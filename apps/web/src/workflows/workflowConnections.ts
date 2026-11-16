import type { RunGraph } from "./runGraph";
import type { RunGraphDirection, RunGraphLayout } from "./runGraphLayout";

function packEdgeLanes(
  graph: RunGraph,
  layout: RunGraphLayout,
  direction: RunGraphDirection,
  kind: "skip" | "feedback",
) {
  const vertical = direction === "vertical";
  const intervals = graph.edges
    .filter((edge) => edge.kind === kind)
    .flatMap((edge) => {
      const from = layout.positions.get(edge.from);
      const to = layout.positions.get(edge.to);
      if (!from || !to) return [];
      const a = vertical ? from.y : from.x;
      const b = vertical ? to.y : to.x;
      return [{ id: edge.id, low: Math.min(a, b), high: Math.max(a, b) }];
    })
    .sort((a, b) => a.high - a.low - (b.high - b.low) || a.id.localeCompare(b.id));
  const lanes: (typeof intervals)[] = [];
  const result = new Map<string, number>();
  for (const interval of intervals) {
    let lane = lanes.findIndex((entries) =>
      entries.every((other) => interval.high < other.low || interval.low > other.high),
    );
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane]!.push(interval);
    result.set(interval.id, lane);
  }
  return result;
}

export function connectionLanes(
  graph: RunGraph,
  layout: RunGraphLayout,
  direction: RunGraphDirection,
) {
  return packEdgeLanes(graph, layout, direction, "skip");
}

export function feedbackConnectionLanes(
  graph: RunGraph,
  layout: RunGraphLayout,
  direction: RunGraphDirection,
) {
  return packEdgeLanes(graph, layout, direction, "feedback");
}

export function connectionLayout(
  graph: RunGraph,
  layout: RunGraphLayout,
  direction: RunGraphDirection,
): RunGraphLayout {
  const lanes = connectionLanes(graph, layout, direction);
  const feedbackLanes = feedbackConnectionLanes(graph, layout, direction);
  const skipReserve = lanes.size ? (Math.max(...lanes.values()) + 1) * 32 + 24 : 0;
  const feedbackReserve = feedbackLanes.size
    ? (Math.max(...feedbackLanes.values()) + 1) * 36 + 24
    : 0;
  if (!skipReserve && !feedbackReserve) return layout;
  if (direction === "vertical") {
    return {
      ...layout,
      ...(feedbackReserve
        ? {
            positions: new Map(
              [...layout.positions].map(([id, point]) => [
                id,
                { ...point, x: point.x + feedbackReserve },
              ]),
            ),
          }
        : {}),
      width: layout.width + skipReserve + feedbackReserve,
    };
  }
  return {
    ...layout,
    ...(skipReserve
      ? {
          positions: new Map(
            [...layout.positions].map(([id, point]) => [
              id,
              { ...point, y: point.y + skipReserve },
            ]),
          ),
        }
      : {}),
    height: layout.height + skipReserve + feedbackReserve,
  };
}

export function skipConnectionPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rail: number,
  direction: RunGraphDirection,
) {
  return direction === "vertical"
    ? `M ${start.x} ${start.y} C ${rail} ${start.y}, ${rail} ${end.y}, ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} C ${start.x} ${rail}, ${end.x} ${rail}, ${end.x} ${end.y}`;
}

export function feedbackConnectionPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rail: number,
  direction: RunGraphDirection,
) {
  return skipConnectionPath(start, end, rail, direction);
}
