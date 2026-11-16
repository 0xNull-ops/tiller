import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CredentialLiveState,
  CredentialApproveInput,
  CredentialEnvVarName,
  credentialEnvVarProblem,
  isCredentialPinAcceptable,
  credentialScopesGrant,
  Credential,
  CredentialCreateInput,
  CredentialField,
  CredentialGrant,
  CredentialHistoryEvent,
  CredentialPolicy,
  CredentialRevokeGrantInput,
  CredentialRpcError,
  CredentialUpdateInput,
  CredentialUseRecord,
  DEFAULT_CREDENTIAL_POLICY,
  DesktopCredentialOsUnlockRequest,
  DesktopCredentialOsUnlockResult,
} from "./credential.ts";
import { sessionGrantsScope } from "./auth.ts";
import { ProjectId } from "./baseSchemas.ts";

const decodeSyncCredential = Schema.decodeSync(Credential);
const decodeSyncCredentialField = Schema.decodeSync(CredentialField);
const decodeSyncCredentialPolicy = Schema.decodeSync(CredentialPolicy);
const decodeSyncCredentialCreateInput = Schema.decodeSync(CredentialCreateInput);
const decodeSyncCredentialUseRecord = Schema.decodeSync(CredentialUseRecord);
const decodeSyncCredentialHistoryEvent = Schema.decodeSync(CredentialHistoryEvent);
const decodeSyncCredentialRpcError = Schema.decodeSync(CredentialRpcError);
const decodeSyncDesktopCredentialOsUnlockRequest = Schema.decodeSync(
  DesktopCredentialOsUnlockRequest,
);
const decodeUnknownSyncDesktopCredentialOsUnlockRequest = Schema.decodeUnknownSync(
  DesktopCredentialOsUnlockRequest,
);
const decodeSyncDesktopCredentialOsUnlockResult = Schema.decodeSync(
  DesktopCredentialOsUnlockResult,
);
const decodeSyncCredentialEnvVarName = Schema.decodeSync(CredentialEnvVarName);
const decodeSyncCredentialUpdateInput = Schema.decodeSync(CredentialUpdateInput);
const decodeSyncCredentialGrant = Schema.decodeSync(CredentialGrant);
const decodeUnknownSyncCredentialGrant = Schema.decodeUnknownSync(CredentialGrant);
const decodeSyncCredentialRevokeGrantInput = Schema.decodeSync(CredentialRevokeGrantInput);
const decodeUnknownSyncCredentialRevokeGrantInput = Schema.decodeUnknownSync(
  CredentialRevokeGrantInput,
);
const decodeSyncCredentialLiveState = Schema.decodeSync(CredentialLiveState);
const decodeSyncCredentialApproveInput = Schema.decodeSync(CredentialApproveInput);
const decodeUnknownSyncCredentialApproveInput = Schema.decodeUnknownSync(CredentialApproveInput);

const textField = {
  id: "key-id",
  label: "Key ID",
  kind: "text",
  envVar: "ASC_KEY_ID",
  required: true,
  highRisk: false,
  value: "ABC123",
} as const;

const secretField = {
  id: "private-key",
  label: "Private key",
  kind: "secretFile",
  envVar: "ASC_PRIVATE_KEY_PATH",
  required: true,
  highRisk: false,
  secret: { set: true, updatedAt: "2026-10-22T00:00:00.000Z", fileName: "AuthKey.p8", size: 257 },
  extensions: ["p8"],
  maxBytes: 16384,
} as const;

const credential = {
  id: "cred-1",
  name: "App Store Connect — Acme",
  templateId: "app-store-connect",
  fields: [textField, secretField],
  policy: DEFAULT_CREDENTIAL_POLICY,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  useCount: 0,
  status: "ready",
} as const;

