import type { MouseEvent, PointerEvent } from "react";
import { CircleHelpIcon, ComputerIcon } from "lucide-react";
import type { WorkflowAttachment, WorkflowReadinessEntry } from "@t3tools/contracts";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { cn } from "~/lib/utils";
import {
  WorkflowAttachmentKindLabel,
  workflowAttachmentClassName,
  workflowAttachmentStyle,
  type WorkflowAttachmentKind,
  type WorkflowAttachmentTone,
} from "./WorkflowAttachmentCard";
import { WORKFLOW_RESOURCE_SIZE } from "./workflowAnnotations";

const readinessLabel: Record<WorkflowReadinessEntry["status"], string> = {
  unknown: "Unknown",
  checking: "Checking",
  available: "Available",
  missing: "Missing",
  error: "Error",
  configured: "Configured",
};

export function WorkflowResourceCard(props: {
  readonly attachment: WorkflowAttachment | null;
  readonly more?: number;
  readonly moreLabel?: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly readiness?: WorkflowReadinessEntry;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly editMode?: boolean;
  readonly dragging?: boolean;
  readonly onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onClickCapture?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = props.attachment
    ? attachmentLabel(props.attachment)
    : (props.moreLabel ?? `${props.more} more resources`);
  const kind = props.attachment ? attachmentKind(props.attachment) : null;
  // A missing or broken requirement needs the user; an advisory MCP status never does.
  const tone: WorkflowAttachmentTone =
    kind === "login" &&
    (props.readiness?.status === "missing" || props.readiness?.status === "error")
      ? "needs-you"
      : "idle";
  return (
    <button
      type="button"
      data-workflow-resource-card
      data-attachment-kind={kind ?? undefined}
      data-attachment-tone={props.attachment ? tone : undefined}
      data-canvas-no-pan
      aria-label={props.attachment ? `Open ${label} resource` : `Show ${label}`}
      onClick={props.onSelect}
      onPointerDown={props.editMode ? props.onPointerDown : undefined}
      onClickCapture={props.onClickCapture}
      className={cn(
        "absolute flex min-w-0 flex-col justify-center gap-0.5 px-3 py-1.5",
        props.attachment
          ? workflowAttachmentClassName(tone)
          : "rounded-lg border border-dashed border-muted-foreground/40 bg-card",
        props.selected && "ring-2 ring-primary",
        props.editMode && "select-none cursor-grab active:cursor-grabbing",
        props.dragging && "opacity-80 shadow-lg",
      )}
      style={{
        left: props.position.x,
        top: props.position.y,
        ...WORKFLOW_RESOURCE_SIZE,
        ...(kind === null ? {} : workflowAttachmentStyle(kind)),
      }}
    >
      {props.attachment && kind !== null ? (
        <>
          <WorkflowAttachmentKindLabel kind={kind} {...kindOverride(props.attachment)} />
          <span className="truncate text-2xs font-medium">{label}</span>
          <span className="truncate text-3xs text-muted-foreground">
            {readinessDisplay(
              props.attachment,
              props.readiness?.status ?? "unknown",
              props.readiness?.message,
            )}
            {props.readiness?.stale ? " · stale" : ""}
          </span>
        </>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <CircleHelpIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-2xs font-medium">{label}</span>
          </span>
          <span className="truncate text-3xs text-muted-foreground">
            {props.moreLabel ? "Collapse" : "Show all"}
          </span>
        </>
      )}
    </button>
  );
}

function attachmentKind(attachment: WorkflowAttachment): WorkflowAttachmentKind {
  switch (attachment.kind) {
    case "mcp-connection":
      return "mcp";
    case "service-login":
    case "requirement":
      return "login";
    case "credential":
      return "credential";
  }
}

/** A requirement is a machine condition rather than a sign-in, so it gets its own label and icon. */
function kindOverride(attachment: WorkflowAttachment) {
  return attachment.kind === "requirement" ? { label: "Requirement", icon: ComputerIcon } : {};
}

export function readinessDisplay(
  attachment: WorkflowAttachment,
  status: WorkflowReadinessEntry["status"],
  message?: string,
) {
  if (attachment.kind === "mcp-connection") {
    if (status === "configured" || (status === "unknown" && message?.startsWith("Configured in ")))
      return "Configured · not verified";
    if (status === "missing" && message?.startsWith("Needs sign-in"))
      return "Advisory · Needs sign-in";
    return `Advisory · ${status === "available" ? "Connected" : status === "error" ? "Not available" : readinessLabel[status]}`;
  }
  if (
    (attachment.kind === "requirement" || attachment.kind === "service-login") &&
    (status === "missing" || status === "error")
  ) {
    return `Required · ${readinessLabel[status]}`;
  }
  return readinessLabel[status];
}

export function attachmentLabel(attachment: WorkflowAttachment) {
  if (attachment.label) return attachment.label;
  switch (attachment.kind) {
    case "requirement":
      return attachment.requirement;
    case "service-login":
      return attachment.service;
    case "mcp-connection":
      return attachment.server;
    case "credential":
      // Credential cards are satellites; this labels the attachment in lists and editors.
      return credentialTemplate(attachment.templateId)?.name ?? attachment.templateId;
  }
}
