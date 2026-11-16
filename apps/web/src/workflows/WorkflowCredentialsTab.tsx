import type { ReactNode } from "react";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  MAX_WORKFLOW_STEP_ATTACHMENTS,
  type Credential,
  type EnvironmentId,
  type ProjectId,
  type WorkflowListing,
  type WorkflowStep,
} from "@t3tools/contracts";
import { KeyRoundIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { credentialStatusPresentation } from "@t3tools/shared/credentialPresentation";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { CredentialBrandIcon } from "../credentials/CredentialBrandIcon";
import { createCredential, credentialListQuery } from "../credentials/credentialState";
import { useProjects } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import type { CredentialProjectOption } from "../credentials/CredentialProjectScope";
import { WorkflowCredentialApprovals } from "./WorkflowCredentialApprovals";
import {
  credentialAttachmentsOf,
  credentialTemplateLabel,
  suggestedCredentialTemplateIds,
  stepUsesCredential,
} from "./workflowCredentialAttachments";

/** The empty vault's shortcuts, in the order the credential design names them. */
const EMPTY_VAULT_TEMPLATES = [
  "app-store-connect",
  "github",
  "vercel",
  "revenuecat",
  "custom",
] as const;

const envVarsOf = (credential: Credential) => credential.fields.map((field) => field.envVar);

/** The project a credential is limited to, when it is limited to one this app knows. */
function projectScopeLabel(
  credential: Credential,
  projectId: ProjectId | null,
  projects: ReadonlyArray<CredentialProjectOption>,
): string | null {
  if (credential.policy.projects === "all") return null;
  const allowed = credential.policy.projects;
  if (projectId !== null && allowed.includes(projectId)) return null;
  if (allowed.length === 1) {
    const only = projects.find((project) => project.id === allowed[0]);
    return only ? `Only for ${only.title}` : "Only for another project";
  }
  return "Only for other projects";
}

function CredentialRow({
  credential,
  projectId,
  projects,
  checked,
  attached,
  disabled,
  onToggle,
  onOpen,
}: {
  readonly credential: Credential;
  readonly projectId: ProjectId | null;
  readonly projects: ReadonlyArray<CredentialProjectOption>;
  readonly checked: boolean;
  readonly attached: boolean;
  readonly disabled: boolean;
  readonly onToggle: (checked: boolean) => void;
  readonly onOpen: () => void;
}) {
  const template = credentialTemplate(credential.templateId);
  const status = credentialStatusPresentation(credential.status);
  const scope = projectScopeLabel(credential, projectId, projects);
  const blocked = scope !== null;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/60">
      <Checkbox
        aria-label={`Attach ${credential.name}`}
        checked={checked}
        disabled={disabled || blocked || attached}
        onCheckedChange={(next) => onToggle(next === true)}
      />
      <CredentialBrandIcon
        name={credential.name}
        templateIcon={template?.icon ?? null}
        iconOverride={credential.icon ?? null}
        envVars={envVarsOf(credential)}
        size="sm"
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onOpen}
        aria-label={`Open ${credential.name}`}
      >
        <span className="block truncate text-xs font-medium">{credential.name}</span>
        <span className="block truncate text-2xs text-muted-foreground">
          {template?.name ?? credential.templateId}
        </span>
      </button>
      <span className="hidden min-w-0 max-w-40 truncate font-mono text-3xs text-muted-foreground sm:block">
        {envVarsOf(credential).join(" · ")}
      </span>
      {attached ? (
        <Badge variant="secondary" size="sm">
          Attached
        </Badge>
      ) : blocked ? (
        <Badge variant="warning" size="sm">
          {scope}
        </Badge>
      ) : (
        <Badge variant={status.variant} size="sm">
          {status.label}
        </Badge>
      )}
    </div>
  );
}

function TemplateShortcut({
  templateId,
  onPick,
}: {
  readonly templateId: string;
  readonly onPick: (templateId: string) => void;
}) {
  const template = credentialTemplate(templateId);
  const name = template?.name ?? templateId;
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-2 rounded-full border border-border px-2 py-1 text-2xs hover:bg-accent"
      onClick={() => onPick(templateId)}
    >
      {templateId === "custom" ? (
        <PlusIcon className="size-3 shrink-0" />
      ) : (
        <CredentialBrandIcon name={name} templateIcon={template?.icon ?? null} size="xs" />
      )}
      <span className="truncate">{name}</span>
    </button>
  );
}