describe("credential schemas", () => {
  it("decodes a credential whose secret fields carry state only", () => {
    const decoded = decodeSyncCredential(credential);
    expect(decoded.fields[1]?.secret).toEqual({
      set: true,
      updatedAt: "2026-10-22T00:00:00.000Z",
      fileName: "AuthKey.p8",
      size: 257,
    });
    expect(JSON.stringify(decoded)).not.toContain("PRIVATE KEY");
  });

  it("refuses a value on a secret field and secret state on a text field", () => {
    expect(() => decodeSyncCredentialField({ ...secretField, value: "-----BEGIN" })).toThrow();
    expect(() =>
      decodeSyncCredentialField({
        ...textField,
        secret: { set: true },
      }),
    ).toThrow();
  });

  it("keeps field ids filename-safe, because they name the stored value", () => {
    expect(() => decodeSyncCredentialField({ ...textField, id: "key/id" })).toThrow();
    expect(() => decodeSyncCredentialField({ ...textField, id: "../escape" })).toThrow();
  });

  it("decodes a project-restricted policy but not an empty restriction list", () => {
    expect(
      decodeSyncCredentialPolicy({
        projects: [ProjectId.make("project-1")],
        alwaysAsk: false,
        revealAllowed: true,
      }),
    ).toMatchObject({ alwaysAsk: false, revealAllowed: true });
    expect(decodeSyncCredentialPolicy({ ...DEFAULT_CREDENTIAL_POLICY, projects: "all" })).toEqual(
      DEFAULT_CREDENTIAL_POLICY,
    );
  });

  it("requires a file payload for secretFile and a plain value otherwise", () => {
    const base = { templateId: "app-store-connect", name: "Acme" };
    expect(
      decodeSyncCredentialCreateInput({
        ...base,
        plainFields: { "key-id": "ABC" },
        secrets: [{ fieldId: "private-key", base64: "AAAA", fileName: "AuthKey.p8" }],
      }),
    ).toMatchObject({ name: "Acme" });
    // Both shapes decode; which one a field accepts is the server's check, because only it knows
    // the template.
    expect(
      decodeSyncCredentialCreateInput({
        ...base,
        secrets: [{ fieldId: "token", value: "abc" }],
      }),
    ).toMatchObject({ templateId: "app-store-connect" });
  });

  it("reserves a use record shape for 6B without ever holding a value", () => {
    const use = decodeSyncCredentialUseRecord({
      provider: "codex",
      model: "gpt-5",
      mode: "exec",
      decision: "allowed",
      result: "ok",
      commandPreview: "asc apps list --limit 1",
    });
    expect(use).toMatchObject({ mode: "exec", result: "ok" });
    const event = decodeSyncCredentialHistoryEvent({
      id: "event-1",
      at: "2026-10-22T00:00:00.000Z",
      type: "used",
      credentialId: "cred-1",
      use,
    });
    expect(Object.keys(event).sort()).toEqual(["at", "credentialId", "id", "type", "use"]);
  });

  it("decodes each RPC error the client has to tell apart", () => {
    expect(decodeSyncCredentialRpcError({ _tag: "CredentialPinRequiredError" })).toMatchObject({
      _tag: "CredentialPinRequiredError",
    });
    expect(
      decodeSyncCredentialRpcError({
        _tag: "CredentialAccessError",
        reason: "locked-out",
        retryAfterSeconds: 30,
      }),
    ).toMatchObject({ reason: "locked-out" });
    expect(
      decodeSyncCredentialRpcError({
        _tag: "CredentialError",
        reason: "field-not-secret",
        fieldId: "key-id",
      }),
    ).toMatchObject({ reason: "field-not-secret" });
  });

  it("carries a desktop unlock request without inventing fields", () => {
    expect(
      decodeSyncDesktopCredentialOsUnlockRequest({
        action: "enable",
        environmentId: "env-1",
        pin: "1234",
      }),
    ).toMatchObject({ action: "enable", environmentId: "env-1", pin: "1234" });
    expect(() =>
      decodeUnknownSyncDesktopCredentialOsUnlockRequest({
        action: "forget",
        environmentId: "env-1",
      }),
    ).toThrow();
  });

  it("omits the released PIN when the OS prompt was cancelled", () => {
    const result = decodeSyncDesktopCredentialOsUnlockResult({
      status: { available: true, enabled: true, method: "touch-id" },
    });
    expect(result.pin).toBeUndefined();
  });
});

describe("credential PINs", () => {
  it("accepts four or more digits, or any passphrase of six or more characters", () => {
    expect(isCredentialPinAcceptable("1234")).toBe(true);
    expect(isCredentialPinAcceptable("123")).toBe(false);
    expect(isCredentialPinAcceptable("abcd")).toBe(false);
    expect(isCredentialPinAcceptable("abcdef")).toBe(true);
    expect(isCredentialPinAcceptable("ab cd1")).toBe(true);
  });
});

describe("credential environment variable names", () => {
  it("accepts the names a command can be given", () => {
    for (const name of ["GITHUB_TOKEN", "GH_TOKEN", "ASC_KEY_ID", "_PRIVATE", "lower_case"]) {
      expect(credentialEnvVarProblem(name)).toBeNull();
      expect(decodeSyncCredentialEnvVarName(name)).toBe(name);
    }
  });

  it("refuses anything that is not a POSIX name", () => {
    for (const name of ["GH-TOKEN", "1TOKEN", "with space", "A=B"]) {
      expect(credentialEnvVarProblem(name)).toMatch(/letters, digits and underscores/);
      expect(() => decodeSyncCredentialEnvVarName(name)).toThrow();
    }
  });

  it("refuses names that change how the command runs", () => {
    for (const name of [
      "PATH",
      "HOME",
      "SHELL",
      "NODE_OPTIONS",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH",
    ]) {
      expect(credentialEnvVarProblem(name)).toMatch(/reserved by the system/);
      expect(() => decodeSyncCredentialEnvVarName(name)).toThrow();
    }
  });

  it("overrides a built-in template's name on create and on update", () => {
    const created = decodeSyncCredentialCreateInput({
      templateId: "github",
      name: "GitHub",
      fields: [{ id: "token", label: "Token", kind: "secret", envVar: "GH_TOKEN" }],
      secrets: [{ fieldId: "token", value: "ghp_x" }],
    });
    expect(created.fields?.[0]?.envVar).toBe("GH_TOKEN");

    const updated = decodeSyncCredentialUpdateInput({
      id: "cred-1",
      fields: [
        { id: "token", label: "Token", kind: "secret", envVar: "GITHUB_TOKEN", required: true },
      ],
    });
    expect(updated.fields?.[0]).toMatchObject({ envVar: "GITHUB_TOKEN", required: true });
  });

  it("keeps reading a stored name written before the check existed", () => {
    // The vault is a single document: failing to decode one old field would hide every credential.
    const legacy = decodeSyncCredential({
      ...credential,
      fields: [{ ...textField, envVar: "GH-TOKEN" }, secretField],
    });
    expect(legacy.fields[0]?.envVar).toBe("GH-TOKEN");
  });
});

