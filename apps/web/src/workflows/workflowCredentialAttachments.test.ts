import { expect, it } from "vite-plus/test";
import type {
  WorkflowCredentialAttachment,
  WorkflowCredentialReadiness,
  WorkflowReadinessEntry,
  WorkflowStep,
} from "@t3tools/contracts";
import type { StepCredentialActivity } from "@t3tools/client-runtime/state/runtime";
import {
  bindCredentialAttachment,
  credentialAttachment,
  credentialAttachmentsFor,
  credentialCardAction,
  credentialEnvVarSummary,
  suggestedCredentialTemplateIds,
  workflowCredentialCardHeight,
  workflowCredentialSatellites,
} from "./workflowCredentialAttachments";

const step = (attachments: WorkflowStep["attachments"]): WorkflowStep => ({
  id: "build",
  skill: "ios-upload",
  attachments,
});

const attachment = (overrides: Partial<WorkflowCredentialAttachment> = {}) => ({
  id: "resource-1",
  kind: "credential" as const,
  templateId: "app-store-connect",
  credentialId: "cred-1" as WorkflowCredentialAttachment["credentialId"],
  ...overrides,
});

const readiness = (
  overrides: Partial<WorkflowCredentialReadiness> = {},
): WorkflowCredentialReadiness => ({
  state: "ready",
  templateId: "app-store-connect",
  statusLabel: "Ready",
  credentialId: "cred-1" as WorkflowCredentialReadiness["credentialId"],
  name: "App Store Connect — Acme",
  envVars: [{ name: "ASC_KEY_ID", file: false }],
  candidates: [],
  optional: false,
  ...overrides,
});

const entry = (credential: WorkflowCredentialReadiness): WorkflowReadinessEntry => ({
  stepId: "build",
  attachmentId: "resource-1",
  kind: "credential",
  status: "available",
  message: "Uses it",
  credential,
});

const activity = (overrides: Partial<StepCredentialActivity> = {}): StepCredentialActivity => ({
  credentialId: "cred-1",
  name: "App Store Connect — Acme",
  templateId: "app-store-connect",
  state: "in-use",
  count: 0,
  requests: [],
  ...overrides,
});

it("folds a live use into the credential the step attached instead of drawing two cards", () => {
  const satellites = workflowCredentialSatellites({
    step: step([attachment()]),
    entries: [entry(readiness())],
    activity: [activity()],
    approval: "once-per-run",
  });
  expect(satellites).toHaveLength(1);
  expect(satellites[0]).toMatchObject({
    key: "credential:build:resource-1",
    attachmentId: "resource-1",
    credentialId: "cred-1",
    state: "in-use",
    statusLabel: "In use",
    name: "App Store Connect — Acme",
  });
});

it("keeps one card per credential when the step attaches the same credential twice", () => {
  const satellites = workflowCredentialSatellites({
    step: step([attachment(), attachment({ id: "resource-2" })]),
    entries: [entry(readiness())],
    activity: [],
    approval: "once-per-run",
  });
  expect(satellites.map((satellite) => satellite.key)).toEqual([
    "credential:build:resource-1",
    "credential:build:resource-2",
  ]);
});

it("gives an ad-hoc use its own vault-keyed card when no attachment names it", () => {
  const satellites = workflowCredentialSatellites({
    step: step([]),
    entries: [],
    activity: [activity({ credentialId: "cred-9", name: "GitHub token", templateId: "github" })],
    approval: "once-per-run",
  });
  expect(satellites).toHaveLength(1);
  expect(satellites[0]).toMatchObject({
    key: "credential:build:cred-9",
    credentialId: "cred-9",
    state: "in-use",
  });
  expect(satellites[0]!.attachmentId).toBeUndefined();
  expect(credentialCardAction(satellites[0]!)).toBe("none");
});

it("shows an imported, unbound attachment as matched with the credential the vault found", () => {
  const satellites = workflowCredentialSatellites({
    step: step([attachment({ credentialId: undefined })]),
    entries: [entry(readiness({ state: "matched", statusLabel: "Matched automatically" }))],
    activity: [],
    approval: "once-per-run",
  });
  expect(satellites[0]).toMatchObject({
    state: "matched",
    credentialId: "cred-1",
    statusLabel: "Matched automatically",
  });
  expect(credentialCardAction(satellites[0]!)).toBe("choose");
});

