import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import * as CredentialOsUnlock from "./CredentialOsUnlock.ts";
import { makeCredentialOsPresence } from "./CredentialOsPresence.ts";
import { runPkcheck, runPowerShellScript } from "./CredentialOsPresenceProcess.ts";

/**
 * Resolves the one prompt adapter this platform has, then builds the service around it. A
 * platform with no adapter yields null, which is what makes the feature disappear from the UI.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    const environment = yield* HostProcess.Environment;
    const presence = makeCredentialOsPresence({
      platform,
      systemPreferences: Electron.systemPreferences,
      runPowerShell: runPowerShellScript,
      runPkcheck,
      hasSessionBus: (environment.DBUS_SESSION_BUS_ADDRESS ?? "").trim() !== "",
      pid: process.pid,
    });
    return CredentialOsUnlock.layer(presence);
  }),
);
