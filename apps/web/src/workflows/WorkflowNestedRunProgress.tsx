import type { WorkflowRun } from "@t3tools/contracts";

const STATUS: Record<WorkflowRun["status"], string> = {
  running: "Running",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

export function WorkflowNestedRunProgress({ run }: { readonly run: WorkflowRun }) {
  const completed = run.steps.filter(
    (step) => step.status === "done" || step.status === "skipped",
  ).length;
  return (
    <span className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
      <span>
        {completed} of {run.steps.length}
      </span>
      <span>{STATUS[run.status]}</span>
    </span>
  );
}
