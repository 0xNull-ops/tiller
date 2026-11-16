import { describe, expect, it, vi } from "vite-plus/test";

import {
  makeCredentialOsPresence,
  makePolkitPresence,
  makeTouchIdPresence,
  makeWindowsHelloPresence,
  POLKIT_ACTION_ID,
  polkitCheckArgs,
  WINDOWS_HELLO_AVAILABLE,
  WINDOWS_HELLO_VERIFIED,
  windowsHelloAvailabilityScript,
  type ProcessResult,
} from "./CredentialOsPresence.ts";

const result = (stdout: string, exitCode = 0): ProcessResult => ({ stdout, exitCode });

describe("Touch ID", () => {
  it("is offered only when the sensor can prompt", async () => {
    expect(
      await makeTouchIdPresence({
        canPromptTouchID: () => true,
        promptTouchID: async () => undefined,
      }).isAvailable(),
    ).toBe(true);
    expect(
      await makeTouchIdPresence({
        canPromptTouchID: () => false,
        promptTouchID: async () => undefined,
      }).isAvailable(),
    ).toBe(false);
    expect(
      await makeTouchIdPresence({
        canPromptTouchID: () => {
          throw new Error("no sensor");
        },
        promptTouchID: async () => undefined,
      }).isAvailable(),
    ).toBe(false);
  });

  it("counts only a resolved prompt as user presence", async () => {
    const prompt = vi.fn(async () => undefined);
    const presence = makeTouchIdPresence({
      canPromptTouchID: () => true,
      promptTouchID: prompt,
    });
    expect(await presence.prompt("Unlock")).toBe(true);
    expect(prompt).toHaveBeenCalledWith("Unlock");

    const cancelled = makeTouchIdPresence({
      canPromptTouchID: () => true,
      promptTouchID: async () => {
        throw new Error("cancelled");
      },
    });
    expect(await cancelled.prompt("Unlock")).toBe(false);
  });
});

describe("Windows Hello", () => {
  it("reads the availability enum from the last output line", async () => {
    const run = vi.fn(async () => result(`warning\n${WINDOWS_HELLO_AVAILABLE}\n`));
    expect(await makeWindowsHelloPresence(run).isAvailable()).toBe(true);
    expect(run).toHaveBeenCalledWith(windowsHelloAvailabilityScript());

    expect(
      await makeWindowsHelloPresence(async () => result("DeviceNotPresent")).isAvailable(),
    ).toBe(false);
    expect(await makeWindowsHelloPresence(async () => result("", 1)).isAvailable()).toBe(false);
    expect(
      await makeWindowsHelloPresence(async () => {
        throw new Error("no powershell");
      }).isAvailable(),
    ).toBe(false);
  });

  it("requires the Verified result, not just a finished script", async () => {
    expect(
      await makeWindowsHelloPresence(async () => result(WINDOWS_HELLO_VERIFIED)).prompt("Unlock"),
    ).toBe(true);
    expect(await makeWindowsHelloPresence(async () => result("Canceled")).prompt("Unlock")).toBe(
      false,
    );
    expect(await makeWindowsHelloPresence(async () => result("", 0)).prompt("Unlock")).toBe(false);
  });

  it("quotes the reason into the script and sends no secret", async () => {
    const run = vi.fn(async (_script: string) => result(WINDOWS_HELLO_VERIFIED));
    const presence = makeWindowsHelloPresence(run);
    await presence.prompt("Unlock it's mine");

    const script = run.mock.calls[0]![0];
    expect(script).toContain("Unlock it''s mine");
    expect(script).toContain("RequestVerificationAsync");
    expect(script).not.toContain("1234");
  });
});

describe("polkit", () => {
  it("checks the action id and process id, never a secret", () => {
    expect(polkitCheckArgs({ pid: 4242, interactive: false })).toEqual([
      "--action-id",
      POLKIT_ACTION_ID,
      "--process",
      "4242",
    ]);
    expect(polkitCheckArgs({ pid: 4242, interactive: true })).toEqual([
      "--action-id",
      POLKIT_ACTION_ID,
      "--process",
      "4242",
      "--allow-user-interaction",
    ]);
  });

  it("is not offered without a session bus", async () => {
    const run = vi.fn(async () => result(""));
    const presence = makePolkitPresence({ runPkcheck: run, hasSessionBus: false, pid: 1 });
    expect(await presence.isAvailable()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a registered action that needs authentication as available", async () => {
    const run = vi.fn(async () => result("", 2));
    const presence = makePolkitPresence({ runPkcheck: run, hasSessionBus: true, pid: 1 });
    expect(await presence.isAvailable()).toBe(true);
    expect(await presence.isAvailable()).toBe(true);

    expect(
      await makePolkitPresence({
        runPkcheck: async () => result("", 127),
        hasSessionBus: true,
        pid: 1,
      }).isAvailable(),
    ).toBe(false);
    expect(
      await makePolkitPresence({
        runPkcheck: async () => result("", 1),
        hasSessionBus: true,
        pid: 1,
      }).isAvailable(),
    ).toBe(false);
  });

  it("authorizes only exit code 0 from the interactive check", async () => {
    const calls: string[][] = [];
    const presence = makePolkitPresence({
      runPkcheck: async (args) => {
        calls.push([...args]);
        return result("", args.includes("--allow-user-interaction") ? 0 : 2);
      },
      hasSessionBus: true,
      pid: 99,
    });
    expect(await presence.prompt("Unlock")).toBe(true);
    expect(calls.at(-1)).toContain("--allow-user-interaction");
    expect(calls.at(-1)).not.toContain("1234");

    expect(
      await makePolkitPresence({
        runPkcheck: async () => result("", 1),
        hasSessionBus: true,
        pid: 99,
      }).prompt("Unlock"),
    ).toBe(false);
  });
});

describe("makeCredentialOsPresence", () => {
  const systemPreferences = {
    canPromptTouchID: () => true,
    promptTouchID: async () => undefined,
  };

  it("picks the adapter for the platform", () => {
    expect(makeCredentialOsPresence({ platform: "darwin", systemPreferences })?.method).toBe(
      "touch-id",
    );
    expect(
      makeCredentialOsPresence({
        platform: "win32",
        runPowerShell: async () => result(""),
      })?.method,
    ).toBe("windows-hello");
    expect(
      makeCredentialOsPresence({
        platform: "linux",
        runPkcheck: async () => result(""),
        hasSessionBus: true,
        pid: 1,
      })?.method,
    ).toBe("polkit");
  });

  it("returns null where no prompt exists", () => {
    expect(makeCredentialOsPresence({ platform: "freebsd" })).toBeNull();
    expect(makeCredentialOsPresence({ platform: "darwin" })).toBeNull();
    expect(makeCredentialOsPresence({ platform: "win32" })).toBeNull();
    expect(
      makeCredentialOsPresence({ platform: "linux", runPkcheck: async () => result("") }),
    ).toBeNull();
  });
});
