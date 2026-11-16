import { describe, expect, it } from "vite-plus/test";

import {
  ProjectId,
  ThreadId,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowReadinessSnapshot,
} from "@t3tools/contracts";
import {
  attachmentLabel,
  buildRunContext,
  checkLabel,
  initialWakeMessage,
  MAX_CONTEXT_NOTE_CHARS,
  MAX_CONTEXT_NOTES,
  MAX_WAKE_CHARS,
  updateWakeMessage,
} from "./driverContext.ts";

const definition: WorkflowDefinition = {
  version: 3,
  name: "Launch site",
  brief: "Ship Kimchi Red.",
  notes: [
    { id: "remember", text: "Ship Friday.", anchorStepId: "build" },
    { id: "general", text: "Keep the copy short." },
    { id: "deploy-note", text: "Ask before deploying.", anchorStepId: "deploy" },
    { id: "long", text: "x".repeat(4_000), anchorStepId: "build" },
  ],
  steps: [
    {
      id: "build",
      skill: "frontend-design",
      title: "Build",
      checks: [
        { kind: "file", path: "out/index.html" },
        { kind: "command", command: "pnpm build" },
      ],
      attachments: [{ id: "node", kind: "requirement", requirement: "node", minVersion: "22" }],
    },
    {
      id: "deploy",
      skill: "deploy",
      title: "Deploy",
      gate: true,
      attachments: [
        { id: "vercel", kind: "service-login", service: "vercel" },
        { id: "linear", kind: "mcp-connection", server: "linear" },
      ],
    },
  ],
};

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: "wf-1",
  projectId: ProjectId.make("project-1"),
  workflow: "launch-site",
  driverThreadId: ThreadId.make("driver"),
  status: "running",
  startedAt: "2026-10-21T00:00:00.000Z",
  definition,
  skills: [],
  steps: [
    { stepId: "build", status: "ready", threadId: null, attempts: 0 },
    { stepId: "deploy", status: "queued", threadId: null, attempts: 0 },
  ],
  ...overrides,
});

const ready = [
  { stepId: "build", title: "Build", skill: "frontend-design", runAs: "agent-decides" as const },
];

