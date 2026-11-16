import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AuthSessionId,
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

// A terminal grant reaches the OS keychain as the same user, so withholding vault access
// protects nothing; grants without a terminal still need explicit credential access.
export const credentialScopesGrant = (scopes: ReadonlyArray<string> | undefined): boolean =>
  scopes?.includes("credentials:manage") === true || scopes?.includes("terminal:operate") === true;

export const CredentialId = TrimmedNonEmptyString.pipe(Schema.brand("CredentialId"));
export type CredentialId = typeof CredentialId.Type;

/** An entry in `@t3tools/shared/credentialTemplates`. */
export const CredentialTemplateId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type CredentialTemplateId = typeof CredentialTemplateId.Type;

/** Field ids double as the suffix of a stored secret's name, so they stay filename-safe. */
export const CredentialFieldId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  Schema.isMaxLength(64),
).annotate({
  description: "Letter first, then letters, digits, underscores or dashes.",
});
export type CredentialFieldId = typeof CredentialFieldId.Type;

/** A Simple Icons slug for a brand override. */
export const CredentialIconSlug = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/),
);
export type CredentialIconSlug = typeof CredentialIconSlug.Type;

export const CredentialFieldKind = Schema.Literals([
  "text",
  "secret",
  "secretMultiline",
  "secretFile",
]);
export type CredentialFieldKind = typeof CredentialFieldKind.Type;

const CREDENTIAL_ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names that decide how a command runs rather than what it authenticates. A credential edit must
 * not be able to choose the shell, the loader or the interpreter flags the agent's command picks
 * up, so these are refused even though they are valid POSIX names.
 */
const CREDENTIAL_ENV_VAR_DENYLIST: ReadonlySet<string> = new Set([
  "BASH_ENV",
  "ENV",
  "HOME",
  "IFS",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "PATH",
  "PERL5LIB",
  "PWD",
  "PYTHONPATH",
  "SHELL",
  "TMPDIR",
]);
const CREDENTIAL_ENV_VAR_DENY_PREFIXES: ReadonlyArray<string> = ["DYLD_"];

/** Null when the name may be injected, otherwise what to tell the user. */
export const credentialEnvVarProblem = (name: string): string | null => {
  if (!CREDENTIAL_ENV_VAR_PATTERN.test(name)) {
    return "Use letters, digits and underscores, and do not start with a digit.";
  }
  if (name.length > 128) return "Keep the name to 128 characters or fewer.";
  if (
    CREDENTIAL_ENV_VAR_DENYLIST.has(name) ||
    CREDENTIAL_ENV_VAR_DENY_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return `${name} is reserved by the system. Pick another name.`;
  }
  return null;
};

/**
 * What a write may set as a field's environment variable name. Only inputs are checked: a vault
 * saved by an older version may already hold a name that is not one of these, and a stored
 * credential must stay readable rather than brick the whole vault.
 */
export const CredentialEnvVarName = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).check(
  Schema.makeFilter((name) => credentialEnvVarProblem(name) ?? true),
);
export type CredentialEnvVarName = typeof CredentialEnvVarName.Type;

/** A single-line pasted secret, such as a token or a password. */
const MAX_CREDENTIAL_SECRET_LENGTH = 16 * 1024;
const MAX_CREDENTIAL_NAME_LENGTH = 120;
const MAX_CREDENTIAL_NOTES_LENGTH = 4_000;
const MAX_CREDENTIAL_TAGS = 20;
const MAX_CREDENTIAL_FIELDS = 40;
const MAX_CREDENTIAL_FILE_BYTES = 1024 * 1024;
/** Base64 of MAX_CREDENTIAL_FILE_BYTES, rounded up to a whole 4-character group. */
const MAX_CREDENTIAL_FILE_BASE64_LENGTH = Math.ceil(MAX_CREDENTIAL_FILE_BYTES / 3) * 4;

