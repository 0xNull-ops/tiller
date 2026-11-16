import { CredentialError, type CredentialKeyStorage } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProcessRunner from "../processRunner.ts";

/** The keychain entry both desktop and headless installs of this environment share. */
const CREDENTIAL_KEYCHAIN_SERVICE = "t3code-credentials";

const VAULT_KEY_BYTES = 32;

const FILE_KEY_NAME = "credential-vault-key";
/** Where Windows keeps the DPAPI-protected key. Only that platform reads it. */
const DPAPI_BLOB_NAME = "credential-vault-key-dpapi";

const KEYCHAIN_TIMEOUT = "5 seconds";

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, "base64"));

const vaultError = (cause: unknown) => new CredentialError({ reason: "vault-failed", cause });

/** Only the entries' count matters here, so each one stays undecoded. */
const CredentialDocumentIndex = Schema.Struct({ credentials: Schema.Array(Schema.Unknown) });
const decodeCredentialDocumentIndex = Schema.decodeUnknownOption(
  Schema.fromJsonString(CredentialDocumentIndex),
);

/** The key the vault settled on, and where it lives. */
interface ResolvedVaultKey {
  readonly key: Uint8Array;
  readonly storage: CredentialKeyStorage;
}

export interface CredentialKeychainCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin?: string;
}

export interface CredentialKeychainResult {
  readonly stdout: string;
  /** Null when the process ended without a code, which every adapter treats as a failure. */
  readonly exitCode: number | null;
}

/** Injected so the adapters can be exercised without touching a real keychain. */
export type CredentialKeychainRunner = (
  input: CredentialKeychainCommand,
) => Effect.Effect<CredentialKeychainResult, CredentialError>;

export interface CredentialKeychain {
  readonly storage: CredentialKeyStorage;
  /** None means the keychain works and holds no key yet; a failure means we cannot tell. */
  readonly read: Effect.Effect<Option.Option<Uint8Array>, CredentialError>;
  readonly write: (key: Uint8Array) => Effect.Effect<void, CredentialError>;
}

/** Windows protects the key with DPAPI and stores the protected blob next to the other secrets. */
export interface CredentialKeychainBlob {
  readonly read: Effect.Effect<Option.Option<Uint8Array>, CredentialError>;
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, CredentialError>;
}

/**
 * Runs a DPAPI transform on base64 bytes sent on stdin, so neither the key nor its protected blob
 * lands in argv. Windows PowerShell 5.1 does not load System.Security by default.
 */
const dpapi = (
  operation: "Protect" | "Unprotect",
  bytes: Uint8Array,
): CredentialKeychainCommand => ({
  command: "powershell",
  args: [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Add-Type -AssemblyName System.Security;" +
      "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
      `$p=[Security.Cryptography.ProtectedData]::${operation}($b,$null,'CurrentUser');` +
      "[Convert]::ToBase64String($p)",
  ],
  stdin: base64(bytes),
});

const makeMacKeychain = (account: string, run: CredentialKeychainRunner): CredentialKeychain => ({
  storage: "os-keychain",
  read: run({
    command: "security",
    args: ["find-generic-password", "-s", CREDENTIAL_KEYCHAIN_SERVICE, "-a", account, "-w"],
  }).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeedSome(fromBase64(result.stdout.trim()))
        : // errSecItemNotFound: the keychain answered, it just has no entry yet.
          result.exitCode === 44
          ? Effect.succeedNone
          : Effect.fail(vaultError(undefined)),
    ),
  ),
  // `security -i` reads its command from stdin, which keeps the key out of argv where any local
  // process could read it. It still exits with the inner command's status.
  write: (key) =>
    run({
      command: "security",
      args: ["-i"],
      stdin: `add-generic-password -U -s "${CREDENTIAL_KEYCHAIN_SERVICE}" -a "${account}" -w "${base64(key)}"\n`,
    }).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0 ? Effect.void : Effect.fail(vaultError(undefined)),
      ),
    ),
});

const makeLinuxKeychain = (account: string, run: CredentialKeychainRunner): CredentialKeychain => ({
  storage: "os-keychain",
  read: run({
    command: "secret-tool",
    args: ["lookup", "service", CREDENTIAL_KEYCHAIN_SERVICE, "account", account],
  }).pipe(
    Effect.flatMap((result) => {
      if (result.exitCode === 0) {
        const value = result.stdout.trim();
        return value === "" ? Effect.succeedNone : Effect.succeedSome(fromBase64(value));
      }
      // secret-tool exits 1 when nothing matches, and 127 (through a shell) when it is absent.
      return result.exitCode === 1 ? Effect.succeedNone : Effect.fail(vaultError(undefined));
    }),
  ),
  write: (key) =>
    run({
      command: "secret-tool",
      args: [
        "store",
        `--label=${CREDENTIAL_KEYCHAIN_SERVICE}`,
        "service",
        CREDENTIAL_KEYCHAIN_SERVICE,
        "account",
        account,
      ],
      stdin: base64(key),
    }).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0 ? Effect.void : Effect.fail(vaultError(undefined)),
      ),
    ),
});

