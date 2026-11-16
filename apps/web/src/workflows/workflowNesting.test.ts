import type { WorkflowListing, WorkflowStep } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { workflowRunFixture } from "./workflowTestFixture";
import { nestableWorkflows, nestedTargetState, openNestedTrail } from "./workflowNesting";

const listing = (workflow: string, steps: ReadonlyArray<WorkflowStep> = []): WorkflowListing => ({
  projectId: workflowRunFixture.projectId,
  workflow,
  definition: { version: 2, name: workflow, steps },
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: workflowRunFixture.startedAt,
  scratch: false,
  editedByThreadId: null,
});

it("hides the current workflow and direct or transitive paths back to it", () => {
  const workflows = [
    listing("launch"),
    listing("direct", [{ id: "launch", kind: "workflow", workflow: "launch" }]),
    listing("indirect", [{ id: "direct", kind: "workflow", workflow: "direct" }]),
    listing("screenshots", [{ id: "capture", skill: "capture" }]),
    { ...listing("broken"), definition: null, problem: "Invalid file" },
  ];
  expect(nestableWorkflows(workflows, "launch").map((item) => item.workflow)).toEqual([
    "screenshots",
  ]);
});

it("handles existing loops without getting stuck and allows shared child workflows", () => {
  const workflows = [
    listing("launch", [{ id: "child", kind: "workflow", workflow: "screenshots" }]),
    listing("screenshots"),
    listing("a", [{ id: "b", kind: "workflow", workflow: "b" }]),
    listing("b", [{ id: "a", kind: "workflow", workflow: "a" }]),
  ];
  expect(nestableWorkflows(workflows, "launch").map((item) => item.workflow)).toEqual([
    "screenshots",
  ]);
});

it("names what a nested reference resolves to from the parent", () => {
  const workflows = [
    listing("launch", [{ id: "child", kind: "workflow", workflow: "screenshots" }]),
    listing("screenshots"),
    listing("a", [{ id: "b", kind: "workflow", workflow: "b" }]),
    listing("b", [{ id: "a", kind: "workflow", workflow: "a" }]),
    { ...listing("broken"), definition: null, problem: "Invalid file" },
  ];
  const stateOf = (target: string) =>
    nestedTargetState({ workflows, parentWorkflow: "launch", target });
  expect(stateOf("")).toBe("empty");
  expect(stateOf("launch")).toBe("self");
  expect(stateOf("screenshots")).toBe("ready");
  expect(stateOf("gone")).toBe("missing");
  expect(stateOf("broken")).toBe("unavailable");
  expect(stateOf("a")).toBe("loops");
});

it("refuses a nested open that would loop back onto the trail", () => {
  expect(openNestedTrail({ trail: [], current: "launch", target: "screenshots" })).toEqual({
    _tag: "open",
    trail: ["launch"],
  });
  expect(openNestedTrail({ trail: ["launch"], current: "shots", target: "launch" })).toEqual({
    _tag: "refused",
  });
  expect(openNestedTrail({ trail: [], current: "launch", target: "launch" })).toEqual({
    _tag: "refused",
  });
});