/**
 * What a client may know about a secret field: whether one is stored and when it changed.
 * There is deliberately no value here, and no shape that could carry one.
 */
export const CredentialSecretState = Schema.Struct({
  set: Schema.Boolean,
  updatedAt: Schema.optionalKey(IsoDateTime),
  fileName: Schema.optionalKey(TrimmedNonEmptyString),
  size: Schema.optionalKey(NonNegativeInt),
});
export type CredentialSecretState = typeof CredentialSecretState.Type;

export const CredentialField = Schema.Struct({
  id: CredentialFieldId,
  label: TrimmedNonEmptyString,
  kind: CredentialFieldKind,
  /**
   * A plain string, not `CredentialEnvVarName`: a vault written by an older version may hold a name
   * that is refused on write today, and reading it must not fail. Writes validate instead.
   */
  envVar: TrimmedNonEmptyString,
  required: Schema.Boolean,
  highRisk: Schema.Boolean,
  /** `text` only: the value the user typed, which is not a secret. */
  value: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_SECRET_LENGTH))),
  /** Secret kinds only. */
  secret: Schema.optionalKey(CredentialSecretState),
  /** `secretFile` only: what a later upload must match. */
  extensions: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  maxBytes: Schema.optionalKey(PositiveInt),
}).check(
  Schema.makeFilter((field) =>
    field.kind === "text"
      ? field.secret === undefined || "A text field never carries secret state."
      : field.value === undefined || "A secret field never carries a value.",
  ),
);
export type CredentialField = typeof CredentialField.Type;

/** "all" or the projects the credential is offered to. */
export const CredentialProjectScope = Schema.Union([
  Schema.Literal("all"),
  Schema.Array(ProjectId).check(Schema.isMaxLength(500)),
]);
export type CredentialProjectScope = typeof CredentialProjectScope.Type;

export const CredentialPolicy = Schema.Struct({
  projects: CredentialProjectScope,
  /** Overrides any workflow-level approval setting: this credential is never used silently. */
  alwaysAsk: Schema.Boolean,
  revealAllowed: Schema.Boolean,
});
export type CredentialPolicy = typeof CredentialPolicy.Type;

export const DEFAULT_CREDENTIAL_POLICY: CredentialPolicy = {
  projects: "all",
  alwaysAsk: true,
  revealAllowed: false,
};

/** A credential expires 14 days before its expiry date is reached. */
export const CREDENTIAL_EXPIRY_WARNING_DAYS = 14;

export const CredentialStatus = Schema.Literals(["ready", "missing-field", "expiring", "expired"]);
export type CredentialStatus = typeof CredentialStatus.Type;

/**
 * The stored and listed shape. `status` is derived on read, so a credential saved months ago
 * reports today's status without a write.
 */
export const CredentialMetadata = Schema.Struct({
  id: CredentialId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_CREDENTIAL_NAME_LENGTH)),
  templateId: CredentialTemplateId,
  /** A brand override; absent means the template's icon or a monogram. */
  icon: Schema.optionalKey(CredentialIconSlug),
  fields: Schema.Array(CredentialField).check(Schema.isMaxLength(MAX_CREDENTIAL_FIELDS)),
  notes: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_NOTES_LENGTH))),
  tags: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(32))).check(
      Schema.isMaxLength(MAX_CREDENTIAL_TAGS),
    ),
  ),
  expiresAt: Schema.optionalKey(IsoDateTime),
  policy: CredentialPolicy,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastUsedAt: Schema.optionalKey(IsoDateTime),
  useCount: NonNegativeInt,
});
export type CredentialMetadata = typeof CredentialMetadata.Type;

export const Credential = Schema.Struct({
  ...CredentialMetadata.fields,
  status: CredentialStatus,
});
export type Credential = typeof Credential.Type;

