import {
  CREDENTIAL_APPROVALS_WARNING,
  CREDENTIAL_REAPPROVAL_WARNING,
  CredentialId,
  EnvironmentId,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  type WorkflowReadinessContext,
  type WorkflowReadinessEntry,
  type WorkflowReadinessSnapshot,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { workflowRunFixture } from "./workflowTestFixture";
import {
  chooseWorkflowAutoOpen,
  workflowReadinessForCanvas,
  workflowReadinessForListing,
  workflowAttachmentRevision,
  workflowProbeCacheKey,
  workflowRunProgress,
  workflowRunsLive,
} from "./workflowState";

const listing = {
  projectId: workflowRunFixture.projectId,
  workflow: "launch",
  definition: workflowRunFixture.definition,
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-10-19T12:00:01.000Z",
  scratch: false,
  editedByThreadId: ThreadId.make("starter"),
};
const readinessContext: Omit<WorkflowReadinessContext, "specification"> = {
  threadId: ThreadId.make("starter"),
  workspaceRoot: "/repo",
  model: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" },
};

it("auto-opens for a workflow edit newer than mount", () => {
  expect(
    chooseWorkflowAutoOpen({
      threadId: "starter",
      mountedAt: Date.parse("2026-10-19T12:00:00Z"),
      workflows: [listing],
      runs: [],
      opened: new Set(),
    }),
  ).toBe("launch");
  expect(
    chooseWorkflowAutoOpen({
      threadId: "starter",
      mountedAt: Date.parse("2026-10-19T12:00:02Z"),
      workflows: [listing],
      runs: [],
      opened: new Set(),
    }),
  ).toBeNull();
});

it("auto-opens a run driven by the viewed thread, once per workflow", () => {
  expect(
    chooseWorkflowAutoOpen({
      threadId: "starter",
      mountedAt: Date.parse("2026-10-19T11:59:00Z"),
      workflows: [],
      runs: [workflowRunFixture],
      opened: new Set(),
    }),
  ).toBe("launch");
  expect(
    chooseWorkflowAutoOpen({
      threadId: "starter",
      mountedAt: Date.parse("2026-10-19T12:00:00Z"),
      workflows: [listing],
      runs: [],
      opened: new Set(["launch"]),
    }),
  ).toBeNull();
});

it("ignores edits and runs from other threads", () => {
  expect(
    chooseWorkflowAutoOpen({
      threadId: "other",
      mountedAt: 0,
      workflows: [listing],
      runs: [],
      opened: new Set(),
    }),
  ).toBeNull();
  expect(
    chooseWorkflowAutoOpen({
      threadId: "other",
      mountedAt: 0,
      workflows: [],
      runs: [workflowRunFixture],
      opened: new Set(),
    }),
  ).toBeNull();
});

it("shares one workflow subscription atom per environment", () => {
  const environmentId = EnvironmentId.make("local");
  expect(workflowRunsLive(environmentId)).toBe(workflowRunsLive(environmentId));
  expect(workflowRunsLive(environmentId)).not.toBe(workflowRunsLive(EnvironmentId.make("remote")));
});

it("invalidates probe result scopes when the chat model changes", () => {
  const environmentId = EnvironmentId.make("local");
  const contextThreadId = ThreadId.make("starter");
  const modelRevision = JSON.stringify({ instanceId: "codex", model: "gpt-6-luna" });
  const changedModelRevision = JSON.stringify({ instanceId: "codex", model: "gpt-6-astra" });

  expect(
    workflowProbeCacheKey(environmentId, listing, contextThreadId, "/repo", modelRevision),
  ).not.toBe(
    workflowProbeCacheKey(environmentId, listing, contextThreadId, "/repo", changedModelRevision),
  );
  expect(
    workflowProbeCacheKey(environmentId, listing, contextThreadId, "/repo", modelRevision),
  ).not.toBe(
    workflowProbeCacheKey(environmentId, listing, contextThreadId, "/other", modelRevision),
  );
});

it("uses returned probe evidence immediately only for its current attachment revision", () => {
  const withResource = {
    ...listing,
    definition: {
      ...listing.definition,
      steps: listing.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [{ id: "node", kind: "requirement" as const, requirement: "Node 22" }],
            }
          : step,
      ),
    },
  };
  const currentContext = {
    ...readinessContext,
    specification: workflowAttachmentRevision(withResource),
  };
  const readiness: WorkflowReadinessSnapshot = {
    entries: [
      {
        stepId: "build",
        attachmentId: "node",
        kind: "requirement",
        status: "available",
        message: "Node is installed",
      },
    ],
    blocksRun: false,
    context: currentContext,
  };

  expect(
    workflowReadinessForListing(
      withResource,
      {
        readiness,
        attachmentRevision: workflowAttachmentRevision(withResource),
      },
      currentContext,
    ),
  ).toBe(readiness);
  const changed = {
    ...withResource,
    definition: {
      ...withResource.definition,
      steps: withResource.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [{ id: "node", kind: "requirement" as const, requirement: "Node 24" }],
            }
          : step,
      ),
    },
  };
  expect(
    workflowReadinessForListing(
      changed,
      {
        readiness,
        attachmentRevision: workflowAttachmentRevision(withResource),
      },
      currentContext,
    ),
  ).toBeUndefined();
});

