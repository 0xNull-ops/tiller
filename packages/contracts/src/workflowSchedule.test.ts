import { describe, expect, it } from "vite-plus/test";

import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { workflowScheduleBinding, workflowSchedulePrompt } from "./workflowSchedule.ts";

const binding = {
  version: 1 as const,
  projectId: ProjectId.make("project-one"),
  workflow: "monthly-aso",
  inputs: { appName: "My App" },
};
const task = {
  projectId: binding.projectId,
  threadId: ThreadId.make("driver"),
  prompt: workflowSchedulePrompt(binding),
};

describe("workflow schedule ownership", () => {
  it("identifies the bound workflow and keeps its run inputs", () => {
    expect(workflowScheduleBinding(task)).toEqual({ ...binding, version: 2 });
  });

  it("does not claim unbound tasks or tasks for another project", () => {
    expect(workflowScheduleBinding({ ...task, threadId: null })).toBeNull();
    expect(workflowScheduleBinding({ ...task, projectId: ProjectId.make("other") })).toBeNull();
  });

  it("ignores ordinary prompts mentioning workflows and damaged markers", () => {
    for (const prompt of [
      "Run monthly-aso and review the results.",
      `Other work first\n${task.prompt}`,
      "T3_WORKFLOW_SCHEDULE not-json",
      'T3_WORKFLOW_SCHEDULE {"version":99}',
    ]) {
      expect(workflowScheduleBinding({ ...task, prompt })).toBeNull();
    }
  });
});
