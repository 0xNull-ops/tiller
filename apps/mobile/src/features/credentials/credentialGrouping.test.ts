import type { Credential, CredentialField, CredentialId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { credentialTypeName, groupCredentialsByType } from "./credentialGrouping";

const field = (id: string): CredentialField => ({
  id,
  label: id,
  kind: "secret",
  envVar: id.toUpperCase(),
  required: true,
  highRisk: false,
});

const credential = (
  id: string,
  name: string,
  templateId: string,
  status: Credential["status"] = "ready",
): Credential => ({
  id: id as CredentialId,
  name,
  templateId,
  fields: [field("token")],
  policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  useCount: 0,
  status,
});

describe("credentialTypeName", () => {
  it("uses the template's name and falls back to the stored id", () => {
    expect(credentialTypeName(credential("a", "Work", "github"))).toBe("GitHub token");
    expect(credentialTypeName(credential("b", "Legacy", "retired-type"))).toBe("retired-type");
  });
});

describe("groupCredentialsByType", () => {
  it("groups by type, orders types by name, and keeps the server's row order", () => {
    const groups = groupCredentialsByType([
      credential("1", "Second GitHub", "github"),
      credential("2", "Vercel prod", "vercel"),
      credential("3", "First GitHub", "github"),
      credential("4", "Legacy", "retired-type"),
    ]);

    expect(groups.map((group) => group.typeName)).toEqual([
      "GitHub token",
      "retired-type",
      "Vercel",
    ]);
    expect(groups[0]?.credentials.map((entry) => entry.name)).toEqual([
      "Second GitHub",
      "First GitHub",
    ]);
  });

  it("keeps a credential whose status is not ready in its group", () => {
    const groups = groupCredentialsByType([
      credential("1", "Rotated", "github", "missing-field"),
      credential("2", "Fresh", "github"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.credentials.map((entry) => entry.status)).toEqual(["missing-field", "ready"]);
  });

  it("returns nothing for no credentials", () => {
    expect(groupCredentialsByType([])).toEqual([]);
  });
});
