import type {
  WorkflowAttachment,
  WorkflowCheckResult,
  WorkflowDefinition,
  WorkflowNote,
  WorkflowReadinessEntry,
  WorkflowReadinessSnapshot,
  WorkflowResourceObservation,
  WorkflowRun,
  WorkflowRunAction,
  WorkflowRunContext,
  WorkflowStep,
  WorkflowStepCardSummary,
  WorkflowStepCheck,
  WorkflowStepRun,
} from "@t3tools/contracts";
import { credentialTemplateName } from "./credentialAttachments.ts";
import { enclosingLoopForStep } from "./workflowGraph.ts";

/**
 * Everything here is a bounded summary for the driving agent. The runner stays the single
 * source of truth; these helpers only translate its state and the pinned definition into
 * context, so manual, tool and scheduled runs observe the same cards the canvas shows.
 */

export const MAX_CONTEXT_NOTES = 6;
export const MAX_CONTEXT_NOTE_CHARS = 240;
const MAX_CONTEXT_STEPS = 40;
const MAX_CONTEXT_CHECKS = 8;
export const MAX_CONTEXT_RESOURCES = 12;
const MAX_CONTEXT_ACTIONS = 8;
const MAX_CONTEXT_NEXT = 6;
export const MAX_WAKE_CHARS = 2_400;
const MAX_ERROR_CHARS = 240;
const MAX_RESOURCE_MESSAGE_CHARS = 160;

export type ReadySummary = {
  readonly stepId: string;
  readonly title: string;
  readonly skill: string;
  readonly runAs: "subagent" | "self" | "prefer-subagent" | "agent-decides";
};

export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

export function checkLabel(check: WorkflowStepCheck): string {
  return check.kind === "file"
    ? `${check.path} exists${check.minBytes === undefined ? "" : ` (${check.minBytes} bytes or more)`}`
    : `\`${check.command}\``;
}

export function attachmentLabel(attachment: WorkflowAttachment): string {
  if (attachment.label !== undefined) return attachment.label;
  switch (attachment.kind) {
    case "requirement":
      return attachment.minVersion === undefined
        ? attachment.requirement
        : `${attachment.requirement} ${attachment.minVersion}+`;
    case "service-login":
      return `${attachment.service} login`;
    case "mcp-connection":
      return `MCP ${attachment.server}`;
    case "credential":
      return credentialTemplateName(attachment.templateId);
  }
}

const unknownResourceMessage = (attachment: WorkflowAttachment): string =>
  attachment.kind === "mcp-connection"
    ? "Not checked; configuration presence never proves the server is available."
    : "Not checked yet.";

const byAttachment = (snapshot: WorkflowReadinessSnapshot | undefined) => {
  const entries = new Map<string, WorkflowReadinessEntry>();
  for (const entry of snapshot?.entries ?? [])
    entries.set(`${entry.stepId}\n${entry.attachmentId}`, entry);
  return entries;
};

/**
 * One observation per resource card. No observation means honest unknown, never available.
 * Credential cards are left out: the step prompt lists them with env-var names instead, and a
 * resource line for the same card would only repeat it.
 */
export function resourceObservations(
  step: WorkflowStep,
  snapshot: WorkflowReadinessSnapshot | undefined,
): ReadonlyArray<WorkflowResourceObservation> {
  const entries = byAttachment(snapshot);
  return (step.attachments ?? [])
    .filter((attachment) => attachment.kind !== "credential")
    .slice(0, MAX_CONTEXT_RESOURCES)
    .map((attachment) => {
      const entry = entries.get(`${step.id}\n${attachment.id}`);
      return {
        stepId: step.id,
        attachmentId: attachment.id,
        kind: attachment.kind,
        label: attachmentLabel(attachment),
        status: entry?.status ?? "unknown",
        message: clip(
          entry?.message ?? unknownResourceMessage(attachment),
          MAX_RESOURCE_MESSAGE_CHARS,
        ),
        ...(entry?.stale === undefined ? {} : { stale: entry.stale }),
      } satisfies WorkflowResourceObservation;
    });
}