/** What a value-carrying write sends. Every one of these is client-to-server only. */
export const CredentialSecretInput = Schema.Struct({
  fieldId: CredentialFieldId,
  /** Secret and secretMultiline values. */
  value: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_SECRET_LENGTH))),
  /** secretFile payloads, base64-encoded. */
  base64: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_FILE_BASE64_LENGTH)),
  ),
  fileName: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
});
export type CredentialSecretInput = typeof CredentialSecretInput.Type;

/** Field definitions for a dynamic template: `.env` bundles and Custom credentials. */
export const CredentialFieldDefinitionInput = Schema.Struct({
  id: CredentialFieldId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  kind: CredentialFieldKind,
  envVar: CredentialEnvVarName,
  required: Schema.optionalKey(Schema.Boolean),
  highRisk: Schema.optionalKey(Schema.Boolean),
  extensions: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(20))),
  maxBytes: Schema.optionalKey(PositiveInt),
});
export type CredentialFieldDefinitionInput = typeof CredentialFieldDefinitionInput.Type;

export const CredentialCreateInput = Schema.Struct({
  requestId: Schema.optionalKey(TrimmedNonEmptyString),
  templateId: CredentialTemplateId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_CREDENTIAL_NAME_LENGTH)),
  /**
   * A dynamic template's field list. On a fixed template these are overrides by field id: only
   * `label` and `envVar` are read, so a built-in field can be injected as `GH_TOKEN` instead of
   * `GITHUB_TOKEN`. The template still decides every field's kind and whether it is required.
   */
  fields: Schema.optionalKey(
    Schema.Array(CredentialFieldDefinitionInput).check(Schema.isMaxLength(MAX_CREDENTIAL_FIELDS)),
  ),
  plainFields: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).check(
      Schema.isMaxProperties(MAX_CREDENTIAL_FIELDS),
    ),
  ),
  secrets: Schema.optionalKey(
    Schema.Array(CredentialSecretInput).check(Schema.isMaxLength(MAX_CREDENTIAL_FIELDS)),
  ),
  notes: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_NOTES_LENGTH))),
  tags: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(32))).check(
      Schema.isMaxLength(MAX_CREDENTIAL_TAGS),
    ),
  ),
  expiresAt: Schema.optionalKey(IsoDateTime),
  policy: Schema.optionalKey(CredentialPolicy),
});
export type CredentialCreateInput = typeof CredentialCreateInput.Type;

/**
 * Rename, re-note, re-tag, edit plain fields, change the policy, or replace the field list.
 * Null clears an optional.
 */
export const CredentialUpdateInput = Schema.Struct({
  requestId: Schema.optionalKey(TrimmedNonEmptyString),
  id: CredentialId,
  name: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_CREDENTIAL_NAME_LENGTH)),
  ),
  notes: Schema.optionalKey(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_NOTES_LENGTH))),
  ),
  tags: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(32))).check(
        Schema.isMaxLength(MAX_CREDENTIAL_TAGS),
      ),
    ),
  ),
  plainFields: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).check(
      Schema.isMaxProperties(MAX_CREDENTIAL_FIELDS),
    ),
  ),
  /**
   * The complete field list the credential should end up with; an id that is absent is removed,
   * along with any value stored for it. A fixed template accepts only its own fields, and then
   * only a `label` or `envVar` change. A field's kind may change only while it holds no value.
   */
  fields: Schema.optionalKey(
    Schema.Array(CredentialFieldDefinitionInput).check(Schema.isMaxLength(MAX_CREDENTIAL_FIELDS)),
  ),
  policy: Schema.optionalKey(CredentialPolicy),
  expiresAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  /** Null resets the icon to automatic. */
  icon: Schema.optionalKey(Schema.NullOr(CredentialIconSlug)),
});
export type CredentialUpdateInput = typeof CredentialUpdateInput.Type;

export const CredentialSetSecretInput = Schema.Struct({
  requestId: Schema.optionalKey(TrimmedNonEmptyString),
  id: CredentialId,
  fieldId: CredentialFieldId,
  value: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_SECRET_LENGTH))),
  base64: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(MAX_CREDENTIAL_FILE_BASE64_LENGTH)),
  ),
  fileName: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
});
export type CredentialSetSecretInput = typeof CredentialSetSecretInput.Type;

