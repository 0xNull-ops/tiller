import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CredentialError, EnvironmentId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";

interface RecordedCall {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin?: string;
}

const layerEnvironment = Layer.succeed(ServerEnvironment.ServerEnvironment, {
  getEnvironmentId: Effect.succeed(EnvironmentId.make("env-test")),
  getDescriptor: Effect.die("unused in the vault key test"),
});

/** Answers `security` (or `secret-tool`) like a machine whose keychain has no entry, then accepts the write. */
const fakeProcessRunner = (calls: Array<RecordedCall>, readExitCode: number, writeExitCode = 0) =>
  Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input: ProcessRunner.ProcessRunInput) =>
      Effect.sync(() => {
        calls.push({
          command: input.command,
          args: input.args,
          ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        });
        const isRead = input.args[0] === "find-generic-password" || input.args[0] === "lookup";
        return {
          stdout: "",
          stderr: "",
          code: isRead ? readExitCode : writeExitCode,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        } as ProcessRunner.ProcessRunOutput;
      }),
  });

const layerVaultWithRunner = (
  runner: Layer.Layer<ProcessRunner.ProcessRunner>,
  platform: NodeJS.Platform = "darwin",
) =>
  CredentialVaultKey.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provide(runner),
    Layer.provideMerge(layerEnvironment),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-credential-vault-test-" }),
    ),
    // The platform is read while the layer is built, so it has to arrive as a layer, not as an
    // ambient service on the test effect.
    Layer.provide(Layer.succeed(HostProcess.Platform, platform)),
  );

const layerVault = (
  calls: Array<RecordedCall>,
  platform: NodeJS.Platform = "darwin",
  readExitCode = 44,
  writeExitCode = 0,
) => layerVaultWithRunner(fakeProcessRunner(calls, readExitCode, writeExitCode), platform);

/**
 * A keychain whose first read fails and whose later reads answer with the stored key, the way a
 * machine behaves right after it was unlocked.
 */
const recoveringProcessRunner = (calls: Array<RecordedCall>, keychainKey: Uint8Array) => {
  let locked = true;
  const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input: ProcessRunner.ProcessRunInput) =>
      Effect.sync(() => {
        const isRead = input.args[0] === "find-generic-password" || input.args[0] === "lookup";
        calls.push({
          command: input.command,
          args: input.args,
          ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        });
        return {
          stdout: isRead && !locked ? Buffer.from(keychainKey).toString("base64") : "",
          stderr: "",
          code: isRead ? (locked ? 1 : 0) : 0,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        } as ProcessRunner.ProcessRunOutput;
      }),
  });
  return { runner, unlock: () => (locked = false) };
};

/** A keychain whose read waits for the test to open it, so a caller stays in flight meanwhile. */
const gatedProcessRunner = (calls: Array<RecordedCall>, gate: Deferred.Deferred<void>) =>
  Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input: ProcessRunner.ProcessRunInput) =>
      Effect.suspend(() => {
        const isRead = input.args[0] === "find-generic-password" || input.args[0] === "lookup";
        calls.push({
          command: input.command,
          args: input.args,
          ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        });
        const output = {
          stdout: "",
          stderr: "",
          code: isRead ? 44 : 0,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        } as ProcessRunner.ProcessRunOutput;
        return isRead ? Deferred.await(gate).pipe(Effect.as(output)) : Effect.succeed(output);
      }),
  });

