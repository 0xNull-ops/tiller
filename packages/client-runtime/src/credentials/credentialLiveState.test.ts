import { expect, it } from "vite-plus/test";
import {
  CredentialId,
  ProjectId,
  ThreadId,
  type CredentialActivity,
  type CredentialHistoryEvent,
} from "@t3tools/contracts";
import {
  EMPTY_CREDENTIAL_LIVE_STATE,
  credentialActivityLabel,
  credentialCallerLabel,
  credentialRequestsForThread,
  stepCredentialActivity,
} from "./credentialLiveState.ts";

const activity: CredentialActivity = {
  id: "use",
  credentialId: CredentialId.make("github"),
  credentialName: "GitHub",
  templateId: "github",
  mode: "exec",
  startedAt: "2026-10-22T14:00:00Z",
  caller: {
    threadId: ThreadId.make("worker"),
    threadTitle: "Release",
    projectId: ProjectId.make("project"),
    provider: "Codex",
    model: "gpt-6.1-sol",
    agentRole: "subagent",
    runId: "run",
    stepId: "build",
  },
};
const history: CredentialHistoryEvent = {
  id: "history",
  at: "2026-10-22T14:00:03Z",
  type: "used",
  credentialId: activity.credentialId,
  credentialName: activity.credentialName,
  use: { ...activity.caller, mode: "exec", decision: "allowed", result: "ok", exitCode: 0 },
};

it("derives asking, active, and completed use with precedence and execution counts", () => {
  const asking = stepCredentialActivity(
    {
      ...EMPTY_CREDENTIAL_LIVE_STATE,
      pending: [{ ...activity, kind: "use", allowedScopes: ["run"] }],
      active: [activity],
    },
    [history],
    "run",
    "build",
  );
  expect(asking).toHaveLength(1);
  expect(credentialActivityLabel(asking[0]!)).toBe("Needs approval");
  expect(asking[0]!.count).toBe(1);
  const active = stepCredentialActivity(
    { ...EMPTY_CREDENTIAL_LIVE_STATE, active: [activity] },
    [history],
    "run",
    "build",
  );
  expect(credentialActivityLabel(active[0]!)).toBe("In use");
  expect(
    credentialActivityLabel(
      stepCredentialActivity(EMPTY_CREDENTIAL_LIVE_STATE, [history], "run", "build")[0]!,
    ),
  ).toBe("Used 1×");
});

it("isolates runs and steps and does not count denials as executions", () => {
  const denied = {
    ...history,
    use: { ...history.use!, result: "denied" as const, decision: "denied" as const },
  };
  expect(
    stepCredentialActivity(
      { ...EMPTY_CREDENTIAL_LIVE_STATE, active: [activity] },
      [history],
      "other",
      "build",
    ),
  ).toEqual([]);
  expect(
    stepCredentialActivity(
      { ...EMPTY_CREDENTIAL_LIVE_STATE, active: [activity] },
      [history],
      "run",
      "other",
    ),
  ).toEqual([]);
  expect(
    stepCredentialActivity(EMPTY_CREDENTIAL_LIVE_STATE, [denied], "run", "build")[0]!.count,
  ).toBe(0);
});

it("retains every concurrent request for one credential", () => {
  const request = { ...activity, kind: "use" as const, allowedScopes: ["once" as const] };
  expect(
    stepCredentialActivity(
      { ...EMPTY_CREDENTIAL_LIVE_STATE, pending: [request, { ...request, id: "second" }] },
      [],
      "run",
      "build",
    )[0]!.requests.map((entry) => entry.id),
  ).toEqual(["use", "second"]);
});

it("keeps add requests visible on the owning step until a credential exists", () => {
  const entries = stepCredentialActivity(
    {
      ...EMPTY_CREDENTIAL_LIVE_STATE,
      pending: [
        {
          id: "add",
          kind: "add",
          caller: activity.caller,
          templateId: "github",
          name: "Release GitHub",
          reason: "Publish release",
          startedAt: activity.startedAt,
        },
      ],
    },
    [],
    "run",
    "build",
  );
  expect(entries[0]?.state).toBe("asking");
  expect(entries[0]?.name).toBe("Release GitHub");
  expect(entries[0]?.requests[0]?.kind).toBe("add");
});

it("routes both add and use requests to asking and workflow driver threads only", () => {
  const use = { ...activity, kind: "use" as const, allowedScopes: ["once" as const] };
  const add = {
    id: "add",
    kind: "add" as const,
    caller: activity.caller,
    reason: "Need GitHub",
    startedAt: activity.startedAt,
  };
  const pending = [use, add];
  const runs = [{ id: "run", driverThreadId: "driver" }];
  expect(credentialRequestsForThread(pending, "worker", [])).toEqual(pending);
  expect(credentialRequestsForThread(pending, "driver", runs)).toEqual(pending);
  expect(credentialRequestsForThread(pending, "other", runs)).toEqual([]);
  expect(
    credentialRequestsForThread(pending, "driver", [{ id: "elsewhere", driverThreadId: "driver" }]),
  ).toEqual([]);
});
it("does not count standalone approvals as executions", () => {
  expect(
    stepCredentialActivity(
      EMPTY_CREDENTIAL_LIVE_STATE,
      [{ ...history, type: "approved" }, history],
      "run",
      "build",
    )[0]?.count,
  ).toBe(1);
});

it("carries the caller and redacted command from a live or pending use to the step", () => {
  const withCommand = { ...activity, commandPreview: "asc builds upload --ipa …" };
  const [inUse] = stepCredentialActivity(
    { ...EMPTY_CREDENTIAL_LIVE_STATE, active: [withCommand] },
    [],
    "run",
    "build",
  );
  expect(inUse?.caller).toEqual(activity.caller);
  expect(inUse?.commandPreview).toBe("asc builds upload --ipa …");
  const [asking] = stepCredentialActivity(
    {
      ...EMPTY_CREDENTIAL_LIVE_STATE,
      pending: [{ ...withCommand, kind: "use", allowedScopes: ["run"] }],
    },
    [],
    "run",
    "build",
  );
  expect(asking?.caller).toEqual(activity.caller);
  expect(asking?.commandPreview).toBe("asc builds upload --ipa …");
});

it("leaves out a command the live use does not carry, and never reuses one from another use", () => {
  const [inUse] = stepCredentialActivity(
    { ...EMPTY_CREDENTIAL_LIVE_STATE, active: [activity] },
    [],
    "run",
    "build",
  );
  expect(inUse?.commandPreview).toBeUndefined();
  const [asking] = stepCredentialActivity(
    {
      ...EMPTY_CREDENTIAL_LIVE_STATE,
      active: [{ ...activity, commandPreview: "gh release list" }],
      pending: [{ ...activity, kind: "use", allowedScopes: ["once"] }],
    },
    [],
    "run",
    "build",
  );
  expect(asking?.commandPreview).toBeUndefined();
});

it("labels a caller by its provider display name and role", () => {
  expect(credentialCallerLabel({ provider: "codex", agentRole: "subagent" })).toBe(
    "Codex subagent",
  );
  expect(credentialCallerLabel({ provider: "claudeAgent", agentRole: "main" })).toBe(
    "Claude main agent",
  );
  expect(credentialCallerLabel({ provider: "Acme", agentRole: "main" })).toBe("Acme main agent");
});
