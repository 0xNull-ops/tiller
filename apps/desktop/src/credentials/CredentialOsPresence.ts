import type { DesktopCredentialOsUnlockMethod } from "@t3tools/contracts";

/**
 * One small interface per OS behind a common shape, so the unlock service never knows which
 * platform it runs on and tests can drive every adapter without a real sensor or dialog.
 */
export interface CredentialOsPresence {
  readonly method: DesktopCredentialOsUnlockMethod;
  /** False when the platform cannot prompt at all, so the feature is not offered. */
  readonly isAvailable: () => Promise<boolean>;
  /** Resolves true only after the OS confirms the user; cancelling is false, not an error. */
  readonly prompt: (reason: string) => Promise<boolean>;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly exitCode: number;
}

export interface PowerShellScriptRunner {
  /** The script arrives on stdin so no part of it can land in the process list. */
  (script: string): Promise<ProcessResult>;
}

export interface PkcheckRunner {
  (args: readonly string[]): Promise<ProcessResult>;
}

export interface TouchIdSystemPreferences {
  readonly canPromptTouchID: () => boolean;
  readonly promptTouchID: (reason: string) => Promise<void>;
}

/** macOS: Touch ID, or the login password when the sensor has one enrolled. */
export const makeTouchIdPresence = (
  systemPreferences: TouchIdSystemPreferences,
): CredentialOsPresence => ({
  method: "touch-id",
  isAvailable: async () => {
    try {
      return systemPreferences.canPromptTouchID() === true;
    } catch {
      return false;
    }
  },
  prompt: async (reason) => {
    try {
      await systemPreferences.promptTouchID(reason);
      return true;
    } catch {
      // A cancelled or failed prompt rejects; both mean "no user presence".
      return false;
    }
  },
});

/**
 * Windows PowerShell 5.1 can await WinRT operations once the `AsTask` extension is resolved.
 * The script is static apart from our own reason string, and it names no secret: the PIN never
 * leaves the main process for a child process.
 */
const WINDOWS_HELLO_PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]",
  "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') })[0]",
].join("\n");

const powershellString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const WINDOWS_HELLO_AVAILABLE = "Available";
export const WINDOWS_HELLO_VERIFIED = "Verified";

export const windowsHelloAvailabilityScript = (): string =>
  [
    WINDOWS_HELLO_PRELUDE,
    "$task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()))",
    "$task.Wait(-1) | Out-Null",
    "Write-Output $task.Result",
  ].join("\n");

const windowsHelloVerificationScript = (reason: string): string =>
  [
    WINDOWS_HELLO_PRELUDE,
    `$task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync(${powershellString(reason)})))`,
    "$task.Wait(-1) | Out-Null",
    "Write-Output $task.Result",
  ].join("\n");

/** PowerShell may append warnings; the enum is the last line it writes. */
const lastLine = (stdout: string): string =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line !== "") ?? "";

/** Windows: Hello, through WinRT in Windows PowerShell, so no native dependency ships. */
export const makeWindowsHelloPresence = (
  runPowerShell: PowerShellScriptRunner,
): CredentialOsPresence => {
  const run = async (script: string): Promise<ProcessResult> => {
    try {
      return await runPowerShell(script);
    } catch {
      return { stdout: "", exitCode: -1 };
    }
  };
  return {
    method: "windows-hello",
    isAvailable: async () => {
      const result = await run(windowsHelloAvailabilityScript());
      return result.exitCode === 0 && lastLine(result.stdout) === WINDOWS_HELLO_AVAILABLE;
    },
    prompt: async (reason) => {
      const result = await run(windowsHelloVerificationScript(reason));
      return result.exitCode === 0 && lastLine(result.stdout) === WINDOWS_HELLO_VERIFIED;
    },
  };
};

/**
 * There is no stock polkit action that means "prove you are this session's user". The exec action
 * is the closest one that asks for a password and exists everywhere polkit does; on a system
 * where it demands an administrator, `pkcheck` simply denies and the PIN field remains.
 */
export const POLKIT_ACTION_ID = "org.freedesktop.policykit.exec";

export const polkitCheckArgs = (input: {
  readonly pid: number;
  readonly interactive: boolean;
}): string[] => [
  "--action-id",
  POLKIT_ACTION_ID,
  "--process",
  String(input.pid),
  ...(input.interactive ? ["--allow-user-interaction"] : []),
];

/** `pkcheck` exits 2 when the action is registered but needs authentication. */
const POLKIT_AVAILABLE_EXIT_CODES = new Set([0, 2]);

/** Linux: polkit, which needs both `pkcheck` and a session bus carrying an agent. */
export const makePolkitPresence = (input: {
  readonly runPkcheck: PkcheckRunner;
  readonly hasSessionBus: boolean;
  readonly pid: number;
}): CredentialOsPresence => ({
  method: "polkit",
  isAvailable: async () => {
    if (!input.hasSessionBus) return false;
    try {
      const result = await input.runPkcheck(
        polkitCheckArgs({ pid: input.pid, interactive: false }),
      );
      return POLKIT_AVAILABLE_EXIT_CODES.has(result.exitCode);
    } catch {
      return false;
    }
  },
  prompt: async () => {
    try {
      const result = await input.runPkcheck(polkitCheckArgs({ pid: input.pid, interactive: true }));
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
});

export interface CredentialOsPresenceHost {
  readonly platform: NodeJS.Platform;
  readonly systemPreferences?: TouchIdSystemPreferences;
  readonly runPowerShell?: PowerShellScriptRunner;
  readonly runPkcheck?: PkcheckRunner;
  readonly hasSessionBus?: boolean;
  readonly pid?: number;
}

/** Null means the feature does not exist on this platform, so the UI never shows it. */
export const makeCredentialOsPresence = (
  host: CredentialOsPresenceHost,
): CredentialOsPresence | null => {
  switch (host.platform) {
    case "darwin":
      return host.systemPreferences === undefined
        ? null
        : makeTouchIdPresence(host.systemPreferences);
    case "win32":
      return host.runPowerShell === undefined ? null : makeWindowsHelloPresence(host.runPowerShell);
    case "linux":
      return host.runPkcheck === undefined || host.pid === undefined
        ? null
        : makePolkitPresence({
            runPkcheck: host.runPkcheck,
            hasSessionBus: host.hasSessionBus === true,
            pid: host.pid,
          });
    default:
      return null;
  }
};
