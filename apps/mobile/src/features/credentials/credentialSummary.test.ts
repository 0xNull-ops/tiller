import type { CredentialPolicy, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { credentialFileSize, credentialProjectScopeLabel } from "./credentialSummary";

const policy = (projects: CredentialPolicy["projects"]): CredentialPolicy => ({
  projects,
  alwaysAsk: true,
  revealAllowed: false,
});

const titles = new Map<ProjectId, string>([
  ["alpha" as ProjectId, "Alpha app"],
  ["beta" as ProjectId, "Beta app"],
]);

describe("credentialProjectScopeLabel", () => {
  it("says when every project can use the credential", () => {
    expect(credentialProjectScopeLabel(policy("all"), titles)).toBe("All projects");
    expect(credentialProjectScopeLabel(policy([]), titles)).toBe("No projects");
  });

  it("names the projects it was given", () => {
    expect(credentialProjectScopeLabel(policy(["alpha" as ProjectId]), titles)).toBe("Alpha app");
    expect(
      credentialProjectScopeLabel(policy(["alpha" as ProjectId, "beta" as ProjectId]), titles),
    ).toBe("Alpha app, Beta app");
  });

  it("counts projects this device cannot name instead of hiding them", () => {
    expect(
      credentialProjectScopeLabel(policy(["alpha" as ProjectId, "gone" as ProjectId]), titles),
    ).toBe("Alpha app + 1 unavailable");
    expect(credentialProjectScopeLabel(policy(["gone" as ProjectId]), titles)).toBe(
      "1 unavailable project",
    );
  });
});

describe("credentialFileSize", () => {
  it("picks a readable unit", () => {
    expect(credentialFileSize(512)).toBe("512 B");
    expect(credentialFileSize(4096)).toBe("4.0 KB");
    expect(credentialFileSize(64 * 1024)).toBe("64 KB");
    expect(credentialFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
