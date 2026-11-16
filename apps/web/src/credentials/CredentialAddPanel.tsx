import type { CredentialPendingRequest } from "@t3tools/contracts";
import type { CredentialCreateInput, CredentialFieldKind } from "@t3tools/contracts";
import {
  CREDENTIAL_TEMPLATES,
  credentialTemplate,
  type CredentialTemplateField,
} from "@t3tools/shared/credentialTemplates";
import { ChevronLeftIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { CredentialBrandIcon } from "./CredentialBrandIcon";
import { CredentialFileField } from "./CredentialFileField";
import {
  CUSTOM_TEMPLATE_ID,
  ENV_BUNDLE_TEMPLATE_ID,
  POPULAR_TEMPLATE_IDS,
  buildCredentialCreateInput,
  emptyCredentialFormDraft,
  envBundleFields,
  envVarFromLabel,
  fixedFieldEnvVar,
  nextCustomFieldId,
  type CredentialFormCustomField,
  type CredentialFormDraft,
  type CredentialFormFile,
} from "./credentialDraft";
import { CredentialProjectScope, type CredentialProjectOption } from "./CredentialProjectScope";

const FIELD_KIND_OPTIONS: ReadonlyArray<{
  readonly value: CredentialFieldKind;
  readonly label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "secret", label: "Secret" },
  { value: "secretMultiline", label: "Multi-line secret" },
  { value: "secretFile", label: "File" },
];

function TemplateTile({
  template,
  onSelect,
}: {
  readonly template: (typeof CREDENTIAL_TEMPLATES)[number];
  readonly onSelect: (templateId: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-border p-2.5 text-left hover:bg-accent"
      onClick={() => onSelect(template.id)}
    >
      <CredentialBrandIcon name={template.name} templateIcon={template.icon} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{template.name}</span>
        <span className="block text-xs leading-snug text-muted-foreground">
          {template.description}
        </span>
      </span>
    </button>
  );
}

function TemplateGallery({ onSelect }: { readonly onSelect: (templateId: string) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const matches = (template: (typeof CREDENTIAL_TEMPLATES)[number]) =>
    normalized === "" ||
    template.name.toLowerCase().includes(normalized) ||
    template.description.toLowerCase().includes(normalized);
  const popularIds = new Set<string>(POPULAR_TEMPLATE_IDS);
  const popular = POPULAR_TEMPLATE_IDS.flatMap((id) => {
    const template = credentialTemplate(id);
    return template !== undefined && matches(template) ? [template] : [];
  });
  const fixed = CREDENTIAL_TEMPLATES.filter(
    (template) => template.dynamic !== true && !popularIds.has(template.id) && matches(template),
  );
  const dynamic = CREDENTIAL_TEMPLATES.filter(
    (template) => template.dynamic === true && matches(template),
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="credential-type-search">Credential type</Label>
        <Input
          id="credential-type-search"
          type="search"
          placeholder="Search types…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {popular.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Popular</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {popular.map((template) => (
              <TemplateTile key={template.id} template={template} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ) : null}
      {fixed.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">More types</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fixed.map((template) => (
              <TemplateTile key={template.id} template={template} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ) : null}
      {dynamic.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Anything else</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {dynamic.map((template) => (
              <TemplateTile key={template.id} template={template} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ) : null}
      {popular.length + fixed.length + dynamic.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No types match.</p>
      ) : null}
    </div>
  );
}

