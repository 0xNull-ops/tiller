import { useEffect, useRef, useState } from "react";
import type {
  EnvironmentId,
  ProjectId,
  WorkflowInput,
  WorkflowListing,
  WorkflowNestedStep,
  WorkflowStep,
} from "@t3tools/contracts";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { useWorkflowRuns } from "./workflowState";
import { nestableWorkflows, nestedTargetState, type NestedTargetState } from "./workflowNesting";
import { isWorkflowNestedStep } from "./workflowStep";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { WorkflowNestedChildSteps } from "./WorkflowNestedChildSteps";

/** A mapping record's identity, so the same values in another order don't count as a change. */
function mappingKey(record: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.entries(record).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

/** What the child reference resolves to, or that the project is still loading. */
type ChildState = NestedTargetState | "loading";

const CHILD_STATE_MESSAGE: Record<Exclude<ChildState, "ready">, string> = {
  empty: "Pick a workflow to run here.",
  loading: "Loading workflows…",
  missing: "This workflow isn’t in this project any more. Pick another one.",
  unavailable: "This workflow’s file can’t be read, so its steps and inputs are unknown.",
  self: "This step runs the workflow it’s in. Pick another workflow.",
  loops: "This workflow runs back into this one, so it can’t be opened from here.",
};

const NO_INPUTS: Readonly<Record<string, string>> = {};

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Edits the children-only fields of a nested-workflow step: the workflow ref and the input mapping. */
export function WorkflowNestedStepFields(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The workflow being edited: a step can't point at itself or at anything that leads back to it. */
  readonly workflow: string;
  /** The inputs this workflow declares; they are what a child's mapping can interpolate. */
  readonly parentInputs: ReadonlyArray<WorkflowInput>;
  readonly step: WorkflowStep;
  readonly onChange: (patch: Partial<WorkflowNestedStep>) => Promise<boolean>;
  readonly disabled: boolean;
  /** Opens the referenced workflow in the panel, optionally on one of its steps. */
  readonly onOpenWorkflow: (workflow: string, stepId?: string) => void;
}) {
  const runsQuery = useWorkflowRuns(props.environmentId, props.projectId);
  const nested = isWorkflowNestedStep(props.step) ? props.step : null;
  const propSlug = nested?.workflow ?? "";
  const incoming = nested?.inputs ?? NO_INPUTS;
  const incomingKey = mappingKey(incoming);
  const [slug, setSlug] = useState(propSlug);
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...incoming }));
  const [focused, setFocused] = useState(false);
  const draftSlug = useRef(propSlug);
  const propSlugRef = useRef(propSlug);
  const seenKey = useRef(incomingKey);
  const pendingKey = useRef<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize nested workflow fields when the selected definition changes.
  useEffect(() => {
    // The server's reference wins once it changes; a reference picked here stands until then.
    if (propSlugRef.current !== propSlug) {
      propSlugRef.current = propSlug;
      setSlug(propSlug);
      if (draftSlug.current !== propSlug) {
        draftSlug.current = propSlug;
        setDraft({});
      }
      seenKey.current = incomingKey;
      pendingKey.current = null;
      return;
    }
    // The server's record belongs to another reference than the one on screen.
    if (propSlug !== slug) return;
    if (incomingKey === seenKey.current) return;
    // A field being typed into keeps what the user wrote; the server's copy waits.
    if (focused) return;
    if (pendingKey.current !== null) {
      // The stream can still carry the value from before the last save.
      if (incomingKey !== pendingKey.current) return;
      pendingKey.current = null;
      seenKey.current = incomingKey;
      return;
    }
    seenKey.current = incomingKey;
    setDraft({ ...incoming });
  }, [propSlug, slug, incoming, incomingKey, focused]);

  if (!nested) {
    return (
      <p role="alert" className="text-xs text-destructive">
        Step isn’t a nested workflow.
      </p>
    );
  }

  const listing = runsQuery.workflows.find((item) => item.workflow === slug) ?? null;
  const childDefinition = listing?.definition ?? null;
  const declared = childDefinition?.inputs ?? [];
  const options = nestableWorkflows(runsQuery.workflows, props.workflow);
  const childState: ChildState =
    slug !== "" && runsQuery.isPending
      ? "loading"
      : nestedTargetState({
          workflows: runsQuery.workflows,
          parentWorkflow: props.workflow,
          target: slug,
        });
  const childName = childDefinition?.name ?? slug;
  const latestChildRun =
    runsQuery.runs
      .filter((run) => run.workflow === slug)
      .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  const templateId = props.parentInputs[0]?.id ?? "<id>";
  const template = `{{input.${templateId}}}`;

  const pick = async (next: string) => {
    if (props.disabled || next === slug) return;
    const previousSlug = slug;
    const previousDraft = draft;
    setSlug(next);
    setDraft({});
    draftSlug.current = next;
    seenKey.current = mappingKey({});
    pendingKey.current = null;
    if (!(await props.onChange({ workflow: next, inputs: {} }))) {
      setSlug(previousSlug);
      draftSlug.current = previousSlug;
      setDraft(previousDraft);
      seenKey.current = incomingKey;
    }
  };
  const changeDraft = (inputId: string, value: string) => {
    setDraft((current) => ({ ...current, [inputId]: value }));
  };
  const commitDraft = async () => {
    if (props.disabled) return;
    const record: Record<string, string> = {};
    for (const input of declared) {
      const value = draft[input.id] ?? "";
      if (value.trim() !== "") record[input.id] = value;
    }
    const key = mappingKey(record);
    if (key === pendingKey.current || key === seenKey.current) return;
    pendingKey.current = key;
    if (!(await props.onChange({ inputs: record }))) pendingKey.current = null;
  };

  const openable = childState === "ready";
  const missingSkills = listing?.missingSkills ?? [];
  return (
    <section className="space-y-3" aria-label="Nested workflow step">
      <div className="space-y-2 rounded-lg border bg-card p-2.5">
        <h4 className="text-xs font-semibold">Runs workflow</h4>
        {childState === "ready" && childDefinition ? (
          <p className="text-2xs text-muted-foreground">
            {countOf(childDefinition.steps.length, "step", "steps")}
            {declared.length > 0 ? ` · ${countOf(declared.length, "input", "inputs")}` : ""}
            {missingSkills.length > 0
              ? ` · ${countOf(missingSkills.length, "skill missing", "skills missing")}`
              : ""}
          </p>
        ) : (
          <p
            className="text-2xs text-muted-foreground"
            role={childState === "loading" ? "status" : undefined}
          >
            {CHILD_STATE_MESSAGE[childState === "ready" ? "empty" : childState]}
          </p>
        )}
        <Button size="sm" disabled={!openable} onClick={() => props.onOpenWorkflow(slug)}>
          Open workflow
        </Button>
        <NestedWorkflowSelect
          value={slug}
          options={options}
          current={listing}
          disabled={props.disabled}
          onChange={(value) => void pick(value)}
        />
        {runsQuery.error ? (
          <p role="alert" className="text-xs text-destructive">
            Couldn’t load workflows.
          </p>
        ) : null}
      </div>
      {openable && childDefinition ? (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold">Steps · {childName}</h4>
          <WorkflowNestedChildSteps
            key={slug}
            workflowName={childName}
            definition={childDefinition}
            missingSkills={missingSkills}
            run={latestChildRun}
            onEditStep={(stepId) => props.onOpenWorkflow(slug, stepId)}
          />
        </div>
      ) : null}
      <div
        className="space-y-1.5"
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <h4 className="text-xs font-semibold">Inputs sent to {childName}</h4>
        {childState !== "ready" ? (
          <p className="text-2xs text-muted-foreground">{CHILD_STATE_MESSAGE[childState]}</p>
        ) : declared.length === 0 ? (
          <p className="text-2xs text-muted-foreground">This workflow takes no inputs.</p>
        ) : (
          declared.map((input) => (
            <MappingField
              key={input.id}
              input={input}
              value={draft[input.id] ?? ""}
              template={template}
              disabled={props.disabled}
              onChange={changeDraft}
              onCommit={commitDraft}
            />
          ))
        )}
      </div>
    </section>
  );
}

