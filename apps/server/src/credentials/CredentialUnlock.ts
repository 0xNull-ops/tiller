import {
  CredentialAccessError,
  CredentialPinRequiredError,
  isCredentialPinAcceptable,
  type AuthSessionId,
  type CredentialError,
  type CredentialPinSetInput,
  type CredentialsStatus,
  type CredentialUnlockInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";
import {
  CREDENTIAL_PIN_PARAMS,
  credentialPinSalt,
  deriveCredentialPinHash,
  pinHashMatches,
} from "./CredentialCrypto.ts";

/** Long enough to edit a few credentials, short enough that a walked-away screen re-locks. */
const CREDENTIAL_UNLOCK_TTL_MS = 5 * 60 * 1000;
const MAX_LOCKOUT_MS = 60 * 60 * 1000;

const isoFromMillis = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

/** Five failures wait 30 s, then 60 s, 120 s, and so on up to an hour. */
const lockoutMs = (failures: number) =>
  Math.min(
    MAX_LOCKOUT_MS,
    CredentialStore.CREDENTIAL_LOCKOUT_BASE_MS *
      2 ** Math.max(0, failures - CredentialStore.CREDENTIAL_LOCKOUT_AFTER_FAILURES),
  );

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromBase64 = (text: string) => Uint8Array.from(Buffer.from(text, "base64"));

export class CredentialUnlock extends Context.Service<
  CredentialUnlock,
  {
    readonly status: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<CredentialsStatus, CredentialError>;
    readonly requireUnlocked: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<void, CredentialAccessError | CredentialPinRequiredError | CredentialError>;
    readonly setPin: (
      input: { readonly sessionId: AuthSessionId } & CredentialPinSetInput,
    ) => Effect.Effect<CredentialsStatus, CredentialAccessError | CredentialError>;
    readonly unlock: (
      input: { readonly sessionId: AuthSessionId } & CredentialUnlockInput,
    ) => Effect.Effect<CredentialsStatus, CredentialAccessError | CredentialError>;
    readonly lock: (sessionId: AuthSessionId) => Effect.Effect<CredentialsStatus, CredentialError>;
  }
>()("t3/credentials/CredentialUnlock") {}

const make = Effect.gen(function* () {
  const store = yield* CredentialStore.CredentialStore;
  const history = yield* CredentialHistory.CredentialHistory;
  const vaultKey = yield* CredentialVaultKey.CredentialVaultKey;
  /** Keyed by the RPC caller's auth session: unlocking one client does not unlock another. */
  const unlocked = yield* Ref.make(new Map<string, number>());
  /**
   * Held across the whole lockout check, PIN verification and failure count, so concurrent guesses
   * cannot all read the same count before any of them records a failure.
   */
  const pinLock = yield* Semaphore.make(1);

  const statusFor = Effect.fn("CredentialUnlock.status")(function* (sessionId: AuthSessionId) {
    const [pin, keyStorage, now, sessions] = yield* Effect.all([
      store.pinRecord,
      vaultKey.keyStorage,
      Clock.currentTimeMillis,
      Ref.get(unlocked),
    ]);
    const until = sessions.get(sessionId);
    return {
      pinSet: Option.isSome(pin),
      keyStorage,
      ...(until !== undefined && until > now ? { unlockedUntil: isoFromMillis(until) } : {}),
    };
  });

  const lockedOutError = (lockedUntil: number, now: number) =>
    new CredentialAccessError({
      reason: "locked-out",
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - now) / 1000)),
    });

  const activeLockout = Effect.fn("CredentialUnlock.activeLockout")(function* () {
    const [lockout, now] = yield* Effect.all([store.lockout, Clock.currentTimeMillis]);
    const until = lockout.lockedUntil === undefined ? undefined : Date.parse(lockout.lockedUntil);
    return until !== undefined && Number.isFinite(until) && until > now
      ? { lockout, now, until }
      : null;
  });

  /** Counts the failure and persists the lockout, so a restart does not clear it. */
  const recordFailure = Effect.fn("CredentialUnlock.recordFailure")(function* (
    sessionId: AuthSessionId,
    failures: number,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const next =
      failures >= CredentialStore.CREDENTIAL_LOCKOUT_AFTER_FAILURES
        ? { failures, lockedUntil: isoFromMillis(now + lockoutMs(failures)) }
        : { failures };
    yield* store.setLockout(next);
    yield* history.record({ type: "unlock-failed", sessionId });
    return next;
  });

  const grant = Effect.fn("CredentialUnlock.grant")(function* (sessionId: AuthSessionId) {
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(unlocked, (sessions) => {
      const next = new Map(sessions);
      next.set(sessionId, now + CREDENTIAL_UNLOCK_TTL_MS);
      return next;
    });
    return yield* statusFor(sessionId);
  });

  const requireUnlocked: CredentialUnlock["Service"]["requireUnlocked"] = Effect.fn(
    "CredentialUnlock.requireUnlocked",
  )(function* (sessionId) {
    const pin = yield* store.pinRecord;
    if (Option.isNone(pin)) return yield* new CredentialPinRequiredError();
    const [now, sessions] = yield* Effect.all([Clock.currentTimeMillis, Ref.get(unlocked)]);
    const until = sessions.get(sessionId);
    if (until !== undefined && until > now) return;
    return yield* new CredentialAccessError({ reason: "unlock-required" });
  });

  const unlock: CredentialUnlock["Service"]["unlock"] = Effect.fn("CredentialUnlock.unlock")(
    function* (input) {
      const pin = yield* store.pinRecord;
      // Nothing to unlock before a PIN exists; the first write asks for one instead.
      if (Option.isNone(pin)) return yield* statusFor(input.sessionId);

      const locked = yield* activeLockout();
      if (locked !== null) return yield* lockedOutError(locked.until, locked.now);

      const record = pin.value;
      const matches = pinHashMatches({
        pin: input.pin,
        salt: fromBase64(record.salt),
        hash: fromBase64(record.hash),
        params: { n: record.n, r: record.r, p: record.p },
      });
      if (!matches) {
        const lockout = yield* store.lockout;
        const next = yield* recordFailure(input.sessionId, lockout.failures + 1);
        if (next.lockedUntil !== undefined) {
          const now = yield* Clock.currentTimeMillis;
          return yield* lockedOutError(Date.parse(next.lockedUntil), now);
        }
        return yield* new CredentialAccessError({
          reason: "pin-incorrect",
          attemptsRemaining: Math.max(
            0,
            CredentialStore.CREDENTIAL_LOCKOUT_AFTER_FAILURES - next.failures,
          ),
        });
      }
      if (yield* store.lockout.pipe(Effect.map((lockout) => lockout.failures > 0))) {
        yield* store.setLockout({ failures: 0 });
      }
      return yield* grant(input.sessionId);
    },
    pinLock.withPermits(1),
  );

  const setPin: CredentialUnlock["Service"]["setPin"] = Effect.fn("CredentialUnlock.setPin")(
    function* (input) {
      if (!isCredentialPinAcceptable(input.newPin)) {
        return yield* new CredentialAccessError({ reason: "pin-too-weak" });
      }
      const existing = yield* store.pinRecord;
      if (Option.isSome(existing)) {
        if (input.currentPin === undefined) {
          return yield* new CredentialAccessError({ reason: "pin-mismatch" });
        }
        // Changing the PIN checks the same lockout as unlocking, so it cannot be used to guess.
        const locked = yield* activeLockout();
        if (locked !== null) return yield* lockedOutError(locked.until, locked.now);
        const matches = pinHashMatches({
          pin: input.currentPin,
          salt: fromBase64(existing.value.salt),
          hash: fromBase64(existing.value.hash),
          params: { n: existing.value.n, r: existing.value.r, p: existing.value.p },
        });
        if (!matches) {
          const lockout = yield* store.lockout;
          yield* recordFailure(input.sessionId, lockout.failures + 1);
          return yield* new CredentialAccessError({ reason: "pin-mismatch" });
        }
      }

      const salt = credentialPinSalt();
      const hash = deriveCredentialPinHash({
        pin: input.newPin,
        salt,
        params: CREDENTIAL_PIN_PARAMS,
      });
      const now = yield* Clock.currentTimeMillis;
      yield* store.setPinRecord(
        Option.some({
          salt: base64(salt),
          hash: base64(hash),
          n: CREDENTIAL_PIN_PARAMS.n,
          r: CREDENTIAL_PIN_PARAMS.r,
          p: CREDENTIAL_PIN_PARAMS.p,
          updatedAt: isoFromMillis(now),
        }),
      );
      yield* store.setLockout({ failures: 0 });
      yield* history.record({ type: Option.isSome(existing) ? "pin-changed" : "pin-set" });
      // Setting a PIN proves knowledge of it, so this session starts unlocked.
      return yield* grant(input.sessionId);
    },
    pinLock.withPermits(1),
  );

  const lock: CredentialUnlock["Service"]["lock"] = Effect.fn("CredentialUnlock.lock")(
    function* (sessionId) {
      yield* Ref.update(unlocked, (sessions) => {
        const next = new Map(sessions);
        next.delete(sessionId);
        return next;
      });
      return yield* statusFor(sessionId);
    },
  );

  return CredentialUnlock.of({ status: statusFor, requireUnlocked, setPin, unlock, lock });
});

export const layer = Layer.effect(CredentialUnlock, make);
