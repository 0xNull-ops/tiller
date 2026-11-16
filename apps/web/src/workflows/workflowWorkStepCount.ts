import type { WorkflowDefinition } from "@t3tools/contracts";
import { isWorkflowNestedStep } from "./workflowStep";

export function workflowWorkStepCount(
  root: WorkflowDefinition,
  rootSlug: string,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
): number {
  const count = (definition: WorkflowDefinition, ancestors: ReadonlySet<string>): number =>
    definition.steps.reduce((total, step) => {
      if (!isWorkflowNestedStep(step)) return total + 1;
      return total + nestedWorkflowWorkStepCount(step.workflow, ancestors, definitions);
    }, 0);
  return count(root, new Set([rootSlug]));
}

export function nestedWorkflowWorkStepCount(
  slug: string,
  ancestors: ReadonlySet<string>,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
): number {
  const nested = definitions.get(slug);
  if (!nested || ancestors.has(slug)) return 1;
  const nextAncestors = new Set([...ancestors, slug]);
  return (
    1 +
    nested.steps.reduce((total, step) => {
      if (!isWorkflowNestedStep(step)) return total + 1;
      return total + nestedWorkflowWorkStepCount(step.workflow, nextAncestors, definitions);
    }, 0)
  );
}