function NestedWorkflowSelect(props: {
  readonly value: string;
  /** The workflows that can be picked: not this one, and not one that leads back to it. */
  readonly options: ReadonlyArray<WorkflowListing>;
  /** The workflow this step points at, when the project still has it. */
  readonly current: WorkflowListing | null;
  readonly disabled: boolean;
  readonly onChange: (next: string) => void;
}) {
  const label = props.current?.definition?.name ?? props.value;
  const selectable = props.options.some((option) => option.workflow === props.value);
  // A reference that can't be picked any more stays on screen, so the step reads honestly.
  const pinned = props.value !== "" && !selectable;
  return (
    <label className="block space-y-1 text-xs font-medium">
      Change workflow
      <Select
        value={props.value || null}
        disabled={props.disabled}
        onValueChange={(value) => {
          if (value) props.onChange(value);
        }}
      >
        <SelectTrigger aria-label="Nested workflow">
          <SelectValue placeholder="Pick a workflow…">{label || "Pick a workflow…"}</SelectValue>
        </SelectTrigger>
        <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
          {pinned ? (
            <SelectItem value={props.value} disabled>
              {label}
            </SelectItem>
          ) : null}
          {props.options.map((option) => (
            <SelectItem key={option.workflow} value={option.workflow}>
              {option.definition?.name ?? option.workflow}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {pinned ? (
        <span className="block text-2xs font-normal text-muted-foreground">
          {props.current === null
            ? `“${props.value}” isn’t in this project any more, so it can’t be picked again.`
            : props.current.definition === null
              ? `“${label}” can’t be loaded, so it can’t be picked again.`
              : `“${label}” runs back into this workflow, so it can’t be picked again.`}
        </span>
      ) : null}
    </label>
  );
}

function MappingField(props: {
  readonly input: WorkflowInput;
  readonly value: string;
  readonly template: string;
  readonly disabled: boolean;
  readonly onChange: (inputId: string, value: string) => void;
  readonly onCommit: () => void;
}) {
  const input = props.input;
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="truncate">{input.label}</span>
        {input.required ? (
          <span className="text-destructive">
            *<span className="sr-only"> required</span>
          </span>
        ) : null}
        <span className="text-2xs">({input.id})</span>
      </span>
      {input.kind === "multiline" ? (
        <Textarea
          size="sm"
          aria-label={`Mapping for ${input.id}`}
          placeholder={props.template}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => props.onChange(input.id, event.target.value)}
          onBlur={props.onCommit}
        />
      ) : (
        <Input
          size="sm"
          aria-label={`Mapping for ${input.id}`}
          placeholder={props.template}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => props.onChange(input.id, event.target.value)}
          onBlur={props.onCommit}
        />
      )}
    </label>
  );
}
