import { expect, it } from "@effect/vitest";
import { WorkflowDefinition } from "@t3tools/contracts";
import { workflowTemplates } from "@t3tools/shared/workflowTemplates";
import * as Schema from "effect/Schema";
import { validateWorkflow } from "./workflowGraph.ts";
const decodeDefinition = Schema.decodeSync(WorkflowDefinition);
it.each(workflowTemplates)("validates $id", (template) => {
  const definition = decodeDefinition(template.definition);
  expect(validateWorkflow(definition)).toEqual([]);
  expect(Object.isFrozen(template.definition.steps)).toBe(true);
  for (const step of definition.steps) {
    if (step.kind !== "workflow")
      expect(template.skills[step.skill]).toMatch(/^[\w-]+\/[\w-]+\/[\w-]+$/);
  }
});