export const CredentialRemoveSecretInput = Schema.Struct({
  id: CredentialId,
  fieldId: CredentialFieldId,
});
export type CredentialRemoveSecretInput = typeof CredentialRemoveSecretInput.Type;

export const CredentialDeleteInput = Schema.Struct({ id: CredentialId });
export type CredentialDeleteInput = typeof CredentialDeleteInput.Type;

export const CredentialGetInput = Schema.Struct({ id: CredentialId });
export type CredentialGetInput = typeof CredentialGetInput.Type;

export const CredentialListResult = Schema.Struct({ credentials: Schema.Array(Credential) });
export type CredentialListResult = typeof CredentialListResult.Type;

export const CredentialHistoryEventType = Schema.Literals([
  "created",
  "renamed",
  "updated",
  "secret-replaced",
  "secret-removed",
  "policy-changed",
  "deleted",
  "pin-set",
  "pin-changed",
  "unlock-failed",
  "used",
  "approved",
  "denied",
]);
export type CredentialHistoryEventType = typeof CredentialHistoryEventType.Type;

export const CredentialUseMode = Schema.Literals(["exec", "file", "reveal", "check", "probe"]);
export type CredentialUseMode = typeof CredentialUseMode.Type;

export const CredentialUseDecision = Schema.Literals(["allowed", "denied", "policy"]);
export type CredentialUseDecision = typeof CredentialUseDecision.Type;

export const CredentialUseResult = Schema.Literals(["ok", "error", "denied"]);
export type CredentialUseResult = typeof CredentialUseResult.Type;

export const CredentialUseRecord = Schema.Struct({
  agentRole: Schema.optionalKey(Schema.Literals(["main", "subagent"])),
  threadTitle: Schema.optionalKey(Schema.String),
  stepTitle: Schema.optionalKey(Schema.String),
  approvalScope: Schema.optionalKey(Schema.Literals(["once", "run", "workflow", "thread"])),
  approvalMethod: Schema.optionalKey(Schema.Literals(["pin", "os", "unlock"])),
  exitCode: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  fieldIds: Schema.optionalKey(Schema.Array(CredentialFieldId)),
  startedAt: Schema.optionalKey(IsoDateTime),
  provider: Schema.optionalKey(TrimmedNonEmptyString),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  threadId: Schema.optionalKey(ThreadId),
  projectId: Schema.optionalKey(ProjectId),
  workflow: Schema.optionalKey(TrimmedNonEmptyString),
  runId: Schema.optionalKey(TrimmedNonEmptyString),
  stepId: Schema.optionalKey(TrimmedNonEmptyString),
  mode: CredentialUseMode,
  /** Redacted and truncated before it is stored. */
  commandPreview: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  decision: CredentialUseDecision,
  approverSessionId: Schema.optionalKey(AuthSessionId),
  result: CredentialUseResult,
});
export type CredentialUseRecord = typeof CredentialUseRecord.Type;

/**
 * One line of the append-only history. Names are copied in so a deleted credential's history
 * still reads, and no field here can hold a value.
 */
export const CredentialHistoryEvent = Schema.Struct({
  id: TrimmedNonEmptyString,
  at: IsoDateTime,
  type: CredentialHistoryEventType,
  credentialId: Schema.optionalKey(CredentialId),
  credentialName: Schema.optionalKey(TrimmedNonEmptyString),
  /** Which fields changed, never what they held. */
  fieldIds: Schema.optionalKey(Schema.Array(CredentialFieldId)),
  sessionId: Schema.optionalKey(AuthSessionId),
  use: Schema.optionalKey(CredentialUseRecord),
});
export type CredentialHistoryEvent = typeof CredentialHistoryEvent.Type;

