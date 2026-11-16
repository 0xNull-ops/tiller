import type { WorkflowDefinition } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { nestedWorkflowWorkStepCount, workflowWorkStepCount } from "./workflowWorkStepCount";

const workflow = (steps: WorkflowDefinition["steps"]): WorkflowDefinition => ({
  version: 1,
  name: "Workflow",
  steps,
});
const skill = (id: string) => ({ id, title: id, skill: id });
const nested = (id: string, workflow: string) => ({
  id,
  title: id,
  kind: "workflow" as const,
  workflow,
});

it("counts repeated nested references recursively and stops ancestor cycles", () => {
  const root = workflow([
    skill("one"),
    skill("two"),
    nested("child-a", "child"),
    nested("child-b", "child"),
  ]);
  const child = workflow([skill("three"), nested("cycle", "root")]);
  const definitions = new Map([
    ["root", root],
    ["child", child],
  ]);
  expect(workflowWorkStepCount(root, "root", definitions)).toBe(8);
});

it("counts only steps as work and ignores notes, gates, checks and resources", () => {
  const definition = {
    ...workflow([
      {
        ...skill("one"),
        note: "context",
        gate: true,
        checks: [{ kind: "command", command: "true" }],
        attachments: [{ id: "node", kind: "requirement", requirement: "Node.js" }],
      },
      skill("two"),
      skill("three"),
      skill("four"),
      skill("five"),
    ]),
    notes: [{ id: "canvas-note", text: "Context card" }],
  };
  expect(workflowWorkStepCount(definition, "five", new Map())).toBe(5);
});

it("counts a nested workflow's recursive contribution", () => {
  const child = workflow([skill("child-one"), nested("grandchild", "grandchild")]);
  const grandchild = workflow([skill("grandchild-one"), skill("grandchild-two")]);
  const definitions = new Map([
    ["child", child],
    ["grandchild", grandchild],
  ]);
  expect(nestedWorkflowWorkStepCount("child", new Set(["root"]), definitions)).toBe(5);
});
