import type { WorkflowDefinition } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { canvasSpots, stepAtPoint } from "./canvasSpots";
import { layoutRunGraph, RUN_GRAPH_NODE, type RunGraphNodeSize } from "./runGraphLayout";

const definition: WorkflowDefinition = {
  version: 1,
  name: "Launch",
  steps: [
    { id: "a", skill: "brief" },
    { id: "b", skill: "design" },
    { id: "c", skill: "deploy" },
  ],
};
const graph = buildWorkflowRunGraph(null, definition);
const layout = layoutRunGraph(graph);

describe("canvas spots", () => {
  it("puts a spot on every connection into a step and after the last step", () => {
    const spots = canvasSpots(graph, layout, RUN_GRAPH_NODE);
    expect(spots.map((spot) => [spot.kind, spot.after, spot.toStepId])).toEqual([
      ["edge", null, "a"],
      ["edge", "a", "b"],
      ["edge", "b", "c"],
      ["append", "c", null],
    ]);
  });

  it("finds the card under a point", () => {
    const b = layout.positions.get(`draft:Launch:b`)!;
    expect(stepAtPoint(graph, layout, RUN_GRAPH_NODE, { x: b.x + 5, y: b.y + 5 })).toBe("b");
    expect(stepAtPoint(graph, layout, RUN_GRAPH_NODE, { x: -50, y: -50 })).toBeNull();
  });

  it("enters a card of its own height and leaves it after its own width", () => {
    const tall = new Map<string, RunGraphNodeSize>([
      ["draft:Launch:b", { width: RUN_GRAPH_NODE.width, height: 160 }],
    ]);
    const tallLayout = layoutRunGraph(graph, RUN_GRAPH_NODE, "horizontal", tall);
    const a = tallLayout.positions.get("draft:Launch:a")!;
    const b = tallLayout.positions.get("draft:Launch:b")!;
    const spots = canvasSpots(graph, tallLayout, RUN_GRAPH_NODE, "horizontal");
    const edge = spots.find((spot) => spot.key === "draft:Launch:a->draft:Launch:b")!;
    // The connection leaves the side of the source and enters the middle of the tall card.
    expect([edge.x, edge.y]).toEqual([(a.x + RUN_GRAPH_NODE.width + b.x) / 2, 80]);
    const plain = canvasSpots(graph, layout, RUN_GRAPH_NODE).find(
      (spot) => spot.key === "draft:Launch:a->draft:Launch:b",
    )!;
    expect(plain.y).toBe(32);
    // The "+" after the last step follows the card it belongs to.
    const append = spots.find((spot) => spot.key === "append:draft:Launch:c")!;
    const c = tallLayout.positions.get("draft:Launch:c")!;
    expect([append.x, append.y]).toEqual([c.x + RUN_GRAPH_NODE.width + 36, c.y + 32]);
  });

  it("runs a vertical connection between cards of their own heights", () => {
    const tall = new Map<string, RunGraphNodeSize>([
      ["draft:Launch:a", { width: RUN_GRAPH_NODE.width, height: 100 }],
      ["draft:Launch:b", { width: RUN_GRAPH_NODE.width, height: 160 }],
    ]);
    const tallLayout = layoutRunGraph(graph, RUN_GRAPH_NODE, "vertical", tall);
    const a = tallLayout.positions.get("draft:Launch:a")!;
    const b = tallLayout.positions.get("draft:Launch:b")!;
    const spots = canvasSpots(graph, tallLayout, RUN_GRAPH_NODE, "vertical");
    const edge = spots.find((spot) => spot.key === "draft:Launch:a->draft:Launch:b")!;
    // The connection leaves the bottom of the source and enters the top of the destination.
    expect([edge.x, edge.y]).toEqual([100, (a.y + 100 + b.y) / 2]);
    // The tall card is hit below the height it would have with one size for every card.
    const probe = { x: b.x + 5, y: b.y + 100 };
    expect(stepAtPoint(graph, tallLayout, RUN_GRAPH_NODE, probe)).toBe("b");
    expect(stepAtPoint(graph, layout, RUN_GRAPH_NODE, probe)).not.toBe("b");
  });

  it("offers insertion before a gated step on its incoming edge, never inside the gate", () => {
    const gated = buildWorkflowRunGraph(null, {
      ...definition,
      steps: definition.steps.map((step) => (step.id === "b" ? { ...step, gate: true } : step)),
    });
    const gatedLayout = layoutRunGraph(gated);
    const spots = canvasSpots(gated, gatedLayout, RUN_GRAPH_NODE);
    expect(spots.map(({ key, kind, after, toStepId }) => [key, kind, after, toStepId])).toEqual([
      ["draft:Launch->draft:Launch:a", "edge", null, "a"],
      ["draft:Launch:a->draft:Launch:approval:b", "edge", "a", "b"],
      ["draft:Launch:b->draft:Launch:c", "edge", "b", "c"],
      ["append:draft:Launch:c", "append", "c", null],
    ]);
    const gatePosition = gatedLayout.positions.get("draft:Launch:approval:b")!;
    expect(
      stepAtPoint(gated, gatedLayout, RUN_GRAPH_NODE, {
        x: gatePosition.x + RUN_GRAPH_NODE.width / 2,
        y: gatePosition.y + RUN_GRAPH_NODE.height / 2,
      }),
    ).toBe("b");
  });

  it("keeps check-to-work insertion external and appends after the owner group", () => {
    const checked = buildWorkflowRunGraph(null, {
      ...definition,
      steps: definition.steps.map((step) =>
        step.id === "b"
          ? { ...step, checks: [{ kind: "file" as const, path: "dist/index.html" }] }
          : step,
      ),
    });
    const checkedLayout = layoutRunGraph(checked);
    const spots = canvasSpots(checked, checkedLayout, RUN_GRAPH_NODE);
    expect(spots.map(({ key, kind, after, toStepId }) => [key, kind, after, toStepId])).toEqual([
      ["draft:Launch->draft:Launch:a", "edge", null, "a"],
      ["draft:Launch:a->draft:Launch:b", "edge", "a", "b"],
      ["draft:Launch:check:b->draft:Launch:c", "edge", "b", "c"],
      ["append:draft:Launch:c", "append", "c", null],
    ]);
    const checkPosition = checkedLayout.positions.get("draft:Launch:check:b")!;
    expect(
      stepAtPoint(checked, checkedLayout, RUN_GRAPH_NODE, {
        x: checkPosition.x + 1,
        y: checkPosition.y + 1,
      }),
    ).toBe("b");
  });
});
