import { describe, expect, it } from "vite-plus/test";

import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { layoutRunGraph, RUN_GRAPH_NODE, type RunGraphNodeSize } from "./runGraphLayout";
import { workflowCanvasLayout, workflowCardKey } from "./workflowCanvasLayout";

const definition = {
  version: 3 as const,
  name: "Launch",
  steps: [
    {
      id: "build",
      skill: "build",
      gate: true,
      checks: [{ kind: "file" as const, path: "out/index.html" }],
      attachments: [{ id: "node", kind: "requirement" as const, requirement: "node" }],
    },
  ],
};
const graph = buildWorkflowRunGraph(null, definition);
const sizes = new Map<string, RunGraphNodeSize>(
  graph.nodes.map((node) => [node.id, { width: RUN_GRAPH_NODE.width, height: 112 }]),
);
const automatic = layoutRunGraph(graph, { ...RUN_GRAPH_NODE, height: 112 }, "horizontal", sizes);

describe("workflowCanvasLayout", () => {
  it("keys every draggable card type", () => {
    expect(graph.nodes.map((node) => [node.kind, workflowCardKey(node)])).toEqual([
      ["workflow", null],
      ["approval", "gate:build"],
      ["step", "build"],
      ["check", "checks:build"],
    ]);
  });

  it("keeps automatic layout when nothing was saved", () => {
    expect(workflowCanvasLayout(graph, automatic, undefined, sizes)).toBe(automatic);
    expect(workflowCanvasLayout(graph, automatic, {}, sizes)).toBe(automatic);
  });

  it("lays saved positions over automatic ones and ignores unknown keys", () => {
    const layout = workflowCanvasLayout(
      graph,
      automatic,
      {
        build: { x: 400, y: 20 },
        "gate:build": { x: 100, y: 20 },
        "checks:build": { x: 2000, y: 20 },
        "future:build": { x: 900, y: 900 },
      },
      sizes,
    );
    expect(layout.positions.get("draft:Launch:build")).toEqual({ x: 400, y: 20 });
    expect(layout.positions.get("draft:Launch:approval:build")).toEqual({ x: 100, y: 20 });
    expect(layout.positions.get("draft:Launch:check:build")).toEqual({ x: 2000, y: 20 });
    expect(layout.positions.size).toBe(graph.nodes.length);
    expect(layout.width).toBe(2000 + RUN_GRAPH_NODE.width);
  });
});
