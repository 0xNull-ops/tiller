import { ProjectId, ThreadId, type WorkflowRun } from "@t3tools/contracts";

export const workflowRunFixture: WorkflowRun = {
  id: "run-one",
  projectId: ProjectId.make("project"),
  workflow: "launch",
  driverThreadId: ThreadId.make("starter"),
  status: "running",
  startedAt: "2026-10-19T12:00:00.000Z",
  definition: {
    version: 1,
    name: "Launch site",
    steps: [
      { id: "research", skill: "research" },
      { id: "build", skill: "build" },
      { id: "images", skill: "images", readsFrom: [] },
      { id: "deploy", skill: "deploy", readsFrom: ["build", "images"] },
    ],
  },
  skills: [],
  steps: [
    { stepId: "research", status: "done", attempts: 1, threadId: ThreadId.make("starter") },
    { stepId: "build", status: "running", attempts: 2, threadId: ThreadId.make("build-thread") },
    { stepId: "images", status: "waiting", waitingFor: "approval", attempts: 0, threadId: null },
    { stepId: "deploy", status: "queued", attempts: 0, threadId: null },
  ],
};