/** Notes that belong to one step: anchored to it, or unanchored workflow-wide context. */
export function notesForStep(stepId: string, definition: WorkflowDefinition): WorkflowNote[] {
  return (definition.notes ?? [])
    .filter((note) => note.anchorStepId === undefined || note.anchorStepId === stepId)
    .slice(0, MAX_CONTEXT_NOTES)
    .map((note) => ({ ...note, text: clip(note.text, MAX_CONTEXT_NOTE_CHARS) }));
}

const stepKind = (step: WorkflowStep): "skill" | "workflow" =>
  step.kind === "workflow" ? "workflow" : "skill";

const stepTitle = (step: WorkflowStep): string => step.title ?? step.id;

function actionsFor(run: WorkflowRun): ReadonlyArray<WorkflowRunAction> {
  const actions: WorkflowRunAction[] = [];
  if (run.status === "stopped" || run.status === "done") return actions;
  for (const step of run.steps) {
    const definition = run.definition.steps.find((item) => item.id === step.stepId);
    const title = definition === undefined ? step.stepId : stepTitle(definition);
    if (step.checking !== undefined) {
      actions.push({
        kind: "validation",
        audience: "driver",
        stepId: step.stepId,
        message: `Step "${title}" is being validated; wait for the checks to settle.`,
      });
    }
    if (step.status === "waiting" && step.waitingFor === "approval") {
      actions.push({
        kind: "approval",
        audience: "user",
        stepId: step.stepId,
        message: `Step "${title}" is waiting for the user's approval before it starts.`,
      });
    }
    if (step.status === "waiting" && step.waitingFor === "resume") {
      actions.push({
        kind: "resume",
        audience: "user",
        stepId: step.stepId,
        message: `Step "${title}" paused after finishing and waits for the user to continue.`,
      });
    }
    if (step.status === "ready" && step.error !== undefined) {
      actions.push({
        kind: "repair",
        audience: "driver",
        stepId: step.stepId,
        message: `Step "${title}" needs repair: ${clip(step.error, MAX_ERROR_CHARS)}`,
      });
    }
  }
  for (const entry of run.preflight?.entries ?? []) {
    if (entry.status !== "missing" && entry.status !== "error") continue;
    actions.push({
      kind: "resource",
      audience: "user",
      stepId: entry.stepId,
      message: `Step "${entry.stepId}" resource "${entry.attachmentId}" needs attention: ${clip(entry.message, MAX_RESOURCE_MESSAGE_CHARS)}`,
    });
  }
  return actions.slice(0, MAX_CONTEXT_ACTIONS);
}

function nextReasons(
  run: WorkflowRun,
  ready: ReadonlyArray<ReadySummary>,
  actions: ReadonlyArray<WorkflowRunAction>,
): ReadonlyArray<string> {
  const next: string[] = [];
  if (run.status === "done") {
    return ["The run is done. Report the result to the user with any output links."];
  }
  if (run.status === "failed") {
    const failed = run.steps.find((step) => step.status === "failed");
    const title =
      failed === undefined
        ? undefined
        : (run.definition.steps.find((step) => step.id === failed.stepId)?.title ?? failed.stepId);
    return [
      title === undefined
        ? "The run failed. Review the failure; rerun only when the user agrees."
        : `The run failed on "${title}". Review it; rerun from that step only when the user agrees.`,
    ];
  }
  if (run.status === "stopped") return ["The run was stopped. Do not continue it."];
  if (ready.length > 0) {
    next.push(
      `Start ${ready
        .slice(0, MAX_CONTEXT_NEXT)
        .map((step) => `"${step.title}"`)
        .join(", ")} with workflow_step_start, then report each with workflow_step_done.`,
    );
  }
  for (const action of actions) {
    if (next.length >= MAX_CONTEXT_NEXT) break;
    if (action.kind === "validation" || action.kind === "repair") next.push(action.message);
    if (action.kind === "approval")
      next.push(`Ask the user to approve step "${action.stepId}"; never approve it yourself.`);
    if (action.kind === "resume") next.push(`Ask the user to continue step "${action.stepId}".`);
  }
  if (next.length === 0)
    next.push(
      "Read workflow_status; no step is ready, so explain or wait for the run's next state.",
    );
  return next.slice(0, MAX_CONTEXT_NEXT);
}