it("accepts streamed readiness only for the current context and ignores legacy snapshots", () => {
  const withResource = {
    ...listing,
    definition: {
      ...listing.definition,
      steps: listing.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [{ id: "node", kind: "requirement" as const, requirement: "Node 22" }],
            }
          : step,
      ),
    },
  };
  const currentContext = {
    ...readinessContext,
    specification: workflowAttachmentRevision(withResource),
  };
  const readiness: WorkflowReadinessSnapshot = {
    entries: [
      {
        stepId: "build",
        attachmentId: "node",
        kind: "requirement",
        status: "available",
        message: "Node is installed",
      },
    ],
    blocksRun: false,
    context: currentContext,
  };
  const streamedListing = { ...withResource, readiness };
  expect(workflowReadinessForListing(streamedListing, null, currentContext)).toBe(readiness);
  for (const candidate of [
    { ...currentContext, threadId: ThreadId.make("other") },
    { ...currentContext, workspaceRoot: "/other-worktree" },
    { ...currentContext, specification: "different-workflow-resources" },
    {
      ...currentContext,
      model: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
    },
  ])
    expect(workflowReadinessForListing(streamedListing, null, candidate)).toBeUndefined();
  expect(
    workflowReadinessForListing(
      { ...streamedListing, readiness: { ...readiness, context: undefined } },
      null,
      currentContext,
    ),
  ).toBeUndefined();
});

it("keeps a credential's state when the canvas reads from another workspace", () => {
  const withCredential = {
    ...listing,
    definition: {
      ...listing.definition,
      steps: listing.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [
                { id: "gh", kind: "credential" as const, templateId: "github" },
                { id: "node", kind: "requirement" as const, requirement: "Node 22" },
              ],
            }
          : step,
      ),
    },
  };
  // The server reads a card in the project root; the canvas sits inside a thread's workspace.
  const projectContext: WorkflowReadinessContext = {
    workspaceRoot: "/repo",
    specification: workflowAttachmentRevision(withCredential),
  };
  const readiness: WorkflowReadinessSnapshot = {
    entries: [
      {
        stepId: "build",
        attachmentId: "gh",
        kind: "credential",
        status: "available",
        message: "Ready",
        credential: {
          state: "ready",
          templateId: "github",
          statusLabel: "Ready",
          credentialId: CredentialId.make("cred-github"),
          name: "GitHub token",
          envVars: [{ name: "GITHUB_TOKEN", file: false }],
          candidates: [],
          optional: false,
        },
      },
      {
        stepId: "build",
        attachmentId: "node",
        kind: "requirement",
        status: "missing",
        message: "Node is missing",
      },
    ],
    blocksRun: true,
    context: projectContext,
  };
  const threadContext: WorkflowReadinessContext = {
    ...readinessContext,
    specification: workflowAttachmentRevision(withCredential),
  };
  const visible = workflowReadinessForListing(
    { ...withCredential, readiness },
    null,
    threadContext,
  );
  // Probe evidence from another workspace never leaks in...
  expect(visible?.entries.map((entry) => entry.attachmentId)).toEqual(["gh"]);
  // ...and neither does its run-blocking claim, but the vault's own state does.
  expect(visible?.blocksRun).toBe(false);
  expect(visible?.context).toBeUndefined();
  expect(visible?.entries[0]?.credential?.statusLabel).toBe("Ready");
  // A canvas whose context matches still sees the whole snapshot.
  expect(workflowReadinessForListing({ ...withCredential, readiness }, null, projectContext)).toBe(
    readiness,
  );
  // Entries for a definition that changed since are stale, credentials included.
  const edited = {
    ...withCredential,
    definition: {
      ...withCredential.definition,
      steps: withCredential.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [
                ...(step.attachments ?? []),
                { id: "linear", kind: "mcp-connection" as const, server: "linear" },
              ],
            }
          : step,
      ),
    },
  };
  expect(
    workflowReadinessForListing({ ...edited, readiness }, null, threadContext),
  ).toBeUndefined();
});