/** The document CredentialStore owns is what says a credential exists, so the probe reads it. */
const seedCredentialDocument = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(config.stateDir, "credentials");
  yield* fileSystem.makeDirectory(directory, { recursive: true });
  yield* fileSystem.writeFileString(
    path.join(directory, "credentials.json"),
    JSON.stringify({ version: 1, credentials: [{ id: "cred-existing" }] }),
  );
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("CredentialVaultKey", (it) => {
  it.effect("stores a new key in the macOS keychain under the environment's account", () => {
    const calls: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const key = yield* vault.vaultKey;
      const storage = yield* vault.keyStorage;

      assert.equal(storage, "os-keychain");
      assert.equal(key.byteLength, 32);
      const read = calls.find((call) => call.args[0] === "find-generic-password");
      assert.equal(read?.command, "security");
      assert.equal(read?.args.at(-2), "env-test");
      assert.equal(read?.args.at(-1), "-w");
      const write = calls.find((call) => call.stdin?.startsWith("add-generic-password") === true);
      assert.deepEqual(write?.args, ["-i"]);
      const written = /-w "([^"]+)"/.exec(write?.stdin ?? "")?.[1];
      assert.equal(
        Buffer.from(written ?? "", "base64").toString("hex"),
        Buffer.from(key).toString("hex"),
      );
      // The key is never written to disk when the keychain took it.
      const store = yield* ServerSecretStore.ServerSecretStore;
      assert.isTrue(Option.isNone(yield* store.get("credential-vault-key")));
    }).pipe(Effect.provide(layerVault(calls)));
  });

  it.effect("keeps an existing on-disk key instead of asking the keychain for another", () => {
    const calls: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;
      const fileKey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
      yield* store.set("credential-vault-key", fileKey);

      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const key = yield* vault.vaultKey;
      const storage = yield* vault.keyStorage;

      assert.equal(storage, "file");
      assert.deepEqual(Array.from(key), Array.from(fileKey));
      assert.equal(calls.length, 0);
    }).pipe(Effect.provide(layerVault(calls)));
  });

  it.effect("falls back to a file key when the platform has no keychain", () => {
    const calls: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const key = yield* vault.vaultKey;
      assert.equal(yield* vault.keyStorage, "file");
      assert.equal(key.byteLength, 32);
      assert.equal(calls.length, 0);
      const store = yield* ServerSecretStore.ServerSecretStore;
      assert.isTrue(Option.isSome(yield* store.get("credential-vault-key")));
    }).pipe(Effect.provide(layerVault(calls, "freebsd")));
  });

  it.effect("keeps the key on disk when the keychain refuses the write", () =>
    Effect.gen(function* () {
      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const key = yield* vault.vaultKey;
      assert.equal(yield* vault.keyStorage, "file");
      const store = yield* ServerSecretStore.ServerSecretStore;
      const stored = yield* store.get("credential-vault-key");
      assert.deepEqual(Array.from(Option.getOrThrow(stored)), Array.from(key));
    }).pipe(Effect.provide(layerVault([], "darwin", 44, 1))),
  );

  it.effect("gives a fresh Linux vault a file key when secret-tool cannot read the keyring", () => {
    const calls: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const key = yield* vault.vaultKey;
      assert.equal(yield* vault.keyStorage, "file");
      assert.equal(key.byteLength, 32);
      assert.isFalse(calls.some((call) => call.args[0] === "store"));
      const store = yield* ServerSecretStore.ServerSecretStore;
      assert.isTrue(Option.isSome(yield* store.get("credential-vault-key")));
    }).pipe(Effect.provide(layerVault(calls, "linux", 127)));
  });

  it.effect(
    "does not move a vault with credentials to a file key when the keyring is unreadable",
    () => {
      const calls: Array<RecordedCall> = [];
      return Effect.gen(function* () {
        yield* seedCredentialDocument;

        const vault = yield* CredentialVaultKey.CredentialVaultKey;
        const error = yield* Effect.flip(vault.vaultKey);
        assert.equal(error.reason, "vault-failed");
        const store = yield* ServerSecretStore.ServerSecretStore;
        assert.isTrue(Option.isNone(yield* store.get("credential-vault-key")));
      }).pipe(Effect.provide(layerVault(calls, "linux", 127)));
    },
  );

  it.effect("does not replace the key of a populated vault when secret-tool reports no key", () => {
    const calls: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      yield* seedCredentialDocument;

      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const error = yield* Effect.flip(vault.vaultKey);
      assert.equal(error.reason, "vault-failed");

      // A new key would strand every secret sealed with the old one, so none is written.
      const store = yield* ServerSecretStore.ServerSecretStore;
      assert.isTrue(Option.isNone(yield* store.get("credential-vault-key")));
      assert.isFalse(calls.some((call) => call.args[0] === "store"));
    }).pipe(Effect.provide(layerVault(calls, "linux", 1)));
  });

  it.effect(
    "does not replace the key of a populated vault when the macOS keychain has no entry",
    () => {
      const calls: Array<RecordedCall> = [];
      return Effect.gen(function* () {
        yield* seedCredentialDocument;

        const vault = yield* CredentialVaultKey.CredentialVaultKey;
        const error = yield* Effect.flip(vault.vaultKey);
        assert.equal(error.reason, "vault-failed");

        const store = yield* ServerSecretStore.ServerSecretStore;
        assert.isTrue(Option.isNone(yield* store.get("credential-vault-key")));
        assert.isFalse(
          calls.some((call) => call.stdin?.startsWith("add-generic-password") === true),
        );
      }).pipe(Effect.provide(layerVault(calls, "darwin", 44)));
    },
  );

  it.effect("gives a fresh Linux vault a key when secret-tool reports no key", () => {
    const calls: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const key = yield* vault.vaultKey;

      assert.equal(yield* vault.keyStorage, "os-keychain");
      assert.equal(key.byteLength, 32);
      assert.isTrue(calls.some((call) => call.args[0] === "store"));
      const store = yield* ServerSecretStore.ServerSecretStore;
      assert.isTrue(Option.isNone(yield* store.get("credential-vault-key")));
    }).pipe(Effect.provide(layerVault(calls, "linux", 1)));
  });

  it.effect(
    "does not replace the key of a populated vault when the platform has no keychain",
    () => {
      const calls: Array<RecordedCall> = [];
      return Effect.gen(function* () {
        yield* seedCredentialDocument;

        const vault = yield* CredentialVaultKey.CredentialVaultKey;
        const error = yield* Effect.flip(vault.vaultKey);
        assert.equal(error.reason, "vault-failed");

        const store = yield* ServerSecretStore.ServerSecretStore;
        assert.isTrue(Option.isNone(yield* store.get("credential-vault-key")));
        assert.equal(calls.length, 0);
      }).pipe(Effect.provide(layerVault(calls, "freebsd")));
    },
  );

  it.effect("asks the keychain again after a failed read instead of staying broken", () => {
    const calls: Array<RecordedCall> = [];
    const keychainKey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
    const { runner, unlock } = recoveringProcessRunner(calls, keychainKey);
    return Effect.gen(function* () {
      // The vault holds a credential, so a key that cannot be read is an error rather than a
      // reason to mint a new one.
      yield* seedCredentialDocument;

      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const error = yield* Effect.flip(vault.vaultKey);
      assert.equal(error.reason, "vault-failed");

      // The keychain answers now, so the next access must try again instead of serving the
      // remembered failure.
      unlock();
      const key = yield* vault.vaultKey;
      assert.deepEqual(Array.from(key), Array.from(keychainKey));
      assert.equal(yield* vault.keyStorage, "os-keychain");
    }).pipe(Effect.provide(layerVaultWithRunner(runner)));
  });

  it.effect("keeps the key it resolved instead of asking the keychain again", () => {
    const calls: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      const first = yield* vault.vaultKey;
      const second = yield* vault.vaultKey;

      assert.deepEqual(Array.from(second), Array.from(first));
      assert.equal(calls.filter((call) => call.args[0] === "find-generic-password").length, 1);
    }).pipe(Effect.provide(layerVault(calls)));
  });

  it.effect("mints one key when two callers ask for it at the same time", () => {
    const calls: Array<RecordedCall> = [];
    const gate = Deferred.makeUnsafe<void>();
    const bothEntered = Deferred.makeUnsafe<void>();
    return Effect.gen(function* () {
      const vault = yield* CredentialVaultKey.CredentialVaultKey;
      let entered = 0;
      // The counter stands in for the two callers being in flight together: the second one has
      // already passed the point where a remembered key would have answered it.
      const access = (key: Effect.Effect<Uint8Array, CredentialError>) =>
        Effect.suspend(() => {
          entered += 1;
          return entered === 2
            ? Deferred.succeed(bothEntered, undefined).pipe(Effect.andThen(key))
            : key;
        });

      const fiber = yield* Effect.forkChild(
        Effect.all([access(vault.vaultKey), access(vault.vaultKey)], {
          concurrency: "unbounded",
        }),
      );
      yield* Deferred.await(bothEntered);
      yield* Deferred.succeed(gate, undefined);
      const [first, second] = yield* Fiber.join(fiber);

      assert.deepEqual(Array.from(second), Array.from(first));
      assert.equal(
        calls.filter((call) => call.stdin?.startsWith("add-generic-password") === true).length,
        1,
      );
    }).pipe(Effect.provide(layerVaultWithRunner(gatedProcessRunner(calls, gate))));
  });
});

