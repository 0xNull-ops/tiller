import {
  workflowChecksCardKey,
  workflowGateCardKey,
  type WorkflowDefinition,
} from "@t3tools/contracts";
import type { RunGraph, RunGraphNode } from "./runGraph";
import type { RunGraphLayout, RunGraphNodeSize } from "./runGraphLayout";

/** The saved-position key for a card, or null for cards that only exist inside a run. */
export function workflowCardKey(node: RunGraphNode): string | null {
  if (node.kind === "approval" && node.approvalFor) return workflowGateCardKey(node.approvalFor);
  if (node.kind === "check" && node.checkFor) return workflowChecksCardKey(node.checkFor);
  if (node.kind === "step" && node.workflowStepId) return node.workflowStepId;
  return null;
}

/**
 * Automatic layout, with any saved positions laid over it. Every card that was never moved keeps
 * its automatic spot, so adding a step moves only what auto-layout owns.
 */
export function workflowCanvasLayout(
  graph: RunGraph,
  automatic: RunGraphLayout,
  saved: WorkflowDefinition["layout"],
  visualSizes: ReadonlyMap<string, RunGraphNodeSize>,
): RunGraphLayout {
  if (!saved || Object.keys(saved).length === 0) return automatic;
  const positions = new Map(automatic.positions);
  let width = 0;
  let height = 0;
  for (const node of graph.nodes) {
    const key = workflowCardKey(node);
    const position = (key === null ? undefined : saved[key]) ?? positions.get(node.id);
    if (!position) continue;
    positions.set(node.id, position);
    const size = visualSizes.get(node.id) ??
      automatic.nodeSizes?.get(node.id) ?? { width: 200, height: 112 };
    width = Math.max(width, position.x + size.width);
    height = Math.max(height, position.y + size.height);
  }
  return { ...automatic, positions, width, height };
}
