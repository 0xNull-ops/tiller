import { expect, it } from "vite-plus/test";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { workflowAnnotationPositions } from "./workflowAnnotations";
import { workflowAnnotationLayoutSizes, workflowCardSizes } from "./workflowOutputs";
import { layoutRunGraph, RUN_GRAPH_NODE } from "./runGraphLayout";
import { workflowRunFixture } from "./workflowTestFixture";
import { credentialRequestFixture } from "../credentials/credentialActivityFixture";
import { EMPTY_CREDENTIAL_LIVE_STATE } from "@t3tools/client-runtime/state/runtime";

it("persists credential satellite positions by step and credential and reserves their lane", () => {
  const graph = buildWorkflowRunGraph(
    workflowRunFixture,
    workflowRunFixture.definition,
    [],
    new Map(),
    { live: { ...EMPTY_CREDENTIAL_LIVE_STATE, pending: [credentialRequestFixture] }, history: [] },
  );
  const visualNodeSizes = workflowCardSizes(graph, workflowRunFixture, RUN_GRAPH_NODE, true);
  const sizes = workflowAnnotationLayoutSizes(
    visualNodeSizes,
    graph,
    workflowRunFixture.definition,
  );
  expect(sizes.get("run-one:build")!.height).toBeGreaterThan(
    visualNodeSizes.get("run-one:build")!.height,
  );
  const layout = layoutRunGraph(graph, RUN_GRAPH_NODE, "horizontal", sizes);
  const input = {
    graph,
    layout,
    visualNodeSizes,
    direction: "horizontal" as const,
    expandedResourceOwners: new Set<string>(),
  };
  const saved = workflowAnnotationPositions({
    ...input,
    definition: {
      ...workflowRunFixture.definition,
      layout: { "credential:build:github": { x: 2000, y: 1000 } },
    },
  });
  expect(saved.credentials.get("credential:build:github")).toEqual({ x: 2000, y: 1000 });
  const tidy = workflowAnnotationPositions({
    ...input,
    definition: { ...workflowRunFixture.definition, layout: {} },
  });
  expect(tidy.credentials.get("credential:build:github")).not.toEqual({ x: 2000, y: 1000 });
});

it("keeps the start card large enough for its contents on compact cards", () => {
  const graph = {
    nodes: [{ id: "start", kind: "workflow", title: "Launch Video", status: "idle" }],
    edges: [],
  } as unknown as Parameters<typeof workflowCardSizes>[0];
  expect(workflowCardSizes(graph, null, { width: 168, height: 72 }, true).get("start")).toEqual({
    width: 240,
    height: 116,
  });
  expect(workflowCardSizes(graph, null, { width: 200, height: 64 }, false).get("start")).toEqual({
    width: 200,
    height: 64,
  });
});