it("takes credential state from the newest server listing over a newer probe result", () => {
  const withCredential = {
    ...listing,
    definition: {
      ...listing.definition,
      steps: listing.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [
                { id: "gh", kind: "credential" as const, templateId: "github" },
                { id: "node", kind: "requirement" as const, requirement: "Node 22" },
              ],
            }
          : step,
      ),
    },
  };
  const context: WorkflowReadinessContext = {
    ...readinessContext,
    specification: workflowAttachmentRevision(withCredential),
  };
  const requirement: WorkflowReadinessEntry = {
    stepId: "build",
    attachmentId: "node",
    kind: "requirement",
    status: "available",
    message: "Node is installed",
  };
  const credentialEntry = (status: "Ready" | "Missing"): WorkflowReadinessEntry => ({
    stepId: "build",
    attachmentId: "gh",
    kind: "credential",
    status: status === "Ready" ? "available" : "missing",
    message: status,
    credential: {
      state: status === "Ready" ? "ready" : "missing",
      templateId: "github",
      statusLabel: status,
      envVars: [{ name: "GITHUB_TOKEN", file: false }],
      candidates: [],
      optional: false,
    },
  });
  const probe = (status: "Ready" | "Missing", evaluatedAt: string) => ({
    readiness: {
      entries: [credentialEntry(status), requirement],
      blocksRun: false,
      evaluatedAt,
      context,
    } satisfies WorkflowReadinessSnapshot,
    attachmentRevision: workflowAttachmentRevision(withCredential),
  });
  // The server refreshes credential entries in place after a vault change, so the listing keeps
  // the snapshot's original stamp and the check that ran later looks newer.
  const refreshed = (status: "Ready" | "Missing") => ({
    ...withCredential,
    readiness: {
      entries: [credentialEntry(status), requirement],
      blocksRun: false,
      evaluatedAt: "2026-10-21T12:00:00.000Z",
      context,
    } satisfies WorkflowReadinessSnapshot,
  });

  const serverReady = refreshed("Ready");
  const earlierProbe = probe("Missing", "2026-10-21T12:05:00.000Z");
  const added = workflowReadinessForListing(serverReady, earlierProbe, context);
  expect(added?.entries.map((entry) => entry.credential?.statusLabel ?? entry.message)).toEqual([
    "Ready",
    "Node is installed",
  ]);
  expect(added?.evaluatedAt).toBe("2026-10-21T12:05:00.000Z");
  // A store selector may call this every render, so the merge must keep its identity.
  expect(workflowReadinessForListing(serverReady, earlierProbe, context)).toBe(added);

  const removed = workflowReadinessForListing(
    refreshed("Missing"),
    probe("Ready", "2026-10-21T12:05:00.000Z"),
    context,
  );
  expect(removed?.entries[0]?.credential?.statusLabel).toBe("Missing");

  // Nothing to overlay when the listing carries no credential state for this revision.
  const probeOnly = probe("Ready", "2026-10-21T12:05:00.000Z");
  expect(
    workflowReadinessForListing({ ...withCredential, readiness: undefined }, probeOnly, context),
  ).toBe(probeOnly.readiness);
});

