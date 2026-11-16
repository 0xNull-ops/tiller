// fork(launch)
// @effect-diagnostics nodeBuiltinImport:off - Release metadata is checked with Node crypto.
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import {
  cliVersionMatches,
  renderCask,
  releaseOptions,
  requireNotaryEnvironment,
  requireRust,
  updateManifest,
} from "./fork-release.ts";
import { releaseNotes } from "./fork-release-notes.ts";

describe("Tiller release", () => {
  it("requires a stable explicit version and confines branch builds to no-publish", () => {
    expect(
      releaseOptions(["--version", "1.2.3", "--no-publish", "--allow-branch"]).allowBranch,
    ).toBe(true);
    expect(releaseOptions(["--version=1.2.3", "--resume"]).resume).toBe(true);
    expect(renderCask("{{VERSION}} {{SHA256}}", "1.2.3", "abc")).toBe("1.2.3 abc");
    expect(() => releaseOptions([])).toThrow("Usage");
    expect(() => releaseOptions(["--version", "1.0.0-beta"])).toThrow("stable semver");
    expect(() => releaseOptions(["--version", "1.0.0", "--allow-branch"])).toThrow(
      "requires --no-publish",
    );
    const cask = renderCask(
      NodeFS.readFileSync(new URL("./homebrew/tiller.rb.template", import.meta.url), "utf8"),
      "1.2.3",
      "abc",
    );
    expect(cask).toContain('version "1.2.3"');
    expect(cask).toContain('sha256 "abc"');
    expect(cask).toContain("Tiller-#{version}-arm64.dmg");
    expect(cask).not.toContain("{{");
    expect(() => requireNotaryEnvironment({})).toThrow("Missing APPLE_API_KEY");
  });
  it("recognizes the packaged CLI version banner and rejects a different version", () => {
    expect(cliVersionMatches("tiller v1.0.0", "1.0.0")).toBe(true);
    expect(cliVersionMatches("1.0.0", "1.0.0")).toBe(true);
    expect(cliVersionMatches("tiller v1.0.1", "1.0.0")).toBe(false);
    expect(cliVersionMatches("tiller v1.0.0-beta", "1.0.0")).toBe(false);
  });
  it("rejects a Rust too old for the resource monitor", () => {
    expect(() => requireRust("rustc 1.90.0 (abc 2025-09-14)")).toThrow("Rust 1.95");
    expect(() => requireRust("not rust")).toThrow("Rust 1.95");
    expect(() => requireRust("rustc 1.95.0 (abc 2026-04-14)")).not.toThrow();
    expect(() => requireRust("rustc 2.0.0 (abc 2027-01-01)")).not.toThrow();
  });
  it("excludes sync PRs and strips private references", () => {
    expect(
      releaseNotes([
        { title: "sync: upstream update (#88)" },
        { title: "Fix startup (#63) https://github.com/private/repo/pull/63" },
        { title: "Handle #12" },
        { title: "fix(sync): never review a model's own repair" },
        { title: "feat(launch): make packaged Tiller independent of T3" },
        { title: "ci: pin the runner" },
        { title: "feat(workflows): add a gallery" },
        { title: "fix(web): move fork RPCs out of upstream files" },
        { title: "feat(web): show distance from the latest T3 Code nightly" },
      ]),
    ).toBe("- Fix startup\n- Handle\n- Add a gallery\n");
  });
  it("hashes the final ZIP bytes for electron-updater", () => {
    const bytes = new TextEncoder().encode("stapled archive");
    const manifest = updateManifest("1.0.0", "Tiller-1.0.0-arm64.zip", bytes);
    expect(manifest).toContain(
      `sha512: ${NodeCrypto.createHash("sha512").update(bytes).digest("base64")}`,
    );
    expect(manifest).toContain("size: 15");
    expect(manifest).toContain("url: Tiller-1.0.0-arm64.zip");
  });
});
