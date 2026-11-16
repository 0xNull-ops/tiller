import type { WorkflowRun, WorkflowStepRun } from "@t3tools/contracts";

export function canStopWorkflowRun(run: WorkflowRun): boolean {
  return run.status === "running" || run.status === "waiting";
}

export type WorkflowRunStepAction = {
  readonly kind: "approve" | "resume";
  readonly stepId: string;
};

export function workflowRunStepActions(run: WorkflowRun): WorkflowRunStepAction[] {
  if (!canStopWorkflowRun(run)) return [];

  return run.steps.reduce<WorkflowRunStepAction[]>((actions, step) => {
    if (step.status === "waiting" && step.waitingFor === "approval") {
      actions.push({ kind: "approve", stepId: step.stepId });
    } else if (
      step.status === "waiting" &&
      (step.waitingFor === "resume" || step.waitingFor === "timer")
    ) {
      actions.push({ kind: "resume", stepId: step.stepId });
    }
    return actions;
  }, []);
}

export function workflowRunStepStatusLabel(step: WorkflowStepRun): string {
  if (step.checking) return "Validating";
  if (step.status === "waiting" && step.waitingFor === "approval") return "Approval needed";
  if (step.status === "waiting" && (step.waitingFor === "resume" || step.waitingFor === "timer"))
    return "Resume needed";
  return step.status;
}
