import { CredentialAccessError, CredentialPinRequiredError } from "@t3tools/contracts";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";

export type CredentialDecisionOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "unlock"; readonly message: string | null }
  | { readonly kind: "error"; readonly message: string };

const isAccessError = Schema.is(CredentialAccessError);
const isPinRequired = Schema.is(CredentialPinRequiredError);

export function credentialApprovalFailure(error: unknown): CredentialDecisionOutcome {
  if (isPinRequired(error))
    return { kind: "error", message: "Set a credential PIN on desktop or web first." };
  if (isAccessError(error)) {
    if (error.reason === "unlock-required") return { kind: "unlock", message: null };
    if (error.reason === "locked-out")
      return {
        kind: "unlock",
        message: `Too many incorrect PINs. Try again in ${error.retryAfterSeconds ?? 0} seconds.`,
      };
    if (error.reason === "pin-incorrect")
      return { kind: "unlock", message: "That PIN is not correct." };
  }
  // Unknown errors can contain server payloads: never echo them into the client.
  return { kind: "error", message: "Could not answer this credential request. Try again." };
}

export async function settleCredentialDecision<A, E>(
  action: () => Promise<AtomCommandResult<A, E>>,
): Promise<CredentialDecisionOutcome> {
  const result = await action();
  return result._tag === "Success"
    ? { kind: "done" }
    : credentialApprovalFailure(squashAtomCommandFailure(result));
}

/** A successful unlock retries only once, even if the session expires again. */
export async function unlockAndRetryCredentialDecision(
  unlock: () => Promise<CredentialDecisionOutcome>,
  retry: () => Promise<CredentialDecisionOutcome>,
): Promise<CredentialDecisionOutcome> {
  const result = await unlock();
  if (result.kind !== "done") return result;
  const retried = await retry();
  return retried.kind === "unlock"
    ? { kind: "error", message: "The session locked again. Answer the request again to unlock." }
    : retried;
}
