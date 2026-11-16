import { describe, expect, it } from "vite-plus/test";
import type { WorkflowRun } from "@t3tools/contracts";

import {
  canStopWorkflowRun,
  workflowRunStepActions,
  workflowRunStepStatusLabel,
} from "./runActions";

const makeRun = (status: WorkflowRun["status"], steps: WorkflowRun["steps"]): WorkflowRun =>
  ({ status, steps }) as WorkflowRun;

describe("saved workflow run actions", () => {
  it("shows validation as a distinct owner state", () => {
    expect(
      workflowRunStepStatusLabel({
        stepId: "build",
        status: "running",
        attempts: 1,
        threadId: null,
        checking: { token: "check-1", startedAt: "2026-10-21T12:00:00Z" },
      }),
    ).toBe("Validating");
  });

  it("offers gate actions only for waiting steps in a live run", () => {
    const run = makeRun("waiting", [
      { stepId: "ship", status: "waiting", waitingFor: "approval", attempts: 0, threadId: null },
      { stepId: "build", status: "waiting", waitingFor: "resume", attempts: 1, threadId: null },
      { stepId: "done", status: "done", waitingFor: "approval", attempts: 1, threadId: null },
    ]);

    expect(workflowRunStepActions(run)).toEqual([
      { kind: "approve", stepId: "ship" },
      { kind: "resume", stepId: "build" },
    ]);
    expect(canStopWorkflowRun(run)).toBe(true);
  });

  it("hides approval, resume and stop actions after a run ends", () => {
    const run = makeRun("done", [
      { stepId: "ship", status: "waiting", waitingFor: "approval", attempts: 0, threadId: null },
    ]);

    expect(workflowRunStepActions(run)).toEqual([]);
    expect(canStopWorkflowRun(run)).toBe(false);
  });
});
