import type { ThreadId } from "@t3tools/contracts";

const draftChoices = new Map<ThreadId, boolean>();

export function draftWorkflowFirstChoice(threadId: ThreadId): boolean | undefined {
  return draftChoices.get(threadId);
}

export function setDraftWorkflowFirstChoice(threadId: ThreadId, enabled: boolean): void {
  draftChoices.set(threadId, enabled);
}

export function moveDraftWorkflowFirstChoice(from: ThreadId, to: ThreadId): void {
  const enabled = draftChoices.get(from);
  if (enabled === undefined) return;
  draftChoices.delete(from);
  draftChoices.set(to, enabled);
}
