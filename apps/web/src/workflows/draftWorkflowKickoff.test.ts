import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import {
  buildDraftWorkflowBootstrap,
  buildWorkflowKickoffPrompt,
  type DraftWorkflowKickoffInput,
} from "./draftWorkflowKickoff";

const input: DraftWorkflowKickoffInput = {
  environmentId: EnvironmentId.make("local"),
  projectId: ProjectId.make("project-1"),
  threadId: ThreadId.make("draft-thread"),
  projectCwd: "/repo",
  workflow: "review",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-test",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "full-access",
  interactionMode: "plan",
  title: "Review task",
  createdAt: "2026-10-20T12:00:00.000Z",
  branch: "feature/draft",
  worktreePath: null,
  envMode: "worktree",
  startFromOrigin: true,
};

describe("draft workflow kickoff", () => {
  it("names the workflow plainly and keeps the exact tool target in one short line", () => {
    const prompt = buildWorkflowKickoffPrompt(input);
    expect(prompt).toBe(
      'Run the Review task workflow.\n\nUse workflow_run for "review" in this chat.',
    );
    expect(prompt).not.toContain(input.projectId);
  });

  it("writes the run's inputs as plain lines, with every value left as it was given", () => {
    const prompt = buildWorkflowKickoffPrompt({
      workflow: "review",
      title: "Review task",
      inputs: { appName: "Foo", notes: "first line\nsecond line" },
    });
    expect(prompt).toBe(
      [
        "Run the Review task workflow.",
        "Inputs:\n- appName: Foo\n- notes: first line\n  second line",
        'Use workflow_run for "review" in this chat, with the inputs above exactly as given.',
      ].join("\n\n"),
    );
  });

  it("shows no raw JSON in the message the user reads", () => {
    const prompt = buildWorkflowKickoffPrompt({
      workflow: "review",
      title: "Review task",
      inputs: { appName: "Foo" },
    });
    expect(prompt).not.toContain("{");
    expect(prompt).not.toContain('"appName"');
    expect(prompt).toContain("- appName: Foo");
  });

  it("bootstraps draft settings and applies worktree options only when selected", () => {
    const bootstrap = buildDraftWorkflowBootstrap(input);
    expect(bootstrap.createThread).toMatchObject({
      projectId: input.projectId,
      modelSelection: input.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "plan",
      branch: "feature/draft",
    });
    expect(bootstrap.prepareWorktree).toEqual({
      projectCwd: "/repo",
      baseBranch: "feature/draft",
      startFromOrigin: true,
    });
    expect(buildDraftWorkflowBootstrap({ ...input, envMode: "local" })).not.toHaveProperty(
      "prepareWorktree",
    );
    expect(
      buildDraftWorkflowBootstrap({ ...input, worktreePath: "/existing-worktree" }),
    ).not.toHaveProperty("prepareWorktree");
  });
});