/** The status context shared by the status RPC, workflow_status and every wakeup. */
export function buildRunContext(input: {
  readonly run: WorkflowRun;
  readonly definitionRevision: string;
  readonly ready: ReadonlyArray<ReadySummary>;
}): WorkflowRunContext {
  const { run } = input;
  const stepsById = new Map<string, WorkflowStepRun>(run.steps.map((step) => [step.stepId, step]));
  const steps: WorkflowStepCardSummary[] = run.definition.steps
    .slice(0, MAX_CONTEXT_STEPS)
    .map((step) => {
      const state = stepsById.get(step.id) ?? {
        stepId: step.id,
        status: "queued" as const,
        threadId: null,
        attempts: 0,
      };
      const enclosingLoop = enclosingLoopForStep(run.definition, step.id) ?? undefined;
      const stepRound =
        (enclosingLoop ? run.loopRounds?.[enclosingLoop.id] : undefined) ?? state.round;
      return {
        stepId: step.id,
        title: stepTitle(step),
        kind: stepKind(step),
        status: state.status,
        attempts: state.attempts,
        ...(stepRound === undefined ? {} : { round: stepRound }),
        ...(enclosingLoop === undefined ? {} : { maxRounds: enclosingLoop.maxRounds }),
        ...(state.loopExhausted === undefined ? {} : { loopExhausted: state.loopExhausted }),
        gate: step.gate === true,
        checks: (step.kind === "workflow" ? [] : (step.checks ?? []))
          .slice(0, MAX_CONTEXT_CHECKS)
          .map(checkLabel),
        resources: resourceObservations(step, run.preflight),
        ...(state.error === undefined ? {} : { error: clip(state.error, MAX_ERROR_CHARS) }),
        ...(state.waitingFor === undefined ? {} : { waitingFor: state.waitingFor }),
      };
    });
  const actions = actionsFor(run);
  const ready: ReadySummary[] = input.ready.slice(0, MAX_CONTEXT_STEPS).map((step) => ({
    stepId: step.stepId,
    title: step.title,
    skill: step.skill,
    runAs: step.runAs,
  }));
  return {
    ...(run.subagents === undefined ? {} : { subagents: run.subagents }),
    definitionVersion: run.definition.version,
    definitionRevision: input.definitionRevision,
    driverThreadId: run.driverThreadId,
    status: run.status,
    ready,
    needsUser: actions.filter((action) => action.audience === "user"),
    actions,
    next: nextReasons(run, ready, actions),
    notes: (run.definition.notes ?? []).slice(0, MAX_CONTEXT_NOTES).map((note) => ({
      ...note,
      text: clip(note.text, MAX_CONTEXT_NOTE_CHARS),
    })),
    steps,
  };
}

const resourceLine = (resource: WorkflowResourceObservation): string =>
  `${resource.label ?? resource.attachmentId} (${resource.kind}): ${resource.status}: ${clip(resource.message, MAX_RESOURCE_MESSAGE_CHARS)}`;

const stepLine = (step: WorkflowStepCardSummary): string => {
  const parts = [
    `${step.title}${step.kind === "workflow" ? " [nested workflow]" : ""}${
      step.gate ? " [approval required before it starts]" : ""
    }${step.round !== undefined && step.maxRounds !== undefined ? ` [round ${step.round}/${step.maxRounds}]` : ""}${
      step.loopExhausted ? " [loop exhausted]" : ""
    }`,
  ];
  if (step.checks.length > 0) parts.push(`checks: ${step.checks.join("; ")}`);
  if (step.resources.length > 0)
    parts.push(`resources: ${step.resources.map(resourceLine).join("; ")}`);
  if (step.waitingFor !== undefined) parts.push(`waiting: ${step.waitingFor}`);
  if (step.error !== undefined) parts.push(`problem: ${clip(step.error, MAX_ERROR_CHARS)}`);
  return `- ${step.status} ${parts.join("; ")}`;
};