const MAX_CREDENTIAL_HISTORY_LIMIT = 200;

export const CredentialHistoryInput = Schema.Struct({
  credentialId: Schema.optionalKey(CredentialId),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_CREDENTIAL_HISTORY_LIMIT)),
  /** The id of the last event already shown; absent starts at the newest. */
  cursor: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CredentialHistoryInput = typeof CredentialHistoryInput.Type;

export const CredentialHistoryPage = Schema.Struct({
  events: Schema.Array(CredentialHistoryEvent),
  nextCursor: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CredentialHistoryPage = typeof CredentialHistoryPage.Type;

export const CredentialKeyStorage = Schema.Literals(["os-keychain", "file"]);
export type CredentialKeyStorage = typeof CredentialKeyStorage.Type;

export const CredentialsStatus = Schema.Struct({
  pinSet: Schema.Boolean,
  /** When this client session's unlock lapses; absent means locked. */
  unlockedUntil: Schema.optionalKey(IsoDateTime),
  /** "file" is the headless fallback, and the UI says so out loud. */
  keyStorage: CredentialKeyStorage,
});
export type CredentialsStatus = typeof CredentialsStatus.Type;

export const CredentialPinSetInput = Schema.Struct({
  newPin: Schema.String.check(Schema.isMinLength(4), Schema.isMaxLength(128)),
  currentPin: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
});
export type CredentialPinSetInput = typeof CredentialPinSetInput.Type;

export const CredentialUnlockInput = Schema.Struct({
  pin: Schema.String.check(Schema.isMaxLength(128)),
});
export type CredentialUnlockInput = typeof CredentialUnlockInput.Type;

/** The first credential write on a fresh vault: the client has to set a PIN first. */
export class CredentialPinRequiredError extends Schema.TaggedError<CredentialPinRequiredError>()(
  "CredentialPinRequiredError",
  {},
) {
  override get message(): string {
    return "Set a credential PIN before changing credentials.";
  }
}

/** At least four digits, or any passphrase of six or more characters. The server enforces it; clients use it to reject early. */
export const isCredentialPinAcceptable = (pin: string): boolean =>
  /^\d{4,}$/.test(pin) || pin.length >= 6;

export const CredentialAccessReason = Schema.Literals([
  "unlock-required",
  "pin-incorrect",
  "locked-out",
  "pin-too-weak",
  "pin-mismatch",
]);
export type CredentialAccessReason = typeof CredentialAccessReason.Type;

export class CredentialAccessError extends Schema.TaggedError<CredentialAccessError>()(
  "CredentialAccessError",
  {
    reason: CredentialAccessReason,
    attemptsRemaining: Schema.optionalKey(NonNegativeInt),
    retryAfterSeconds: Schema.optionalKey(NonNegativeInt),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "unlock-required":
        return "Unlock the credential vault first.";
      case "pin-incorrect":
        return "That PIN is not correct.";
      case "locked-out":
        return `Too many incorrect PINs. Try again in ${this.retryAfterSeconds ?? 0} seconds.`;
      case "pin-too-weak":
        return "Use at least 4 digits or a passphrase of 6 or more characters.";
      case "pin-mismatch":
        return "The current PIN is required and must be correct to change it.";
    }
  }
}

export const CredentialErrorReason = Schema.Literals([
  "not-found",
  "unknown-template",
  "unknown-field",
  "missing-field",
  "field-not-secret",
  "field-not-text",
  "invalid-field",
  "invalid-value",
  "invalid-env-var",
  "duplicate-env-var",
  "field-has-value",
  "file-too-large",
  "file-type-not-allowed",
  "too-many-fields",
  "store-failed",
  "history-failed",
  "vault-failed",
]);
export type CredentialErrorReason = typeof CredentialErrorReason.Type;

export class CredentialError extends Schema.TaggedError<CredentialError>()("CredentialError", {
  reason: CredentialErrorReason,
  /** Set when the failure belongs to one field, so the form can point at it. */
  fieldId: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return "That credential no longer exists.";
      case "unknown-template":
        return "That credential type is not one this version knows.";
      case "unknown-field":
        return "That field is not part of this credential.";
      case "missing-field":
        return `A required field is empty${this.fieldId === undefined ? "" : `: ${this.fieldId}`}.`;
      case "field-not-secret":
        return "That field does not hold a secret.";
      case "field-not-text":
        return "That field is not a plain text field.";
      case "invalid-field":
        return "That field definition is not valid.";
      case "invalid-value":
        return "The value is not valid.";
      case "invalid-env-var":
        return "That environment variable name is not allowed.";
      case "duplicate-env-var":
        return "Another field already uses that environment variable name.";
      case "field-has-value":
        return "Remove the stored value before changing what kind of field this is.";
      case "file-too-large":
        return "The file is larger than this field allows.";
      case "file-type-not-allowed":
        return "That file type is not allowed for this field.";
      case "too-many-fields":
        return "This credential has too many fields.";
      case "store-failed":
        return "Failed to save the credential vault.";
      case "history-failed":
        return "Failed to read or write the credential history.";
      case "vault-failed":
        return "Failed to obtain the vault key.";
    }
  }
}

