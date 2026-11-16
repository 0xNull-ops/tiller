import {
  CREDENTIAL_OS_UNLOCK_REASON,
  type DesktopCredentialOsUnlockStatus,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import type { CredentialOsPresence } from "./CredentialOsPresence.ts";

/** One encrypted PIN per environment, so a remote environment never shares the local one. */
const StoredDocument = Schema.Struct({
  version: Schema.Literal(1),
  environments: Schema.Record(Schema.String, Schema.String),
});
type StoredDocument = typeof StoredDocument.Type;

const encodeStoredDocument = Schema.encodeEffect(Schema.fromJsonString(StoredDocument));
const decodeStoredDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredDocument));

export class CredentialOsUnlockError extends Schema.TaggedError<CredentialOsUnlockError>()(
  "CredentialOsUnlockError",
  {
    reason: Schema.Literals(["unavailable", "invalid-pin", "store-failed"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "unavailable":
        return "This system cannot confirm who you are for the credential vault.";
      case "invalid-pin":
        return "A PIN is required to enable system unlock.";
      case "store-failed":
        return "The desktop app could not save the PIN in the system keychain.";
    }
  }
}

export interface CredentialOsUnlockResult {
  readonly status: DesktopCredentialOsUnlockStatus;
  readonly pin: Option.Option<string>;
}

export class CredentialOsUnlock extends Context.Service<
  CredentialOsUnlock,
  {
    readonly status: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<DesktopCredentialOsUnlockStatus, CredentialOsUnlockError>;
    /** The renderer has already proved the PIN to the server; this only stores it. */
    readonly enable: (
      environmentId: EnvironmentId,
      pin: string,
    ) => Effect.Effect<DesktopCredentialOsUnlockStatus, CredentialOsUnlockError>;
    readonly disable: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<DesktopCredentialOsUnlockStatus, CredentialOsUnlockError>;
    /** Prompts the OS first, then releases the stored PIN. Never prompts twice. */
    readonly unlock: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<CredentialOsUnlockResult, CredentialOsUnlockError>;
  }
>()("@t3tools/desktop/credentials/CredentialOsUnlock") {}

const make = Effect.fn("CredentialOsUnlock.make")(function* (
  presence: CredentialOsPresence | null,
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const crypto = yield* SecureRandom.SecureRandom;
  const documentPath = path.join(environment.stateDir, "credential-os-unlock.json");

  const storeFailed = (cause: unknown) =>
    new CredentialOsUnlockError({ reason: "store-failed", cause });

  /** Electron's Linux fallback is plain text, so it is not a place for a PIN. */
  const storageSupported = Effect.gen(function* () {
    const encryptionAvailable = yield* safeStorage.isEncryptionAvailable.pipe(
      Effect.orElseSucceed(() => false),
    );
    if (!encryptionAvailable) return false;
    const backend = yield* safeStorage.selectedStorageBackend;
    return !(Option.isSome(backend) && backend.value === "basic_text");
  });

  const presenceAvailable =
    presence === null
      ? Effect.succeed(false)
      : Effect.promise(() => presence.isAvailable().catch(() => false));

  const readEnvironments = Effect.gen(function* () {
    const raw = yield* fileSystem.readFileString(documentPath).pipe(
      Effect.asSome,
      Effect.orElseSucceed(() => Option.none<string>()),
    );
    if (Option.isNone(raw)) return {} as Record<string, string>;
    return yield* decodeStoredDocument(raw.value).pipe(
      Effect.map((document) => document.environments),
      Effect.orElseSucceed(() => ({}) as Record<string, string>),
    );
  });

  const writeEnvironments = Effect.fn("CredentialOsUnlock.writeDocument")(function* (
    environments: Record<string, string>,
  ) {
    const encoded = yield* encodeStoredDocument({ version: 1, environments });
    const suffix = (yield* crypto.uuidV4()).replace(/-/g, "");
    const temporaryPath = `${documentPath}.${suffix}.tmp`;
    yield* fileSystem.makeDirectory(path.dirname(documentPath), { recursive: true });
    yield* fileSystem
      .writeFileString(temporaryPath, `${encoded}\n`)
      .pipe(Effect.andThen(fileSystem.chmod(temporaryPath, 0o600)));
    yield* fileSystem.rename(temporaryPath, documentPath);
    yield* fileSystem.chmod(documentPath, 0o600).pipe(Effect.ignore);
  });

  const readPin = Effect.fn("CredentialOsUnlock.readPin")(function* (environmentId: EnvironmentId) {
    const environments = yield* readEnvironments;
    const encoded = environments[environmentId];
    if (encoded === undefined) return Option.none<string>();
    const decoded = Base64.decode(encoded);
    if (Result.isFailure(decoded)) return Option.none<string>();
    return yield* safeStorage.decryptString(decoded.success).pipe(
      Effect.asSome,
      Effect.orElseSucceed(() => Option.none<string>()),
    );
  });

  const statusFor = Effect.fn("desktop.credentialOsUnlock.status")(function* (
    environmentId: EnvironmentId,
  ) {
    const supported = yield* storageSupported;
    const available = supported && (yield* presenceAvailable);
    const enabled = available && Option.isSome(yield* readPin(environmentId));
    return {
      available,
      enabled,
      ...(available && presence !== null ? { method: presence.method } : {}),
    };
  });

  const enable: CredentialOsUnlock["Service"]["enable"] = Effect.fn(
    "desktop.credentialOsUnlock.enable",
  )(function* (environmentId, pin) {
    if (pin === "") return yield* new CredentialOsUnlockError({ reason: "invalid-pin" });
    const supported = yield* storageSupported;
    if (!supported || !(yield* presenceAvailable)) {
      return yield* new CredentialOsUnlockError({ reason: "unavailable" });
    }
    yield* Effect.gen(function* () {
      const environments = yield* readEnvironments;
      const encrypted = yield* safeStorage.encryptString(pin);
      yield* writeEnvironments({
        ...environments,
        [environmentId]: Base64.encode(encrypted),
      });
    }).pipe(Effect.mapError(storeFailed));
    return yield* statusFor(environmentId);
  });

  const disable: CredentialOsUnlock["Service"]["disable"] = Effect.fn(
    "desktop.credentialOsUnlock.disable",
  )(function* (environmentId) {
    const environments = yield* readEnvironments;
    if (environments[environmentId] !== undefined) {
      const next = { ...environments };
      delete next[environmentId];
      yield* writeEnvironments(next).pipe(Effect.mapError(storeFailed));
    }
    return yield* statusFor(environmentId);
  });

  const unlock: CredentialOsUnlock["Service"]["unlock"] = Effect.fn(
    "desktop.credentialOsUnlock.unlock",
  )(function* (environmentId) {
    const status = yield* statusFor(environmentId);
    if (!status.enabled || presence === null) {
      return { status, pin: Option.none<string>() };
    }
    const confirmed = yield* Effect.promise(() =>
      presence.prompt(CREDENTIAL_OS_UNLOCK_REASON).catch(() => false),
    );
    if (!confirmed) return { status, pin: Option.none<string>() };
    return { status, pin: yield* readPin(environmentId) };
  });

  return CredentialOsUnlock.of({ status: statusFor, enable, disable, unlock });
});

export const layer = (presence: CredentialOsPresence | null) =>
  Layer.effect(CredentialOsUnlock, make(presence));
