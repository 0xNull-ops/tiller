import { describe, expect, it } from "vite-plus/test";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { canvasSpots } from "./canvasSpots";
import { layoutRunGraph, RUN_GRAPH_NODE } from "./runGraphLayout";
import { connectionLanes, connectionLayout, feedbackConnectionLanes } from "./workflowConnections";

const definition = {
  version: 3 as const,
  name: "Links",
  steps: [
    { id: "a", skill: "a" },
    { id: "b", skill: "b" },
    { id: "c", skill: "c", readsFrom: ["a", "b"] },
    { id: "d", skill: "d", readsFrom: ["a", "c"] },
  ],
};

describe("workflow connections", () => {
  it("classifies dependencies and excludes skip edges from insertion", () => {
    const graph = buildWorkflowRunGraph(null, definition);
    expect(graph.edges.map((edge) => edge.kind)).toEqual([
      "spine",
      "spine",
      "skip",
      "spine",
      "skip",
      "spine",
    ]);
    const layout = layoutRunGraph(graph);
    const spots = canvasSpots(graph, layout, RUN_GRAPH_NODE);
    for (const edge of graph.edges.filter((edge) => edge.kind === "skip")) {
      expect(spots.some((spot) => spot.key === edge.id)).toBe(false);
    }
    const independent = buildWorkflowRunGraph(null, {
      ...definition,
      steps: [
        { id: "a", skill: "a" },
        { id: "b", skill: "b", readsFrom: [] },
      ],
    });
    expect(independent.edges.every((edge) => edge.from === "draft:Links")).toBe(true);
  });
  it.each(["horizontal", "vertical"] as const)(
    "reserves distinct lanes and bounds in %s layout",
    (direction) => {
      const graph = buildWorkflowRunGraph(null, definition);
      const base = layoutRunGraph(graph, RUN_GRAPH_NODE, direction);
      const lanes = connectionLanes(graph, base, direction);
      expect(new Set(lanes.values()).size).toBe(2);
      const layout = connectionLayout(graph, base, direction);
      expect(direction === "horizontal" ? layout.height : layout.width).toBeGreaterThan(
        direction === "horizontal" ? base.height : base.width,
      );
    },
  );

  it.each(["horizontal", "vertical"] as const)(
    "routes feedback arcs in dedicated lanes without suppressing terminal append spots in %s layout",
    (direction) => {
      const looped = {
        ...definition,
        loops: [
          {
            id: "d-to-b",
            from: "d",
            to: "b",
            maxRounds: 3,
            until: { kind: "step-says-pass" as const },
          },
        ],
      };
      const graph = buildWorkflowRunGraph(null, looped);
      const base = layoutRunGraph(graph, RUN_GRAPH_NODE, direction);
      const feedbackLanes = feedbackConnectionLanes(graph, base, direction);
      expect(feedbackLanes.get("loop:d-to-b")).toBe(0);
      const spots = canvasSpots(graph, base, RUN_GRAPH_NODE, direction);
      expect(spots.some((spot) => spot.key === "loop:d-to-b")).toBe(false);
      expect(spots.some((spot) => spot.kind === "append" && spot.after === "d")).toBe(true);
    },
  );
});
