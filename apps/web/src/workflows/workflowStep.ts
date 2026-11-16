import type {
  ModelSelection,
  WorkflowDefinition,
  WorkflowDelegation,
  WorkflowStep,
} from "@t3tools/contracts";

export type WorkflowStepChoice =
  | { readonly kind: "skill"; readonly skill: string }
  | { readonly kind: "workflow"; readonly workflow: string; readonly name: string };

/** True when a step carries a named skill. The default kind, for files saved before nested workflows. */
export function isWorkflowSkillStep(
  step: WorkflowStep,
): step is Extract<WorkflowStep, { skill: string }> {
  return step.kind === undefined || step.kind === "skill";
}

/** True when a step references another saved workflow. */
export function isWorkflowNestedStep(
  step: WorkflowStep,
): step is Extract<WorkflowStep, { kind: "workflow" }> {
  return step.kind === "workflow";
}

/** The execution rule for a workflow. Version 2 stores it on `execution`; version 1 used `delegation`. */
export function definitionDelegation(
  definition: Pick<WorkflowDefinition, "execution" | "delegation"> | null,
): WorkflowDelegation | undefined {
  if (!definition) return undefined;
  return definition.execution ?? definition.delegation;
}

/** A workflow's optional model selection: the workflow's own, then the step's if it is a skill step. */
export function stepModel(
  step: WorkflowStep,
  fallback: ModelSelection | undefined,
): ModelSelection | undefined {
  return isWorkflowSkillStep(step) ? (step.model ?? fallback) : fallback;
}