/**
 * Resources → Credentials. Its job is one gesture: pick what this step needs, attach the lot. The
 * same rows suggest from the step's own words, so a step that says "upload to TestFlight" offers
 * App Store Connect before the run rather than failing during it.
 */
export function WorkflowCredentialsTab({
  projectId,
  projects,
  step,
  credentials,
  loading,
  error,
  disabled,
  approvals,
  onAttach,
  onNewCredential,
  onManage,
  onOpenCredential,
}: {
  readonly projectId: ProjectId | null;
  readonly projects: ReadonlyArray<CredentialProjectOption>;
  readonly step: WorkflowStep;
  readonly credentials: ReadonlyArray<Credential>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly approvals: ReactNode;
  readonly onAttach: (
    credentials: ReadonlyArray<Credential>,
  ) => void | boolean | Promise<void | boolean>;
  readonly onNewCredential: (templateId: string | null) => void;
  readonly onManage: () => void;
  readonly onOpenCredential: (credentialId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const attachedTemplateIds = new Set(
    credentialAttachmentsOf(step).map((attachment) => attachment.templateId),
  );
  const suggested = suggestedCredentialTemplateIds({
    step,
    attachedServers: (step.attachments ?? []).flatMap((attachment) =>
      attachment.kind === "mcp-connection" ? [attachment.server] : [],
    ),
  });
  const suggestedCredentials = credentials.filter(
    (credential) =>
      suggested.includes(credential.templateId) &&
      !stepUsesCredential(step, credential.id) &&
      projectScopeLabel(credential, projectId, projects) === null,
  );
  const suggestedWithoutCredential = suggested.filter(
    (templateId) =>
      !credentials.some((credential) => credential.templateId === templateId) &&
      !attachedTemplateIds.has(templateId),
  );
  const normalized = query.trim().toLowerCase();
  const visible = credentials.filter((credential) => {
    if (normalized === "") return true;
    return [
      credential.name,
      credentialTemplateLabel(credential.templateId),
      ...envVarsOf(credential),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
  const selectable = visible.filter(
    (credential) =>
      !stepUsesCredential(step, credential.id) &&
      projectScopeLabel(credential, projectId, projects) === null,
  );
  const chosen = selectable.filter((credential) => selected.has(credential.id));
  const remaining = MAX_WORKFLOW_STEP_ATTACHMENTS - (step.attachments?.length ?? 0);
  const toggle = (credentialId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(credentialId);
      else next.delete(credentialId);
      return next;
    });
  const attach = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    const result = await Promise.resolve(onAttach(chosen)).then(
      (value) => {
        setBusy(false);
        return value;
      },
      (failure: unknown) => {
        setBusy(false);
        throw failure;
      },
    );
    if (result === false) return;
    setSelected(new Set());
    setQuery("");
  };

  return (
    <div className="w-full min-w-0 space-y-2">
      <Input
        type="search"
        aria-label="Search credentials"
        placeholder="Search credentials…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {credentials.length === 0 && !loading && error === null ? (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <div className="flex items-center gap-2">
            <KeyRoundIcon className="size-3.5 text-muted-foreground" />
            <p className="text-xs font-medium">No credentials yet</p>
          </div>
          <p className="text-2xs text-muted-foreground">
            Add one here and it attaches to this step when you save it.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EMPTY_VAULT_TEMPLATES.map((templateId) => (
              <TemplateShortcut
                key={templateId}
                templateId={templateId}
                onPick={(id) => onNewCredential(id)}
              />
            ))}
          </div>
        </div>
      ) : loading && credentials.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">Loading credentials…</p>
      ) : error !== null ? (
        <p role="alert" className="px-1 py-1 text-xs text-destructive">
          {error}
        </p>
      ) : (
        <>
          {suggestedCredentials.length > 0 || suggestedWithoutCredential.length > 0 ? (
            <section className="space-y-1" aria-label="Suggested for this step">
              <h3 className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Suggested for this step
              </h3>
              {suggestedCredentials.map((credential) => (
                <CredentialRow
                  key={`suggested-${credential.id}`}
                  credential={credential}
                  projectId={projectId}
                  projects={projects}
                  checked={selected.has(credential.id)}
                  attached={stepUsesCredential(step, credential.id)}
                  disabled={disabled}
                  onToggle={(checked) => toggle(credential.id, checked)}
                  onOpen={() => onOpenCredential(credential.id)}
                />
              ))}
              {suggestedWithoutCredential.map((templateId) => (
                <div
                  key={`suggested-template-${templateId}`}
                  className="flex min-w-0 items-center gap-2 px-1.5 py-1"
                >
                  <CredentialBrandIcon
                    name={credentialTemplateLabel(templateId)}
                    templateIcon={credentialTemplate(templateId)?.icon ?? null}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {credentialTemplateLabel(templateId)}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={`Add ${credentialTemplateLabel(templateId)}`}
                    disabled={disabled}
                    onClick={() => onNewCredential(templateId)}
                  >
                    <PlusIcon /> Add
                  </Button>
                </div>
              ))}
            </section>
          ) : null}

          <section className="space-y-1" aria-label="All credentials">
            <h3 className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              All credentials
            </h3>
            {visible.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No credentials match “{query.trim()}”.
              </p>
            ) : (
              visible.map((credential) => (
                <CredentialRow
                  key={credential.id}
                  credential={credential}
                  projectId={projectId}
                  projects={projects}
                  checked={selected.has(credential.id)}
                  attached={stepUsesCredential(step, credential.id)}
                  disabled={disabled}
                  onToggle={(checked) => toggle(credential.id, checked)}
                  onOpen={() => onOpenCredential(credential.id)}
                />
              ))
            )}
          </section>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={() => onNewCredential(null)}>
            <PlusIcon /> New credential…
          </Button>
          <Button variant="ghost" size="xs" onClick={onManage}>
            <SettingsIcon /> Manage credentials…
          </Button>
        </div>
        <Button
          size="xs"
          disabled={disabled || busy || chosen.length === 0 || chosen.length > remaining}
          onClick={() => void attach()}
        >
          {busy ? "Attaching…" : `Attach ${chosen.length || ""}`.trim()}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">{approvals}</div>
      <p className="text-2xs text-muted-foreground">
        Attachment stores the credential's type and this environment's id. Values never enter the
        workflow file.
      </p>
    </div>
  );
}

