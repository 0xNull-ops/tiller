import type { ProviderInstanceId, ServerProvider, WorkflowSubagentModel } from "@t3tools/contracts";
import { resolveSubagentModels } from "@t3tools/shared/workflowSubagents";

export type ResolvedWorkflowSubagentSelection = {
  readonly hint: WorkflowSubagentModel;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
};

/** Maps each usable picker selection back to the hint that produced it. */
export function resolveWorkflowSubagentSelections(
  hints: ReadonlyArray<WorkflowSubagentModel>,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ResolvedWorkflowSubagentSelection> {
  const resolved = resolveSubagentModels(hints, providers).usable;
  const mapped: Array<ResolvedWorkflowSubagentSelection> = [];
  const usedHints = new Set<WorkflowSubagentModel>();
  for (const selection of resolved) {
    const hint = hints.find((candidate) => {
      if (usedHints.has(candidate)) return false;
      const result = resolveSubagentModels([candidate], providers).usable[0];
      return result?.instanceId === selection.instanceId && result.model === selection.model;
    });
    if (hint) {
      usedHints.add(hint);
      mapped.push({ hint, instanceId: selection.instanceId, model: selection.model });
    }
  }
  return mapped;
}

export function toggleWorkflowSubagentModel(
  hints: ReadonlyArray<WorkflowSubagentModel>,
  selection: WorkflowSubagentModel,
  max: number,
): ReadonlyArray<WorkflowSubagentModel> | null {
  const next = [...hints];
  const index = next.findIndex(
    (hint) => hint.instanceId === selection.instanceId && hint.model === selection.model,
  );
  if (index >= 0) next.splice(index, 1);
  else {
    if (next.length >= max) return null;
    next.push(selection);
  }
  return next.length ? next : null;
}

export function toggleResolvedWorkflowSubagentModel(
  hints: ReadonlyArray<WorkflowSubagentModel>,
  selection: WorkflowSubagentModel,
  providers: ReadonlyArray<ServerProvider>,
  max: number,
): ReadonlyArray<WorkflowSubagentModel> | null {
  const matching = resolveWorkflowSubagentSelections(hints, providers).find(
    (candidate) =>
      candidate.instanceId === selection.instanceId && candidate.model === selection.model,
  );
  if (matching) return removeWorkflowSubagentModel(hints, matching.hint);
  if (hints.length >= max) return null;
  return [...hints, selection];
}

export function removeWorkflowSubagentModel(
  hints: ReadonlyArray<WorkflowSubagentModel>,
  selection: WorkflowSubagentModel,
): ReadonlyArray<WorkflowSubagentModel> | null {
  const next = hints.filter(
    (hint) => hint.instanceId !== selection.instanceId || hint.model !== selection.model,
  );
  return next.length ? next : null;
}