export const CredentialRpcError = Schema.Union([
  CredentialError,
  CredentialAccessError,
  CredentialPinRequiredError,
]);
export type CredentialRpcError = typeof CredentialRpcError.Type;

/**
 * How the desktop shell can stand in for typing the PIN. The shell still sends whatever it
 * releases to `credentials.unlock`; the server never trusts the local check.
 */
export const DesktopCredentialOsUnlockMethod = Schema.Literals([
  "touch-id",
  "windows-hello",
  "polkit",
]);
export type DesktopCredentialOsUnlockMethod = typeof DesktopCredentialOsUnlockMethod.Type;

export const DesktopCredentialOsUnlockAction = Schema.Literals([
  "status",
  "enable",
  "disable",
  "unlock",
]);
export type DesktopCredentialOsUnlockAction = typeof DesktopCredentialOsUnlockAction.Type;

/**
 * One channel for the whole feature: the shell keeps the PIN, the renderer only asks for it
 * right before forwarding it to the server.
 */
export const DesktopCredentialOsUnlockRequest = Schema.Struct({
  action: DesktopCredentialOsUnlockAction,
  /** The PIN is stored per environment, so a remote environment never shares one. */
  environmentId: EnvironmentId,
  /** `enable` only. */
  pin: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
});
export type DesktopCredentialOsUnlockRequest = typeof DesktopCredentialOsUnlockRequest.Type;

export const DesktopCredentialOsUnlockStatus = Schema.Struct({
  /** False when the shell cannot prompt, or has no protected place for the PIN. */
  available: Schema.Boolean,
  enabled: Schema.Boolean,
  method: Schema.optionalKey(DesktopCredentialOsUnlockMethod),
});
export type DesktopCredentialOsUnlockStatus = typeof DesktopCredentialOsUnlockStatus.Type;

export const DesktopCredentialOsUnlockResult = Schema.Struct({
  status: DesktopCredentialOsUnlockStatus,
  /** `unlock` only, after the OS prompt. Absent when the prompt was cancelled. */
  pin: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
});
export type DesktopCredentialOsUnlockResult = typeof DesktopCredentialOsUnlockResult.Type;

export interface DesktopCredentialOsUnlockBridge {
  (request: DesktopCredentialOsUnlockRequest): Promise<DesktopCredentialOsUnlockResult>;
}

/** The one reason the shell ever shows: it must not carry anything about the credential. */
export const CREDENTIAL_OS_UNLOCK_REASON = "Unlock your T3 Code credentials";