/**
 * The picker's mounted form: reads the vault only while the tab is open and authorized, so an
 * unopened Resources popover costs nothing.
 */
export function WorkflowCredentialsTabConnected({
  environmentId,
  projectId,
  step,
  listing,
  disabled,
  onAttach,
  onNewCredential,
  onManage,
  onOpenCredential,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly step: WorkflowStep;
  readonly listing: WorkflowListing;
  readonly disabled: boolean;
  readonly onAttach: (
    credentials: ReadonlyArray<Credential>,
  ) => void | boolean | Promise<void | boolean>;
  readonly onNewCredential: (templateId: string | null) => void;
  readonly onManage: () => void;
  readonly onOpenCredential: (credentialId: string) => void;
}) {
  const canManage = useAtomValue(createCredential.permissionAtom(environmentId));
  const list = useEnvironmentQuery(
    canManage ? credentialListQuery({ environmentId, input: {} }) : null,
  );
  const projects = useProjects()
    .filter((project) => project.environmentId === environmentId)
    .map((project) => ({ id: project.id, title: project.title }));
  const approvals = (
    <WorkflowCredentialApprovals
      environmentId={environmentId}
      projectId={listing.projectId}
      workflow={listing.workflow}
      value={listing.definition?.credentialApprovals}
      disabled={disabled}
      appearance="inline"
      helpText={false}
    />
  );
  return (
    <WorkflowCredentialsTab
      projectId={projectId}
      projects={projects}
      step={step}
      credentials={list.data?.credentials ?? []}
      loading={list.isPending && list.data === null}
      error={list.error ?? null}
      disabled={disabled}
      approvals={approvals}
      onAttach={onAttach}
      onNewCredential={onNewCredential}
      onManage={onManage}
      onOpenCredential={onOpenCredential}
    />
  );
}
