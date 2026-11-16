import type {
  CredentialCreateInput,
  CredentialFieldDefinitionInput,
  CredentialFieldKind,
  CredentialPolicy,
  CredentialSecretInput,
  ProjectId,
} from "@t3tools/contracts";
import {
  IsoDateTime,
  credentialEnvVarProblem,
  isCredentialPinAcceptable,
} from "@t3tools/contracts";
import {
  credentialTemplate,
  parseEnvBundle,
  type CredentialTemplate,
} from "@t3tools/shared/credentialTemplates";

export const CUSTOM_TEMPLATE_ID = "custom";
export const ENV_BUNDLE_TEMPLATE_ID = "env-bundle";

/** The gallery's first group, in the order the design calls for. */
export const POPULAR_TEMPLATE_IDS = [
  "app-store-connect",
  "apple-signing",
  "revenuecat",
  "github",
  "vercel",
] as const;

export interface CredentialFormFile {
  readonly base64: string;
  readonly fileName: string;
  readonly size: number;
}

export interface CredentialFormSecret {
  readonly value: string;
  readonly file: CredentialFormFile | null;
}

export interface EnvBundleDraftField {
  readonly id: string;
  readonly envVar: string;
  readonly label: string;
  readonly value: string;
}

export interface CredentialFormCustomField {
  readonly id: string;
  readonly label: string;
  readonly kind: CredentialFieldKind;
  readonly envVar: string;
  readonly required: boolean;
  /** Comma-separated, `secretFile` only. */
  readonly extensions: string;
  readonly value: string;
  readonly file: CredentialFormFile | null;
}

export interface CredentialFormDraft {
  readonly templateId: string;
  readonly name: string;
  readonly plainValues: Readonly<Record<string, string>>;
  readonly secretValues: Readonly<Record<string, CredentialFormSecret>>;
  /** A fixed template's fields keep their ids; this only renames how they are injected. */
  readonly envVarOverrides: Readonly<Record<string, string>>;
  readonly customFields: ReadonlyArray<CredentialFormCustomField>;
  readonly envText: string;
  readonly envFields: ReadonlyArray<EnvBundleDraftField>;
  readonly notes: string;
  readonly expiresAt: string;
  readonly scope: "all" | "selected";
  readonly projectIds: ReadonlyArray<ProjectId>;
}

export type CredentialFormBuildResult =
  | { readonly ok: true; readonly input: CredentialCreateInput }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fieldId?: string;
      /** Which control to point at: the value the user typed, or the environment variable name. */
      readonly target?: "value" | "envVar";
    };

const EMPTY_SECRET: CredentialFormSecret = { value: "", file: null };

export const emptyCredentialFormDraft = (templateId: string): CredentialFormDraft => {
  const template = credentialTemplate(templateId);
  const plainValues: Record<string, string> = {};
  const secretValues: Record<string, CredentialFormSecret> = {};
  for (const field of template?.fields ?? []) {
    if (field.kind === "text") plainValues[field.id] = "";
    else secretValues[field.id] = EMPTY_SECRET;
  }
  return {
    templateId,
    name: "",
    plainValues,
    secretValues,
    envVarOverrides: {},
    customFields:
      templateId === CUSTOM_TEMPLATE_ID
        ? [
            {
              id: "field-1",
              label: "",
              kind: "secret",
              envVar: "",
              required: true,
              extensions: "",
              value: "",
              file: null,
            },
          ]
        : [],
    envText: "",
    envFields: [],
    notes: "",
    expiresAt: "",
    scope: "all",
    projectIds: [],
  };
};

const FIELD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** A stored field's id has to start with a letter and stay filename-safe. */
export const credentialFieldId = (
  source: string,
  taken: ReadonlySet<string> = new Set(),
): string => {
  const candidate = source
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const base = FIELD_ID_PATTERN.test(candidate) ? candidate : "field";
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const suffix = `-${index}`;
    const next = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(next)) return next;
  }
};

export const nextCustomFieldId = (fields: ReadonlyArray<CredentialFormCustomField>): string => {
  const taken = new Set(fields.map((field) => field.id));
  return credentialFieldId(`field-${fields.length + 1}`, taken);
};

/** `STRIPE_SECRET_KEY` from "Stripe secret key". */
export const envVarFromLabel = (label: string): string => {
  const normalized = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized === "" ? "" : /^[A-Z_]/.test(normalized) ? normalized : `VAR_${normalized}`;
};

export const envBundleFields = (text: string): ReadonlyArray<EnvBundleDraftField> => {
  const taken = new Set<string>();
  return parseEnvBundle(text).map(({ key, value }) => {
    const id = credentialFieldId(key, taken);
    taken.add(id);
    return { id, envVar: key, label: key, value };
  });
};

const fileExtensions = (raw: string): ReadonlyArray<string> =>
  raw
    .split(",")
    .map((extension) => extension.trim().toLowerCase().replace(/^\./, ""))
    .filter((extension) => extension !== "");