export const CredentialApprovalScope = Schema.Literals(["once", "run", "workflow", "thread"]);
export type CredentialApprovalScope = typeof CredentialApprovalScope.Type;
export const CredentialCaller = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  projectId: ProjectId,
  provider: Schema.String,
  model: Schema.String,
  agentRole: Schema.Literals(["main", "subagent"]),
  workflow: Schema.optionalKey(Schema.String),
  runId: Schema.optionalKey(Schema.String),
  stepId: Schema.optionalKey(Schema.String),
  stepTitle: Schema.optionalKey(Schema.String),
  credentialApprovals: Schema.optionalKey(Schema.Literals(["ask", "once-per-run", "pre-approved"])),
});
export type CredentialCaller = typeof CredentialCaller.Type;
export const CredentialActivity = Schema.Struct({
  id: Schema.String,
  credentialId: CredentialId,
  credentialName: Schema.String,
  templateId: CredentialTemplateId,
  icon: Schema.optionalKey(CredentialIconSlug),
  caller: CredentialCaller,
  mode: Schema.Literals(["exec", "file"]),
  commandPreview: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  startedAt: IsoDateTime,
});
export type CredentialActivity = typeof CredentialActivity.Type;
export const CredentialPendingRequest = Schema.Union([
  Schema.Struct({
    ...CredentialActivity.fields,
    kind: Schema.Literal("use"),
    allowedScopes: Schema.Array(CredentialApprovalScope),
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("add"),
    caller: CredentialCaller,
    templateId: Schema.optionalKey(CredentialTemplateId),
    name: Schema.optionalKey(Schema.String),
    reason: Schema.String,
    startedAt: IsoDateTime,
  }),
]);
export type CredentialPendingRequest = typeof CredentialPendingRequest.Type;
export const CredentialLiveState = Schema.Struct({
  /** Increments after a use is recorded; clients refresh history and usage counts on change. */
  historyRevision: NonNegativeInt,
  pending: Schema.Array(CredentialPendingRequest),
  active: Schema.Array(CredentialActivity),
});
export type CredentialLiveState = typeof CredentialLiveState.Type;
/** One saved per-use approval: a credential the user allowed a thread, run or workflow to use. */
export const CredentialApprovalGrant = Schema.Struct({
  kind: Schema.Literal("approval"),
  id: Schema.String,
  credentialId: CredentialId,
  scope: Schema.Literals(["run", "workflow", "thread"]),
  projectId: ProjectId,
  threadId: ThreadId,
  workflow: Schema.optionalKey(Schema.String),
  runId: Schema.optionalKey(Schema.String),
  approverSessionId: AuthSessionId,
  approvalMethod: Schema.Literals(["pin", "unlock"]),
  createdAt: IsoDateTime,
});
export type CredentialApprovalGrant = typeof CredentialApprovalGrant.Type;

/**
 * One credential a workflow's pre-approval covers on this machine. It is authority of its own
 * rather than a field on the workflow file, so the vault lists and withdraws it like any grant.
 */
export const CredentialWorkflowPreapprovalGrant = Schema.Struct({
  kind: Schema.Literal("workflow-preapproval"),
  id: Schema.String,
  credentialId: CredentialId,
  projectId: ProjectId,
  workflow: Schema.String,
  approverSessionId: AuthSessionId,
  createdAt: IsoDateTime,
});
export type CredentialWorkflowPreapprovalGrant = typeof CredentialWorkflowPreapprovalGrant.Type;

export const CredentialGrant = Schema.Union([
  CredentialApprovalGrant,
  CredentialWorkflowPreapprovalGrant,
]);
export type CredentialGrant = typeof CredentialGrant.Type;

/**
 * A grant is withdrawn by naming which kind it is. A pre-approval withdraws one credential at a
 * time, so the rest of the workflow's coverage survives.
 */
