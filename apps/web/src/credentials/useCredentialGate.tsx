import { useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import { unlockCredentials } from "./credentialState";
import { CredentialUnlockDialog } from "./CredentialPinDialogs";
import {
  bindCredentialOsUnlock,
  credentialOsUnlockMethodLabel,
  unlockWithStoredPin,
  useCredentialOsUnlockStatus,
} from "./credentialOsUnlock";
import {
  classifyCredentialFailure,
  credentialFailureMessage,
  type CredentialActionResult,
} from "./credentialWriteGate";

export const settleCredentialCommand = async <A, E>(
  run: () => Promise<AtomCommandResult<A, E>>,
): Promise<CredentialActionResult<A>> => {
  const result = await run();
  if (result._tag === "Success") return { ok: true, value: result.value };
  return {
    ok: false,
    failure: isAtomCommandInterrupted(result)
      ? { kind: "error", message: "The environment disconnected before the action finished." }
      : classifyCredentialFailure(squashAtomCommandFailure(result)),
  };
};

/** The server decides when unlock is required. An accepted unlock retries the original action once. */
export function useCredentialGate(environmentId: EnvironmentId) {
  const unlock = useAtomCommand(unlockCredentials, { reportFailure: false });
  const os = useCredentialOsUnlockStatus(environmentId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const pending = useRef<(() => Promise<CredentialActionResult<unknown>>) | null>(null);
  const run = async (action: () => Promise<CredentialActionResult<unknown>>) => {
    if (busy || pending.current) return;
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) return;
    if (result.failure.kind === "unlock-required" || result.failure.kind === "locked-out") {
      pending.current = action;
      setBlocked(result.failure.kind === "locked-out");
      setError(
        result.failure.kind === "locked-out" ? credentialFailureMessage(result.failure) : null,
      );
      setOpen(true);
    } else setError(credentialFailureMessage(result.failure));
  };
  const retry = async () => {
    const action = pending.current;
    pending.current = null;
    setOpen(false);
    if (action) {
      const result = await action();
      if (!result.ok) setError(credentialFailureMessage(result.failure));
    }
  };
  const verify = (pin: string) =>
    settleCredentialCommand(() => unlock({ environmentId, input: { pin } }));
  const submit = async (pin: string) => {
    setBusy(true);
    const result = await verify(pin);
    if (result.ok) await retry();
    else {
      setError(credentialFailureMessage(result.failure));
      if (result.failure.kind === "locked-out") setBlocked(true);
    }
    setBusy(false);
    return result.ok;
  };
  const osUnlock = async () => {
    setBusy(true);
    const outcome = await unlockWithStoredPin({
      shell: bindCredentialOsUnlock(environmentId),
      unlock: verify,
    });
    if (outcome.kind === "unlocked") await retry();
    else if (outcome.kind === "pin-rejected") {
      os.setStatus(null);
      setError("Enter your PIN to unlock credentials.");
    } else if (outcome.kind === "locked-out" || outcome.kind === "failed") {
      setError(outcome.message);
      setBlocked(outcome.kind === "locked-out");
    }
    setBusy(false);
  };
  return {
    run,
    busy,
    error: open ? null : error,
    dialog: (
      <CredentialUnlockDialog
        open={open}
        busy={busy}
        error={error}
        onSubmit={submit}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            pending.current = null;
            setError(null);
          }
        }}
        osUnlockLabel={
          os.status?.enabled && os.status.method
            ? credentialOsUnlockMethodLabel(os.status.method)
            : null
        }
        osUnlockBusy={busy}
        osUnlockDisabled={blocked}
        onOsUnlock={() => void osUnlock()}
      />
    ),
  };
}