it("offers add, choose or fix per state and leaves a ready card alone", () => {
  const action = (state: WorkflowCredentialReadiness["state"]) =>
    credentialCardAction(
      workflowCredentialSatellites({
        step: step([attachment()]),
        entries: [entry(readiness({ state, statusLabel: state }))],
        activity: [],
      })[0]!,
    );
  expect(action("missing")).toBe("add");
  expect(action("choose")).toBe("choose");
  expect(action("incomplete")).toBe("fix");
  expect(action("expired")).toBe("fix");
  expect(action("ready")).toBe("none");
});

it("suggests a credential from the step's own words, and never one it already has", () => {
  const ios: WorkflowStep = {
    id: "upload",
    skill: "ios-upload",
    note: "Upload the build with asc and wait for TestFlight processing.",
  };
  expect(suggestedCredentialTemplateIds({ step: ios, attachedServers: [] })).toContain(
    "app-store-connect",
  );
  const deploy: WorkflowStep = {
    id: "deploy",
    skill: "release-site",
    note: "Deploy the built site to Vercel and report the URL.",
  };
  expect(suggestedCredentialTemplateIds({ step: deploy, attachedServers: [] })).toContain("vercel");
  expect(
    suggestedCredentialTemplateIds({
      step: step([attachment()]),
      attachedServers: [],
    }),
  ).not.toContain("app-store-connect");
});

it("suggests from an attached MCP server's name", () => {
  const stepWithMcp: WorkflowStep = {
    id: "publish",
    skill: "ship-it",
    attachments: [{ id: "mcp", kind: "mcp-connection", server: "RevenueCat MCP" }],
  };
  expect(
    suggestedCredentialTemplateIds({ step: stepWithMcp, attachedServers: ["RevenueCat MCP"] }),
  ).toContain("revenuecat");
});

it("writes the portable template and this machine's id into an attachment", () => {
  expect(
    credentialAttachment({
      id: "resource-7",
      templateId: "vercel",
      credentialId: "cred-vercel",
      name: "Vercel — site",
    }),
  ).toEqual({
    id: "resource-7",
    kind: "credential",
    templateId: "vercel",
    credentialId: "cred-vercel",
    label: "Vercel — site",
  });
});

it("writes templateId and credentialId for a multi-select, skipping ones already attached", () => {
  const written = credentialAttachmentsFor({
    step: {
      attachments: [attachment({ id: "resource-1" })],
    },
    credentials: [
      { id: "cred-1", templateId: "app-store-connect", name: "App Store Connect — Acme" },
      { id: "cred-2", templateId: "vercel", name: "Vercel — site" },
    ],
    limit: 12,
    newId: () => "resource-2",
  });
  expect(written).toEqual([
    {
      id: "resource-2",
      kind: "credential",
      templateId: "vercel",
      credentialId: "cred-2",
      label: "Vercel — site",
    },
  ]);
});

it("binds a chosen credential by id while keeping the portable template", () => {
  expect(
    bindCredentialAttachment(
      {
        id: "resource-1",
        kind: "credential",
        templateId: "app-store-connect",
        label: "App Store Connect — Acme",
      },
      "cred-appstore",
    ),
  ).toEqual({
    id: "resource-1",
    kind: "credential",
    templateId: "app-store-connect",
    credentialId: "cred-appstore",
    label: "App Store Connect — Acme",
  });
});

it("names a file field the way the agent sees it", () => {
  expect(
    credentialEnvVarSummary([
      { name: "ASC_KEY_ID", file: false },
      { name: "ASC_PRIVATE_KEY", file: true },
    ]),
  ).toBe("ASC_KEY_ID · ASC_PRIVATE_KEY (file path)");
});

it("reserves a lane row for each masked env name, so stacked cards never overlap", () => {
  const heightFor = (envVars: WorkflowCredentialReadiness["envVars"]) =>
    workflowCredentialCardHeight(
      workflowCredentialSatellites({
        step: step([attachment()]),
        entries: [entry(readiness({ envVars }))],
        activity: [],
        approval: "once-per-run",
      })[0]!,
    );
  const one = [{ name: "ASC_KEY_ID", file: false }];
  const two = [...one, { name: "ASC_ISSUER_ID", file: false }];
  const three = [...two, { name: "ASC_KEY_PATH", file: true }];
  expect(heightFor(two)).toBe(heightFor(one) + 14);
  // A fourth name folds into the "+2" row instead of growing the card again.
  expect(heightFor(three)).toBe(heightFor(two) + 14);
  expect(heightFor([...three, { name: "ASC_TEAM_ID", file: false }])).toBe(heightFor(three));
});
