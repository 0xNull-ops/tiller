import { useState } from "react";
import {
  EllipsisIcon,
  KeyRoundIcon,
  LinkIcon,
  PlusIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react";
import type { Credential, CredentialId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEnvironmentQuery } from "../state/query";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { CredentialBrandIcon } from "../credentials/CredentialBrandIcon";
import { CredentialRequest } from "../credentials/CredentialRequest";
import { createCredential, credentialListQuery } from "../credentials/credentialState";
import { credentialStatusPresentation } from "@t3tools/shared/credentialPresentation";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import {
  credentialCallerLabel,
  type StepCredentialActivity,
} from "@t3tools/client-runtime/state/runtime";
import { cn } from "~/lib/utils";
import {
  WorkflowAttachmentKindLabel,
  workflowAttachmentClassName,
  workflowAttachmentStyle,
  type WorkflowAttachmentTone,
} from "./WorkflowAttachmentCard";
import {
  credentialApprovalLabel,
  credentialCardAction,
  credentialCardExplanation,
  credentialCardTone,
  type WorkflowCredentialCardState,
  type WorkflowCredentialSatellite,
} from "./workflowCredentialAttachments";

/**
 * One credential card beside its step. Before a run it names the vault state and offers the one
 * action that fixes it; during a run it becomes the approval request, then "in use", then a count.
 */
export function WorkflowCredentialSatelliteCard({
  satellite,
  environmentId,
  projectId,
  canEdit,
  onChoose,
  onAdd,
  onFix,
  onManage,
  onRemove,
}: {
  readonly satellite: WorkflowCredentialSatellite;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly canEdit: boolean;
  readonly onChoose: (credentialId: CredentialId) => void;
  readonly onAdd: () => void;
  readonly onFix: () => void;
  readonly onManage: () => void;
  readonly onRemove: () => void;
}) {
  const action = credentialCardAction(satellite);
  const explanation = credentialCardExplanation(satellite);
  const template = credentialTemplate(satellite.templateId);
  const liveUse =
    satellite.activity !== undefined &&
    (satellite.state === "asking" || satellite.state === "in-use")
      ? satellite.activity
      : null;
  const tone = credentialTone(satellite.state);
  const actionControl =
    action === "add" ? (
      <Button
        variant="outline"
        size="xs"
        aria-label={`Add ${satellite.templateName}`}
        disabled={!canEdit}
        onClick={onAdd}
      >
        <PlusIcon /> Add
      </Button>
    ) : action === "choose" ? (
      <WorkflowCredentialChoose
        satellite={satellite}
        environmentId={environmentId}
        projectId={projectId}
        disabled={!canEdit}
        onChoose={onChoose}
      />
    ) : action === "fix" ? (
      <Button variant="outline" size="xs" aria-label={`Fix ${satellite.name}`} onClick={onFix}>
        <WrenchIcon /> Fix
      </Button>
    ) : null;
  return (
    <div
      className={cn(workflowAttachmentClassName(tone), "relative space-y-1.5 py-2 pl-3 pr-2")}
      style={workflowAttachmentStyle("credential")}
      data-workflow-credential-card={satellite.key}
      data-tour="credential-card"
      data-credential-state={satellite.state}
      data-attachment-kind="credential"
      data-attachment-tone={tone}
    >
      <div className="flex min-w-0 items-center gap-2">
        <WorkflowAttachmentKindLabel kind="credential" />
        <span
          className={cn(
            "ml-auto flex min-w-0 items-center gap-1 truncate text-3xs",
            liveUse ? textToneClass(satellite.state) : "text-muted-foreground",
          )}
        >
          {liveUse === null && satellite.approval === "pre-approved" ? (
            <ShieldCheckIcon aria-hidden className="size-2.5 shrink-0" />
          ) : null}
          <span className="truncate">
            {liveUse ? satellite.statusLabel : credentialApprovalLabel(satellite.approval)}
          </span>
        </span>
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-micro"
                aria-label={`${satellite.name} credential actions`}
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={onManage}>Manage credentials…</MenuItem>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              disabled={!canEdit || satellite.attachmentId === undefined}
              onClick={onRemove}
            >
              Remove from step
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <CredentialBrandIcon
          name={satellite.name}
          templateIcon={template?.icon ?? null}
          iconOverride={satellite.icon ?? null}
          envVars={satellite.envVars.map((envVar) => envVar.name)}
          size="sm"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{satellite.name}</span>
      </div>
      {satellite.envVars.length > 0 ? (
        // Names and masks only: the vault never hands the value to the canvas.
        <div className="font-mono text-3xs text-muted-foreground">
          {satellite.envVars.slice(0, 2).map((envVar) => (
            <p key={envVar.name} className="truncate">
              {envVar.name} ••••••••
            </p>
          ))}
          {satellite.envVars.length > 2 ? <p>+{satellite.envVars.length - 2}</p> : null}
        </div>
      ) : null}
      {liveUse ? (
        <CredentialUseSummary activity={liveUse} asking={satellite.state === "asking"} />
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <p className={cn("min-w-0 truncate text-2xs", textToneClass(satellite.state))}>
            {satellite.statusLabel}
            {satellite.optional ? " · optional" : ""}
          </p>
          {actionControl ? <div className="ml-auto shrink-0">{actionControl}</div> : null}
        </div>
      )}
      {satellite.requests.length > 0 ? (
        <div className="space-y-2">
          {satellite.requests.map((request) => (
            <CredentialRequest
              key={request.id}
              environmentId={environmentId}
              request={request}
              compact
            />
          ))}
        </div>
      ) : null}
      {explanation ? <p className="text-2xs text-muted-foreground">{explanation}</p> : null}
    </div>
  );
}

/**
 * Only a live use overrides the dashes, as the mockup does: amber while an agent asks, blue while it
 * runs. A missing or expired credential asks for a fix without taking over the canvas.
 */
function credentialTone(state: WorkflowCredentialCardState): WorkflowAttachmentTone {
  if (state === "asking") return "needs-you";
  if (state === "in-use") return "in-use";
  return "idle";
}

function textToneClass(state: WorkflowCredentialCardState): string {
  switch (credentialCardTone(state)) {
    case "warning":
      return "text-warning";
    case "error":
      return "text-destructive";
    case "info":
      return "text-info";
    default:
      return state === "used" ? "text-success" : "text-muted-foreground";
  }
}

/**
 * Who is asking or using the credential, and the redacted command they run with it. The caller
 * and command are both optional on a live use, so each line falls back to what is known.
 */
function CredentialUseSummary({
  activity,
  asking,
}: {
  readonly activity: StepCredentialActivity;
  readonly asking: boolean;
}) {
  const verb = asking ? "Asked by" : "In use by";
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="truncate text-2xs text-muted-foreground">
        {activity.caller ? (
          <>
            {verb} <span className="text-foreground">{credentialCallerLabel(activity.caller)}</span>
          </>
        ) : asking ? (
          "An agent is asking to use it."
        ) : (
          "An agent is using it now."
        )}
      </p>
      {activity.commandPreview ? (
        <p className="truncate font-mono text-3xs text-muted-foreground">
          {activity.commandPreview}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The binding UI for an imported or unbound workflow. A `choose` state carries its candidates;
 * `matched` means exactly one credential already fits, so the popover reads the vault to offer the
 * others too rather than silently keeping the automatic pick.
 */
function WorkflowCredentialChoose({
  satellite,
  environmentId,
  projectId,
  disabled,
  onChoose,
}: {
  readonly satellite: WorkflowCredentialSatellite;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly disabled: boolean;
  readonly onChoose: (credentialId: CredentialId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            aria-label={`Choose ${satellite.templateName}`}
            disabled={disabled}
          />
        }
      >
        <LinkIcon /> Choose…
      </PopoverTrigger>
      {open ? (
        <PopoverPopup align="start" width="md" padding="none">
          <div className="space-y-1 p-2">
            <p className="px-1 pb-1 text-2xs text-muted-foreground">
              {satellite.templateName} on this environment
            </p>
            <CredentialChoices
              satellite={satellite}
              environmentId={environmentId}
              projectId={projectId}
              onPick={(credentialId) => {
                setOpen(false);
                onChoose(credentialId);
              }}
            />
          </div>
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}

function CredentialChoices({
  satellite,
  environmentId,
  projectId,
  onPick,
}: {
  readonly satellite: WorkflowCredentialSatellite;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly onPick: (credentialId: CredentialId) => void;
}) {
  const canManage = useAtomValue(createCredential.permissionAtom(environmentId));
  const list = useEnvironmentQuery(
    canManage && satellite.candidates.length === 0
      ? credentialListQuery({ environmentId, input: {} })
      : null,
  );
  const rows =
    satellite.candidates.length > 0
      ? satellite.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          statusLabel: candidate.statusLabel,
          icon: candidate.icon ?? null,
        }))
      : (list.data?.credentials ?? [])
          .filter(
            (credential) =>
              credential.templateId === satellite.templateId &&
              (projectId === null ||
                credential.policy.projects === "all" ||
                credential.policy.projects.includes(projectId)),
          )
          .map((credential: Credential) => ({
            id: credential.id,
            name: credential.name,
            statusLabel: credentialStatusPresentation(credential.status).label,
            icon: credential.icon ?? null,
          }));
  if (rows.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">
        No {satellite.templateName} credential is available in this project yet.
      </p>
    );
  }
  return (
    <>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          aria-label={`Choose ${row.name}`}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onPick(row.id)}
        >
          <CredentialBrandIcon
            name={row.name}
            templateIcon={credentialTemplate(satellite.templateId)?.icon ?? null}
            iconOverride={row.icon}
            size="xs"
          />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">{row.statusLabel}</span>
        </button>
      ))}
    </>
  );
}