function FieldEnvVarInput({
  id,
  fieldLabel,
  defaultEnvVar,
  value,
  error,
  onChange,
}: {
  readonly id: string;
  readonly fieldLabel: string;
  readonly defaultEnvVar: string;
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Environment variable</Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          aria-label={`Environment variable for ${fieldLabel}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {value === defaultEnvVar ? null : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Reset environment variable for ${fieldLabel}`}
            onClick={() => onChange(defaultEnvVar)}
          >
            Reset
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

function FixedField({
  field,
  draft,
  envVar,
  error,
  fieldError,
  envVarError,
  onError,
  onEnvVarChange,
  onPlainChange,
  onSecretChange,
}: {
  readonly field: CredentialTemplateField;
  readonly draft: CredentialFormDraft;
  readonly envVar: string;
  readonly error: string | null;
  readonly fieldError: string | null;
  readonly envVarError: string | null;
  readonly onError: (message: string | null) => void;
  readonly onEnvVarChange: (value: string) => void;
  readonly onPlainChange: (fieldId: string, value: string) => void;
  readonly onSecretChange: (
    fieldId: string,
    patch: { readonly value?: string; readonly file?: CredentialFormFile | null },
  ) => void;
}) {
  const inputId = useId();
  const envId = useId();
  const secret = draft.secretValues[field.id] ?? { value: "", file: null };
  const description = error === null ? undefined : error;
  const envVarInput = (
    <FieldEnvVarInput
      id={envId}
      fieldLabel={field.label}
      defaultEnvVar={field.envVar}
      value={envVar}
      error={envVarError}
      onChange={onEnvVarChange}
    />
  );

  if (field.kind === "text") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>
          {field.label}
          {field.required === true ? " *" : ""}
        </Label>
        <Input
          id={inputId}
          value={draft.plainValues[field.id] ?? ""}
          onChange={(event) => onPlainChange(field.id, event.target.value)}
        />
        {description === undefined ? null : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {fieldError === null ? null : (
          <p role="alert" className="text-xs text-destructive-foreground">
            {fieldError}
          </p>
        )}
        {envVarInput}
      </div>
    );
  }

  if (field.kind === "secretFile") {
    return (
      <div className="space-y-1.5">
        <CredentialFileField
          id={inputId}
          label={`${field.label}${field.required === true ? " *" : ""}`}
          extensions={field.extensions}
          maxBytes={field.maxBytes}
          value={secret.file}
          error={fieldError}
          onValueChange={(file) => onSecretChange(field.id, { file })}
          onError={onError}
        />
        {envVarInput}
      </div>
    );
  }

  if (field.kind === "secretMultiline") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>
          {field.label}
          {field.required === true ? " *" : ""}
        </Label>
        <div className="font-mono">
          <Textarea
            id={inputId}
            rows={4}
            value={secret.value}
            onChange={(event) => onSecretChange(field.id, { value: event.target.value })}
          />
        </div>
        {description === undefined ? null : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {fieldError === null ? null : (
          <p role="alert" className="text-xs text-destructive-foreground">
            {fieldError}
          </p>
        )}
        {envVarInput}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>
        {field.label}
        {field.required === true ? " *" : ""}
      </Label>
      <Input
        id={inputId}
        type="password"
        autoComplete="off"
        value={secret.value}
        onChange={(event) => onSecretChange(field.id, { value: event.target.value })}
      />
      <p className="text-xs text-muted-foreground">
        {field.highRisk === true ? "High risk" : null}
        {field.highRisk === true && description !== undefined ? " · " : null}
        {description}
      </p>
      {fieldError === null ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {fieldError}
        </p>
      )}
      {envVarInput}
    </div>
  );
}

