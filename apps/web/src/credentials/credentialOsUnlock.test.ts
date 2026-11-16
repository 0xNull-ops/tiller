import type { CredentialsStatus } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  credentialOsUnlockMethodLabel,
  enableOsUnlock,
  refreshStoredPinAfterChange,
  unlockWithStoredPin,
  type CredentialOsUnlockClient,
} from "./credentialOsUnlock";
import type { CredentialActionResult } from "./credentialWriteGate";

const STATUS: CredentialsStatus = { pinSet: true, keyStorage: "os-keychain" };
const TOUCH_ID = { available: true, enabled: true, method: "touch-id" } as const;

const client = (overrides: Partial<CredentialOsUnlockClient> = {}): CredentialOsUnlockClient => ({
  status: vi.fn(async () => TOUCH_ID),
  enable: vi.fn(async () => TOUCH_ID),
  disable: vi.fn(async () => ({ ...TOUCH_ID, enabled: false })),
  requestPin: vi.fn(async () => "1234"),
  ...overrides,
});

const ok = <A>(value: A): CredentialActionResult<A> => ({ ok: true, value });

describe("credentialOsUnlockMethodLabel", () => {
  it("names each prompt the way its platform does", () => {
    expect(credentialOsUnlockMethodLabel("touch-id")).toBe("Touch ID");
    expect(credentialOsUnlockMethodLabel("windows-hello")).toBe("Windows Hello");
    expect(credentialOsUnlockMethodLabel("polkit")).toBe("System password");
  });
});

describe("unlockWithStoredPin", () => {
  it("does nothing when the OS prompt is cancelled", async () => {
    const unlock = vi.fn(async () => ok(STATUS));
    const outcome = await unlockWithStoredPin({
      shell: client({ requestPin: async () => null }),
      unlock,
    });
    expect(outcome).toEqual({ kind: "no-pin" });
    expect(unlock).not.toHaveBeenCalled();
  });

  it("forwards the released PIN to the server", async () => {
    const unlock = vi.fn(async () => ok(STATUS));
    const outcome = await unlockWithStoredPin({ shell: client(), unlock });
    expect(outcome).toEqual({ kind: "unlocked" });
    expect(unlock).toHaveBeenCalledWith("1234");
  });

  it("deletes a PIN the server rejects so the next attempt asks for one", async () => {
    const disable = vi.fn(async () => TOUCH_ID);
    const outcome = await unlockWithStoredPin({
      shell: client({ disable }),
      unlock: async () => ({ ok: false, failure: { kind: "pin-incorrect" } }),
    });
    expect(outcome).toEqual({ kind: "pin-rejected" });
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it("does not retry after a lockout and keeps the stored PIN", async () => {
    const disable = vi.fn(async () => TOUCH_ID);
    const unlock = vi.fn(async (): Promise<CredentialActionResult<CredentialsStatus>> => ({
      ok: false,
      failure: { kind: "locked-out", retryAfterSeconds: 30 },
    }));
    const outcome = await unlockWithStoredPin({ shell: client({ disable }), unlock });
    expect(outcome.kind).toBe("locked-out");
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(disable).not.toHaveBeenCalled();
  });
});

describe("enableOsUnlock", () => {
  it("never stores a PIN the server refuses", async () => {
    const enable = vi.fn(async () => TOUCH_ID);
    const outcome = await enableOsUnlock({
      pin: "1234",
      shell: client({ enable }),
      verify: async () => ({ ok: false, failure: { kind: "pin-incorrect" } }),
    });
    expect(outcome).toEqual({ ok: false, message: "That PIN is not correct." });
    expect(enable).not.toHaveBeenCalled();
  });

  it("stores the PIN only after the server accepts it", async () => {
    const enable = vi.fn(async () => ({ ...TOUCH_ID, enabled: true }));
    const outcome = await enableOsUnlock({
      pin: "1234",
      shell: client({ enable }),
      verify: async () => ok(STATUS),
    });
    expect(outcome).toEqual({ ok: true, status: { ...TOUCH_ID, enabled: true } });
    expect(enable).toHaveBeenCalledWith("1234");
  });
});

describe("refreshStoredPinAfterChange", () => {
  it("leaves a disabled setting alone", async () => {
    const enable = vi.fn(async () => TOUCH_ID);
    expect(
      await refreshStoredPinAfterChange({
        enabled: false,
        pin: "5678",
        shell: client({ enable }),
      }),
    ).toBe("not-enabled");
    expect(enable).not.toHaveBeenCalled();
  });

  it("rewrites the stored PIN after a change", async () => {
    const enable = vi.fn(async () => TOUCH_ID);
    expect(
      await refreshStoredPinAfterChange({ enabled: true, pin: "5678", shell: client({ enable }) }),
    ).toBe("updated");
    expect(enable).toHaveBeenCalledWith("5678");
  });

  it("drops the stored PIN when the keychain refuses the new one", async () => {
    const disable = vi.fn(async () => ({ ...TOUCH_ID, enabled: false }));
    const outcome = await refreshStoredPinAfterChange({
      enabled: true,
      pin: "5678",
      shell: client({
        enable: async () => {
          throw new Error("keychain unavailable");
        },
        disable,
      }),
    });
    expect(outcome).toBe("cleared");
    expect(disable).toHaveBeenCalledTimes(1);
  });
});
