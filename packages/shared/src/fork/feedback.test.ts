import { describe, expect, it } from "vite-plus/test";

import {
  buildFeedbackIssueUrl,
  describeFeedbackOs,
  FEEDBACK_NEW_ISSUE_URL,
  FEEDBACK_PREFILLED_FIELDS,
  FEEDBACK_REPOSITORY_URL,
  feedbackArch,
  feedbackOsName,
  safeFeedbackFact,
} from "./feedback.ts";

const facts = { appVersion: "0.1.6", os: "macOS 15.3.0", arch: "arm64" };

describe("buildFeedbackIssueUrl", () => {
  it("opens a new issue on the public Tiller repository", () => {
    const url = buildFeedbackIssueUrl({ kind: "bug", facts });
    expect(FEEDBACK_NEW_ISSUE_URL).toBe(`${FEEDBACK_REPOSITORY_URL}/issues/new`);
    expect(FEEDBACK_REPOSITORY_URL).toBe("https://github.com/Antler-Web-Studios/tiller");
    expect(url.startsWith(`${FEEDBACK_NEW_ISSUE_URL}?`)).toBe(true);
  });

  it("offers the bug and feature forms with their own template", () => {
    expect(
      new URL(buildFeedbackIssueUrl({ kind: "bug", facts })).searchParams.get("template"),
    ).toBe("bug.yml");
    expect(
      new URL(buildFeedbackIssueUrl({ kind: "feature", facts })).searchParams.get("template"),
    ).toBe("feature.yml");
  });

  it("prefills the app version, the OS version and the architecture", () => {
    const params = new URL(
      buildFeedbackIssueUrl({ kind: "bug", facts: { ...facts, arch: "arm64" } }),
    ).searchParams;
    expect(params.get("version")).toBe("0.1.6");
    expect(params.get("os")).toBe("macOS 15.3.0");
    expect(params.get("arch")).toBe("arm64");
    expect([...params.keys()].toSorted()).toEqual(["arch", "os", "template", "version"]);
    expect([...FEEDBACK_PREFILLED_FIELDS]).toEqual(["version", "os", "arch"]);
  });

  it("drops a fact that looks like a path, a home directory or an address", () => {
    const params = new URL(
      buildFeedbackIssueUrl({
        kind: "bug",
        facts: {
          appVersion: "/Users/ada/checkouts/tiller",
          os: "macOS 15.3.0",
          arch: "C:\\Users\\ada\\tiller",
        },
      }),
    ).searchParams;
    expect(params.get("version")).toBe("unknown");
    expect(params.get("arch")).toBe("unknown");
    const href = params.toString();
    expect(href).not.toContain("ada");
    expect(href).not.toContain("Users");
  });

  it("leaves the architecture out when the caller has none", () => {
    const params = new URL(
      buildFeedbackIssueUrl({ kind: "bug", facts: { appVersion: "0.1.6", os: "macOS" } }),
    ).searchParams;
    expect(params.has("arch")).toBe(false);
    expect(params.get("version")).toBe("0.1.6");
  });
});

describe("safeFeedbackFact", () => {
  it("keeps single-line values and collapses the rest to its fallback", () => {
    expect(safeFeedbackFact("  0.1.6  ")).toBe("0.1.6");
    expect(safeFeedbackFact("macOS 15.3.0")).toBe("macOS 15.3.0");
    expect(safeFeedbackFact("")).toBe("unknown");
    expect(safeFeedbackFact(undefined)).toBe("unknown");
    expect(safeFeedbackFact("x".repeat(61))).toBe("unknown");
    expect(safeFeedbackFact("/home/ada/project")).toBe("unknown");
    expect(safeFeedbackFact("ada@example.com")).toBe("unknown");
    expect(safeFeedbackFact("https://example.com/a")).toBe("unknown");
  });
});

describe("feedback platform facts", () => {
  it("names the OS from an Electron or browser platform", () => {
    expect(feedbackOsName("darwin")).toBe("macOS");
    expect(feedbackOsName("macOS")).toBe("macOS");
    expect(feedbackOsName("win32")).toBe("Windows");
    expect(feedbackOsName("linux")).toBe("Linux");
    expect(feedbackOsName("MacIntel")).toBe("macOS");
    expect(feedbackOsName("Win32")).toBe("Windows");
    expect(feedbackOsName(undefined)).toBe("unknown OS");
  });

  it("puts the OS version beside the name only when there is one", () => {
    expect(describeFeedbackOs("darwin", "15.3.0")).toBe("macOS 15.3.0");
    expect(describeFeedbackOs("darwin", undefined)).toBe("macOS");
    expect(describeFeedbackOs("darwin", "/Users/ada")).toBe("macOS");
  });

  it("normalizes the two ways a platform reports its architecture", () => {
    expect(feedbackArch("arm64")).toBe("arm64");
    expect(feedbackArch("arm")).toBe("arm64");
    expect(feedbackArch("x64")).toBe("x64");
    expect(feedbackArch("x86")).toBe("x64");
    expect(feedbackArch("mips")).toBe("unknown");
  });
});
