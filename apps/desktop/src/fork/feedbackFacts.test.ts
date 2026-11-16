import { expect, it } from "vite-plus/test";

import { desktopFeedbackFacts, readSystemVersion } from "./feedbackFacts.ts";

it("reports the desktop app's version, macOS version and architecture", () => {
  expect(
    desktopFeedbackFacts({
      appVersion: "0.1.6",
      platform: "darwin",
      arch: "arm64",
      systemVersion: "15.3.0",
    }),
  ).toEqual({ appVersion: "0.1.6", os: "macOS 15.3.0", arch: "arm64" });
});

it("still reports an OS name when the system version cannot be read", () => {
  const facts = desktopFeedbackFacts({
    appVersion: "0.1.6",
    platform: "darwin",
    arch: "x64",
    systemVersion: readSystemVersion(() => {
      throw new Error("not available");
    }),
  });
  expect(facts.os).toBe("macOS");
  expect(facts.arch).toBe("x64");
});

it("asks Electron for a version that the renderer cannot see", () => {
  expect(readSystemVersion(() => "15.3.0")).toBe("15.3.0");
});
