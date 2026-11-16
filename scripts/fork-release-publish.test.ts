// @effect-diagnostics nodeBuiltinImport:off - Isolated release fixtures.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  downloadReleaseAssets,
  waitForNpmVersion,
  compareVersions,
  notesSince,
  publishChannels,
  resumeState,
  type Command,
  type ReleaseState,
} from "./fork-release-publish.ts";

describe("release publication", () => {
  it("waits for a new npm version to become visible", () => {
    const answers = ["404", "0.9.0", "0.9.1"];
    const waits: number[] = [];
    waitForNpmVersion(
      () => {
        const answer = answers.shift()!;
        if (answer === "404") throw new Error("E404");
        return answer;
      },
      "0.9.1",
      (ms) => waits.push(ms),
    );
    expect(waits).toHaveLength(2);
    expect(() =>
      waitForNpmVersion(
        () => "0.9.0",
        "0.9.1",
        () => undefined,
      ),
    ).toThrow("npm version verification failed");
  });
  it("retries a release asset download that GitHub briefly reports missing", () => {
    let calls = 0;
    const waits: number[] = [];
    downloadReleaseAssets(
      () => {
        if (++calls < 3) throw new Error("HTTP 404: Not Found");
        return "";
      },
      "v1.0.3",
      "Antler-Web-Studios/tiller",
      "/tmp/x",
      (ms) => waits.push(ms),
    );
    expect(waits).toEqual([5_000, 10_000]);
    expect(() =>
      downloadReleaseAssets(
        () => {
          throw new Error("HTTP 404: Not Found");
        },
        "v1.0.3",
        "Antler-Web-Studios/tiller",
        "/tmp/x",
        () => undefined,
      ),
    ).toThrow("HTTP 404");
  });
  it("compares numeric stable versions and defaults to the previous publication date", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.9.0", "2.0.0")).toBe(-1);
    expect(() => compareVersions("01.0.0", "1.0.0")).toThrow();
    expect(notesSince(undefined, { published_at: "2026-10-01T12:34:56Z" })).toBe(
      "2026-10-01T12:34:56Z",
    );
    expect(notesSince("2026-09-01", undefined)).toBe("2026-09-01");
    expect(notesSince(undefined, undefined)).toBe("1970-01-01T00:00:00Z");
  });
  it("keeps a release in draft when downloaded assets differ", () => {
    const output = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "release-draft-test-"));
    try {
      NodeFS.writeFileSync(NodePath.join(output, "asset"), "expected");
      const state: ReleaseState = {
        version: "1.2.3",
        commit: "abc",
        verified: true,
        github: false,
        npm: false,
        homebrew: false,
        tagged: false,
      };
      const calls: string[] = [];
      const run: Command = (command, args) => {
        calls.push([command, ...args].join(" "));
        if (args[0] === "api") return JSON.stringify([{ tag_name: "v1.2.3", draft: true }]);
        if (args[1] === "download")
          NodeFS.writeFileSync(
            NodePath.join(args[args.indexOf("--dir") + 1]!, "asset"),
            "truncated",
          );
        return "";
      };
      expect(() => publishChannels(run, state, output, ["asset"], () => {})).toThrow(
        "Remote asset differs",
      );
      expect(calls.some((c) => c.includes("--draft=false"))).toBe(false);
      expect(calls.some((c) => c.startsWith("npm"))).toBe(false);
      expect(state.github).toBe(false);
    } finally {
      NodeFS.rmSync(output, { recursive: true, force: true });
    }
  });
  it("resumes after npm failure without republishing GitHub and verifies draft assets before exposing the feed", () => {
    const output = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "release-test-"));
    try {
      NodeFS.writeFileSync(NodePath.join(output, "asset"), "verified");
      NodeFS.writeFileSync(NodePath.join(output, "tiller.rb"), "cask");
      const state: ReleaseState = {
        version: "1.2.3",
        commit: "abc",
        verified: true,
        github: false,
        npm: false,
        homebrew: false,
        tagged: false,
      };
      const calls: string[] = [];
      let fail = true;
      const run: Command = (command, args) => {
        const call = [command, ...args].join(" ");
        calls.push(call);
        if (args[0] === "api") return "[]";
        if (args[1] === "download")
          NodeFS.copyFileSync(
            NodePath.join(output, "asset"),
            NodePath.join(args[args.indexOf("--dir") + 1]!, "asset"),
          );
        if (command === "npm" && args[0] === "view") {
          if (args.includes("versions"))
            throw Object.assign(new Error("Not found"), {
              stdout: JSON.stringify({ error: { code: "E404" } }),
            });
          return state.version;
        }
        if (command === "npm" && args[0] === "publish" && fail) throw new Error("npm unavailable");
        if (command === "git" && args[0] === "status") return " M Casks/tiller.rb";
        return "";
      };
      let saved = "";
      expect(() =>
        publishChannels(run, state, output, ["asset"], () => {
          saved = JSON.stringify(state);
        }),
      ).toThrow("npm unavailable");
      expect(calls.findIndex((c) => c.includes("--draft --title"))).toBeLessThan(
        calls.findIndex((c) => c.startsWith("gh release upload")),
      );
      expect(calls.findIndex((c) => c.startsWith("gh release download"))).toBeLessThan(
        calls.findIndex((c) => c.includes("--draft=false")),
      );
      expect(state.github).toBe(true);
      const restored = resumeState(JSON.parse(saved), "1.2.3", "abc");
      expect(() => resumeState(restored, "1.2.4", "abc")).toThrow("Resume");
      expect(() => resumeState({ ...restored, verified: false }, "1.2.3", "abc")).toThrow("Resume");
      calls.length = 0;
      fail = false;
      publishChannels(run, restored, output, ["asset"], () => {});
      expect(calls.some((c) => c.startsWith("gh release"))).toBe(false);
      expect(calls.find((c) => c.includes("commit -m"))).toBe(
        "git -c core.hooksPath=/dev/null commit -m Release Tiller 1.2.3",
      );
      expect(calls).toContain("git push origin HEAD:main");
      expect(restored).toMatchObject({ npm: true, homebrew: true, tagged: true });
      expect(calls.findIndex((c) => c.startsWith("npm publish"))).toBeLessThan(
        calls.findIndex((c) => c.startsWith("gh repo clone")),
      );
      calls.length = 0;
      publishChannels(run, restored, output, ["asset"], () => {});
      expect(calls).toEqual([]);
    } finally {
      NodeFS.rmSync(output, { recursive: true, force: true });
    }
  });
});
