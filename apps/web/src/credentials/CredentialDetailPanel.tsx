import { CredentialUsageSummary } from "./CredentialUsageSummary";
import { CredentialGrantLabel } from "./CredentialGrantLabel";
import type { CredentialGrant, EnvironmentId } from "@t3tools/contracts";
import { CredentialHistory } from "./CredentialHistory";
import {
  IsoDateTime,
  type Credential,
  type CredentialField,
  type CredentialFieldDefinitionInput,
  type CredentialFieldId,
  type CredentialFieldKind,
  type CredentialHistoryEvent,
  type CredentialPolicy,
  type CredentialSetSecretInput,
  type CredentialUpdateInput,
} from "@t3tools/contracts";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { credentialStatusPresentation } from "@t3tools/shared/credentialPresentation";
import { ChevronLeftIcon, ClockIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { formatRelativeTimeLabel } from "../timestampFormat";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
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
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { CredentialBrandIcon } from "./CredentialBrandIcon";
import { CredentialFileField } from "./CredentialFileField";
import { CredentialIconPicker } from "./CredentialIconPicker";
import { CredentialProjectScope, type CredentialProjectOption } from "./CredentialProjectScope";
import {
  credentialFieldId,
  envVarError,
  envVarFromLabel,
  formatBytes,
  type CredentialFormFile,
} from "./credentialDraft";

export interface CredentialHistoryView {
  readonly events: ReadonlyArray<CredentialHistoryEvent>;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly nextCursor?: string | undefined;
}

const fieldValue = (field: CredentialField): string => field.value ?? "";

const secretSummary = (field: CredentialField): string => {
  if (field.secret?.set !== true) return "Not set";
  return field.secret.updatedAt === undefined
    ? "Set ✓"
    : `Set ✓ · updated ${formatRelativeTimeLabel(field.secret.updatedAt)}`;
};

const EMPTY_GRANTS: ReadonlyArray<CredentialGrant> = [];

/** The editable shape of a field: what the list shows while the panel is in edit mode. */
interface FieldDraft {
  readonly id: string;
  readonly label: string;
  readonly envVar: string;
  readonly kind: CredentialFieldKind;
  readonly required: boolean;
}

const draftOf = (field: CredentialField): FieldDraft => ({
  id: field.id,
  label: field.label,
  envVar: field.envVar,
  kind: field.kind,
  required: field.required,
});

/** Whether a field holds something, which decides if its kind may still change. */
const fieldHasValue = (field: CredentialField | undefined): boolean =>
  field === undefined
    ? false
    : field.kind === "text"
      ? (field.value ?? "").trim() !== ""
      : field.secret?.set === true;

const FIELD_KIND_OPTIONS: ReadonlyArray<{
  readonly value: CredentialFieldKind;
  readonly label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "secret", label: "Secret" },
  { value: "secretMultiline", label: "Multi-line secret" },
  { value: "secretFile", label: "File" },
];

const nextFieldDraftId = (drafts: ReadonlyArray<FieldDraft>): string =>
  credentialFieldId(`field-${drafts.length + 1}`, new Set(drafts.map((draft) => draft.id)));

/**
 * Changing the kind of a field that already holds a value would discard it, so that option is
 * disabled and explained rather than silently losing the secret.
 */
function FieldKindSelect({
  label,
  value,
  locked,
  onChange,
}: {
  readonly label: string;
  readonly value: CredentialFieldKind;
  readonly locked: boolean;
  readonly onChange: (kind: CredentialFieldKind) => void;
}) {
  const select = (
    <Select
      value={value}
      disabled={locked}
      onValueChange={(next) => onChange(next as CredentialFieldKind)}
    >
      <SelectTrigger size="sm" aria-label={`Kind of ${label}`}>
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
  );
  if (!locked) return <div className="w-40 shrink-0">{select}</div>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex w-40 shrink-0" />}>
        {select}
      </TooltipTrigger>
      <TooltipPopup>Remove the stored value before changing the kind.</TooltipPopup>
    </Tooltip>
  );
}

/**
 * One field while the panel is in edit mode. The stored field is what the row started from, so the
 * row can keep naming the inputs after it while the label draft changes, and can tell whether a
 * kind change would throw a value away.
 */