function CustomFieldRow({
  field,
  error,
  disabled,
  onPatch,
  onRemove,
}: {
  readonly field: CredentialFormCustomField;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly onPatch: (patch: Partial<CredentialFormCustomField>) => void;
  readonly onRemove: () => void;
}) {
  const inputId = useId();
  const [fileError, setFileError] = useState<string | null>(null);
  const description = error === null ? undefined : error;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Field name"
          placeholder="Field name"
          value={field.label}
          onChange={(event) => {
            const label = event.target.value;
            const previous = envVarFromLabel(field.label);
            const next = envVarFromLabel(label);
            onPatch({
              label,
              ...(field.envVar === previous || field.envVar === "" ? { envVar: next } : {}),
            });
          }}
        />
        <div className="w-44 shrink-0">
          <Select
            value={field.kind}
            onValueChange={(value) => onPatch({ kind: value as CredentialFieldKind })}
          >
            <SelectTrigger size="sm" aria-label={`${field.label || "Custom"} field kind`}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {FIELD_KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button
          type="button"
          variant="ghost-muted"
          size="icon-micro"
          aria-label={`Remove ${field.label || "custom"} field`}
          disabled={disabled}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-env`}>Environment variable</Label>
          <Input
            id={`${inputId}-env`}
            value={field.envVar}
            onChange={(event) => onPatch({ envVar: event.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Checkbox
            checked={field.required}
            disabled={disabled}
            onCheckedChange={(checked) => onPatch({ required: checked === true })}
          />
          Required
        </label>
      </div>
      {field.kind === "secretFile" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${inputId}-ext`}>File extensions</Label>
            <Input
              id={`${inputId}-ext`}
              placeholder="p8, pem"
              value={field.extensions}
              onChange={(event) => onPatch({ extensions: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated, or leave empty to accept any file up to 1 MB.
            </p>
          </div>
          <CredentialFileField
            id={`${inputId}-file`}
            label={field.label || "File"}
            extensions={field.extensions
              .split(",")
              .map((extension) => extension.trim().toLowerCase().replace(/^\./, ""))
              .filter((extension) => extension !== "")}
            maxBytes={1024 * 1024}
            value={field.file}
            error={fileError}
            disabled={disabled}
            onValueChange={(file) => onPatch({ file })}
            onError={setFileError}
          />
        </>
      ) : field.kind === "secretMultiline" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-value`}>{field.label || "Value"}</Label>
          <div className="font-mono">
            <Textarea
              id={`${inputId}-value`}
              rows={3}
              value={field.value}
              onChange={(event) => onPatch({ value: event.target.value })}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-value`}>{field.label || "Value"}</Label>
          <Input
            id={`${inputId}-value`}
            type={field.kind === "secret" ? "password" : "text"}
            autoComplete="off"
            value={field.value}
            onChange={(event) => onPatch({ value: event.target.value })}
          />
        </div>
      )}
      {description === undefined ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

export function CredentialAddPanel({
  initialRequest,
  presetTemplateId,
  projects,
  error,
  onCreate,
  onCancel,
}: {
  readonly initialRequest?: Extract<CredentialPendingRequest, { kind: "add" }> | undefined;
  /** A template the caller already chose, such as a workflow step's missing credential. */
  readonly presetTemplateId?: string | null | undefined;
  readonly projects: ReadonlyArray<CredentialProjectOption>;
  readonly error: string | null;
  readonly onCreate: (input: CredentialCreateInput) => Promise<boolean>;
  readonly onCancel: () => void;
}) {
  const startingTemplateId = initialRequest?.templateId ?? presetTemplateId ?? null;
  const [templateId, setTemplateId] = useState<string | null>(startingTemplateId);
  const [draft, setDraft] = useState<CredentialFormDraft>({
    ...emptyCredentialFormDraft(startingTemplateId ?? CUSTOM_TEMPLATE_ID),
    ...(initialRequest?.name ? { name: initialRequest.name } : {}),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [envVarErrors, setEnvVarErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const notesId = useId();
  const expiryId = useId();
  const envId = useId();

  const template = templateId === null ? undefined : credentialTemplate(templateId);

  const patch = (next: Partial<CredentialFormDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const selectTemplate = (nextId: string) => {
    setTemplateId(nextId);
    setDraft({
      ...emptyCredentialFormDraft(nextId),
      ...(initialRequest?.name ? { name: initialRequest.name } : {}),
    });
    setFormError(null);
    setFieldErrors({});
    setEnvVarErrors({});
  };

  const changeType = () => {
    setTemplateId(null);
    setFormError(null);
    setFieldErrors({});
    setEnvVarErrors({});
  };

  const setEnvVarOverride = (fieldId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      envVarOverrides: { ...current.envVarOverrides, [fieldId]: value },
    }));
  };

  const updateCustomField = (index: number, next: Partial<CredentialFormCustomField>) => {
    setDraft((current) => ({
      ...current,
      customFields: current.customFields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...next } : field,
      ),
    }));
  };

  const addCustomField = () => {
    setDraft((current) => ({
      ...current,
      customFields: [
        ...current.customFields,
        {
          id: nextCustomFieldId(current.customFields),
          label: "",
          kind: "secret",
          envVar: "",
          required: true,
          extensions: "",
          value: "",
          file: null,
        },
      ],
    }));
  };

  const submit = () => {
    const built = buildCredentialCreateInput(draft);
    if (!built.ok) {
      setFormError(null);
      setFieldErrors({});
      setEnvVarErrors({});
      if (built.target === "envVar" && built.fieldId !== undefined) {
        setEnvVarErrors({ [built.fieldId]: built.message });
        return;
      }
      setFormError(built.message);
      if (built.fieldId !== undefined) setFieldErrors({ [built.fieldId]: built.message });
      return;
    }
    setFormError(null);
    setFieldErrors({});
    setEnvVarErrors({});
    setBusy(true);
    void onCreate({
      ...built.input,
      ...(initialRequest ? { requestId: initialRequest.id } : {}),
    }).then((ok) => {
      setBusy(false);
      if (ok) setDraft(emptyCredentialFormDraft(draft.templateId));
    });
  };

  const envVarNames =
    template?.dynamic === true
      ? template.id === ENV_BUNDLE_TEMPLATE_ID
        ? draft.envFields.map((field) => field.envVar)
        : draft.customFields.map((field) => field.envVar)
      : (template?.fields.map((field) => fixedFieldEnvVar(field, draft.envVarOverrides)) ?? []);

  if (template === undefined) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <ChevronLeftIcon />
            Back
          </Button>
          <div>
            <h2 className="text-base font-medium">Add credential</h2>
            <p className="text-xs text-muted-foreground">
              Pick a type, or Custom for anything else.
            </p>
          </div>
        </div>
        <TemplateGallery onSelect={selectTemplate} />
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <ChevronLeftIcon />
          Back
        </Button>
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <CredentialBrandIcon name={template.name} templateIcon={template.icon} />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-medium">{template.name}</h2>
            <p className="text-xs text-muted-foreground">{template.description}</p>
          </div>
          <Button type="button" variant="ghost-muted" size="sm" onClick={changeType}>
            Change type
          </Button>
        </div>
      </div>

      {formError === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {formError}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={draft.name}
          placeholder={`${template.name} (production)`}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </div>

      {template.id === ENV_BUNDLE_TEMPLATE_ID ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={envId}>Paste a .env file</Label>
            <div className="font-mono">
              <Textarea
                id={envId}
                rows={8}
                placeholder={"API_URL=https://example.com\nSTRIPE_SECRET_KEY=sk_live_…"}
                value={draft.envText}
                onChange={(event) => {
                  const text = event.target.value;
                  patch({ envText: text, envFields: envBundleFields(text) });
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Comments, <span className="font-mono">export</span> and quotes are handled. Every key
              becomes a secret field; later duplicates win.
            </p>
          </div>
          {draft.envFields.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {draft.envFields.length} {draft.envFields.length === 1 ? "key" : "keys"}
              </p>
              {draft.envFields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-2">
                  <Input
                    aria-label={`Environment variable for key ${index + 1}`}
                    value={field.envVar}
                    onChange={(event) => {
                      const envVar = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        envFields: current.envFields.map((candidate) =>
                          candidate.id === field.id
                            ? { ...candidate, envVar, label: envVar }
                            : candidate,
                        ),
                      }));
                    }}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : template.id === CUSTOM_TEMPLATE_ID ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Fields</span>
            <Button type="button" variant="outline" size="sm" onClick={addCustomField}>
              <PlusIcon />
              Add field
            </Button>
          </div>
          {draft.customFields.map((field, index) => (
            <CustomFieldRow
              key={field.id}
              field={field}
              error={fieldErrors[field.id] ?? null}
              disabled={busy}
              onPatch={(next) => updateCustomField(index, next)}
              onRemove={() =>
                setDraft((current) => ({
                  ...current,
                  customFields: current.customFields.filter(
                    (_, fieldIndex) => fieldIndex !== index,
                  ),
                }))
              }
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {template.fields.map((field) => (
            <FixedField
              key={field.id}
              field={field}
              draft={draft}
              envVar={fixedFieldEnvVar(field, draft.envVarOverrides)}
              error={
                field.highRisk === true ? "High risk: agents should never see this value." : null
              }
              fieldError={fieldErrors[field.id] ?? null}
              envVarError={envVarErrors[field.id] ?? null}
              onEnvVarChange={(value) => setEnvVarOverride(field.id, value)}
              onError={(message) =>
                setFieldErrors((current) =>
                  message === null
                    ? Object.fromEntries(
                        Object.entries(current).filter(([key]) => key !== field.id),
                      )
                    : { ...current, [field.id]: message },
                )
              }
              onPlainChange={(fieldId, value) =>
                setDraft((current) => ({
                  ...current,
                  plainValues: { ...current.plainValues, [fieldId]: value },
                }))
              }
              onSecretChange={(fieldId, secretPatch) =>
                setDraft((current) => ({
                  ...current,
                  secretValues: {
                    ...current.secretValues,
                    [fieldId]: {
                      ...(current.secretValues[fieldId] ?? { value: "", file: null }),
                      ...secretPatch,
                    },
                  },
                }))
              }
            />
          ))}
        </div>
      )}

      {envVarNames.length > 0 ? (
        <div className="space-y-1">
          <span className="text-sm font-medium">Agents get these as</span>
          <p className="text-xs font-mono text-muted-foreground">{envVarNames.join(" · ")}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={notesId}>Notes</Label>
        <Textarea
          id={notesId}
          rows={2}
          value={draft.notes}
          onChange={(event) => patch({ notes: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={expiryId}>Expires on</Label>
        <Input
          id={expiryId}
          type="date"
          value={draft.expiresAt}
          onChange={(event) => patch({ expiresAt: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Optional. T3 warns two weeks before this date.
        </p>
      </div>

      <CredentialProjectScope
        projects={projects}
        scope={draft.scope}
        projectIds={draft.projectIds}
        disabled={busy}
        onChange={(scope, projectIds) => patch({ scope, projectIds })}
      />

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Add credential"}
        </Button>
      </div>
    </form>
  );
}