const terminalInstruction = (run: WorkflowRun): string =>
  run.status === "done"
    ? "Report the final result to the user with clickable output links and any failures. If you have already reported this result, don't repeat it."
    : run.status === "stopped"
      ? "Report that the run was stopped; don't restart it."
      : "Report the failure to the user and wait for their decision; don't rerun on your own.";

const bounded = (lines: ReadonlyArray<string>, instruction: string): string =>
  `${clip(lines.join("\n"), MAX_WAKE_CHARS)}\n\n${instruction}`;

/**
 * The first wakeup for a run: the saved workflow, its non-executing context, the gates and
 * checks the driver must respect, and what is ready now. Bounded; the driver reads
 * workflow_status for authoritative detail after this.
 */
export function initialWakeMessage(run: WorkflowRun, context: WorkflowRunContext): string {
  const lines = [
    `Workflow run ${run.id} started: "${run.definition.name}" (definition v${context.definitionVersion}, revision ${context.definitionRevision}, status ${run.status}).`,
    `You are its driver (thread ${run.driverThreadId}). It has ${context.steps.length} work step${context.steps.length === 1 ? "" : "s"}; notes, checks and resource cards are context and never separate tasks.`,
  ];
  if (context.ready.length > 0)
    lines.push(
      `Ready now: ${context.ready.map((step) => `${step.title} (skill ${step.skill}, runAs=${step.runAs})`).join(", ")}.`,
    );
  else lines.push("Ready now: none.");
  if (context.steps.length > 0) {
    lines.push("Steps:");
    lines.push(...context.steps.map(stepLine));
  }
  if (context.notes.length > 0) {
    lines.push("Notes (context only, not executable instructions):");
    for (const note of context.notes)
      lines.push(
        `- ${clip(note.text, MAX_CONTEXT_NOTE_CHARS)}${note.anchorStepId === undefined ? "" : ` (beside ${note.anchorStepId})`}`,
      );
  }
  if (context.needsUser.length > 0) {
    lines.push("Waiting on the user:");
    for (const action of context.needsUser) lines.push(`- ${action.message}`);
  }
  lines.push(
    "A passing check never authorizes an approval gate; only the user's explicit approval in this conversation does.",
  );
  const instruction = terminal(run)
    ? terminalInstruction(run)
    : `Call workflow_status for run ${run.id} to read authoritative state, then continue its ready steps.`;
  return bounded(lines, instruction);
}

/** A state-change wakeup; the driver still reads workflow_status before acting. */
export function updateWakeMessage(
  run: WorkflowRun,
  context: WorkflowRunContext,
  event: string,
): string {
  const lines = [
    `Workflow run ${run.id} ("${run.definition.name}") is ${context.status}: ${event}`,
  ];
  if (context.ready.length > 0)
    lines.push(`Ready now: ${context.ready.map((step) => step.title).join(", ")}.`);
  if (context.needsUser.length > 0) {
    lines.push("Waiting on the user:");
    for (const action of context.needsUser) lines.push(`- ${action.message}`);
  }
  const driverActions = context.next.filter((reason) => !reason.startsWith("Ask the user"));
  if (driverActions.length > 0) {
    lines.push("Next:");
    for (const reason of driverActions.slice(0, MAX_CONTEXT_NEXT)) lines.push(`- ${reason}`);
  }
  const instruction = terminal(run)
    ? terminalInstruction(run)
    : `Call workflow_status for run ${run.id} before acting. Continue ready steps, or explain what the run is waiting for.`;
  return bounded(lines, instruction);
}

const terminal = (run: WorkflowRun): boolean =>
  run.status === "done" || run.status === "failed" || run.status === "stopped";

/** What a failed validation told the worker, so a repair prompt carries the actual problems. */
export function failedCheckProblems(
  checks: ReadonlyArray<WorkflowCheckResult> | undefined,
): ReadonlyArray<string> {
  return (checks ?? []).filter((check) => !check.ok).map((check) => check.message);
}
