import type { CSSProperties } from "react";
import { CheckIcon, KeyRoundIcon, PlugIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import type { WorkflowAttachment } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { workflowCanvasKindColor, type WorkflowCanvasKind } from "./workflowCanvasColors";

/**
 * A satellite is something a step uses, drawn flat and dashed so it reads apart from the step.
 * Its colour comes from the kind's root variable; see workflowCanvasColors.ts.
 */
export type WorkflowAttachmentKind = WorkflowCanvasKind;

/** `needs-you` takes the user's attention, `in-use` is the agent working, `idle` is the default. */
export type WorkflowAttachmentTone = "needs-you" | "in-use" | "idle";

const KIND_PRESENTATION: Record<
  WorkflowAttachmentKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  credential: { label: "Credential", icon: KeyRoundIcon },
  mcp: { label: "MCP", icon: PlugIcon },
  check: { label: "Check", icon: CheckIcon },
  login: { label: "Login", icon: UserRoundIcon },
};

const FRAME =
  "rounded-lg border text-left before:absolute before:inset-y-1.5 before:left-0 before:w-0.75 before:rounded-r-full before:bg-(--wf-attachment)";

const TONE: Record<WorkflowAttachmentTone, string> = {
  idle: "border-dashed border-(--wf-attachment)/45 bg-card/60",
  "needs-you": "border-solid border-warning bg-warning/10",
  "in-use": "border-solid border-info bg-info/10",
};

/**
 * The frame's classes. The accent bar is absolutely positioned against the card itself, so the card
 * must be positioned: canvas cards are `absolute`, and a card laid out in normal flow adds
 * `relative` (see the credential satellite).
 */
export function workflowAttachmentClassName(tone: WorkflowAttachmentTone): string {
  return cn(FRAME, TONE[tone]);
}

/**
 * The kind colour, and a text tint of it that keeps 4.5:1 on the canvas in both themes for every
 * preset. Mixing in the contrast foreground is what makes the amber and green presets legible on
 * white, and it still follows the user's contrast setting.
 */
export function workflowAttachmentStyle(kind: WorkflowAttachmentKind): CSSProperties {
  const color = workflowCanvasKindColor(kind);
  return {
    "--wf-attachment": color,
    "--wf-attachment-text": `color-mix(in srgb, ${color} 50%, var(--contrast-foreground))`,
  } as CSSProperties;
}

export function WorkflowAttachmentKindLabel({
  kind,
  label,
  icon,
}: {
  readonly kind: WorkflowAttachmentKind;
  readonly label?: string;
  readonly icon?: LucideIcon;
}) {
  const presentation = KIND_PRESENTATION[kind];
  const Icon = icon ?? presentation.icon;
  return (
    <span className="flex min-w-0 items-center gap-1 text-3xs font-semibold uppercase tracking-wider text-(--wf-attachment-text)">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label ?? presentation.label}</span>
    </span>
  );
}

export interface WorkflowAttachmentChipCount {
  readonly kind: WorkflowAttachmentKind;
  readonly count: number;
}

/**
 * How many of each kind a step uses, for the chips on its card. `attachments` are the step's
 * resource attachments; credentials and checks are counted by the caller, since their cards are
 * built from other data.
 */
export function attachmentChipCounts(input: {
  readonly credentials: number;
  readonly checks: number;
  readonly attachments: ReadonlyArray<WorkflowAttachment>;
}): ReadonlyArray<WorkflowAttachmentChipCount> {
  const countOf = (matches: (attachment: WorkflowAttachment) => boolean) =>
    input.attachments.filter(matches).length;
  const counts: ReadonlyArray<WorkflowAttachmentChipCount> = [
    { kind: "credential", count: input.credentials },
    { kind: "mcp", count: countOf((attachment) => attachment.kind === "mcp-connection") },
    { kind: "check", count: input.checks },
    {
      kind: "login",
      count: countOf(
        (attachment) => attachment.kind === "service-login" || attachment.kind === "requirement",
      ),
    },
  ];
  return counts.filter((entry) => entry.count > 0);
}

/** Compact counts on a step card, so the card says what it uses without repeating their status. */
export function WorkflowAttachmentChips({
  counts,
}: {
  readonly counts: ReadonlyArray<WorkflowAttachmentChipCount>;
}) {
  if (counts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {counts.map(({ kind, count }) => {
        const { label, icon: Icon } = KIND_PRESENTATION[kind];
        return (
          <span
            key={kind}
            role="img"
            aria-label={`${count} ${label.toLowerCase()}`}
            style={workflowAttachmentStyle(kind)}
            className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px text-3xs font-medium text-muted-foreground"
          >
            <Icon aria-hidden className="size-2.5 text-(--wf-attachment)" />
            {count}
          </span>
        );
      })}
    </div>
  );
}