const missingRequired = (label: string, fieldId: string): CredentialFormBuildResult => ({
  ok: false,
  message: `${label} is required.`,
  fieldId,
});

/**
 * The names a create is about to inject. The server checks the same rules; checking here puts the
 * message on the field the user has to fix.
 */
export const envVarError = (
  fields: ReadonlyArray<{ readonly id: string; readonly label: string; readonly envVar: string }>,
): { readonly message: string; readonly fieldId: string } | null => {
  const seen = new Set<string>();
  for (const field of fields) {
    const problem = credentialEnvVarProblem(field.envVar);
    if (problem !== null) return { fieldId: field.id, message: `${field.label}: ${problem}` };
    if (seen.has(field.envVar)) {
      return { fieldId: field.id, message: `${field.envVar} is used twice.` };
    }
    seen.add(field.envVar);
  }
  return null;
};

/** The name a fixed template's field will actually be injected under. */
export const fixedFieldEnvVar = (
  field: { readonly id: string; readonly envVar: string },
  overrides: Readonly<Record<string, string>>,
): string => {
  const override = (overrides[field.id] ?? "").trim();
  return override === "" ? field.envVar : override;
};

const secretInput = (
  fieldId: string,
  kind: CredentialFieldKind,
  secret: CredentialFormSecret | undefined,
): CredentialSecretInput | null => {
  if (kind === "secretFile") {
    if (!secret?.file) return null;
    return { fieldId, base64: secret.file.base64, fileName: secret.file.fileName };
  }
  if (!secret || secret.value === "") return null;
  return { fieldId, value: secret.value };
};

const policyFor = (draft: CredentialFormDraft): CredentialPolicy => ({
  projects: draft.scope === "selected" ? [...draft.projectIds] : "all",
  alwaysAsk: true,
  revealAllowed: false,
});

const expiresAtFor = (
  raw: string,
): { readonly ok: true; readonly value: string | undefined } | { readonly ok: false } => {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? { ok: false }
    : { ok: true, value: IsoDateTime.make(date.toISOString()) };
};

