import { expect, it } from "@effect/vitest";
import { skillsShAuditDetails, skillsShAuditLabel } from "./skillsSh.ts";

it("explains provider warnings while preserving pass and missing-audit states", () => {
  const audit = {
    results: [
      {
        provider: "scanner",
        status: "warn",
        summary: "Downloads and runs a remote script",
        riskLevel: "high",
      },
      { provider: "reviewer", status: "pass", summary: "No issues found" },
    ],
  };
  expect(skillsShAuditLabel(audit)).toBe("Warnings");
  expect(skillsShAuditDetails(audit)).toEqual([
    "scanner: warn: high: Downloads and runs a remote script",
    "reviewer: pass: No issues found",
  ]);
  expect(skillsShAuditLabel([{ status: "pass" }])).toBe("Audited");
  expect(skillsShAuditLabel(null)).toBe("No audit");
  expect(skillsShAuditDetails(null)[0]).toContain("No audit details");
});
