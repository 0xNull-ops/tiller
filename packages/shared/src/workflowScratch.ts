/**
 * A workflow a thread's agent created while Workflow-first was on. Version 3 keeps the
 * marker on the definition, so a listing that carries one is scratch until the user keeps
 * it. Web and mobile derive their "From threads" grouping here so the two cannot drift.
 *
 * The view is structural because the marker is additive to version 3 and older definitions
 * simply lack it. Only its presence and the thread it names matter to a client.
 */
export interface WorkflowScratchView {
  readonly definition: object | null;
}

interface WorkflowScratchOriginView {
  readonly threadId?: string;
}

function readOrigin(value: unknown): WorkflowScratchOriginView | null {
  if (typeof value !== "object" || value === null) return null;
  return "threadId" in value && typeof value.threadId === "string"
    ? { threadId: value.threadId }
    : {};
}

/** The scratch origin a definition carries, or null on an ordinary or unreadable one. */
function workflowScratchOrigin(workflow: WorkflowScratchView): WorkflowScratchOriginView | null {
  const definition = workflow.definition;
  if (definition === null) return null;
  return "origin" in definition ? readOrigin(definition.origin) : null;
}

/** The thread that created a scratch workflow; null on an ordinary one. */
export function workflowScratchThreadId(workflow: WorkflowScratchView): string | null {
  return workflowScratchOrigin(workflow)?.threadId ?? null;
}

export function isScratchWorkflow(workflow: WorkflowScratchView): boolean {
  return workflowScratchOrigin(workflow) !== null;
}

export interface WorkflowScratchGroups<T> {
  readonly regular: readonly T[];
  readonly scratch: readonly T[];
}

/**
 * Splits in input order. Callers sort first, and each group keeps that order, so keeping
 * a workflow moves it from one group to the other without reordering its neighbours.
 */
export function splitScratchWorkflows<T extends WorkflowScratchView>(
  workflows: readonly T[],
): WorkflowScratchGroups<T> {
  const regular: T[] = [];
  const scratch: T[] = [];
  for (const workflow of workflows) {
    if (isScratchWorkflow(workflow)) scratch.push(workflow);
    else regular.push(workflow);
  }
  return { regular, scratch };
}