const makeWindowsKeychain = (
  blob: CredentialKeychainBlob,
  run: CredentialKeychainRunner,
): CredentialKeychain => ({
  storage: "os-keychain",
  read: blob.read.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (protectedBlob) =>
          run(dpapi("Unprotect", protectedBlob)).pipe(
            Effect.flatMap((result) =>
              result.exitCode === 0
                ? Effect.succeedSome(fromBase64(result.stdout.trim()))
                : Effect.fail(vaultError(undefined)),
            ),
          ),
      }),
    ),
  ),
  write: (key) =>
    run(dpapi("Protect", key)).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? blob.write(fromBase64(result.stdout.trim()))
          : Effect.fail(vaultError(undefined)),
      ),
    ),
});

/**
 * The platform's keychain, or null when this platform has none we can drive. Linux without
 * libsecret reports failure rather than null: a missing `secret-tool` must not silently move a
 * key that already lives in the keyring. `resolve` lets a vault with no credentials past that
 * failure, since there is no sealed value to strand.
 */
export const makePlatformKeychain = (input: {
  readonly platform: NodeJS.Platform;
  readonly account: string;
  readonly run: CredentialKeychainRunner;
  readonly blob: CredentialKeychainBlob;
}): CredentialKeychain | null => {
  switch (input.platform) {
    case "darwin":
      return makeMacKeychain(input.account, input.run);
    case "linux":
      return makeLinuxKeychain(input.account, input.run);
    case "win32":
      return makeWindowsKeychain(input.blob, input.run);
    default:
      return null;
  }
};

export class CredentialVaultKey extends Context.Service<
  CredentialVaultKey,
  {
    /** Where the key actually lives, which the UI has to say out loud when it is a file. */
    readonly keyStorage: Effect.Effect<CredentialKeyStorage, CredentialError>;
    readonly vaultKey: Effect.Effect<Uint8Array, CredentialError>;
  }
>()("t3/credentials/CredentialVaultKey") {}