export const CredentialRevokeGrantInput = Schema.Union([
  Schema.Struct({
    // A browser tab that was open before the kinds existed still sends a bare grant id, so a
    // missing kind means the approval.
    kind: Schema.Literal("approval").pipe(
      Schema.withDecodingDefaultKey(Effect.succeed("approval")),
    ),
    grantId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("workflow-preapproval"),
    projectId: ProjectId,
    workflow: Schema.String,
    credentialId: CredentialId,
  }),
]);
export type CredentialRevokeGrantInput = typeof CredentialRevokeGrantInput.Type;
export const CredentialApproveInput = Schema.Struct({
  requestId: Schema.String,
  scope: CredentialApprovalScope,
});
export const CredentialRequestInput = Schema.Struct({
  templateId: Schema.optionalKey(CredentialTemplateId),
  name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))),
  reason: Schema.String.check(Schema.isMaxLength(1000)),
});
export type CredentialRequestInput = typeof CredentialRequestInput.Type;
export const CredentialRequestResult = Schema.Struct({
  status: Schema.Literals(["saved", "declined", "timed-out"]),
  credentialId: Schema.optionalKey(CredentialId),
});
export type CredentialRequestResult = typeof CredentialRequestResult.Type;
/**
 * A workflow step agent already knows its run and step; naming them lets a use that started
 * before `workflow_step_start` linked the thread still belong to that step on the canvas. The
 * server verifies the link and ignores an unverifiable hint.
 */
export const CredentialWorkflowStepHint = Schema.Struct({
  runId: Schema.optionalKey(TrimmedNonEmptyString),
  stepId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CredentialWorkflowStepHint = typeof CredentialWorkflowStepHint.Type;
export const CredentialExecInput = Schema.Struct({
  credential: TrimmedNonEmptyString,
  command: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16000)),
  cwd: Schema.optionalKey(Schema.String),
  timeoutSec: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(3600))),
  ...CredentialWorkflowStepHint.fields,
});
export type CredentialExecInput = typeof CredentialExecInput.Type;
export const CredentialExecResult = Schema.Struct({
  exitCode: Schema.NullOr(Schema.Int),
  stdout: Schema.String,
  stderr: Schema.String,
  truncated: Schema.Boolean,
  /** Env-var names of fields withheld from the command because the name is reserved. */
  skippedEnvVars: Schema.Array(Schema.String),
});
export type CredentialExecResult = typeof CredentialExecResult.Type;
export const CredentialFileInput = Schema.Struct({
  credential: TrimmedNonEmptyString,
  ...CredentialWorkflowStepHint.fields,
});
export type CredentialFileInput = typeof CredentialFileInput.Type;
export const CredentialFileResult = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.String),
  plainFields: Schema.Record(Schema.String, Schema.String),
  /** Env-var names of fields withheld because the name is reserved, so the agent knows why. */
  skippedEnvVars: Schema.Array(Schema.String),
});
export type CredentialFileResult = typeof CredentialFileResult.Type;
export const CredentialAgentListing = Schema.Array(
  Schema.Struct({
    id: CredentialId,
    name: Schema.String,
    templateId: CredentialTemplateId,
    status: CredentialStatus,
    policy: CredentialPolicy,
    usable: Schema.Boolean,
    fields: Schema.Array(
      Schema.Struct({
        id: CredentialFieldId,
        kind: CredentialFieldKind,
        envVar: Schema.String,
        set: Schema.Boolean,
      }),
    ),
  }),
);
export type CredentialAgentListing = typeof CredentialAgentListing.Type;
export class CredentialUseError extends Schema.TaggedError<CredentialUseError>()(
  "CredentialUseError",
  {
    approverSessionId: Schema.optionalKey(AuthSessionId),
    reason: Schema.Literals([
      "not-approved",
      "timed-out",
      "busy",
      "not-found",
      "project-restricted",
      "not-ready",
      "run-required",
      "ambiguous-run",
      "execution-failed",
      "storage-failed",
      "invalid-scope",
    ]),
  },
) {
  override get message(): string {
    return this.reason === "timed-out"
      ? "Credential not approved: timed out."
      : `Credential use: ${this.reason}.`;
  }
}
