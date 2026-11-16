import {
  CREDENTIAL_EXPIRY_WARNING_DAYS,
  CredentialError,
  CredentialId,
  CredentialMetadata,
  CredentialPolicy,
  DEFAULT_CREDENTIAL_POLICY,
  credentialEnvVarProblem,
  type Credential,
  type CredentialCreateInput,
  type CredentialField,
  type CredentialFieldDefinitionInput,
  type CredentialFieldKind,
  type CredentialSecretInput,
  type CredentialSetSecretInput,
  type CredentialStatus,
  type CredentialUpdateInput,
  type CredentialRemoveSecretInput,
} from "@t3tools/contracts";
import {
  DEFAULT_CREDENTIAL_FILE_MAX_BYTES,
  MAX_CREDENTIAL_FIELDS,
  credentialFileExtension,
  credentialTemplate,
  type CredentialTemplate,
  type CredentialTemplateField,
} from "@t3tools/shared/credentialTemplates";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Base64 from "effect/encoding/Base64";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { decryptCredentialValue, encryptCredentialValue } from "./CredentialCrypto.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const CredentialPinRecord = Schema.Struct({
  /** base64 of the per-PIN random salt. */
  salt: Schema.String,
  /** base64 of the scrypt output. */
  hash: Schema.String,
  n: Schema.Int,
  r: Schema.Int,
  p: Schema.Int,
  updatedAt: Schema.String,
});
export type CredentialPinRecord = typeof CredentialPinRecord.Type;

/** Five wrong PINs start a lockout that doubles for each further failure. */
export const CREDENTIAL_LOCKOUT_AFTER_FAILURES = 5;
export const CREDENTIAL_LOCKOUT_BASE_MS = 30 * 1000;

export const CredentialLockout = Schema.Struct({
  failures: Schema.Int,
  lockedUntil: Schema.optionalKey(Schema.String),
});
export type CredentialLockout = typeof CredentialLockout.Type;

const CredentialVaultDocument = Schema.Struct({
  version: Schema.Literal(1),
  credentials: Schema.Array(CredentialMetadata),
  pin: Schema.optionalKey(Schema.NullOr(CredentialPinRecord)),
  lockout: Schema.optionalKey(CredentialLockout),
});
type CredentialVaultDocument = typeof CredentialVaultDocument.Type;

const emptyDocument: CredentialVaultDocument = { version: 1, credentials: [] };
const emptyLockout: CredentialLockout = { failures: 0 };

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(CredentialVaultDocument));
const encodeDocument = Schema.encodeEffect(fromJsonStringPretty(CredentialVaultDocument));

const storeError = (cause: unknown) => new CredentialError({ reason: "store-failed", cause });

const policyEquals = Schema.toEquivalence(CredentialPolicy);

const secretStoreName = (credentialId: string, fieldId: string) =>
  `credential-${credentialId}-${fieldId}`;

const isText = (field: CredentialField) => field.kind === "text";

/** Whether a field holds anything today, which decides if its kind may still change. */
const hasValue = (field: CredentialField): boolean =>
  isText(field) ? (field.value ?? "").trim() !== "" : field.secret?.set === true;

/** The writable shape of a field, untied to the metadata's stored-value constraints. */
interface FieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: CredentialFieldKind;
  readonly envVar: string;
  readonly required: boolean;
  readonly highRisk: boolean;
  readonly extensions?: readonly string[];
  readonly maxBytes?: number;
}

const definitionOf = (field: CredentialField): FieldDefinition => ({
  id: field.id,
  label: field.label,
  kind: field.kind,
  envVar: field.envVar,
  required: field.required,
  highRisk: field.highRisk,
  ...(field.extensions === undefined ? {} : { extensions: field.extensions }),
  ...(field.maxBytes === undefined ? {} : { maxBytes: field.maxBytes }),
});

const definitionOfTemplate = (field: CredentialTemplateField): FieldDefinition => ({
  id: field.id,
  label: field.label,
  kind: field.kind,
  envVar: field.envVar,
  required: field.required ?? false,
  highRisk: field.highRisk ?? false,
  ...(field.extensions === undefined ? {} : { extensions: field.extensions }),
  ...(field.maxBytes === undefined ? {} : { maxBytes: field.maxBytes }),
});

const definitionOfInput = (field: CredentialFieldDefinitionInput): FieldDefinition => ({
  id: field.id,
  label: field.label,
  kind: field.kind,
  envVar: field.envVar,
  required: field.required ?? false,
  highRisk: field.highRisk ?? false,
  ...(field.extensions === undefined ? {} : { extensions: field.extensions }),
  ...(field.maxBytes === undefined ? {} : { maxBytes: field.maxBytes }),
});

