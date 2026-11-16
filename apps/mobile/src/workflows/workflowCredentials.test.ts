import {
  CredentialId,
  type WorkflowCredentialAttachment,
  type WorkflowCredentialReadiness,
  type WorkflowCredentialState,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { workflowCredentialRow } from "./workflowCredentials";

const attachment = (templateId: string): WorkflowCredentialAttachment => ({
  id: "asc",
  kind: "credential",
  templateId,
  optional: false,
});

const readiness = (
  state: WorkflowCredentialState,
  overrides: Partial<WorkflowCredentialReadiness> = {},
): WorkflowCredentialReadiness => ({
  state,
  templateId: "app-store-connect",
  statusLabel: "Ready",
  optional: false,
  envVars: [],
  candidates: [],
  ...overrides,
});

describe("workflowCredentialRow", () => {
  it("names the bound credential and lists only its env-var names", () => {
    const row = workflowCredentialRow(
      attachment("app-store-connect"),
      readiness("ready", {
        credentialId: CredentialId.make("cred-acme"),
        name: "App Store Connect — Acme",
        icon: "appstore",
        envVars: [
          { name: "ASC_KEY_ID", file: false },
          { name: "ASC_PRIVATE_KEY_PATH", file: true },
        ],
      }),
    );
    expect(row).toEqual({
      name: "App Store Connect — Acme",
      templateIcon: "appstore",
      iconOverride: "appstore",
      envVars: ["ASC_KEY_ID", "ASC_PRIVATE_KEY_PATH"],
      statusLabel: "Ready",
      tone: "ready",
    });
  });

  it("falls back to the template name while nothing is bound", () => {
    const row = workflowCredentialRow(
      attachment("app-store-connect"),
      readiness("missing", { statusLabel: "Missing" }),
    );
    expect(row.name).toBe("App Store Connect API key");
    expect(row.statusLabel).toBe("Missing");
    expect(row.tone).toBe("attention");
  });

  it("shows the template id when no template matches", () => {
    const row = workflowCredentialRow(attachment("homegrown-token"), undefined);
    expect(row.name).toBe("homegrown-token");
  });

  it("marks an attachment nobody has checked as neutral, not as a problem", () => {
    const row = workflowCredentialRow(attachment("github"), undefined);
    expect(row).toMatchObject({ statusLabel: "Not checked", tone: "neutral", envVars: [] });
  });

  it("maps each readiness state to one tone", () => {
    const tones = (
      [
        "ready",
        "matched",
        "expiring",
        "choose",
        "missing",
        "incomplete",
        "expired",
        "not-allowed",
        "no-access",
      ] satisfies WorkflowCredentialState[]
    ).map((state) => [state, workflowCredentialRow(attachment("github"), readiness(state)).tone]);
    expect(Object.fromEntries(tones)).toEqual({
      ready: "ready",
      matched: "ready",
      expiring: "expiring",
      choose: "attention",
      missing: "attention",
      incomplete: "attention",
      expired: "attention",
      "not-allowed": "attention",
      "no-access": "attention",
    });
  });
});
