import { describe, expect, it } from "@effect/vitest";
import {
  CredentialId,
  ProjectId,
  type Credential,
  type CredentialStatus,
  type WorkflowCredentialAttachment,
  type WorkflowCredentialReadiness,
  type WorkflowDefinition,
  type WorkflowReadinessEntry,
  type WorkflowSkillStep,
} from "@t3tools/contracts";

import {
  attachedCredentialIds,
  blockingCredentialEntries,
  credentialApprovalWarnings,
  credentialReadiness,
  resolveCredentialAttachment,
} from "./credentialAttachments.ts";

const projectId = ProjectId.make("project-1");
const elsewhere = ProjectId.make("project-2");
const nowMs = Date.parse("2026-10-22T00:00:00.000Z");

const credential = (input: {
  readonly id: string;
  readonly templateId?: string;
  readonly status?: CredentialStatus;
  readonly expiresAt?: string;
  readonly projects?: Credential["policy"]["projects"];
  readonly fields?: Credential["fields"];
}): Credential => ({
  id: CredentialId.make(input.id),
  name: `Credential ${input.id}`,
  templateId: input.templateId ?? "github",
  fields: input.fields ?? [
    {
      id: "token",
      label: "Token",
      kind: "secret",
      envVar: "GITHUB_TOKEN",
      required: true,
      highRisk: false,
      secret: { set: true },
    },
  ],
  policy: {
    projects: input.projects ?? "all",
    alwaysAsk: false,
    revealAllowed: false,
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  useCount: 0,
  ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  status: input.status ?? "ready",
});

const attachment = (input: {
  readonly credentialId?: string;
  readonly templateId?: string;
  readonly optional?: boolean;
}): WorkflowCredentialAttachment => ({
  id: "gh",
  kind: "credential",
  templateId: input.templateId ?? "github",
  ...(input.credentialId === undefined
    ? {}
    : { credentialId: CredentialId.make(input.credentialId) }),
  ...(input.optional === undefined ? {} : { optional: input.optional }),
});

const resolve = (attached: WorkflowCredentialAttachment, credentials: ReadonlyArray<Credential>) =>
  resolveCredentialAttachment({ attachment: attached, projectId, credentials });

const readiness = (
  attached: WorkflowCredentialAttachment,
  credentials: ReadonlyArray<Credential> | undefined,
): WorkflowCredentialReadiness =>
  credentialReadiness({
    attachment: attached,
    resolution: credentials === undefined ? undefined : resolve(attached, credentials),
    nowMs,
  });

describe("credential attachment binding", () => {
  it("uses a bound credential that exists and is usable", () => {
    const bound = credential({ id: "cred-1" });
    const other = credential({ id: "cred-2" });
    expect(resolve(attachment({ credentialId: "cred-1" }), [other, bound])).toEqual({
      state: "ready",
      credential: bound,
    });
  });

  it("reports the bound credential's own problem instead of swapping in another", () => {
    const expired = credential({ id: "cred-expired", status: "expired" });
    const ready = credential({ id: "cred-ready" });
    expect(resolve(attachment({ credentialId: "cred-expired" }), [expired, ready])).toMatchObject({
      state: "expired",
      credential: { id: "cred-expired" },
    });
    const incomplete = credential({ id: "cred-incomplete", status: "missing-field" });
    expect(resolve(attachment({ credentialId: "cred-incomplete" }), [incomplete])).toMatchObject({
      state: "incomplete",
    });
  });

  it("refuses a bound credential the project may not use, even when others match", () => {
    const restricted = credential({ id: "cred-1", projects: [elsewhere] });
    const allowed = credential({ id: "cred-2" });
    expect(resolve(attachment({ credentialId: "cred-1" }), [restricted, allowed])).toMatchObject({
      state: "not-allowed",
      credential: { id: "cred-1" },
    });
  });

  it("matches by template when the bound id is gone or the file is portable", () => {
    const only = credential({ id: "cred-1" });
    for (const attached of [attachment({ credentialId: "cred-deleted" }), attachment({})]) {
      expect(resolve(attached, [only])).toEqual({ state: "matched", credential: only });
    }
  });

  it("ignores a bound id that names another template", () => {
    const stripe = credential({ id: "cred-stripe", templateId: "stripe" });
    expect(resolve(attachment({ credentialId: "cred-stripe" }), [stripe])).toEqual({
      state: "missing",
    });
    const github = credential({ id: "cred-github" });
    expect(resolve(attachment({ credentialId: "cred-stripe" }), [stripe, github])).toEqual({
      state: "matched",
      credential: github,
    });
  });

  it("asks the user to choose between several usable matches", () => {
    const first = credential({ id: "cred-1" });
    const second = credential({ id: "cred-2" });
    expect(resolve(attachment({ credentialId: "cred-deleted" }), [first, second])).toEqual({
      state: "choose",
      candidates: [first, second],
    });
  });

  it("reports missing when the template has no credential the project may use", () => {
    expect(resolve(attachment({}), [])).toEqual({ state: "missing" });
    expect(
      resolve(attachment({}), [
        credential({ id: "cred-other", templateId: "stripe" }),
        credential({ id: "cred-restricted", projects: [elsewhere] }),
      ]),
    ).toEqual({ state: "missing" });
  });

  it("reports the single unusable candidate's state instead of a bare missing", () => {
    const expired = credential({ id: "cred-1", status: "expired" });
    expect(resolve(attachment({}), [expired])).toMatchObject({ state: "expired" });
    const incomplete = credential({ id: "cred-2", status: "missing-field" });
    expect(resolve(attachment({}), [incomplete])).toMatchObject({ state: "incomplete" });
  });
});

describe("credential readiness detail", () => {
  it("names env vars and files without carrying a value", () => {
    const asc = credential({
      id: "cred-1",
      templateId: "app-store-connect",
      fields: [
        {
          id: "key-id",
          label: "Key ID",
          kind: "text",
          envVar: "ASC_KEY_ID",
          required: true,
          highRisk: false,
          value: "ABC123",
        },
        {
          id: "private-key",
          label: "Private key",
          kind: "secretFile",
          envVar: "ASC_PRIVATE_KEY_PATH",
          required: true,
          highRisk: false,
          secret: { set: true, fileName: "key.p8", size: 12 },
        },
      ],
    });
    const detail = readiness(
      attachment({ templateId: "app-store-connect", credentialId: "cred-1" }),
      [asc],
    );
    expect(detail).toMatchObject({
      state: "ready",
      templateId: "app-store-connect",
      statusLabel: "Ready",
      credentialId: "cred-1",
      envVars: [
        { name: "ASC_KEY_ID", file: false },
        { name: "ASC_PRIVATE_KEY_PATH", file: true },
      ],
      candidates: [],
      optional: false,
    });
    expect(JSON.stringify(detail)).not.toContain("ABC123");
    expect(JSON.stringify(detail)).not.toContain("key.p8");
  });

  it("keeps a reserved legacy env name out of the names the step promises", () => {
    // Saved before the reserved-name check existed; injection skips PATH, so readiness must too.
    const legacy = credential({
      id: "cred-1",
      fields: [
        {
          id: "path",
          label: "Path",
          kind: "text",
          envVar: "PATH",
          required: false,
          highRisk: false,
          value: "/tmp/bin",
        },
        {
          id: "token",
          label: "Token",
          kind: "secret",
          envVar: "GITHUB_TOKEN",
          required: true,
          highRisk: false,
          secret: { set: true },
        },
      ],
    });
    expect(readiness(attachment({ credentialId: "cred-1" }), [legacy])).toMatchObject({
      state: "ready",
      envVars: [{ name: "GITHUB_TOKEN", file: false }],
    });
  });

  it("labels an expiring credential with the days left", () => {
    const expiring = credential({
      id: "cred-1",
      status: "expiring",
      expiresAt: "2026-11-03T00:00:00.000Z",
    });
    expect(readiness(attachment({ credentialId: "cred-1" }), [expiring]).statusLabel).toBe(
      "Expires in 12 days",
    );
    const tomorrow = credential({
      id: "cred-2",
      status: "expiring",
      expiresAt: "2026-10-23T00:00:00.000Z",
    });
    expect(readiness(attachment({ credentialId: "cred-2" }), [tomorrow]).statusLabel).toBe(
      "Expires tomorrow",
    );
  });

  it("matches one usable candidate even among unusable ones, and asks between two usable", () => {
    const detail = readiness(attachment({}), [
      credential({ id: "cred-1" }),
      credential({ id: "cred-2", status: "expired" }),
    ]);
    expect(detail).toMatchObject({ state: "matched", credentialId: "cred-1" });
    const ambiguous = readiness(attachment({}), [
      credential({ id: "cred-1" }),
      credential({ id: "cred-2", status: "expired" }),
      credential({ id: "cred-3" }),
    ]);
    expect(ambiguous.state).toBe("choose");
    expect(ambiguous.candidates.map((candidate) => candidate.statusLabel)).toEqual([
      "Ready",
      "Expired",
      "Ready",
    ]);
  });

  it("reports vault unavailability as no-access rather than missing", () => {
    expect(readiness(attachment({}), undefined)).toMatchObject({
      state: "no-access",
      statusLabel: "Credential vault unavailable",
      envVars: [],
      candidates: [],
    });
  });

  it("marks an optional attachment so a run can proceed without it", () => {
    expect(readiness(attachment({ optional: true }), []).optional).toBe(true);
  });
});

describe("attached credential ids", () => {
  const step = (attachments: ReadonlyArray<WorkflowCredentialAttachment>): WorkflowSkillStep => ({
    id: "deploy",
    skill: "deploy",
    attachments,
  });

  it("returns only the credentials the policy may cover", () => {
    const ready = credential({ id: "cred-1" });
    const expired = credential({ id: "cred-2", status: "expired" });
    expect(
      attachedCredentialIds({
        step: step([
          { ...attachment({ credentialId: "cred-1" }), id: "one" },
          { ...attachment({ credentialId: "cred-2" }), id: "two" },
          { ...attachment({}), id: "three", templateId: "stripe" },
        ]),
        projectId,
        credentials: [ready, expired],
      }),
    ).toEqual([CredentialId.make("cred-1")]);
  });

  it("never resolves two candidates into a silent choice", () => {
    expect(
      attachedCredentialIds({
        step: step([attachment({})]),
        projectId,
        credentials: [credential({ id: "cred-1" }), credential({ id: "cred-2" })],
      }),
    ).toEqual([]);
  });
});

describe("credential approval warnings and unattended blocking", () => {
  const definition = (credentialApprovals?: WorkflowDefinition["credentialApprovals"]) => ({
    version: 3 as const,
    name: "Release",
    ...(credentialApprovals === undefined ? {} : { credentialApprovals }),
    steps: [
      {
        id: "deploy",
        skill: "deploy",
        attachments: [attachment({})],
      },
    ],
  });

  it("warns only when a workflow with credentials is not pre-approved", () => {
    expect(credentialApprovalWarnings(definition())).toEqual([
      "Scheduled runs need Pre-approved credentials.",
    ]);
    expect(credentialApprovalWarnings(definition("ask"))).toHaveLength(1);
    expect(credentialApprovalWarnings(definition("pre-approved"))).toEqual([]);
    expect(
      credentialApprovalWarnings({
        version: 3,
        name: "Release",
        steps: [{ id: "deploy", skill: "deploy" }],
      }),
    ).toEqual([]);
  });

  it("blocks only required, unusable credential entries", () => {
    const entry = (
      state: WorkflowCredentialReadiness["state"],
      optional = false,
    ): WorkflowReadinessEntry => ({
      stepId: "deploy",
      attachmentId: "gh",
      kind: "credential",
      status: "missing",
      message: "…",
      credential: { ...readiness(attachment({}), []), state, optional },
    });
    const snapshot = {
      blocksRun: false,
      entries: [
        entry("ready"),
        entry("matched"),
        entry("expiring"),
        entry("missing"),
        entry("choose"),
        entry("incomplete"),
        entry("expired"),
        entry("not-allowed"),
        entry("no-access"),
        entry("missing", true),
      ],
    };
    expect(blockingCredentialEntries(snapshot).map((item) => item.credential?.state)).toEqual([
      "missing",
      "choose",
      "incomplete",
      "expired",
      "not-allowed",
      "no-access",
    ]);
  });
});
