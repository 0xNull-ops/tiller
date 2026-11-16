import { describe, expect, it } from "vite-plus/test";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { WORKFLOW_RESOURCE_SIZE, workflowAnnotationPositions } from "./workflowAnnotations";
import { workflowAnnotationLayoutSizes, workflowCardSizes } from "./workflowOutputs";
import { layoutRunGraph } from "./runGraphLayout";
import { workflowRunFixture as run } from "./workflowTestFixture";

describe("workflowAnnotationPositions", () => {
  it("keeps notes and per-owner resources outside execution nodes and lays out overflow in the owner lane", () => {
    const definition = {
      ...run.definition,
      notes: [
        { id: "launch-note", text: "Remember the spec", anchorStepId: "build" },
        { id: "free-note", text: "Unanchored", x: 40, y: 48 },
      ],
      steps: run.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: ["Node 22", "Vercel", "RevenueCat", "Xcode 17", "macOS"].map(
                (name, index) => ({
                  id: `resource-${index}`,
                  kind: "requirement" as const,
                  requirement: name,
                }),
              ),
            }
          : step,
      ),
    };
    const graph = buildWorkflowRunGraph(null, definition);
    const layout = layoutRunGraph(graph, undefined, "vertical");
    const occupied = layoutRunGraph(
      graph,
      undefined,
      "vertical",
      workflowAnnotationLayoutSizes(
        workflowCardSizes(graph, null, { width: 200, height: 112 }, false),
        graph,
        definition,
      ),
    );
    const collapsed = workflowAnnotationPositions({
      definition,
      graph,
      layout,
      direction: "vertical",
      expandedResourceOwners: new Set(),
    });
    const expanded = workflowAnnotationPositions({
      definition,
      graph,
      layout,
      direction: "vertical",
      expandedResourceOwners: new Set(["build"]),
    });
    expect(graph.nodes).toHaveLength(definition.steps.length + 1);
    expect(occupied.positions.get("draft:Launch site:deploy")!.y).toBeGreaterThan(
      layout.positions.get("draft:Launch site:deploy")!.y,
    );
    expect([...collapsed.resources.keys()]).toEqual([
      "build/resource-0",
      "build/resource-1",
      "build/resource-2",
      "build/__more",
    ]);
    expect(expanded.resources.size).toBe(5);
    expect(collapsed.notes.get("free-note")).toEqual({ x: 40, y: 48 });
    expect(collapsed.notes.get("launch-note")!.y).toBeGreaterThan(
      collapsed.resources.get("build/__more")!.y,
    );
    expect(collapsed.height).toBeGreaterThan(layout.height);
    expect(collapsed.notes.size).toBe(2);
  });

  it("draws a resource at its saved position and grows the canvas to include it", () => {
    const definition = {
      ...run.definition,
      version: 3 as const,
      layout: { "resource:build:node": { x: 4000, y: 40 } },
      steps: run.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [{ id: "node", kind: "requirement" as const, requirement: "Node 22" }],
            }
          : step,
      ),
    };
    const graph = buildWorkflowRunGraph(null, definition);
    const layout = layoutRunGraph(graph);
    const annotations = workflowAnnotationPositions({
      definition,
      graph,
      layout,
      direction: "horizontal",
      expandedResourceOwners: new Set(),
    });
    expect(annotations.resources.get("build/node")).toEqual({ x: 4000, y: 40 });
    expect(annotations.width).toBe(4000 + WORKFLOW_RESOURCE_SIZE.width);
  });
});
