import type { RunGraph } from "./runGraph";
import type { RunGraphDirection, RunGraphLayout } from "./runGraphLayout";

type Point = { readonly x: number; readonly y: number };
type NodeSize = { readonly width: number; readonly height: number };

/** Where a connection leaves one card and enters the next. */
export function edgeEnds(
  from: Point,
  to: Point,
  size: NodeSize,
  direction: RunGraphDirection,
  destinationSize: NodeSize = size,
) {
  return direction === "vertical"
    ? {
        start: { x: from.x + size.width / 2, y: from.y + size.height },
        end: { x: to.x + destinationSize.width / 2, y: to.y },
      }
    : {
        start: { x: from.x + size.width, y: from.y + size.height / 2 },
        end: { x: to.x, y: to.y + destinationSize.height / 2 },
      };
}

/** The size a card was laid out with, when the layout knows per-card sizes. */
function sizeOfNode(layout: RunGraphLayout, nodeId: string, fallback: NodeSize): NodeSize {
  return layout.nodeSizes?.get(nodeId) ?? fallback;
}

/** A smooth curve that leaves and enters along the graph's direction. */
export function edgePath(start: Point, end: Point, direction: RunGraphDirection): string {
  if (direction === "vertical") {
    const bend = Math.max(24, Math.abs(end.y - start.y) / 2);
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
  }
  const bend = Math.max(24, Math.abs(end.x - start.x) / 2);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

/**
 * A place on the canvas where a new step can go: the middle of a connection, or just after a
 * step nothing follows. `x`/`y` are its centre in canvas units.
 */
export interface CanvasSpot {
  readonly key: string;
  readonly kind: "edge" | "append";
  readonly x: number;
  readonly y: number;
  /** The step a new or moved step goes after; null puts it first. */
  readonly after: string | null;
  /** For connections, the step on the far end. */
  readonly toStepId: string | null;
}

const APPEND_GAP = 36;

export const stepIdOfNode = (nodeId: string) => nodeId.slice(nodeId.lastIndexOf(":") + 1);

export function canvasSpots(
  graph: RunGraph,
  layout: RunGraphLayout,
  nodeSize: NodeSize,
  direction: RunGraphDirection = "horizontal",
): CanvasSpot[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const spots: CanvasSpot[] = [];
  for (const edge of graph.edges) {
    const from = layout.positions.get(edge.from);
    const to = layout.positions.get(edge.to);
    const targetNode = nodesById.get(edge.to);
    const targetKind = targetNode?.kind;
    // The internal gate-to-step edge is structural. Insertion belongs on the gate's incoming edge.
    if (
      edge.kind === "skip" ||
      edge.kind === "feedback" ||
      from === undefined ||
      to === undefined ||
      (targetKind !== "step" && targetKind !== "approval") ||
      (nodesById.get(edge.from)?.kind === "approval" && targetKind === "step")
    )
      continue;
    const { start, end } = edgeEnds(
      from,
      to,
      sizeOfNode(layout, edge.from, nodeSize),
      direction,
      sizeOfNode(layout, edge.to, nodeSize),
    );
    spots.push({
      key: edge.id,
      kind: "edge",
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      after:
        nodesById.get(edge.from)?.kind === "step" || nodesById.get(edge.from)?.kind === "check"
          ? (nodesById.get(edge.from)?.workflowStepId ??
            nodesById.get(edge.from)?.checkFor ??
            stepIdOfNode(edge.from))
          : null,
      toStepId:
        targetKind === "approval"
          ? (targetNode?.approvalFor ?? null)
          : (targetNode?.workflowStepId ?? stepIdOfNode(edge.to)),
    });
  }
  for (const node of graph.nodes) {
    if (
      (node.kind !== "step" && node.kind !== "check") ||
      graph.edges.some((edge) => edge.kind !== "feedback" && edge.from === node.id)
    )
      continue;
    const position = layout.positions.get(node.id);
    if (position === undefined) continue;
    const size = sizeOfNode(layout, node.id, nodeSize);
    spots.push({
      key: `append:${node.id}`,
      kind: "append",
      ...(direction === "vertical"
        ? { x: position.x + size.width / 2, y: position.y + size.height + APPEND_GAP }
        : { x: position.x + size.width + APPEND_GAP, y: position.y + size.height / 2 }),
      after: node.workflowStepId ?? node.checkFor ?? stepIdOfNode(node.id),
      toStepId: null,
    });
  }
  return spots;
}

/** The step card under a point, if any. */
export function stepAtPoint(
  graph: RunGraph,
  layout: RunGraphLayout,
  nodeSize: NodeSize,
  point: Point,
): string | null {
  for (const node of graph.nodes) {
    if (node.kind !== "step" && node.kind !== "approval" && node.kind !== "check") continue;
    const position = layout.positions.get(node.id);
    if (position === undefined) continue;
    const size = sizeOfNode(layout, node.id, nodeSize);
    if (
      point.x >= position.x &&
      point.x <= position.x + size.width &&
      point.y >= position.y &&
      point.y <= position.y + size.height
    )
      return node.workflowStepId ?? node.approvalFor ?? node.checkFor ?? stepIdOfNode(node.id);
  }
  return null;
}