it("takes credential warnings from the newest server listing over a newer probe result", () => {
  const withCredential = {
    ...listing,
    definition: {
      ...listing.definition,
      steps: listing.definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              attachments: [{ id: "gh", kind: "credential" as const, templateId: "github" }],
            }
          : step,
      ),
    },
  };
  const context: WorkflowReadinessContext = {
    ...readinessContext,
    specification: workflowAttachmentRevision(withCredential),
  };
  const snapshot = (evaluatedAt: string, warnings: ReadonlyArray<string>) =>
    ({
      entries: [],
      blocksRun: false,
      evaluatedAt,
      context,
      warnings,
    }) satisfies WorkflowReadinessSnapshot;
  const server = (warnings: ReadonlyArray<string>) => ({
    ...withCredential,
    readiness: snapshot("2026-10-21T10:00:00.000Z", warnings),
  });
  // The probe ran after the server's check, so its timestamp wins and only the server knows the
  // advisories, which the probe result never carries.
  const probe = (warnings: ReadonlyArray<string>) => ({
    readiness: snapshot("2026-10-21T12:00:00.000Z", warnings),
    attachmentRevision: workflowAttachmentRevision(withCredential),
  });

  const serverWarned = server([CREDENTIAL_REAPPROVAL_WARNING]);
  const probed = probe(["Check the proxy"]);
  const merged = workflowReadinessForListing(serverWarned, probed, context);
  expect(merged?.warnings).toEqual(["Check the proxy", CREDENTIAL_REAPPROVAL_WARNING]);
  // A store selector may call this every render, so the merge must keep its identity.
  expect(workflowReadinessForListing(serverWarned, probed, context)).toBe(merged);

  expect(
    workflowReadinessForListing(
      server([CREDENTIAL_APPROVALS_WARNING]),
      probe([CREDENTIAL_APPROVALS_WARNING]),
      context,
    )?.warnings,
  ).toEqual([CREDENTIAL_APPROVALS_WARNING]);
  // Once the server drops an advisory, a probe that still carries it must not keep it on screen.
  expect(
    workflowReadinessForListing(server([]), probe([CREDENTIAL_APPROVALS_WARNING]), context)
      ?.warnings,
  ).toEqual([]);
});

it("does not show current draft readiness on a pinned historical run without preflight", () => {
  const readiness: WorkflowReadinessSnapshot = {
    entries: [
      {
        stepId: "build",
        attachmentId: "node",
        kind: "requirement",
        status: "available",
        message: "Node is installed",
      },
    ],
    blocksRun: false,
  };
  expect(workflowReadinessForCanvas(workflowRunFixture, { ...listing, readiness }, false)).toBe(
    undefined,
  );
  const pinnedReadiness = {
    ...readiness,
    entries: [
      { ...readiness.entries[0]!, status: "missing" as const, message: "Missing in run workspace" },
    ],
  };
  expect(
    workflowReadinessForCanvas(
      { ...workflowRunFixture, preflight: pinnedReadiness },
      { ...listing, readiness },
      false,
    ),
  ).toBe(pinnedReadiness);
  expect(workflowReadinessForCanvas(null, { ...listing, readiness }, false)).toBe(readiness);
});

it("counts checked skills as work and their checks on a separate denominator", () => {
  const run = {
    ...workflowRunFixture,
    definition: {
      ...workflowRunFixture.definition,
      steps: workflowRunFixture.definition.steps.map((step) =>
        step.id === "build"
          ? { ...step, checks: [{ kind: "command" as const, command: "pnpm build" }] }
          : step,
      ),
    },
    steps: workflowRunFixture.steps.map((step) =>
      step.stepId === "research"
        ? { ...step, status: "done" as const }
        : step.stepId === "build"
          ? {
              ...step,
              checks: [
                {
                  check: { kind: "command" as const, command: "pnpm build" },
                  ok: true,
                  message: "Passed",
                },
              ],
            }
          : step,
    ),
  };
  expect(workflowRunProgress(run)).toEqual({
    workDone: 1,
    workTotal: 4,
    checksPassed: 1,
    checksTotal: 1,
  });
});

it("discards MCP readiness after changing the workflow's subagent provider", () => {
  const codex = {
    ...listing,
    definition: {
      ...listing.definition,
      subagentModels: [
        {
          driver: ProviderDriverKind.make("codex"),
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6-luna",
        },
      ],
    },
  };
  const context = { ...readinessContext, specification: workflowAttachmentRevision(codex) };
  const readiness: WorkflowReadinessSnapshot = {
    entries: [
      {
        stepId: "build",
        attachmentId: "github",
        kind: "mcp-connection",
        status: "available",
        message: "GitHub is ready in Codex",
      },
    ],
    blocksRun: false,
    context,
  };
  expect(workflowReadinessForListing({ ...codex, readiness }, null, context)).toBe(readiness);
  const claude = {
    ...codex,
    readiness,
    definition: {
      ...codex.definition,
      subagentModels: [
        {
          driver: ProviderDriverKind.make("claudeAgent"),
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-haiku-5-5",
        },
      ],
    },
  };
  expect(
    workflowReadinessForListing(claude, null, {
      ...context,
      specification: workflowAttachmentRevision(claude),
    }),
  ).toBeUndefined();
});
