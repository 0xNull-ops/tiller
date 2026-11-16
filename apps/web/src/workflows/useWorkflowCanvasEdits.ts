import { useState } from "react";
import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkflowDefinition,
  WorkflowEdit,
  WorkflowLoop,
  WorkflowSlug,
} from "@t3tools/contracts";
import { useWorkflowEdit } from "./workflowState";
import { isWorkflowSkillStep, type WorkflowStepChoice } from "./workflowStep";
import {
  insertBetween as positionBetween,
  titleFromSkill,
  uniqueStepId,
  withReadsFrom,
} from "./workflowEditing";

function chosenStep(definition: WorkflowDefinition, choice: string | WorkflowStepChoice) {
  const source = typeof choice === "string" ? { kind: "skill" as const, skill: choice } : choice;
  const reference = source.kind === "skill" ? source.skill : source.workflow;
  return {
    id: uniqueStepId(definition, reference),
    title: source.kind === "skill" ? titleFromSkill(source.skill) : source.name,
    ...(source.kind === "skill"
      ? { kind: "skill" as const, skill: source.skill }
      : { kind: "workflow" as const, workflow: source.workflow }),
  };
}

export function useWorkflowCanvasEdits(options: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly workflow: WorkflowSlug | null;
  readonly definition: WorkflowDefinition | null;
  readonly canEdit: boolean;
  readonly onRunCreated: (runId: string) => void;
}) {
  const edit = useWorkflowEdit(options.environmentId);
  // Card and note moves paint immediately; the saved definition replaces this once it arrives.
  // Comparing the source identity means a broadcast for the same definition clears the overlay
  // without a render-time state reset.
  const [optimistic, setOptimistic] = useState<{
    readonly source: WorkflowDefinition;
    readonly definition: WorkflowDefinition;
  } | null>(null);
  const pending = optimistic?.source === options.definition ? optimistic.definition : null;
  const layout = (pending ?? options.definition)?.layout;
  const notes = (pending ?? options.definition)?.notes;

  const applyOptimistic = async (next: WorkflowDefinition, input: WorkflowEdit) => {
    const previous = optimistic;
    setOptimistic({ source: options.definition!, definition: next });
    const result = await edit.run(input);
    if (!result) setOptimistic((current) => (current?.definition === next ? previous : current));
  };

  const target =
    options.projectId && options.workflow
      ? { projectId: options.projectId, workflow: options.workflow }
      : null;
  const editable = options.canEdit && edit.canEdit && target !== null;

  const addStep = async (choice: string | WorkflowStepChoice, after?: string | null) => {
    if (!editable || !options.definition || !target) return;
    const nextAfter = after === undefined ? (options.definition.steps.at(-1)?.id ?? null) : after;
    return edit.run({
      _tag: "stepPut",
      ...target,
      step: {
        ...chosenStep(options.definition, choice),
        readsFrom: nextAfter === null ? [] : [nextAfter],
      },
      after: nextAfter,
    });
  };

  const insertBetween = async (
    from: string | null,
    to: string,
    choice: string | WorkflowStepChoice,
  ) => {
    if (!editable || !options.definition || !target) return;
    const step = chosenStep(options.definition, choice);
    const position = positionBetween(options.definition, from, to, step.id);
    const inserted = await edit.run({
      _tag: "stepPut",
      ...target,
      step,
      after: position.after,
    });
    if (inserted && position.rewired) {
      await edit.run({ _tag: "stepPut", ...target, step: position.rewired, after: undefined });
    }
  };

  const dropSkill = async (name: string, content: string, targetStepId: string | null) => {
    if (!editable || !options.definition || !target) return;
    const written = await edit.run({
      _tag: "skillWrite",
      projectId: target.projectId,
      name,
      content,
      target: "project",
    });
    if (!written) return;
    const step = options.definition.steps.find((item) => item.id === targetStepId);
    if (step) {
      if (!isWorkflowSkillStep(step)) return;
      await edit.run({ _tag: "stepPut", ...target, step: { ...step, skill: name } });
    } else {
      const nextAfter = options.definition.steps.at(-1)?.id ?? null;
      await edit.run({
        _tag: "stepPut",
        ...target,
        step: {
          ...chosenStep(options.definition, name),
          readsFrom: nextAfter === null ? [] : [nextAfter],
        },
        after: nextAfter,
      });
    }
  };

  const removeStep = (stepId: string) => {
    if (!editable || !target) return;
    return edit.run({ _tag: "stepRemove", ...target, stepId });
  };

  const startRun = async (driverThreadId: ThreadId, inputs?: Record<string, string>) => {
    if (!edit.canEdit || !target) return;
    const result = await edit.run({
      _tag: "runStart",
      ...target,
      driverThreadId,
      ...(inputs === undefined ? {} : { inputs }),
    });
    if (result?.runId) options.onRunCreated(result.runId);
  };

  const unlinkSteps = (sourceId: string, targetId: string) => {
    if (!editable || !options.definition || !target) return;
    const step = options.definition.steps.find((entry) => entry.id === targetId);
    if (step)
      return edit.run({
        _tag: "stepPut",
        ...target,
        step: { ...step, readsFrom: (step.readsFrom ?? []).filter((id) => id !== sourceId) },
      });
  };
  const linkSteps = (sourceId: string, targetId: string) => {
    if (!editable || !options.definition || !target) return;
    const updated = withReadsFrom(options.definition, targetId, sourceId);
    if (updated) return edit.run({ _tag: "stepPut", ...target, step: updated });
  };
  const putLoop = (loop: WorkflowLoop) => {
    if (!editable || !target) return;
    return edit.run({ _tag: "loopPut", ...target, loop });
  };
  const removeLoop = (loopId: string) => {
    if (!editable || !target) return;
    return edit.run({ _tag: "loopRemove", ...target, loopId });
  };

  const setLayout = async (positions: NonNullable<WorkflowDefinition["layout"]>, reset = false) => {
    if (!edit.canEdit || !target || !options.definition) return;
    const nextLayout = { ...(reset ? {} : layout), ...positions };
    await applyOptimistic(
      { ...options.definition, layout: nextLayout },
      {
        _tag: "layoutSet",
        ...target,
        positions,
        ...(reset ? { reset } : {}),
      },
    );
  };

  const moveNote = async (id: string, x: number, y: number) => {
    if (!editable || !target || !options.definition) return;
    const note = notes?.find((entry) => entry.id === id);
    if (!note) return;
    const moved = { ...note, x, y };
    await applyOptimistic(
      {
        ...options.definition,
        notes: notes?.map((entry) => (entry.id === id ? moved : entry)),
      },
      { _tag: "notePut", ...target, note: moved },
    );
  };

  const refresh = (runId?: string | null) => {
    if (!edit.canEdit || !options.projectId) return;
    return edit.run({
      _tag: "refresh",
      projectId: options.projectId,
      ...(options.workflow ? { workflow: options.workflow } : {}),
      ...(runId ? { runId } : {}),
    });
  };

  return {
    ...edit,
    editable,
    addStep,
    insertBetween,
    dropSkill,
    removeStep,
    startRun,
    layout,
    notes,
    moveNote,
    setLayout,
    linkSteps,
    unlinkSteps,
    putLoop,
    removeLoop,
    refresh,
  };
}