function FieldEditRow({
  draft,
  storedField,
  templateEnvVar,
  envVarError,
  dynamic,
  plainValue,
  busy,
  onLabelChange,
  onPatch,
  onPlainValueChange,
  onRemove,
}: {
  readonly draft: FieldDraft;
  readonly storedField: CredentialField | undefined;
  readonly templateEnvVar: string | undefined;
  readonly envVarError: string | null;
  readonly dynamic: boolean;
  readonly plainValue: string;
  readonly busy: boolean;
  readonly onLabelChange: (label: string) => void;
  readonly onPatch: (patch: Partial<FieldDraft>) => void;
  readonly onPlainValueChange: (value: string) => void;
  readonly onRemove: () => void;
}) {
  const original = storedField?.label ?? "new field";
  const locked = fieldHasValue(storedField);
  return (
    <div className="space-y-2 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Input
            aria-label={`Label for ${original}`}
            placeholder="Field name"
            value={draft.label}
            onChange={(event) => onLabelChange(event.target.value)}
          />
          <div className="flex items-center gap-1">
            <Input
              aria-label={`Environment variable for ${original}`}
              placeholder="ENV_VAR_NAME"
              value={draft.envVar}
              onChange={(event) => onPatch({ envVar: event.target.value })}
            />
            {templateEnvVar !== undefined && draft.envVar !== templateEnvVar ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={`Reset environment variable for ${original}`}
                onClick={() => onPatch({ envVar: templateEnvVar })}
              >
                Reset
              </Button>
            ) : null}
          </div>
          {envVarError === null ? null : (
            <p role="alert" className="text-xs text-destructive-foreground">
              {envVarError}
            </p>
          )}
          {dynamic ? (
            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              <FieldKindSelect
                label={original}
                value={draft.kind}
                locked={locked}
                onChange={(kind) => onPatch({ kind })}
              />
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  aria-label={`Required ${original}`}
                  checked={draft.required}
                  disabled={busy}
                  onCheckedChange={(checked) => onPatch({ required: checked === true })}
                />
                Required
              </label>
            </div>
          ) : null}
        </div>
        <div className="flex w-1/2 shrink-0 items-start justify-end gap-1">
          {draft.kind === "text" ? (
            <Input
              aria-label={`Value of ${original}`}
              value={plainValue}
              onChange={(event) => onPlainValueChange(event.target.value)}
            />
          ) : storedField === undefined ? (
            <span className="pt-1.5 text-xs text-muted-foreground">Set after saving</span>
          ) : (
            <span className="pt-1.5 text-xs text-muted-foreground">
              {secretSummary(storedField)}
            </span>
          )}
          {dynamic ? (
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-micro"
              aria-label={`Remove field ${original}`}
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2Icon />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CredentialDetailPanel({
  credential,
  environmentId,
  grants = EMPTY_GRANTS,
  grantsError = null,
  onRevokeGrant,
  projects,
  history,
  onBack,
  onUpdate,
  onSetSecret,
  onRemoveSecret,
  onDelete,
  onLoadMoreHistory,
}: {
  readonly environmentId?: EnvironmentId | undefined;
  readonly grants?: ReadonlyArray<CredentialGrant>;
  readonly grantsError?: string | null;
  readonly onRevokeGrant?: ((grant: CredentialGrant) => Promise<unknown>) | undefined;
  readonly credential: Credential;
  readonly projects: ReadonlyArray<CredentialProjectOption>;
  readonly history: CredentialHistoryView;
  readonly onBack: () => void;
  readonly onUpdate: (input: CredentialUpdateInput) => Promise<boolean>;
  readonly onSetSecret: (input: CredentialSetSecretInput) => Promise<boolean>;
  readonly onRemoveSecret: (fieldId: CredentialFieldId) => Promise<boolean>;
  readonly onDelete: () => void;
  readonly onLoadMoreHistory: () => void;
}) {
  const template = credentialTemplate(credential.templateId);
  const dynamicFields = template?.dynamic === true;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [name, setName] = useState(credential.name);
  const [notes, setNotes] = useState(credential.notes ?? "");
  const [expiresAt, setExpiresAt] = useState(
    credential.expiresAt === undefined ? "" : credential.expiresAt.slice(0, 10),
  );
  const [plainDrafts, setPlainDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      credential.fields
        .filter((field) => field.kind === "text")
        .map((field) => [field.id, fieldValue(field)]),
    ),
  );
  const [fieldDrafts, setFieldDrafts] = useState<ReadonlyArray<FieldDraft>>(() =>
    credential.fields.map(draftOf),
  );
  const [envVarErrors, setEnvVarErrors] = useState<Readonly<Record<string, string>>>({});
  const [removalTarget, setRemovalTarget] = useState<FieldDraft | null>(null);
  const [replacing, setReplacing] = useState<CredentialFieldId | null>(null);
  const [replaceValue, setReplaceValue] = useState("");
  const [replaceFile, setReplaceFile] = useState<CredentialFormFile | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const detailId = useId();
  const notesId = `${detailId}-notes`;
  const expiryId = `${detailId}-expiry`;
  const nameId = `${detailId}-name`;

  const status = credentialStatusPresentation(credential.status);
  const templateName = template?.name ?? credential.templateId;
  const storedFields = new Map(credential.fields.map((field) => [field.id, field] as const));

  const resetDetails = () => {
    setName(credential.name);
    setNotes(credential.notes ?? "");
    setExpiresAt(credential.expiresAt === undefined ? "" : credential.expiresAt.slice(0, 10));
    setPlainDrafts(
      Object.fromEntries(
        credential.fields
          .filter((field) => field.kind === "text")
          .map((field) => [field.id, fieldValue(field)]),
      ),
    );
    setFieldDrafts(credential.fields.map(draftOf));
    setEnvVarErrors({});
    setRemovalTarget(null);
    setEditing(false);
  };

  const beginEdit = () => {
    // A save replaces this credential in the list; start from what is stored rather than from the
    // drafts the last edit left behind.
    resetDetails();
    setEditing(true);
  };

  const updateFieldDraft = (id: string, patch: Partial<FieldDraft>) => {
    setFieldDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  };

  const renameField = (draft: FieldDraft, label: string) => {
    const previous = envVarFromLabel(draft.label);
    const next = envVarFromLabel(label);
    // Follow the label until the user takes the environment variable over.
    updateFieldDraft(draft.id, {
      label,
      ...(draft.envVar === previous || draft.envVar === "" ? { envVar: next } : {}),
    });
  };

  const addField = () => {
    setFieldDrafts((current) => [
      ...current,
      {
        id: nextFieldDraftId(current),
        label: "",
        envVar: "",
        kind: "secret",
        required: true,
      },
    ]);
  };

  const requestRemoveField = (draft: FieldDraft) => {
    if (fieldHasValue(storedFields.get(draft.id))) {
      setRemovalTarget(draft);
      return;
    }
    setFieldDrafts((current) => current.filter((candidate) => candidate.id !== draft.id));
  };

  const confirmRemoveField = () => {
    const target = removalTarget;
    setRemovalTarget(null);
    if (target === null) return;
    setFieldDrafts((current) => current.filter((candidate) => candidate.id !== target.id));
  };

  const saveDetails = () => {
    if (name.trim() === "") {
      setActionError("Give this credential a name.");
      return;
    }
    if (fieldDrafts.length === 0) {
      setActionError("A credential needs at least one field.");
      return;
    }
    if (fieldDrafts.some((draft) => draft.label.trim() === "")) {
      setActionError("Give every field a name.");
      return;
    }
    const definitions: ReadonlyArray<CredentialFieldDefinitionInput> = fieldDrafts.map((draft) => ({
      id: draft.id,
      label: draft.label.trim(),
      kind: draft.kind,
      envVar: draft.envVar.trim(),
      required: draft.required,
    }));
    const envProblem = envVarError(definitions);
    if (envProblem !== null) {
      setActionError(null);
      setEnvVarErrors({ [envProblem.fieldId]: envProblem.message });
      return;
    }
    setEnvVarErrors({});
    const changedPlainFields = Object.fromEntries(
      fieldDrafts
        .filter((draft) => draft.kind === "text")
        .filter((draft) => {
          const stored = storedFields.get(draft.id);
          const current = stored?.kind === "text" ? fieldValue(stored) : "";
          return (plainDrafts[draft.id] ?? "") !== current;
        })
        .map((draft) => [draft.id, plainDrafts[draft.id] ?? ""]),
    );
    const fieldsChanged =
      definitions.length !== credential.fields.length ||
      definitions.some((definition) => {
        const stored = storedFields.get(definition.id);
        return (
          stored === undefined ||
          stored.label !== definition.label ||
          stored.envVar !== definition.envVar ||
          stored.kind !== definition.kind ||
          stored.required !== (definition.required ?? false)
        );
      });
    const trimmedExpiry = expiresAt.trim();
    const currentExpiry = credential.expiresAt?.slice(0, 10) ?? "";
    const expiryChanged = trimmedExpiry !== currentExpiry;
    const expiryValue =
      trimmedExpiry === "" ? null : IsoDateTime.make(`${trimmedExpiry}T00:00:00.000Z`);
    const nextNotes = notes.trim() === "" ? null : notes;
    const nameChanged = name.trim() !== credential.name;
    const notesChanged = (credential.notes ?? "") !== (nextNotes ?? "");
    if (
      !nameChanged &&
      !notesChanged &&
      !expiryChanged &&
      !fieldsChanged &&
      Object.keys(changedPlainFields).length === 0
    ) {
      setEditing(false);
      return;
    }
    setActionError(null);
    setBusy(true);
    void onUpdate({
      id: credential.id,
      ...(nameChanged ? { name: name.trim() } : {}),
      ...(fieldsChanged ? { fields: definitions } : {}),
      ...(Object.keys(changedPlainFields).length === 0 ? {} : { plainFields: changedPlainFields }),
      ...(notesChanged ? { notes: nextNotes } : {}),
      ...(expiryChanged ? { expiresAt: expiryValue } : {}),
    }).then((ok) => {
      setBusy(false);
      if (ok) setEditing(false);
    });
  };

  const updatePolicy = (policy: CredentialPolicy) => {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    void onUpdate({ id: credential.id, policy }).then(() => {
      setBusy(false);
    });
  };

  const beginReplace = (field: CredentialField) => {
    setReplacing(field.id);
    setReplaceValue("");
    setReplaceFile(null);
    setReplaceError(null);
  };

  const cancelReplace = () => {
    setReplacing(null);
    setReplaceValue("");
    setReplaceFile(null);
    setReplaceError(null);
  };

  const submitReplace = (field: CredentialField) => {
    const input: CredentialSetSecretInput =
      field.kind === "secretFile"
        ? replaceFile === null
          ? { id: credential.id, fieldId: field.id }
          : {
              id: credential.id,
              fieldId: field.id,
              base64: replaceFile.base64,
              fileName: replaceFile.fileName,
            }
        : { id: credential.id, fieldId: field.id, value: replaceValue };
    if (field.kind === "secretFile" && replaceFile === null) {
      setReplaceError("Choose a file first.");
      return;
    }
    if (field.kind !== "secretFile" && replaceValue === "") {
      setReplaceError("Enter a value first.");
      return;
    }
    setBusy(true);
    setActionError(null);
    void onSetSecret(input).then((ok) => {
      setBusy(false);
      setReplaceValue("");
      setReplaceFile(null);
      if (ok) {
        setReplacing(null);
        setReplaceError(null);
      }
    });
  };

  const removeSecret = (field: CredentialField) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    void onRemoveSecret(field.id).then(() => {
      setBusy(false);
    });
  };

  const updateIcon = (slug: string | null) => {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    void onUpdate({ id: credential.id, icon: slug }).then(() => {
      setBusy(false);
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon />
          All credentials
        </Button>
      </div>

      <div className="flex items-start gap-3">
        <CredentialBrandIcon
          name={credential.name}
          templateIcon={template?.icon ?? null}
          iconOverride={credential.icon ?? null}
          envVars={credential.fields.map((field) => field.envVar)}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium">{credential.name}</h2>
          <CredentialUsageSummary
            credentialId={credential.id}
            environmentId={environmentId}
            events={history.events}
          />
          <p className="text-xs text-muted-foreground">
            {templateName} · added {formatRelativeTimeLabel(credential.createdAt)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {credential.lastUsedAt === undefined ? (
              <span className="text-xs text-muted-foreground">Never used</span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Last used {formatRelativeTimeLabel(credential.lastUsedAt)}
              </span>
            )}
          </div>
        </div>
        {editing ? null : (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={beginEdit}>
            <PencilIcon />
            Edit
          </Button>
        )}
      </div>

      {actionError === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {actionError}
        </p>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Fields</h3>
          {editing && dynamicFields ? (
            <Button type="button" variant="outline" size="xs" disabled={busy} onClick={addField}>
              <PlusIcon />
              Add field
            </Button>
          ) : null}
        </div>
        <div className="divide-y divide-border rounded-lg border border-border">
          {editing
            ? fieldDrafts.map((draft) => (
                <FieldEditRow
                  key={draft.id}
                  draft={draft}
                  storedField={storedFields.get(draft.id)}
                  templateEnvVar={
                    template?.fields.find((candidate) => candidate.id === draft.id)?.envVar
                  }
                  envVarError={envVarErrors[draft.id] ?? null}
                  dynamic={dynamicFields}
                  plainValue={plainDrafts[draft.id] ?? ""}
                  busy={busy}
                  onLabelChange={(label) => renameField(draft, label)}
                  onPatch={(patch) => updateFieldDraft(draft.id, patch)}
                  onPlainValueChange={(value) =>
                    setPlainDrafts((current) => ({ ...current, [draft.id]: value }))
                  }
                  onRemove={() => requestRemoveField(draft)}
                />
              ))
            : credential.fields.map((field) => (
                <div key={field.id} className="space-y-2 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{field.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {field.envVar}
                        {field.required ? "" : " · optional"}
                        {field.highRisk ? " · high risk" : ""}
                      </p>
                    </div>
                    {field.kind === "text" ? (
                      <p className="w-1/2 shrink-0 break-all text-right font-mono text-sm">
                        {fieldValue(field) === "" ? "Not set" : fieldValue(field)}
                      </p>
                    ) : (
                      <div className="flex w-1/2 shrink-0 flex-col items-end gap-1">
                        <span className="text-xs text-muted-foreground">
                          {secretSummary(field)}
                        </span>
                        {field.secret?.fileName === undefined ? null : (
                          <span className="text-xs text-muted-foreground">
                            {field.secret.fileName}
                            {field.secret.size === undefined
                              ? ""
                              : ` · ${formatBytes(field.secret.size)}`}
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={busy}
                            onClick={() => beginReplace(field)}
                          >
                            Replace
                          </Button>
                          {field.secret?.set === true ? (
                            <Button
                              type="button"
                              variant="ghost-destructive"
                              size="xs"
                              disabled={busy}
                              onClick={() => removeSecret(field)}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                  {replacing === field.id ? (
                    <div className="space-y-2 rounded-lg border border-border p-2">
                      {field.kind === "secretFile" ? (
                        <CredentialFileField
                          id={`replace-${field.id}`}
                          label={`Replace ${field.label}`}
                          extensions={field.extensions}
                          maxBytes={field.maxBytes}
                          value={replaceFile}
                          error={replaceError}
                          disabled={busy}
                          onValueChange={setReplaceFile}
                          onError={setReplaceError}
                        />
                      ) : (
                        <div className="space-y-1.5">
                          <Label htmlFor={`replace-${field.id}`}>Replace {field.label}</Label>
                          {field.kind === "secretMultiline" ? (
                            <div className="font-mono">
                              <Textarea
                                id={`replace-${field.id}`}
                                rows={3}
                                value={replaceValue}
                                onChange={(event) => setReplaceValue(event.target.value)}
                              />
                            </div>
                          ) : (
                            <Input
                              id={`replace-${field.id}`}
                              type="password"
                              autoComplete="off"
                              value={replaceValue}
                              onChange={(event) => setReplaceValue(event.target.value)}
                            />
                          )}
                          {replaceError === null ? null : (
                            <p role="alert" className="text-xs text-destructive-foreground">
                              {replaceError}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" variant="ghost" size="xs" onClick={cancelReplace}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          disabled={busy}
                          onClick={() => submitReplace(field)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {dynamicFields
            ? "Each value reaches a command under its environment variable name."
            : "This type has fixed fields. You can rename them and change which environment variable carries each value."}
        </p>
      </section>

      <AlertDialog
        open={removalTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemovalTarget(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removalTarget?.label ?? "this field"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its stored value is deleted too. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmRemoveField}>
              Remove field
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Details</h3>
        <div className="space-y-3 rounded-lg border border-border p-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={nameId}>Name</Label>
                <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={notesId}>Notes</Label>
                <Textarea
                  id={notesId}
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={expiryId}>Expires on</Label>
                <Input
                  id={expiryId}
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={resetDetails}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={saveDetails}>
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm">
                  {credential.notes === undefined || credential.notes.trim() === ""
                    ? "No notes."
                    : credential.notes}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ClockIcon className="size-3.5" />
                {credential.expiresAt === undefined
                  ? "No expiry date."
                  : `Expires ${credential.expiresAt.slice(0, 10)}.`}
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Icon</span>
                <CredentialIconPicker
                  name={credential.name}
                  value={credential.icon ?? null}
                  onValueChange={updateIcon}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Policy</h3>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <label className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm">Always ask before agents use this</span>
              <span className="block text-xs text-muted-foreground">
                Overrides a workflow's own approval setting.
              </span>
            </span>
            <Switch
              checked={credential.policy.alwaysAsk}
              disabled={busy}
              onCheckedChange={(checked) =>
                updatePolicy({ ...credential.policy, alwaysAsk: checked === true })
              }
            />
          </label>
          <label className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm">Allow the model provider to see this value</span>
              <span className="block text-xs text-warning-foreground">
                The model provider will see this value. Only do this for low-risk or test keys.
              </span>
            </span>
            <Switch
              checked={credential.policy.revealAllowed}
              disabled={busy}
              onCheckedChange={(checked) =>
                updatePolicy({ ...credential.policy, revealAllowed: checked === true })
              }
            />
          </label>
          <CredentialProjectScope
            projects={projects}
            scope={credential.policy.projects === "all" ? "all" : "selected"}
            projectIds={credential.policy.projects === "all" ? [] : credential.policy.projects}
            disabled={busy}
            onChange={(scope, projectIds) =>
              updatePolicy({
                ...credential.policy,
                projects: scope === "all" ? "all" : projectIds,
              })
            }
          />
        </div>
      </section>

      <section className="space-y-2" aria-label="Credential grants">
        <h3 className="text-xs font-medium text-muted-foreground">Grants</h3>
        {grantsError ? (
          <p role="alert" className="text-xs text-destructive">
            {grantsError}
          </p>
        ) : null}
        {grants.length ? (
          grants.map((grant) => (
            <div
              key={grant.id}
              className="flex items-start justify-between gap-2 rounded border p-2"
            >
              <div className="min-w-0 text-xs">
                <CredentialGrantLabel
                  grant={grant}
                  environmentId={environmentId}
                  projectTitle={projects.find((project) => project.id === grant.projectId)?.title}
                />
                <time dateTime={grant.createdAt}>
                  {grant.kind === "workflow-preapproval"
                    ? `Pre-approved ${formatRelativeTimeLabel(grant.createdAt)} · by you (unlocked session)`
                    : `Created ${formatRelativeTimeLabel(grant.createdAt)}`}
                </time>
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={busy || !onRevokeGrant}
                onClick={() => {
                  setBusy(true);
                  void onRevokeGrant?.(grant).then(() => setBusy(false));
                }}
              >
                Revoke
              </Button>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No saved grants.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">History</h3>
        <div className="rounded-lg border border-border">
          {history.error === null ? null : (
            <p role="alert" className="px-3 py-2 text-sm text-destructive-foreground">
              {history.error}
            </p>
          )}
          {history.loading ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Loading history…</p>
          ) : (
            <CredentialHistory events={history.events} environmentId={environmentId} />
          )}

          {history.nextCursor === undefined ? null : (
            <div className="border-t border-border px-3 py-2">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={history.loadingMore}
                onClick={onLoadMoreHistory}
              >
                <PlusIcon />
                {history.loadingMore ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </div>
      </section>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <XIcon />
          Close
        </Button>
        <Button
          type="button"
          variant="destructive-outline"
          size="sm"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2Icon />
          Delete credential
        </Button>
      </div>
    </div>
  );
}