/** The Needs block's credential rows: what the agent gets, and how it may use it. */
export function WorkflowCredentialNeeds({
  satellites,
}: {
  readonly satellites: ReadonlyArray<WorkflowCredentialSatellite>;
}) {
  if (satellites.length === 0) return null;
  return (
    <section className="mt-2 space-y-2" aria-label="Credentials">
      <h4 className="flex items-center gap-1 text-xs font-medium">
        <KeyRoundIcon className="size-3" />
        Credentials
      </h4>
      {satellites.map((satellite) => {
        const template = credentialTemplate(satellite.templateId);
        return (
          <div key={satellite.key} className="space-y-1 border-t py-2">
            <div className="flex min-w-0 items-center gap-2">
              <CredentialBrandIcon
                name={satellite.name}
                templateIcon={template?.icon ?? null}
                iconOverride={satellite.icon ?? null}
                envVars={satellite.envVars.map((envVar) => envVar.name)}
                size="xs"
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{satellite.name}</span>
              <Badge variant={credentialCardTone(satellite.state)} size="sm">
                {satellite.state === "used" ? `Used ${satellite.count}×` : satellite.statusLabel}
              </Badge>
            </div>
            <p className="text-2xs text-muted-foreground">
              {satellite.templateName} · {credentialApprovalLabel(satellite.approval)}
              {satellite.optional ? " · optional" : ""}
            </p>
            {satellite.envVars.length > 0 ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-2xs">
                <dt className="text-muted-foreground">Agent gets</dt>
                <dd className="font-mono">
                  {satellite.envVars
                    .map((envVar) => (envVar.file ? `${envVar.name} (file path)` : envVar.name))
                    .join(" · ")}
                </dd>
              </dl>
            ) : null}
            {credentialCardExplanation(satellite) ? (
              <p className="text-2xs text-muted-foreground">
                {credentialCardExplanation(satellite)}
              </p>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
