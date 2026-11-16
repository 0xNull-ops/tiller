import {
  DesktopCredentialOsUnlockRequest,
  DesktopCredentialOsUnlockResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CredentialOsUnlock from "../../credentials/CredentialOsUnlock.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const credentialOsUnlock = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CREDENTIAL_OS_UNLOCK_CHANNEL,
  payload: DesktopCredentialOsUnlockRequest,
  result: DesktopCredentialOsUnlockResult,
  handler: Effect.fn("desktop.ipc.credentialOsUnlock")(function* (request) {
    const service = yield* CredentialOsUnlock.CredentialOsUnlock;
    switch (request.action) {
      case "status":
        return { status: yield* service.status(request.environmentId) };
      case "enable": {
        if (request.pin === undefined) {
          return yield* new CredentialOsUnlock.CredentialOsUnlockError({ reason: "invalid-pin" });
        }
        const status = yield* service.enable(request.environmentId, request.pin);
        return { status };
      }
      case "disable":
        return { status: yield* service.disable(request.environmentId) };
      case "unlock": {
        const result = yield* service.unlock(request.environmentId);
        return {
          status: result.status,
          ...(Option.isSome(result.pin) ? { pin: result.pin.value } : {}),
        };
      }
    }
  }),
});
