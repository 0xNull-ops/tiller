// @effect-diagnostics nodeBuiltinImport:off - Artifact guards inspect temporary release fixtures.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import {
  checkReleaseTree,
  requireReleaseCheckout,
  releaseTestArgs,
  releaseSmokeArgs,
} from "./fork-release-checks.ts";

it("resumes the saved commit even after main moves, but rejects edits and another commit", () => {
  expect(() => requireReleaseCheckout(true, "saved", "new-main", false, "saved")).not.toThrow();
  expect(() => requireReleaseCheckout(false, "saved", "new-main", false, "saved")).toThrow();
  expect(() => requireReleaseCheckout(true, "other", "new-main", false, "saved")).toThrow();
  expect(() => requireReleaseCheckout(true, "branch", "main", false)).toThrow();
});
it("gates releases with focused tests and a smoke command against the built executable", () => {
  expect(releaseTestArgs).toContain("apps/server/src/workflows");
  expect(releaseSmokeArgs("/build/Tiller", "/output")).toEqual([
    "scripts/smoke-desktop-app.ts",
    "--executable",
    "/build/Tiller",
    "--artifacts-dir",
    "/output/smoke",
  ]);
});

it("rejects missing notices, owner paths and embedded disabled configuration", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tiller-artifact-check-"));
  try {
    expect(() => checkReleaseTree(root, "upstream notice", "/home/owner", ["pk_private"])).toThrow(
      "MIT notice missing",
    );
    NodeFS.writeFileSync(NodePath.join(root, "LICENSE-T3-CODE"), "upstream notice");
    expect(() =>
      checkReleaseTree(root, "upstream notice", "/home/owner", ["pk_private"]),
    ).not.toThrow();
    NodeFS.writeFileSync(NodePath.join(root, "binary"), "prefix/home/owner/.cargo/registry");
    expect(() => checkReleaseTree(root, "upstream notice", "/home/owner", ["pk_private"])).toThrow(
      "Owner home path",
    );
    NodeFS.writeFileSync(NodePath.join(root, "binary"), "pk_private");
    expect(() => checkReleaseTree(root, "upstream notice", "/home/owner", ["pk_private"])).toThrow(
      "Disabled public configuration",
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
