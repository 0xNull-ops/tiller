import type {
  DesktopCredentialOsUnlockMethod,
  DesktopCredentialOsUnlockResult,
  DesktopCredentialOsUnlockStatus,
  EnvironmentId,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { credentialFailureMessage, type CredentialActionResult } from "./credentialWriteGate";

/** The desktop shell's own names for the OS prompt it can show. */
export const credentialOsUnlockMethodLabel = (method: DesktopCredentialOsUnlockMethod): string => {
  switch (method) {
    case "touch-id":
      return "Touch ID";
    case "windows-hello":
      return "Windows Hello";
    case "polkit":
      return "System password";
  }
};

type Bridge = (request: {
  readonly action: "status" | "enable" | "disable" | "unlock";
  readonly environmentId: EnvironmentId;
  readonly pin?: string;
}) => Promise<DesktopCredentialOsUnlockResult>;

const bridge = (): Bridge | null =>
  typeof window === "undefined" ? null : (window.desktopBridge?.credentialOsUnlock ?? null);

/** Web browsers and mobile have no bridge, so the whole feature is absent there. */
const hasCredentialOsUnlockBridge = (): boolean => bridge() !== null;

const call = async (
  request: Parameters<Bridge>[0],
): Promise<DesktopCredentialOsUnlockResult | null> => {
  const invoke = bridge();
  if (invoke === null) return null;
  try {
    return await invoke(request);
  } catch {
    return null;
  }
};

/** One environment's view of the shell, so the manager never handles an id. */
export interface CredentialOsUnlockClient {
  readonly status: () => Promise<DesktopCredentialOsUnlockStatus | null>;
  readonly enable: (pin: string) => Promise<DesktopCredentialOsUnlockStatus | null>;
  readonly disable: () => Promise<DesktopCredentialOsUnlockStatus | null>;
  /** Resolves the stored PIN only after the OS confirmed the user; null when cancelled. */
  readonly requestPin: () => Promise<string | null>;
}

export const bindCredentialOsUnlock = (environmentId: EnvironmentId): CredentialOsUnlockClient => ({
  status: async () => (await call({ action: "status", environmentId }))?.status ?? null,
  enable: async (pin) => (await call({ action: "enable", environmentId, pin }))?.status ?? null,
  disable: async () => (await call({ action: "disable", environmentId }))?.status ?? null,
  requestPin: async () => (await call({ action: "unlock", environmentId }))?.pin ?? null,
});

export interface CredentialOsUnlockView {
  readonly supported: boolean;
  readonly status: DesktopCredentialOsUnlockStatus | null;
  readonly setStatus: (status: DesktopCredentialOsUnlockStatus | null) => void;
}

/** Status lives in the manager's state; the container loads it once per environment. */
export function useCredentialOsUnlockStatus(environmentId: EnvironmentId): CredentialOsUnlockView {
  const supported = hasCredentialOsUnlockBridge();
  const [status, setStatus] = useState<DesktopCredentialOsUnlockStatus | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- Request the native OS unlock bridge after the credential prompt mounts.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void bindCredentialOsUnlock(environmentId)
      .status()
      .then(
        (next) => {
          if (!cancelled) setStatus(next);
        },
        () => {
          if (!cancelled) setStatus(null);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [environmentId, supported]);
  return { supported, status: supported ? status : null, setStatus };
}

export type StoredPinUnlockOutcome =
  | { readonly kind: "no-pin" }
  | { readonly kind: "unlocked" }
  | { readonly kind: "pin-rejected" }
  | { readonly kind: "locked-out"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * The OS prompt releases the PIN, then the server decides. A rejected PIN is deleted so the next
 * attempt asks for the PIN instead; a lockout is never retried, because the server already said no.
 */
export const unlockWithStoredPin = async (input: {
  readonly shell: CredentialOsUnlockClient;
  readonly unlock: (pin: string) => Promise<CredentialActionResult<unknown>>;
}): Promise<StoredPinUnlockOutcome> => {
  const pin = await input.shell.requestPin();
  if (pin === null) return { kind: "no-pin" };
  const result = await input.unlock(pin);
  if (result.ok) return { kind: "unlocked" };
  switch (result.failure.kind) {
    case "pin-incorrect":
      await input.shell.disable();
      return { kind: "pin-rejected" };
    case "locked-out":
      return { kind: "locked-out", message: credentialFailureMessage(result.failure) };
    default:
      return { kind: "failed", message: credentialFailureMessage(result.failure) };
  }
};

export type EnableOsUnlockOutcome =
  | { readonly ok: true; readonly status: DesktopCredentialOsUnlockStatus | null }
  | { readonly ok: false; readonly message: string };

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The desktop app could not save the PIN.";

/** The server must accept the PIN before the shell is allowed to keep it. */
export const enableOsUnlock = async (input: {
  readonly pin: string;
  readonly shell: CredentialOsUnlockClient;
  readonly verify: (pin: string) => Promise<CredentialActionResult<unknown>>;
}): Promise<EnableOsUnlockOutcome> => {
  const verification = await input.verify(input.pin);
  if (!verification.ok) {
    return { ok: false, message: credentialFailureMessage(verification.failure) };
  }
  try {
    return { ok: true, status: await input.shell.enable(input.pin) };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
};

export type StoredPinRefreshOutcome = "not-enabled" | "updated" | "cleared";

/**
 * A PIN change leaves the shell holding the old PIN, which the server would reject on the next
 * unlock. Rewriting it keeps the setting on; if the keychain refuses, it is dropped so the user is
 * asked for the new PIN rather than being locked out by a stale one.
 */
export const refreshStoredPinAfterChange = async (input: {
  readonly enabled: boolean;
  readonly pin: string;
  readonly shell: CredentialOsUnlockClient;
}): Promise<StoredPinRefreshOutcome> => {
  if (!input.enabled) return "not-enabled";
  try {
    await input.shell.enable(input.pin);
    return "updated";
  } catch {
    await input.shell.disable();
    return "cleared";
  }
};