/** A field that has never held a value, which is what adding a field or changing its kind gives. */
const emptyField = (definition: FieldDefinition): CredentialField => {
  const base = {
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    envVar: definition.envVar,
    required: definition.required,
    highRisk: definition.highRisk,
  };
  switch (definition.kind) {
    case "text":
      return { ...base, kind: "text", value: "" };
    case "secretFile":
      return {
        ...base,
        kind: "secretFile",
        secret: { set: false },
        ...(definition.extensions === undefined ? {} : { extensions: definition.extensions }),
        ...(definition.maxBytes === undefined ? {} : { maxBytes: definition.maxBytes }),
      };
    default:
      return { ...base, kind: definition.kind, secret: { set: false } };
  }
};

/**
 * Every write runs through here: the name becomes an environment variable of a command T3 runs,
 * so a duplicate or a shell-reserved name is a safety problem, not a preference.
 */
const validateFieldSet = (
  definitions: ReadonlyArray<FieldDefinition>,
): Effect.Effect<ReadonlyArray<FieldDefinition>, CredentialError> => {
  if (definitions.length === 0) {
    return Effect.fail(new CredentialError({ reason: "missing-field" }));
  }
  if (definitions.length > MAX_CREDENTIAL_FIELDS) {
    return Effect.fail(new CredentialError({ reason: "too-many-fields" }));
  }
  const ids = new Set<string>();
  const envVars = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      return Effect.fail(new CredentialError({ reason: "invalid-field", fieldId: definition.id }));
    }
    if (credentialEnvVarProblem(definition.envVar) !== null) {
      return Effect.fail(
        new CredentialError({ reason: "invalid-env-var", fieldId: definition.id }),
      );
    }
    if (envVars.has(definition.envVar)) {
      return Effect.fail(
        new CredentialError({ reason: "duplicate-env-var", fieldId: definition.id }),
      );
    }
    ids.add(definition.id);
    envVars.add(definition.envVar);
  }
  return Effect.succeed(definitions);
};

/** Replaces an optional key, dropping it when the new value is undefined. */
const withOptional = <A extends object, K extends keyof A>(
  base: A,
  key: K,
  value: A[K] | undefined,
): A => {
  const next = { ...base };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
};

/**
 * Status is derived, never stored: a credential saved months ago reports today's status
 * without a write, and an expiry needs no background job.
 */
const deriveCredentialStatus = (record: CredentialMetadata, nowMs: number): CredentialStatus => {
  const expiresAt = record.expiresAt === undefined ? Number.NaN : Date.parse(record.expiresAt);
  const hasExpiry = Number.isFinite(expiresAt);
  if (hasExpiry && expiresAt <= nowMs) return "expired";
  const missing = record.fields.some((field) =>
    field.kind === "text"
      ? field.required && (field.value ?? "").trim() === ""
      : field.required && field.secret?.set !== true,
  );
  // An unusable credential outranks the advisory expiry warning, which would otherwise hide it.
  if (missing) return "missing-field";
  if (hasExpiry && expiresAt - nowMs <= CREDENTIAL_EXPIRY_WARNING_DAYS * DAY_MS) return "expiring";
  return "ready";
};

const toCredential = (record: CredentialMetadata, nowMs: number): Credential => ({
  ...record,
  status: deriveCredentialStatus(record, nowMs),
});

interface DecodedSecret {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly size?: number;
}

export class CredentialStore extends Context.Service<
  CredentialStore,
  {
    readonly revision: Effect.Effect<number>;
    /**
     * Emits the new revision after every write that changes what the vault offers: a credential
     * added, edited, deleted, or a value replaced. Workflow readiness listens, so a card that said
     * "Missing" turns "Ready" without waiting for the user to check it again.
     */
    readonly changes: Stream.Stream<number>;
    readonly markUsed: (id: CredentialId) => Effect.Effect<void, CredentialError>;
    readonly list: () => Effect.Effect<ReadonlyArray<Credential>, CredentialError>;
    readonly get: (id: CredentialId) => Effect.Effect<Credential, CredentialError>;
    readonly create: (input: CredentialCreateInput) => Effect.Effect<Credential, CredentialError>;
    readonly update: (input: CredentialUpdateInput) => Effect.Effect<Credential, CredentialError>;
    readonly setSecret: (
      input: CredentialSetSecretInput,
    ) => Effect.Effect<Credential, CredentialError>;
    readonly removeSecret: (
      input: CredentialRemoveSecretInput,
    ) => Effect.Effect<Credential, CredentialError>;
    readonly delete: (id: CredentialId) => Effect.Effect<void, CredentialError>;
    /**
     * The only way a value leaves the vault. 6B's exec, file and reveal paths call it; no RPC
     * response may ever include what it returns.
     */
    readonly readSecretValue: (input: {
      readonly id: CredentialId;
      readonly fieldId: string;
    }) => Effect.Effect<Uint8Array, CredentialError>;
    readonly pinRecord: Effect.Effect<Option.Option<CredentialPinRecord>, CredentialError>;
    readonly setPinRecord: (
      record: Option.Option<CredentialPinRecord>,
    ) => Effect.Effect<void, CredentialError>;
    readonly lockout: Effect.Effect<CredentialLockout, CredentialError>;
    readonly setLockout: (lockout: CredentialLockout) => Effect.Effect<void, CredentialError>;
  }