const buildFixedTemplateInput = (
  template: CredentialTemplate,
  draft: CredentialFormDraft,
  expiresAt: string | undefined,
): CredentialFormBuildResult => {
  const injected = template.fields.map((field) => ({
    id: field.id,
    label: field.label,
    envVar: fixedFieldEnvVar(field, draft.envVarOverrides),
  }));
  const envProblem = envVarError(injected);
  if (envProblem !== null) {
    return { ...envProblem, ok: false, target: "envVar" };
  }
  const plainFields: Record<string, string> = {};
  const secrets: CredentialSecretInput[] = [];
  for (const field of template.fields) {
    if (field.kind === "text") {
      const value = draft.plainValues[field.id] ?? "";
      if (field.required === true && value.trim() === "") {
        return missingRequired(field.label, field.id);
      }
      plainFields[field.id] = value;
      continue;
    }
    const secret = secretInput(field.id, field.kind, draft.secretValues[field.id]);
    if (secret === null && field.required === true) {
      return missingRequired(field.label, field.id);
    }
    if (secret !== null) secrets.push(secret);
  }
  // Only the names that differ from the template are sent, so a stored field's default stays the
  // template's to change later.
  const overrides = template.fields.flatMap((field) => {
    const envVar = fixedFieldEnvVar(field, draft.envVarOverrides);
    return envVar === field.envVar
      ? []
      : [{ id: field.id, label: field.label, kind: field.kind, envVar }];
  });
  return {
    ok: true,
    input: {
      templateId: template.id,
      name: draft.name.trim(),
      plainFields,
      secrets,
      ...(overrides.length === 0 ? {} : { fields: overrides }),
      policy: policyFor(draft),
      ...(draft.notes.trim() === "" ? {} : { notes: draft.notes }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    },
  };
};

const buildCustomInput = (
  draft: CredentialFormDraft,
  expiresAt: string | undefined,
): CredentialFormBuildResult => {
  if (draft.customFields.length === 0) {
    return { ok: false, message: "Add at least one field." };
  }
  const fields: CredentialFieldDefinitionInput[] = [];
  const plainFields: Record<string, string> = {};
  const secrets: CredentialSecretInput[] = [];
  const seenIds = new Set<string>();
  const seenEnvVars = new Set<string>();
  for (const field of draft.customFields) {
    const label = field.label.trim();
    const envVar = field.envVar.trim();
    if (label === "") return { ok: false, message: "Every custom field needs a name." };
    if (envVar === "")
      return { ok: false, message: `${label} needs an environment variable name.` };
    if (!FIELD_ID_PATTERN.test(field.id)) {
      return { ok: false, message: `${label} needs a valid field id.` };
    }
    if (seenIds.has(field.id)) return { ok: false, message: "Two custom fields share an id." };
    const envProblem = credentialEnvVarProblem(envVar);
    if (envProblem !== null) {
      return {
        ok: false,
        message: `${label}: ${envProblem}`,
        fieldId: field.id,
        target: "envVar",
      };
    }
    if (seenEnvVars.has(envVar)) {
      return {
        ok: false,
        message: `${envVar} is used twice.`,
        fieldId: field.id,
        target: "envVar",
      };
    }
    seenIds.add(field.id);
    seenEnvVars.add(envVar);
    fields.push({
      id: field.id,
      label,
      kind: field.kind,
      envVar,
      required: field.required,
      ...(field.kind === "secretFile" && fileExtensions(field.extensions).length > 0
        ? { extensions: fileExtensions(field.extensions) }
        : {}),
    });
    if (field.kind === "text") {
      if (field.required && field.value.trim() === "") {
        return missingRequired(label, field.id);
      }
      plainFields[field.id] = field.value;
      continue;
    }
    const secret = secretInput(field.id, field.kind, {
      value: field.value,
      file: field.file,
    });
    if (secret === null && field.required) return missingRequired(label, field.id);
    if (secret !== null) secrets.push(secret);
  }
  return {
    ok: true,
    input: {
      templateId: CUSTOM_TEMPLATE_ID,
      name: draft.name.trim(),
      fields,
      plainFields,
      secrets,
      policy: policyFor(draft),
      ...(draft.notes.trim() === "" ? {} : { notes: draft.notes }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    },
  };
};

const buildEnvBundleInput = (
  draft: CredentialFormDraft,
  expiresAt: string | undefined,
): CredentialFormBuildResult => {
  if (draft.envFields.length === 0) {
    return { ok: false, message: "Paste at least one KEY=value line." };
  }
  const fields: CredentialFieldDefinitionInput[] = [];
  const secrets: CredentialSecretInput[] = [];
  const seenEnvVars = new Set<string>();
  for (const field of draft.envFields) {
    const envVar = field.envVar.trim();
    if (envVar === "")
      return { ok: false, message: "Every key needs an environment variable name." };
    const envProblem = credentialEnvVarProblem(envVar);
    if (envProblem !== null) {
      return {
        ok: false,
        message: `${envVar}: ${envProblem}`,
        fieldId: field.id,
        target: "envVar",
      };
    }
    if (seenEnvVars.has(envVar))
      return {
        ok: false,
        message: `${envVar} is listed twice.`,
        fieldId: field.id,
        target: "envVar",
      };
    seenEnvVars.add(envVar);
    fields.push({ id: field.id, label: envVar, kind: "secret", envVar });
    secrets.push({ fieldId: field.id, value: field.value });
  }
  return {
    ok: true,
    input: {
      templateId: ENV_BUNDLE_TEMPLATE_ID,
      name: draft.name.trim(),
      fields,
      secrets,
      policy: policyFor(draft),
      ...(draft.notes.trim() === "" ? {} : { notes: draft.notes }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    },
  };
};

export const buildCredentialCreateInput = (
  draft: CredentialFormDraft,
): CredentialFormBuildResult => {
  if (draft.name.trim() === "") return { ok: false, message: "Give this credential a name." };
  const template = credentialTemplate(draft.templateId);
  if (template === undefined) return { ok: false, message: "Pick a credential type." };
  const expires = expiresAtFor(draft.expiresAt);
  if (!expires.ok) return { ok: false, message: "That expiry date is not valid." };
  switch (template.id) {
    case ENV_BUNDLE_TEMPLATE_ID:
      return buildEnvBundleInput(draft, expires.value);
    case CUSTOM_TEMPLATE_ID:
      return buildCustomInput(draft, expires.value);
    default:
      return buildFixedTemplateInput(template, draft, expires.value);
  }
};

export const validateCredentialFile = (
  fileName: string,
  size: number,
  extensions: ReadonlyArray<string> | undefined,
  maxBytes: number | undefined,
): string | null => {
  const normalized = extensions?.map((extension) => extension.toLowerCase()) ?? [];
  if (normalized.length > 0) {
    const actual = fileName.trim().toLowerCase().split(".").at(-1) ?? "";
    if (!normalized.includes(actual)) {
      return `Use a ${normalized.map((extension) => `.${extension}`).join(" or ")} file.`;
    }
  }
  if (maxBytes !== undefined && size > maxBytes) {
    return `This file is larger than ${formatBytes(maxBytes)}.`;
  }
  return null;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const base64FromBytes = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

export const pinValidationError = (pin: string, confirmation: string): string | null => {
  if (!isCredentialPinAcceptable(pin)) {
    return "Use at least four digits or a passphrase of six or more characters.";
  }
  if (pin.length > 128) return "That PIN is too long.";
  if (pin !== confirmation) return "The two PINs do not match.";
  return null;
};
