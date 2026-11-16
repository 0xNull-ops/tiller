import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";

const VAULT_KEY = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));

const layerVaultKey = Layer.succeed(CredentialVaultKey.CredentialVaultKey, {
  keyStorage: Effect.succeed("file" as const),
  vaultKey: Effect.succeed(VAULT_KEY),
});

const layerUnlock = () =>
  CredentialUnlock.layer.pipe(
    Layer.provideMerge(CredentialStore.layer.pipe(Layer.provideMerge(CredentialHistory.layer))),
    Layer.provide(layerVaultKey),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-credential-unlock-test-" }),
    ),
  );

const session = AuthSessionId.make("session-a");
const otherSession = AuthSessionId.make("session-b");

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("CredentialUnlock", (it) => {
  it.effect("asks for a PIN before the first write and unlocks the session that sets it", () =>
    Effect.gen(function* () {
      const unlock = yield* CredentialUnlock.CredentialUnlock;

      const before = yield* unlock.status(session);
      assert.isFalse(before.pinSet);
      assert.isUndefined(before.unlockedUntil);
      assert.equal(before.keyStorage, "file");

      const required = yield* Effect.flip(unlock.requireUnlocked(session));
      assert.equal(required._tag, "CredentialPinRequiredError");

      const after = yield* unlock.setPin({ sessionId: session, newPin: "1234" });
      assert.isTrue(after.pinSet);
      assert.isString(after.unlockedUntil);
      yield* unlock.requireUnlocked(session);

      // A second client starts locked even though the first is unlocked.
      const other = yield* unlock.status(otherSession);
      assert.isTrue(other.pinSet);
      assert.isUndefined(other.unlockedUntil);
      const denied = yield* Effect.flip(unlock.requireUnlocked(otherSession));
      assert.equal(denied._tag, "CredentialAccessError");
    }).pipe(Effect.provide(layerUnlock())),
  );

  it.effect("re-locks the session five minutes after the unlock", () =>
    Effect.gen(function* () {
      const unlock = yield* CredentialUnlock.CredentialUnlock;
      yield* unlock.setPin({ sessionId: session, newPin: "1234" });

      yield* TestClock.adjust("4 minutes");
      yield* unlock.requireUnlocked(session);

      yield* TestClock.adjust("61 seconds");
      const expired = yield* Effect.flip(unlock.requireUnlocked(session));
      assert.equal(expired._tag, "CredentialAccessError");
      assert.equal((expired as { reason: string }).reason, "unlock-required");
      assert.isUndefined((yield* unlock.status(session)).unlockedUntil);
    }).pipe(Effect.provide(layerUnlock())),
  );

  it.effect("locks out after five wrong PINs, doubling the wait, and persists the lockout", () =>
    Effect.gen(function* () {
      const unlock = yield* CredentialUnlock.CredentialUnlock;
      const store = yield* CredentialStore.CredentialStore;
      yield* unlock.setPin({ sessionId: session, newPin: "1234" });
      yield* unlock.lock(session);

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const error = yield* Effect.flip(unlock.unlock({ sessionId: session, pin: "0000" }));
        assert.equal((error as { reason: string }).reason, "pin-incorrect");
        assert.equal((error as { attemptsRemaining: number }).attemptsRemaining, 5 - attempt);
      }

      const locked = yield* Effect.flip(unlock.unlock({ sessionId: session, pin: "0000" }));
      assert.equal((locked as { reason: string }).reason, "locked-out");
      assert.equal((locked as { retryAfterSeconds: number }).retryAfterSeconds, 30);

      const persisted = yield* store.lockout;
      assert.equal(persisted.failures, 5);
      assert.isDefined(persisted.lockedUntil);

      // The correct PIN does not work during the lockout, and a restart keeps the wait.
      yield* TestClock.adjust("29 seconds");
      const stillLocked = yield* Effect.flip(unlock.unlock({ sessionId: session, pin: "1234" }));
      assert.equal((stillLocked as { reason: string }).reason, "locked-out");

      yield* TestClock.adjust("2 seconds");
      const unlocked = yield* unlock.unlock({ sessionId: session, pin: "1234" });
      assert.isString(unlocked.unlockedUntil);
      assert.equal((yield* store.lockout).failures, 0);
    }).pipe(Effect.provide(layerUnlock())),
  );

  it.effect("counts concurrent wrong PINs against the same lockout", () =>
    Effect.gen(function* () {
      const unlock = yield* CredentialUnlock.CredentialUnlock;
      const store = yield* CredentialStore.CredentialStore;
      yield* unlock.setPin({ sessionId: session, newPin: "1234" });
      yield* unlock.lock(session);

      const errors = yield* Effect.all(
        Array.from({ length: 12 }, () =>
          Effect.flip(unlock.unlock({ sessionId: session, pin: "0000" })),
        ),
        { concurrency: "unbounded" },
      );
      const reasons = errors.map((error) => (error as { reason: string }).reason);
      // The fifth wrong PIN starts the lockout, so four are plain misses and the other eight are refused.
      assert.equal(reasons.filter((reason) => reason === "pin-incorrect").length, 4);
      assert.equal(reasons.filter((reason) => reason === "locked-out").length, 8);
      const persisted = yield* store.lockout;
      assert.equal(persisted.failures, 5);
      assert.isDefined(persisted.lockedUntil);
    }).pipe(Effect.provide(layerUnlock())),
  );

  it.effect("a sixth wrong PIN waits twice as long as the fifth", () =>
    Effect.gen(function* () {
      const unlock = yield* CredentialUnlock.CredentialUnlock;
      yield* unlock.setPin({ sessionId: session, newPin: "1234" });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        yield* Effect.flip(unlock.unlock({ sessionId: session, pin: "0000" }));
      }
      yield* TestClock.adjust("31 seconds");
      const second = yield* Effect.flip(unlock.unlock({ sessionId: session, pin: "0000" }));
      assert.equal((second as { reason: string }).reason, "locked-out");
      assert.equal((second as { retryAfterSeconds: number }).retryAfterSeconds, 60);
    }).pipe(Effect.provide(layerUnlock())),
  );

  it.effect("changing the PIN needs the current one and a strong new one", () =>
    Effect.gen(function* () {
      const unlock = yield* CredentialUnlock.CredentialUnlock;
      yield* unlock.setPin({ sessionId: session, newPin: "1234" });

      const weak = yield* Effect.flip(
        unlock.setPin({ sessionId: session, newPin: "12", currentPin: "1234" }),
      );
      assert.equal((weak as { reason: string }).reason, "pin-too-weak");

      const missingCurrent = yield* Effect.flip(
        unlock.setPin({ sessionId: session, newPin: "5678" }),
      );
      assert.equal((missingCurrent as { reason: string }).reason, "pin-mismatch");

      const wrongCurrent = yield* Effect.flip(
        unlock.setPin({ sessionId: session, newPin: "5678", currentPin: "0000" }),
      );
      assert.equal((wrongCurrent as { reason: string }).reason, "pin-mismatch");

      yield* unlock.setPin({ sessionId: session, newPin: "correct horse", currentPin: "1234" });
      yield* unlock.lock(session);
      yield* unlock.unlock({ sessionId: session, pin: "correct horse" });
    }).pipe(Effect.provide(layerUnlock())),
  );

  it.effect("records failures and PIN changes without any PIN material", () =>
    Effect.gen(function* () {
      const unlock = yield* CredentialUnlock.CredentialUnlock;
      const history = yield* CredentialHistory.CredentialHistory;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      yield* unlock.setPin({ sessionId: session, newPin: "246810" });
      yield* Effect.flip(unlock.unlock({ sessionId: session, pin: "999999-wrong" }));
      yield* unlock.setPin({ sessionId: session, newPin: "135791", currentPin: "246810" });

      const page = yield* history.read({ limit: 10 });
      assert.deepEqual(
        page.events.map((event) => event.type),
        ["pin-changed", "unlock-failed", "pin-set"],
      );
      const raw = yield* fileSystem.readFileString(
        path.join(config.stateDir, "credentials", "history.jsonl"),
      );
      for (const pin of ["246810", "135791", "999999-wrong"]) assert.notInclude(raw, pin);
      const store = yield* CredentialStore.CredentialStore;
      assert.isTrue(Option.isSome(yield* store.pinRecord));
    }).pipe(Effect.provide(layerUnlock())),
  );
});
