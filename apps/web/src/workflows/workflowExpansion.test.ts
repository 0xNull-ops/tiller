import type { WorkflowListing, WorkflowRun, WorkflowStep } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import type { RunGraphNode } from "./runGraph";
import { layoutExpansion, nestedExpansions, EXPANSION_CARD } from "./workflowExpansion";
import { workflowRunFixture } from "./workflowTestFixture";

const listing = (workflow: string, steps: ReadonlyArray<WorkflowStep>): WorkflowListing => ({
  projectId: workflowRunFixture.projectId,
  workflow,
  definition: { version: 3, name: `${workflow} name`, steps },
  problem: null,
  missingSkills: ["logo-generator"],
  skills: [],
  blockers: [],
  updatedAt: workflowRunFixture.startedAt,
  scratch: false,
  editedByThreadId: null,
});

const nestedNode = (stepId: string, workflow: string): RunGraphNode => ({
  id: `run:${stepId}`,
  kind: "step",
  workflowStepId: stepId,
  nestedWorkflow: workflow,
  title: stepId,
  detail: null,
  status: "idle",
  childThreadId: null,
});

const card = { width: 200, height: 112 };

it("sizes the group to a grid of up to three steps per row under the card", () => {
  expect(layoutExpansion({ cardWidth: 200, cardHeight: 112, count: 0 })).toEqual({
    width: 200,
    height: 112,
  });
  const three = layoutExpansion({ cardWidth: 200, cardHeight: 112, count: 3 });
  const seven = layoutExpansion({ cardWidth: 200, cardHeight: 112, count: 7 });
  expect(three.width).toBe(3 * EXPANSION_CARD.width + 2 * 12 + 24);
  expect(seven.height).toBeGreaterThan(three.height);
  expect(seven.width).toBe(three.width);
});

it("places each child step in its grid cell, offset from the card", () => {
  const child = listing("kit", [
    { id: "a", kind: "skill", skill: "research", title: "A" },
    { id: "b", kind: "skill", skill: "logo-generator", title: "B" },
    { id: "c", kind: "skill", skill: "design", title: "C" },
    { id: "d", kind: "skill", skill: "design", title: "D" },
  ] as WorkflowStep[]);
  const [expansion] = nestedExpansions({
    nodes: [nestedNode("kit-step", "kit")],
    expandedStepIds: new Set(["kit-step"]),
    parentWorkflow: "launch",
    workflows: [child],
    latestRunOf: () => null,
    cardSize: () => card,
  });
  expect(expansion!.steps.map((step) => [step.stepId, step.x, step.y])).toEqual([
    ["a", 12, 112 + 12 + 12],
    ["b", 12 + 176 + 12, 112 + 12 + 12],
    ["c", 12 + 2 * (176 + 12), 112 + 12 + 12],
    ["d", 12, 112 + 12 + 12 + 56 + 12],
  ]);
  expect(expansion!.steps[1]).toMatchObject({ missingSkill: true });
  expect(expansion!.name).toBe("kit name");
});

it("reads each step's status from the child's latest run", () => {
  const child = listing("kit", [
    { id: "a", kind: "skill", skill: "x", title: "A" },
  ] as WorkflowStep[]);
  const run = {
    ...workflowRunFixture,
    workflow: "kit",
    steps: [{ stepId: "a", status: "running", attempts: 1, threadId: null }],
  } as WorkflowRun;
  const [expansion] = nestedExpansions({
    nodes: [nestedNode("kit-step", "kit")],
    expandedStepIds: new Set(["kit-step"]),
    parentWorkflow: "launch",
    workflows: [child],
    latestRunOf: (workflow) => (workflow === "kit" ? run : null),
    cardSize: () => card,
  });
  expect(expansion!.steps[0]!.status).toBe("running");
});

it("leaves a card plain when it isn't expanded or its reference can't be opened", () => {
  const looping = listing("loop", [
    { id: "back", kind: "workflow", workflow: "launch" },
  ] as WorkflowStep[]);
  const base = {
    parentWorkflow: "launch",
    workflows: [looping, listing("kit", [])],
    latestRunOf: () => null,
    cardSize: () => card,
  };
  expect(
    nestedExpansions({
      ...base,
      nodes: [nestedNode("kit-step", "kit")],
      expandedStepIds: new Set(),
    }),
  ).toEqual([]);
  expect(
    nestedExpansions({
      ...base,
      nodes: [
        nestedNode("loop-step", "loop"),
        nestedNode("self-step", "launch"),
        nestedNode("gone-step", "gone"),
      ],
      expandedStepIds: new Set(["loop-step", "self-step", "gone-step"]),
    }),
  ).toEqual([]);
});