>()("t3/credentials/CredentialStore") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const store = yield* ServerSecretStore.ServerSecretStore;
  const vaultKey = yield* CredentialVaultKey.CredentialVaultKey;
  const history = yield* CredentialHistory.CredentialHistory;
  const crypto = yield* SecureRandom.SecureRandom;
  let revision = 0;
  const changeHub = yield* PubSub.unbounded<number>();
  const writeLock = yield* Semaphore.make(1);

  const directory = path.join(config.stateDir, "credentials");
  const documentPath = path.join(directory, "credentials.json");

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const nowMs = Effect.map(DateTime.now, DateTime.toEpochMillis);
  // `writeFileStringAtomically` reads the filesystem from context, so the vault supplies it once
  // here instead of every method carrying the requirement.
  const fileIo = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  const readDocument: Effect.Effect<CredentialVaultDocument, CredentialError> = Effect.gen(
    function* () {
      const text = yield* fileSystem.readFileString(documentPath).pipe(
        Effect.catchIf(
          (cause) => cause.reason._tag === "NotFound",
          () => Effect.succeed(null),
        ),
        Effect.mapError(storeError),
      );
      if (text === null) return emptyDocument;
      const decoded = decodeDocument(text);
      if (Option.isNone(decoded)) {
        return yield* new CredentialError({
          reason: "store-failed",
          cause: new Error(`${documentPath} is not a valid credential vault file.`),
        });
      }
      return decoded.value;
    },
  );

  const writeDocument = Effect.fn("CredentialStore.writeDocument")(function* (
    document: CredentialVaultDocument,
  ) {
    yield* fileSystem
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(storeError));
    yield* fileSystem.chmod(directory, 0o700).pipe(Effect.mapError(storeError));
    const contents = yield* encodeDocument(document).pipe(
      Effect.mapError((cause) => new CredentialError({ reason: "store-failed", cause })),
    );
    yield* writeFileStringAtomically({ filePath: documentPath, contents }).pipe(
      Effect.mapError(storeError),
      Effect.provide(fileIo),
    );
    yield* fileSystem.chmod(documentPath, 0o600).pipe(Effect.mapError(storeError));
  });

  const mutate = <A>(
    operation: (
      document: CredentialVaultDocument,
    ) => Effect.Effect<
      { readonly document: CredentialVaultDocument; readonly result: A },
      CredentialError
    >,
    notify = true,
  ) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const document = yield* readDocument;
        const next = yield* operation(document);
        yield* writeDocument(next.document);
        // A use count or a lockout timer changes nothing readiness could report, so it neither
        // invalidates the compiled redaction values nor wakes the canvases.
        if (notify) {
          revision += 1;
          yield* PubSub.publish(changeHub, revision);
        }
        return next.result;
      }),
    );

  const encrypt = (credentialId: string, fieldId: string, plaintext: Uint8Array) =>
    vaultKey.vaultKey.pipe(
      Effect.flatMap((key) =>
        Effect.try({
          try: () => encryptCredentialValue({ key, credentialId, fieldId, plaintext }),
          catch: storeError,
        }),
      ),
    );

  const writeSecret = Effect.fn("CredentialStore.writeSecret")(function* (
    credentialId: string,
    fieldId: string,
    plaintext: Uint8Array,
  ) {
    const envelope = yield* encrypt(credentialId, fieldId, plaintext);
    yield* store
      .set(secretStoreName(credentialId, fieldId), envelope)
      .pipe(Effect.mapError(storeError));
  });

  const removeSecretValue = (credentialId: string, fieldId: string) =>
    store.remove(secretStoreName(credentialId, fieldId)).pipe(Effect.mapError(storeError));

  const definitionsFor = (
    template: CredentialTemplate,
    input: CredentialCreateInput,
  ): Effect.Effect<ReadonlyArray<FieldDefinition>, CredentialError> => {
    const supplied = input.fields ?? [];
    const templateFields = template.fields.map(definitionOfTemplate);
    if (template.dynamic !== true) {
      // A built-in template's fields are fixed; the only thing a create may change is how each one
      // is labelled and which environment variable carries it.
      const byId = new Map(templateFields.map((field) => [field.id, field] as const));
      const overrides = new Map<string, CredentialFieldDefinitionInput>();
      for (const field of supplied) {
        const base = byId.get(field.id);
        if (base === undefined) {
          return Effect.fail(new CredentialError({ reason: "unknown-field", fieldId: field.id }));
        }
        if (base.kind !== field.kind) {
          return Effect.fail(new CredentialError({ reason: "invalid-field", fieldId: field.id }));
        }
        overrides.set(field.id, field);
      }
      return validateFieldSet(
        templateFields.map((field) => {
          const override = overrides.get(field.id);
          return override === undefined
            ? field
            : { ...field, label: override.label, envVar: override.envVar };
        }),
      );
    }
    if (supplied.length === 0) {
      return Effect.fail(new CredentialError({ reason: "missing-field" }));
    }
    return validateFieldSet(supplied.map(definitionOfInput));
  };

  const decodeBase64 = (text: string, fieldId: string) =>
    Effect.fromResult(Base64.decode(text)).pipe(
      Effect.mapError(() => new CredentialError({ reason: "invalid-value", fieldId })),
    );

  const decodeSecret = (
    definition: FieldDefinition,
    input: CredentialSecretInput,
  ): Effect.Effect<DecodedSecret, CredentialError> => {
    const fieldId = definition.id;
    if (definition.kind !== "secretFile") {
      if (input.base64 !== undefined) {
        return Effect.fail(new CredentialError({ reason: "invalid-value", fieldId }));
      }
      if (input.value === undefined) {
        return Effect.fail(new CredentialError({ reason: "invalid-value", fieldId }));
      }
      return Effect.succeed({ bytes: new TextEncoder().encode(input.value) });
    }
    if (input.value !== undefined) {
      return Effect.fail(new CredentialError({ reason: "invalid-value", fieldId }));
    }
    if (input.base64 === undefined) {
      return Effect.fail(new CredentialError({ reason: "invalid-value", fieldId }));
    }
    const fileName = input.fileName ?? `${fieldId}.bin`;
    const bytes = decodeBase64(input.base64, fieldId);
    return bytes.pipe(
      Effect.flatMap((decoded) => {
        const maxBytes = definition.maxBytes ?? DEFAULT_CREDENTIAL_FILE_MAX_BYTES;
        if (decoded.byteLength > maxBytes) {
          return Effect.fail(new CredentialError({ reason: "file-too-large", fieldId }));
        }
        const extensions = definition.extensions;
        if (
          extensions !== undefined &&
          extensions.length > 0 &&
          !extensions.includes(credentialFileExtension(fileName))
        ) {
          return Effect.fail(new CredentialError({ reason: "file-type-not-allowed", fieldId }));
        }
        return Effect.succeed({
          bytes: decoded,
          fileName,
          size: decoded.byteLength,
        });
      }),
    );
  };

  const secretField = (
    definition: FieldDefinition,
    secret: DecodedSecret,
    updatedAt: string,
  ): CredentialField => ({
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    envVar: definition.envVar,
    required: definition.required,
    highRisk: definition.highRisk,
    secret: {
      set: true,
      updatedAt,
      ...(secret.fileName === undefined ? {} : { fileName: secret.fileName }),
      ...(secret.size === undefined ? {} : { size: secret.size }),
    },
    ...(definition.extensions === undefined ? {} : { extensions: definition.extensions }),
    ...(definition.maxBytes === undefined ? {} : { maxBytes: definition.maxBytes }),
  });

  const list: CredentialStore["Service"]["list"] = Effect.fn("CredentialStore.list")(function* () {
    const [document, at] = yield* Effect.all([readDocument, nowMs]);
    return document.credentials.map((record) => toCredential(record, at));
  });

  const get: CredentialStore["Service"]["get"] = Effect.fn("CredentialStore.get")(function* (id) {
    const [document, at] = yield* Effect.all([readDocument, nowMs]);
    const record = document.credentials.find((candidate) => candidate.id === id);
    if (record === undefined) return yield* new CredentialError({ reason: "not-found" });
    return toCredential(record, at);
  });

  const create: CredentialStore["Service"]["create"] = Effect.fn("CredentialStore.create")(
    function* (input) {
      const template = credentialTemplate(input.templateId);
      if (template === undefined) {
        return yield* new CredentialError({ reason: "unknown-template" });
      }
      const definitions = yield* definitionsFor(template, input);
      const plainFields = input.plainFields ?? {};
      const secrets = new Map(
        (input.secrets ?? []).map((secret) => [secret.fieldId, secret] as const),
      );
      const known = new Set(definitions.map((definition) => definition.id));
      for (const fieldId of Object.keys(plainFields)) {
        if (!known.has(fieldId)) {
          return yield* new CredentialError({ reason: "unknown-field", fieldId });
        }
      }
      for (const fieldId of secrets.keys()) {
        if (!known.has(fieldId)) {
          return yield* new CredentialError({ reason: "unknown-field", fieldId });
        }
      }

      const id = yield* crypto.uuidV4().pipe(
        Effect.mapError(storeError),
        Effect.map((uuid) => CredentialId.make(`cred-${uuid}`)),
      );
      const updatedAt = yield* nowIso;

      const fields: CredentialField[] = [];
      const written: Array<{ readonly fieldId: string }> = [];
      for (const definition of definitions) {
        if (definition.kind === "text") {
          if (secrets.has(definition.id)) {
            return yield* new CredentialError({
              reason: "field-not-secret",
              fieldId: definition.id,
            });
          }
          const value = plainFields[definition.id] ?? "";
          if (definition.required && value.trim() === "") {
            return yield* new CredentialError({
              reason: "missing-field",
              fieldId: definition.id,
            });
          }
          fields.push({
            id: definition.id,
            label: definition.label,
            kind: "text",
            envVar: definition.envVar,
            required: definition.required,
            highRisk: definition.highRisk,
            value,
          });
          continue;
        }
        if (plainFields[definition.id] !== undefined) {
          return yield* new CredentialError({
            reason: "field-not-text",
            fieldId: definition.id,
          });
        }
        const provided = secrets.get(definition.id);
        if (provided === undefined) {
          if (definition.required) {
            return yield* new CredentialError({
              reason: "missing-field",
              fieldId: definition.id,
            });
          }
          fields.push({
            id: definition.id,
            label: definition.label,
            kind: definition.kind,
            envVar: definition.envVar,
            required: false,
            highRisk: definition.highRisk,
            secret: { set: false },
            ...(definition.extensions === undefined ? {} : { extensions: definition.extensions }),
            ...(definition.maxBytes === undefined ? {} : { maxBytes: definition.maxBytes }),
          });
          continue;
        }
        const decoded = yield* decodeSecret(definition, provided);
        yield* writeSecret(id, definition.id, decoded.bytes);
        written.push({ fieldId: definition.id });
        fields.push(secretField(definition, decoded, updatedAt));
      }

      const record: CredentialMetadata = {
        id,
        name: input.name,
        templateId: input.templateId,
        fields,
        policy: input.policy ?? DEFAULT_CREDENTIAL_POLICY,
        createdAt: updatedAt,
        updatedAt,
        useCount: 0,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      };

      const saved = yield* Effect.result(
        mutate((document) =>
          Effect.succeed({
            document: { ...document, credentials: [...document.credentials, record] },
            result: record,
          }),
        ),
      );
      if (Result.isFailure(saved)) {
        yield* Effect.forEach(written, (entry) => removeSecretValue(id, entry.fieldId), {
          discard: true,
        });
        return yield* saved.failure;
      }
      yield* history.record({
        type: "created",
        credentialId: id,
        credentialName: saved.success.name,
      });
      return toCredential(saved.success, yield* nowMs);
    },
  );

  const applyPlainFields = (
    fields: ReadonlyArray<CredentialField>,
    plainFields: Readonly<Record<string, string>>,
  ): Effect.Effect<ReadonlyArray<CredentialField>, CredentialError> => {
    for (const fieldId of Object.keys(plainFields)) {
      const field = fields.find((candidate) => candidate.id === fieldId);
      if (field === undefined) {
        return Effect.fail(new CredentialError({ reason: "unknown-field", fieldId }));
      }
      if (!isText(field)) {
        return Effect.fail(new CredentialError({ reason: "field-not-text", fieldId }));
      }
    }
    return Effect.succeed(
      fields.map((field) => {
        const value = plainFields[field.id];
        return isText(field) && value !== undefined ? { ...field, value } : field;
      }),
    );
  };

  interface FieldMerge {
    readonly fields: ReadonlyArray<CredentialField>;
    readonly removed: ReadonlyArray<CredentialField>;
    readonly changedIds: ReadonlyArray<string>;
  }

  /**
   * `definitions` is the whole field list the credential should end up with, so an id that is
   * absent means removal. A built-in template keeps its own field set: only the label and the
   * environment variable name are the user's to change there.
   */
  const mergeFieldDefinitions = (
    record: CredentialMetadata,
    definitions: ReadonlyArray<FieldDefinition>,
  ): Effect.Effect<FieldMerge, CredentialError> => {
    const template = credentialTemplate(record.templateId);
    const fixed = template !== undefined && template.dynamic !== true;
    const existing = new Map(record.fields.map((field) => [field.id, field] as const));
    const nextIds = new Set(definitions.map((definition) => definition.id));
    if (fixed) {
      for (const definition of definitions) {
        const templateField = template.fields.find((field) => field.id === definition.id);
        if (templateField === undefined) {
          return Effect.fail(
            new CredentialError({ reason: "unknown-field", fieldId: definition.id }),
          );
        }
        if (templateField.kind !== definition.kind) {
          return Effect.fail(
            new CredentialError({ reason: "invalid-field", fieldId: definition.id }),
          );
        }
      }
      for (const templateField of template.fields) {
        if (!nextIds.has(templateField.id)) {
          return Effect.fail(
            new CredentialError({ reason: "invalid-field", fieldId: templateField.id }),
          );
        }
      }
    }
    const fields: CredentialField[] = [];
    const changedIds: string[] = [];
    for (const definition of definitions) {
      const current = existing.get(definition.id);
      if (current === undefined) {
        fields.push(emptyField(definition));
        changedIds.push(definition.id);
        continue;
      }
      if (current.kind !== definition.kind) {
        if (hasValue(current)) {
          return Effect.fail(
            new CredentialError({ reason: "field-has-value", fieldId: definition.id }),
          );
        }
        // The old kind's payload cannot survive the change, so the field starts empty. A field
        // with a value never gets here, so no stored secret is thrown away silently.
        fields.push(emptyField(definition));
        changedIds.push(definition.id);
        continue;
      }
      const next: CredentialField = {
        ...current,
        label: definition.label,
        envVar: definition.envVar,
        required: fixed ? current.required : definition.required,
        ...(current.kind === "secretFile" && definition.extensions !== undefined
          ? { extensions: definition.extensions }
          : {}),
      };
      fields.push(next);
      if (
        current.label !== next.label ||
        current.envVar !== next.envVar ||
        current.required !== next.required ||
        current.extensions !== next.extensions
      ) {
        changedIds.push(definition.id);
      }
    }
    const removed = record.fields.filter((field) => !nextIds.has(field.id));
    return Effect.succeed({ fields, removed, changedIds });
  };

  const update: CredentialStore["Service"]["update"] = Effect.fn("CredentialStore.update")(
    function* (input) {
      const updatedAt = yield* nowIso;
      const result = yield* mutate((document) => {
        const index = document.credentials.findIndex((candidate) => candidate.id === input.id);
        if (index < 0) return Effect.fail(new CredentialError({ reason: "not-found" }));
        const record = document.credentials[index]!;
        const merged: Effect.Effect<FieldMerge | null, CredentialError> =
          input.fields === undefined
            ? Effect.succeed(null)
            : validateFieldSet(input.fields.map(definitionOfInput)).pipe(
                Effect.flatMap((definitions) => mergeFieldDefinitions(record, definitions)),
              );
        return merged.pipe(
          Effect.flatMap((merge) =>
            applyPlainFields(
              merge === null ? record.fields : merge.fields,
              input.plainFields ?? {},
            ).pipe(
              Effect.map((fields) => {
                let next: CredentialMetadata = {
                  ...record,
                  fields,
                  updatedAt,
                  name: input.name ?? record.name,
                  policy: input.policy ?? record.policy,
                };
                next = withOptional(
                  next,
                  "notes",
                  input.notes === undefined ? record.notes : (input.notes ?? undefined),
                );
                next = withOptional(
                  next,
                  "tags",
                  input.tags === undefined ? record.tags : (input.tags ?? undefined),
                );
                next = withOptional(
                  next,
                  "expiresAt",
                  input.expiresAt === undefined ? record.expiresAt : (input.expiresAt ?? undefined),
                );
                next = withOptional(
                  next,
                  "icon",
                  input.icon === undefined ? record.icon : (input.icon ?? undefined),
                );
                const credentials = [...document.credentials];
                credentials[index] = next;
                return {
                  document: { ...document, credentials },
                  result: {
                    previous: record,
                    next,
                    removed: merge?.removed ?? [],
                    changedFieldIds: merge?.changedIds ?? [],
                  },
                };
              }),
            ),
          ),
        );
      });
      const { previous, next, removed, changedFieldIds } = result;
      // The document no longer names these fields, so their blobs are orphans; a failed removal
      // leaves an unreferenced secret rather than a field pointing at a value that is gone.
      yield* Effect.forEach(
        removed.filter((field) => !isText(field)),
        (field) => removeSecretValue(next.id, field.id),
        { discard: true },
      );
      if (previous.name !== next.name) {
        yield* history.record({
          type: "renamed",
          credentialId: next.id,
          credentialName: next.name,
        });
      }
      if (!policyEquals(previous.policy, next.policy)) {
        yield* history.record({
          type: "policy-changed",
          credentialId: next.id,
          credentialName: next.name,
        });
      }
      const fieldIds = [
        ...new Set([
          ...Object.keys(input.plainFields ?? {}),
          ...changedFieldIds,
          ...removed.map((field) => field.id),
        ]),
      ];
      const touchedMetadata =
        input.notes !== undefined ||
        input.tags !== undefined ||
        input.expiresAt !== undefined ||
        input.icon !== undefined;
      if (fieldIds.length > 0 || touchedMetadata) {
        yield* history.record({
          type: "updated",
          credentialId: next.id,
          credentialName: next.name,
          ...(fieldIds.length === 0 ? {} : { fieldIds }),
        });
      }
      return toCredential(next, yield* nowMs);
    },
  );

  const setSecret: CredentialStore["Service"]["setSecret"] = Effect.fn("CredentialStore.setSecret")(
    function* (input) {
      const document = yield* readDocument;
      const record = document.credentials.find((candidate) => candidate.id === input.id);
      if (record === undefined) return yield* new CredentialError({ reason: "not-found" });
      const field = record.fields.find((candidate) => candidate.id === input.fieldId);
      if (field === undefined) return yield* new CredentialError({ reason: "unknown-field" });
      if (isText(field)) return yield* new CredentialError({ reason: "field-not-secret" });

      const definition: FieldDefinition = definitionOf(field);
      const decoded = yield* decodeSecret(definition, {
        fieldId: input.fieldId,
        ...(input.value === undefined ? {} : { value: input.value }),
        ...(input.base64 === undefined ? {} : { base64: input.base64 }),
        ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
      });
      const updatedAt = yield* nowIso;
      yield* writeSecret(input.id, input.fieldId, decoded.bytes);
      const result = yield* mutate((current) => {
        const index = current.credentials.findIndex((candidate) => candidate.id === input.id);
        if (index < 0) return Effect.fail(new CredentialError({ reason: "not-found" }));
        const existing = current.credentials[index]!;
        const next: CredentialMetadata = {
          ...existing,
          updatedAt,
          fields: existing.fields.map((candidate) =>
            candidate.id === input.fieldId
              ? secretField(definition, decoded, updatedAt)
              : candidate,
          ),
        };
        const credentials = [...current.credentials];
        credentials[index] = next;
        return Effect.succeed({ document: { ...current, credentials }, result: next });
      });
      yield* history.record({
        type: "secret-replaced",
        credentialId: result.id,
        credentialName: result.name,
        fieldIds: [input.fieldId],
      });
      return toCredential(result, yield* nowMs);
    },
  );

  const removeSecret: CredentialStore["Service"]["removeSecret"] = Effect.fn(
    "CredentialStore.removeSecret",
  )(function* (input) {
    const updatedAt = yield* nowIso;
    const result = yield* mutate((document) => {
      const index = document.credentials.findIndex((candidate) => candidate.id === input.id);
      if (index < 0) return Effect.fail(new CredentialError({ reason: "not-found" }));
      const existing = document.credentials[index]!;
      const field = existing.fields.find((candidate) => candidate.id === input.fieldId);
      if (field === undefined) return Effect.fail(new CredentialError({ reason: "unknown-field" }));
      if (isText(field)) return Effect.fail(new CredentialError({ reason: "field-not-secret" }));
      const next: CredentialMetadata = {
        ...existing,
        updatedAt,
        fields: existing.fields.map((candidate) =>
          candidate.id === input.fieldId ? { ...candidate, secret: { set: false } } : candidate,
        ),
      };
      const credentials = [...document.credentials];
      credentials[index] = next;
      return Effect.succeed({ document: { ...document, credentials }, result: next });
    });
    yield* removeSecretValue(input.id, input.fieldId);
    yield* history.record({
      type: "secret-removed",
      credentialId: result.id,
      credentialName: result.name,
      fieldIds: [input.fieldId],
    });
    return toCredential(result, yield* nowMs);
  });

  const remove: CredentialStore["Service"]["delete"] = Effect.fn("CredentialStore.delete")(
    function* (id) {
      const removed = yield* mutate((document) => {
        const record = document.credentials.find((candidate) => candidate.id === id);
        if (record === undefined) {
          return Effect.fail(new CredentialError({ reason: "not-found" }));
        }
        return Effect.succeed({
          document: {
            ...document,
            credentials: document.credentials.filter((candidate) => candidate.id !== id),
          },
          result: record,
        });
      });
      yield* Effect.forEach(
        removed.fields.filter((field) => !isText(field)).map((field) => field.id),
        (fieldId) => removeSecretValue(id, fieldId),
        { discard: true },
      );
      yield* history.record({
        type: "deleted",
        credentialId: removed.id,
        credentialName: removed.name,
      });
    },
  );

  const readSecretValue: CredentialStore["Service"]["readSecretValue"] = Effect.fn(
    "CredentialStore.readSecretValue",
  )(function* (input) {
    const [document, key] = yield* Effect.all([readDocument, vaultKey.vaultKey]);
    const record = document.credentials.find((candidate) => candidate.id === input.id);
    if (record === undefined) return yield* new CredentialError({ reason: "not-found" });
    const field = record.fields.find((candidate) => candidate.id === input.fieldId);
    if (field === undefined) return yield* new CredentialError({ reason: "unknown-field" });
    if (isText(field)) return yield* new CredentialError({ reason: "field-not-secret" });
    if (field.secret?.set !== true) {
      return yield* new CredentialError({ reason: "missing-field", fieldId: input.fieldId });
    }
    const envelope = yield* store
      .get(secretStoreName(input.id, input.fieldId))
      .pipe(Effect.mapError(storeError));
    if (Option.isNone(envelope)) {
      return yield* new CredentialError({ reason: "missing-field", fieldId: input.fieldId });
    }
    return yield* Effect.try({
      try: () =>
        decryptCredentialValue({
          key,
          credentialId: input.id,
          fieldId: input.fieldId,
          envelope: envelope.value,
        }),
      catch: storeError,
    });
  });

  const pinRecord: CredentialStore["Service"]["pinRecord"] = readDocument.pipe(
    Effect.map((document) => Option.fromUndefinedOr(document.pin ?? undefined)),
    Effect.withSpan("CredentialStore.pinRecord"),
  );

  const setPinRecord: CredentialStore["Service"]["setPinRecord"] = Effect.fn(
    "CredentialStore.setPinRecord",
  )(function* (record) {
    yield* mutate(
      (document) =>
        Effect.succeed({
          document: { ...document, pin: Option.getOrNull(record) },
          result: undefined,
        }),
      false,
    );
  });

  const lockout: CredentialStore["Service"]["lockout"] = readDocument.pipe(
    Effect.map((document) => document.lockout ?? emptyLockout),
    Effect.withSpan("CredentialStore.lockout"),
  );

  const setLockout: CredentialStore["Service"]["setLockout"] = Effect.fn(
    "CredentialStore.setLockout",
  )(function* (value) {
    yield* mutate(
      (document) =>
        Effect.succeed({ document: { ...document, lockout: value }, result: undefined }),
      false,
    );
  });

  const markUsed = Effect.fn("CredentialStore.markUsed")(function* (id: CredentialId) {
    const at = yield* nowIso;
    yield* mutate(
      (document) =>
        Effect.succeed({
          document: {
            ...document,
            credentials: document.credentials.map((c) =>
              c.id === id ? { ...c, useCount: c.useCount + 1, lastUsedAt: at } : c,
            ),
          },
          result: undefined,
        }),
      false,
    );
  });

  return CredentialStore.of({
    revision: Effect.sync(() => revision),
    changes: Stream.fromPubSub(changeHub),
    markUsed,
    list,
    get,
    create,
    update,
    setSecret,
    removeSecret,
    delete: remove,
    readSecretValue,
    pinRecord,
    setPinRecord,
    lockout,
    setLockout,
  });
});

export const layer = Layer.effect(CredentialStore, make);
