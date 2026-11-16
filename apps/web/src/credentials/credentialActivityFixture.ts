import {
  CredentialId,
  ProjectId,
  ThreadId,
  type CredentialActivity,
  type CredentialHistoryEvent,
  type CredentialPendingRequest,
} from "@t3tools/contracts";

export const credentialActivityFixture: CredentialActivity = {
  id: "request-1",
  credentialId: CredentialId.make("github"),
  credentialName: "GitHub",
  templateId: "github",
  caller: {
    threadId: ThreadId.make("worker"),
    threadTitle: "Release 1.4",
    projectId: ProjectId.make("project"),
    provider: "codex",
    model: "gpt-6.1-sol",
    agentRole: "subagent",
    runId: "run-one",
    stepId: "build",
    stepTitle: "Build",
    workflow: "launch",
  },
  mode: "exec",
  commandPreview: "gh release list",
  startedAt: "2026-10-22T14:00:00Z",
};
export const credentialRequestFixture: CredentialPendingRequest = {
  ...credentialActivityFixture,
  kind: "use",
  allowedScopes: ["run", "once"],
};
export const credentialHistoryFixture: CredentialHistoryEvent = {
  id: "history-1",
  type: "used",
  at: "2026-10-22T14:00:03Z",
  credentialId: credentialActivityFixture.credentialId,
  credentialName: "GitHub",
  use: {
    ...credentialActivityFixture.caller,
    mode: "exec",
    commandPreview: "gh release list",
    startedAt: credentialActivityFixture.startedAt,
    decision: "allowed",
    result: "ok",
    exitCode: 0,
    approvalScope: "run",
    approvalMethod: "pin",
  },
};