const make = Effect.gen(function* () {
  const store = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const crypto = yield* SecureRandom.SecureRandom;
  const platform = yield* HostProcess.Platform;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const run: CredentialKeychainRunner = (input) =>
    processRunner
      .run({
        command: input.command,
        args: input.args,
        timeout: KEYCHAIN_TIMEOUT,
        ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
      })
      .pipe(
        Effect.map((output) => ({
          stdout: output.stdout,
          exitCode: typeof output.code === "number" ? output.code : null,
        })),
        Effect.mapError((cause) => vaultError(cause)),
      );

  const blob: CredentialKeychainBlob = {
    read: store.get(DPAPI_BLOB_NAME).pipe(
      Effect.map((value) => Option.map(value, (bytes) => Uint8Array.from(bytes))),
      Effect.mapError((cause) => vaultError(cause)),
    ),
    write: (bytes) =>
      store.set(DPAPI_BLOB_NAME, bytes).pipe(Effect.mapError((cause) => vaultError(cause))),
  };

  const keychain = environment.getEnvironmentId.pipe(
    Effect.map((account) => makePlatformKeychain({ platform, account, run, blob })),
  );

  const readFileKey = store.get(FILE_KEY_NAME).pipe(
    Effect.map(Option.map((bytes) => Uint8Array.from(bytes))),
    Effect.mapError((cause) => vaultError(cause)),
  );

  const fileKey = store.getOrCreateRandom(FILE_KEY_NAME, VAULT_KEY_BYTES).pipe(
    Effect.map((bytes) => Uint8Array.from(bytes)),
    Effect.mapError((cause) => vaultError(cause)),
  );

  const randomKey = crypto.randomBytes(VAULT_KEY_BYTES).pipe(
    Effect.map((bytes) => Uint8Array.from(bytes)),
    Effect.mapError((cause) => vaultError(cause)),
  );

  /**
   * Whether any credential is recorded. Read from the document itself because CredentialStore
   * depends on this service. An unreadable document counts as data, so it never allows a switch.
   */
  const vaultHasCredentials = fileSystem
    .readFileString(path.join(config.stateDir, "credentials", "credentials.json"))
    .pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
      Effect.mapError(vaultError),
      Effect.map((text) => {
        if (text === null) return false;
        return Option.match(decodeCredentialDocumentIndex(text), {
          onNone: () => true,
          onSome: (index) => index.credentials.length > 0,
        });
      }),
    );

  /**
   * The same probe, but it never fails: a document we cannot read is a document we cannot rule
   * out, and "cannot rule out" must never license a key swap.
   */
  const vaultMayHoldCredentials = Effect.orElseSucceed(vaultHasCredentials, () => true);

  const keepOnDisk = (key: Uint8Array) =>
    store.set(FILE_KEY_NAME, key).pipe(
      Effect.mapError((cause) => vaultError(cause)),
      Effect.map(() => ({ key, storage: "file" as const })),
    );

  /**
   * A vault that already holds credentials keeps the key that sealed them. A replacement key
   * opens none of those secrets, so a key we cannot read is an error, never a reason to mint one.
   */
  const refuseKeySwap = Effect.fail(
    vaultError(
      new Error(
        "The credential vault already holds credentials, but its key could not be retrieved.",
      ),
    ),
  );

  const resolve = Effect.gen(function* () {
    const resolvedKeychain = yield* keychain;
    // A key already on disk stays authoritative: consulting the keychain first could hand back a
    // different key and orphan every value this install can still decrypt.
    const existing = yield* readFileKey;
    if (Option.isSome(existing)) return { key: existing.value, storage: "file" as const };
    if (resolvedKeychain === null) {
      // Without a keychain the only key this install can have is the one it writes now, which is
      // safe only while the vault holds nothing.
      if (yield* vaultMayHoldCredentials) return yield* refuseKeySwap;
      return { key: yield* fileKey, storage: "file" as const };
    }
    const stored = yield* Effect.result(resolvedKeychain.read);
    if (Result.isFailure(stored)) {
      if (yield* vaultMayHoldCredentials) return yield* stored.failure;
      yield* Effect.logWarning(
        "No usable OS keychain for the credential vault key; keeping it on disk.",
        { platform, errorTag: stored.failure._tag },
      );
      return yield* keepOnDisk(yield* randomKey);
    }
    if (Option.isSome(stored.success)) {
      return { key: stored.success.value, storage: "os-keychain" as const };
    }
    // The keychain answered that it holds no key. That is the normal first run of an empty
    // vault, but for a vault with credentials it means the key is out of reach, and a new one
    // would strand every secret sealed with the old.
    if (yield* vaultMayHoldCredentials) return yield* refuseKeySwap;
    const generated = yield* randomKey;
    const written = yield* Effect.result(resolvedKeychain.write(generated));
    if (Result.isSuccess(written)) return { key: generated, storage: "os-keychain" as const };
    yield* Effect.logWarning(
      "Could not store the credential vault key in the OS keychain; keeping it on disk.",
      { platform, errorTag: written.failure._tag },
    );
    return yield* keepOnDisk(generated);
  }).pipe(
    Effect.tap((resolved) =>
      Effect.annotateCurrentSpan({ "credential.key_storage": resolved.storage }),
    ),
    Effect.withSpan("CredentialVaultKey.resolve"),
  );

  /**
   * Only a successful resolution is remembered. A keychain that was locked for a moment, right
   * after a login, must not leave the vault broken until the server restarts, so a failure is
   * tried again on the next access.
   */
  const resolvedKey = yield* Ref.make(Option.none<ResolvedVaultKey>());
  // Two callers that arrive together must not mint two keys, so the resolution runs under a
  // permit and the second one finds the key the first one resolved.
  const resolvePermit = yield* Semaphore.make(1);

  const resolveKey = Effect.gen(function* () {
    const remembered = yield* Ref.get(resolvedKey);
    if (Option.isSome(remembered)) return remembered.value;
    return yield* resolvePermit.withPermits(1)(
      Effect.gen(function* () {
        // The holder of the permit may have resolved the key while this caller waited.
        const current = yield* Ref.get(resolvedKey);
        if (Option.isSome(current)) return current.value;
        const resolved = yield* resolve;
        yield* Ref.set(resolvedKey, Option.some(resolved));
        return resolved;
      }),
    );
  });

  return CredentialVaultKey.of({
    keyStorage: Effect.map(resolveKey, (resolved) => resolved.storage),
    vaultKey: Effect.map(resolveKey, (resolved) => resolved.key),
  });
});

export const layer = Layer.effect(CredentialVaultKey, make);
