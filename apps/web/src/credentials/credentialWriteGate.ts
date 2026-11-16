import {
  CredentialAccessError,
  CredentialError,
  CredentialPinRequiredError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * The three ways a write can be turned away: the vault has no PIN yet, this session's
 * unlock lapsed, or the credentials themselves are wrong. Everything else is a plain error.
 */
export type CredentialFailure =
  | { readonly kind: "pin-required" }
  | { readonly kind: "unlock-required" }
  | { readonly kind: "pin-incorrect"; readonly attemptsRemaining?: number }
  | { readonly kind: "locked-out"; readonly retryAfterSeconds: number }
  | { readonly kind: "error"; readonly message: string };

export type CredentialActionResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly failure: CredentialFailure };

const isCredentialPinRequired = Schema.is(CredentialPinRequiredError);
const isCredentialAccessError = Schema.is(CredentialAccessError);
const isCredentialError = Schema.is(CredentialError);

export const classifyCredentialFailure = (error: unknown): CredentialFailure => {
  if (isCredentialPinRequired(error)) return { kind: "pin-required" };
  if (isCredentialAccessError(error)) {
    switch (error.reason) {
      case "unlock-required":
        return { kind: "unlock-required" };
      case "pin-incorrect":
        return {
          kind: "pin-incorrect",
          ...(error.attemptsRemaining === undefined
            ? {}
            : { attemptsRemaining: error.attemptsRemaining }),
        };
      case "locked-out":
        return { kind: "locked-out", retryAfterSeconds: error.retryAfterSeconds ?? 0 };
      default:
        return { kind: "error", message: error.message };
    }
  }
  if (isCredentialError(error)) return { kind: "error", message: error.message };
  return {
    kind: "error",
    message: error instanceof Error && error.message.trim() !== "" ? error.message : String(error),
  };
};

export const credentialFailureMessage = (failure: CredentialFailure): string => {
  switch (failure.kind) {
    case "pin-required":
      return "Set a credential PIN before changing credentials.";
    case "unlock-required":
      return "Unlock the credential vault first.";
    case "pin-incorrect":
      return failure.attemptsRemaining === undefined
        ? "That PIN is not correct."
        : `That PIN is not correct. ${failure.attemptsRemaining} ${
            failure.attemptsRemaining === 1 ? "try" : "tries"
          } left.`;
    case "locked-out":
      return `Too many incorrect PINs. Try again in ${failure.retryAfterSeconds} seconds.`;
    case "error":
      return failure.message;
  }
};
