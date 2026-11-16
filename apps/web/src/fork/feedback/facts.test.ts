import { describe, expect, it } from "vite-plus/test";

import { feedbackFactsFrom } from "./facts";

describe("feedbackFactsFrom", () => {
  it("reports the app version, the macOS version and the architecture", () => {
    expect(
      feedbackFactsFrom({
        appVersion: "0.1.6",
        desktopPlatform: "darwin",
        browserPlatform: "macOS",
        entropy: { platformVersion: "15.3.0", architecture: "arm" },
      }),
    ).toEqual({ appVersion: "0.1.6", os: "macOS 15.3.0", arch: "arm64" });
  });

  it("names the OS but no version when the browser withholds high-entropy hints", () => {
    const facts = feedbackFactsFrom({
      appVersion: "0.1.6",
      desktopPlatform: undefined,
      browserPlatform: "Windows",
      entropy: {},
    });
    expect(facts.os).toBe("Windows");
    expect(facts.arch).toBe("unknown");
  });

  it("maps a Linux architecture from Chromium's own vocabulary", () => {
    expect(
      feedbackFactsFrom({
        appVersion: "0.1.6",
        desktopPlatform: "linux",
        browserPlatform: "Linux",
        entropy: { platformVersion: "6.8.0", architecture: "x86" },
      }),
    ).toEqual({ appVersion: "0.1.6", os: "Linux 6.8.0", arch: "x64" });
  });
});