describe("credential grants", () => {
  const approval = {
    kind: "approval",
    id: "grant-1",
    credentialId: "cred-1",
    scope: "workflow",
    projectId: "project-1",
    threadId: "thread-1",
    workflow: "release",
    approverSessionId: "session-1",
    approvalMethod: "unlock",
    createdAt: "2026-10-22T00:00:00.000Z",
  } as const;
  const preapproval = {
    kind: "workflow-preapproval",
    id: "workflow-preapproval:project-1:release:cred-1",
    credentialId: "cred-1",
    projectId: "project-1",
    workflow: "release",
    approverSessionId: "session-1",
    createdAt: "2026-10-22T00:00:00.000Z",
  } as const;

  it("tells a per-use approval apart from a workflow pre-approval by kind", () => {
    expect(decodeSyncCredentialGrant(approval)).toMatchObject({
      kind: "approval",
      scope: "workflow",
    });
    expect(decodeSyncCredentialGrant(preapproval)).toEqual(preapproval);
    // The kinds share a credential and a project, so a row without one is ambiguous: refuse it
    // rather than guess which door it should be withdrawn through.
    const { kind: _kind, ...noKind } = approval;
    expect(() => decodeUnknownSyncCredentialGrant(noKind)).toThrow();
  });

  it("names the kind a revoke withdraws", () => {
    expect(
      decodeSyncCredentialRevokeGrantInput({
        kind: "approval",
        grantId: "grant-1",
      }),
    ).toEqual({ kind: "approval", grantId: "grant-1" });
    expect(
      decodeSyncCredentialRevokeGrantInput({
        kind: "workflow-preapproval",
        projectId: "project-1",
        workflow: "release",
        credentialId: "cred-1",
      }),
    ).toMatchObject({ kind: "workflow-preapproval", workflow: "release" });
    // A pre-approval withdraws one credential by name; there is no row id to send instead.
    expect(() =>
      decodeUnknownSyncCredentialRevokeGrantInput({
        kind: "workflow-preapproval",
        grantId: "workflow-preapproval:project-1:release:cred-1",
      }),
    ).toThrow();
  });

  it("reads the bare grant id a tab from before the kinds existed sends", () => {
    expect(decodeSyncCredentialRevokeGrantInput({ grantId: "grant-1" })).toEqual({
      kind: "approval",
      grantId: "grant-1",
    });
  });

  it.each([
    { scopes: ["credentials:manage"], allowed: true },
    { scopes: ["terminal:operate"], allowed: true },
    { scopes: ["terminal:read", "orchestration:operate"], allowed: false },
    { scopes: [], allowed: false },
  ] as const)("checks stored scopes $scopes", ({ scopes, allowed }) => {
    expect(credentialScopesGrant(scopes)).toBe(allowed);
    for (const session of [{ scopes }, { scopes: [], permissions: scopes }]) {
      expect(sessionGrantsScope({ ...session, authenticated: true }, "credentials:manage")).toBe(
        allowed,
      );
      expect(sessionGrantsScope({ ...session, authenticated: false }, "credentials:manage")).toBe(
        false,
      );
    }
  });

  it("honors exact narrowed permissions over legacy scopes", () => {
    expect(
      sessionGrantsScope(
        { authenticated: true, scopes: ["terminal:operate"], permissions: [] },
        "credentials:manage",
      ),
    ).toBe(false);
  });
});

it("validates approval scopes and initial live state", () => {
  expect(decodeSyncCredentialLiveState({ pending: [], active: [], historyRevision: 0 })).toEqual({
    pending: [],
    active: [],
    historyRevision: 0,
  });
  expect(decodeSyncCredentialApproveInput({ requestId: "request", scope: "run" })).toEqual({
    requestId: "request",
    scope: "run",
  });
  expect(() =>
    decodeUnknownSyncCredentialApproveInput({ requestId: "request", scope: "forever" }),
  ).toThrow();
});

it.each(["pin", "os", "unlock"] as const)(
  "keeps history readable with approval method %s",
  (approvalMethod) => {
    const event = decodeSyncCredentialHistoryEvent({
      id: "event",
      at: "2026-10-22T00:00:00Z",
      type: "used",
      use: { mode: "exec", decision: "allowed", result: "ok", approvalMethod },
    });
    expect(event.use?.approvalMethod).toBe(approvalMethod);
  },
);
