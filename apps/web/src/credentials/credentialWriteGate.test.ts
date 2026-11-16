import {
  CredentialAccessError,
  CredentialError,
  CredentialPinRequiredError,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { classifyCredentialFailure, credentialFailureMessage } from "./credentialWriteGate";

describe("classifyCredentialFailure", () => {
  it("recognizes a vault with no PIN", () => {
    expect(classifyCredentialFailure(new CredentialPinRequiredError())).toEqual({
      kind: "pin-required",
    });
  });

  it("recognizes a lapsed session unlock", () => {
    expect(
      classifyCredentialFailure(new CredentialAccessError({ reason: "unlock-required" })),
    ).toEqual({ kind: "unlock-required" });
  });

  it("keeps the attempts left on a wrong PIN", () => {
    expect(
      classifyCredentialFailure(
        new CredentialAccessError({ reason: "pin-incorrect", attemptsRemaining: 2 }),
      ),
    ).toEqual({ kind: "pin-incorrect", attemptsRemaining: 2 });
  });

  it("keeps the lockout retry time", () => {
    const failure = classifyCredentialFailure(
      new CredentialAccessError({ reason: "locked-out", retryAfterSeconds: 30 }),
    );
    expect(failure).toEqual({ kind: "locked-out", retryAfterSeconds: 30 });
    expect(credentialFailureMessage(failure)).toBe(
      "Too many incorrect PINs. Try again in 30 seconds.",
    );
  });

  it("turns a vault error into its message", () => {
    const failure = classifyCredentialFailure(new CredentialError({ reason: "not-found" }));
    expect(failure).toEqual({ kind: "error", message: "That credential no longer exists." });
  });

  it("falls back to an Error's message", () => {
    expect(classifyCredentialFailure(new Error("boom"))).toEqual({
      kind: "error",
      message: "boom",
    });
  });
});