const runWith =
  (result: { readonly exitCode: number | null; readonly stdout?: string }) =>
  (_input: CredentialVaultKey.CredentialKeychainCommand) =>
    Effect.succeed({ stdout: result.stdout ?? "", exitCode: result.exitCode });

const emptyBlob: CredentialVaultKey.CredentialKeychainBlob = {
  read: Effect.succeedNone,
  write: () => Effect.void,
};

it.effect("makePlatformKeychain reports no keychain on an unsupported platform", () =>
  Effect.sync(() => {
    const keychain = CredentialVaultKey.makePlatformKeychain({
      platform: "freebsd",
      account: "env",
      run: runWith({ exitCode: 0 }),
      blob: emptyBlob,
    });
    assert.isNull(keychain);
  }),
);

it.effect("the macOS adapter reads the key, and treats a missing item as no key", () =>
  Effect.gen(function* () {
    const key = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index));
    const found = CredentialVaultKey.makePlatformKeychain({
      platform: "darwin",
      account: "env",
      run: runWith({ exitCode: 0, stdout: `${Buffer.from(key).toString("base64")}\n` }),
      blob: emptyBlob,
    });
    assert.equal(found?.storage, "os-keychain");
    const read = yield* found!.read;
    assert.deepEqual(Array.from(Option.getOrThrow(read)), Array.from(key));

    const missing = CredentialVaultKey.makePlatformKeychain({
      platform: "darwin",
      account: "env",
      run: runWith({ exitCode: 44 }),
      blob: emptyBlob,
    });
    assert.isTrue(Option.isNone(yield* missing!.read));
  }),
);