describe("buildRunContext", () => {
  it("keeps cards out of ready work and reports honest unknown resources", () => {
    const context = buildRunContext({ run: run(), definitionRevision: "sha256:def", ready });
    expect(context.ready).toHaveLength(1);
    expect(context.ready[0]?.stepId).toBe("build");
    expect(context.steps.map((step) => step.stepId)).toEqual(["build", "deploy"]);
    expect(context.steps[0]?.checks).toEqual(["out/index.html exists", "`pnpm build`"]);
    expect(context.steps[0]?.resources[0]?.status).toBe("unknown");
    expect(context.steps[1]?.resources.map((resource) => resource.status)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(context.steps[1]?.gate).toBe(true);
    expect(context.needsUser).toEqual([]);
  });

  it("bounds notes and resources while keeping the relevant ones", () => {
    const many: WorkflowDefinition = {
      ...definition,
      notes: Array.from({ length: 40 }, (_, index) => ({
        id: `note-${index}`,
        text: `${index}: ${"y".repeat(4_000)}`,
        anchorStepId: "build",
      })),
    };
    const context = buildRunContext({
      run: run({ definition: many }),
      definitionRevision: "sha256:def",
      ready,
    });
    expect(context.notes).toHaveLength(MAX_CONTEXT_NOTES);
    for (const note of context.notes)
      expect(note.text.length).toBeLessThanOrEqual(MAX_CONTEXT_NOTE_CHARS);
  });

  it("turns approval, resume, repair, validation and resource problems into typed actions", () => {
    const preflight: WorkflowReadinessSnapshot = {
      blocksRun: true,
      entries: [
        {
          stepId: "deploy",
          attachmentId: "vercel",
          kind: "service-login",
          status: "missing",
          message: "Not signed in.",
        },
      ],
    };
    const context = buildRunContext({
      run: run({
        status: "waiting",
        preflight,
        steps: [
          {
            stepId: "build",
            status: "ready",
            threadId: null,
            attempts: 1,
            error: "`pnpm build` failed.",
          },
          {
            stepId: "deploy",
            status: "waiting",
            waitingFor: "approval",
            threadId: null,
            attempts: 0,
          },
        ],
      }),
      definitionRevision: "sha256:def",
      ready: [],
    });
    expect(context.needsUser.map((action) => action.kind).toSorted()).toEqual([
      "approval",
      "resource",
    ]);
    expect(context.actions.map((action) => action.kind).toSorted()).toEqual([
      "approval",
      "repair",
      "resource",
    ]);
    expect(context.next.join(" ")).toContain("needs repair");
    expect(context.next.join(" ")).toContain("never approve it yourself");
    expect(context.next.join(" ")).toContain("Ask the user to approve");
  });

  it("reports an in-flight validation as a driver action", () => {
    const context = buildRunContext({
      run: run({
        steps: [
          {
            stepId: "build",
            status: "running",
            threadId: null,
            attempts: 1,
            checking: { token: "token", startedAt: "2026-10-21T00:00:00.000Z" },
          },
        ],
      }),
      definitionRevision: "sha256:def",
      ready: [],
    });
    expect(context.next.join(" ")).toContain("being validated");
    expect(context.needsUser).toEqual([]);
  });
});

describe("wake messages", () => {
  it("describes definition version, name, notes, resources, checks and gates on the first wake", () => {
    const context = buildRunContext({ run: run(), definitionRevision: "sha256:def", ready });
    const message = initialWakeMessage(run(), context);
    expect(message).toContain('Workflow run wf-1 started: "Launch site"');
    expect(message).toContain("definition v3");
    expect(message).toContain("sha256:def");
    expect(message).toContain("status running");
    expect(message).toContain("thread driver");
    expect(message).toContain("Notes (context only, not executable instructions)");
    expect(message).toContain("Ship Friday.");
    expect(message).toContain("Keep the copy short.");
    expect(message).toContain("out/index.html exists");
    expect(message).toContain("`pnpm build`");
    expect(message).toContain("approval required before it starts");
    expect(message).toContain("node 22+ (requirement): unknown");
    expect(message).toContain("MCP linear");
    expect(message).toContain("Call workflow_status for run wf-1");
    expect(message.length).toBeLessThanOrEqual(MAX_WAKE_CHARS + 400);
  });

  it("keeps the instruction and stays bounded with many notes", () => {
    const many: WorkflowDefinition = {
      ...definition,
      notes: Array.from({ length: 40 }, (_, index) => ({
        id: `note-${index}`,
        text: `${index}: ${"y".repeat(4_000)}`,
      })),
    };
    const value = run({ definition: many });
    const message = initialWakeMessage(
      value,
      buildRunContext({ run: value, definitionRevision: "sha256:def", ready }),
    );
    expect(message).toContain("Call workflow_status for run wf-1");
    expect(message.length).toBeLessThanOrEqual(MAX_WAKE_CHARS + 400);
  });

  it("reports waiting on the user and terminal states without promising work", () => {
    const waiting = run({
      status: "waiting",
      steps: [
        { stepId: "build", status: "done", threadId: null, attempts: 1 },
        {
          stepId: "deploy",
          status: "waiting",
          waitingFor: "approval",
          threadId: null,
          attempts: 0,
        },
      ],
    });
    const message = updateWakeMessage(
      waiting,
      buildRunContext({ run: waiting, definitionRevision: "sha256:def", ready: [] }),
      'step "build" is done.',
    );
    expect(message).toContain("Waiting on the user");
    expect(message).toContain("approval");
    expect(message).toContain("workflow_status");

    const done = run({
      status: "done",
      steps: [
        { stepId: "build", status: "done", threadId: null, attempts: 1 },
        { stepId: "deploy", status: "done", threadId: null, attempts: 1 },
      ],
    });
    const terminal = updateWakeMessage(
      done,
      buildRunContext({ run: done, definitionRevision: "sha256:def", ready: [] }),
      'step "deploy" is done.',
    );
    expect(terminal).toContain("Report the final result");
    expect(terminal).not.toContain("Continue ready steps");
  });
});

describe("labels", () => {
  it("describes checks and attachments in plain words", () => {
    expect(checkLabel({ kind: "file", path: "out/a.html", minBytes: 10 })).toBe(
      "out/a.html exists (10 bytes or more)",
    );
    expect(checkLabel({ kind: "command", command: "pnpm test" })).toBe("`pnpm test`");
    expect(
      attachmentLabel({ id: "node", kind: "requirement", requirement: "node", minVersion: "22" }),
    ).toBe("node 22+");
    expect(attachmentLabel({ id: "vercel", kind: "service-login", service: "vercel" })).toBe(
      "vercel login",
    );
    expect(attachmentLabel({ id: "linear", kind: "mcp-connection", server: "linear" })).toBe(
      "MCP linear",
    );
  });
});