it.effect("the Linux adapter passes the key on stdin and treats exit 1 as no key", () =>
  Effect.gen(function* () {
    const commands: Array<CredentialVaultKey.CredentialKeychainCommand> = [];
    const keychain = CredentialVaultKey.makePlatformKeychain({
      platform: "linux",
      account: "env",
      run: (input) => {
        commands.push(input);
        return Effect.succeed({ stdout: "", exitCode: input.args[0] === "lookup" ? 1 : 0 });
      },
      blob: emptyBlob,
    });
    assert.isTrue(Option.isNone(yield* keychain!.read));
    yield* keychain!.write(new Uint8Array(32).fill(3));
    assert.equal(commands[0]?.command, "secret-tool");
    assert.deepEqual(commands[0]?.args, [
      "lookup",
      "service",
      "t3code-credentials",
      "account",
      "env",
    ]);
    assert.equal(commands[1]?.args[0], "store");
    assert.equal(typeof commands[1]?.stdin, "string");
  }),
);

it.effect("the Windows adapter round-trips through DPAPI and the protected blob", () =>
  Effect.gen(function* () {
    const key = new Uint8Array(32).fill(9);
    let stored: Uint8Array | undefined;
    const blob: CredentialVaultKey.CredentialKeychainBlob = {
      read: Effect.sync(() => Option.fromUndefinedOr(stored)),
      write: (bytes) =>
        Effect.sync(() => {
          stored = bytes;
        }),
    };
    const commands: Array<CredentialVaultKey.CredentialKeychainCommand> = [];
    // Stands in for PowerShell: base64 in, the same base64 out, so the adapter's plumbing is what
    // the test checks.
    const keychain = CredentialVaultKey.makePlatformKeychain({
      platform: "win32",
      account: "env",
      run: (input) => {
        commands.push(input);
        return Effect.succeed({ stdout: input.stdin ?? "", exitCode: 0 });
      },
      blob,
    });
    yield* keychain!.write(key);
    assert.ok(stored !== undefined);
    assert.deepEqual(Array.from(stored), Array.from(key));
    const read = yield* keychain!.read;
    assert.deepEqual(Array.from(Option.getOrThrow(read)), Array.from(key));
    // Neither the key nor its protected blob may appear in argv.
    const keyText = Buffer.from(key).toString("base64");
    assert.isFalse(commands.some((command) => command.args.join(" ").includes(keyText)));
  }),
);
