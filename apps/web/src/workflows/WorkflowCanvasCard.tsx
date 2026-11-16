import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import {
  WorkflowAttachmentChips,
  WorkflowAttachmentKindLabel,
  workflowAttachmentClassName,
  workflowAttachmentStyle,
  type WorkflowAttachmentChipCount,
} from "./WorkflowAttachmentCard";
import type { WorkflowTrigger } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../components/ui/tooltip";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { RunGraphNode, RunGraphStatus } from "./runGraph";
import { WorkflowStartCardBody, type WorkflowStartInput } from "./WorkflowStartCardBody";
import type { WorkflowBlocker, WorkflowRun } from "@t3tools/contracts";
import { WorkflowNestedRunProgress } from "./WorkflowNestedRunProgress";
import { WorkflowApprovalCardBody } from "./WorkflowApprovalCardBody";

const STATUS_DOT: Record<RunGraphStatus, string> = {
  pending: "bg-muted-foreground/40",
  idle: "bg-muted-foreground/40",
  running: "bg-primary",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
  skipped: "bg-muted-foreground/40",
  blocked: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<RunGraphStatus, string> = {
  pending: "Queued",
  idle: "Idle",
  running: "Running",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  skipped: "Skipped",
  blocked: "Blocked",
};

const KIND_LABEL: Record<RunGraphNode["kind"], string> = {
  turn: "Turn",
  task: "Task",
  workflow: "Workflow",
  phase: "Phase",
  agent: "Agent",
  step: "Step",
  approval: "Approval",
  check: "Check",
};

export function WorkflowCanvasCard(props: {
  readonly node: RunGraphNode;
  readonly style: CSSProperties;
  readonly onOpen: (() => void) | null;
  readonly actions: ReactNode;
  readonly outputs?: ReactNode;
  readonly activity?: ReactNode;
  readonly error: string;
  readonly worker: string | null;
  readonly childRun?: WorkflowRun | null;
  readonly appearing: boolean;
  readonly onAppearanceEnd: () => void;
  readonly onSelectDetail: (() => void) | null;
  readonly editMode?: boolean;
  readonly scope?: "project" | "global";
  readonly delegation?: "subagent" | "self";
  readonly subagentModelLabel?: string;
  /** What the step uses, as counts on its card. The card names no status for them. */
  readonly chips?: ReadonlyArray<WorkflowAttachmentChipCount>;
  /** Which edge the link handle sits on: right for horizontal graphs, bottom for vertical. */
  readonly direction?: "horizontal" | "vertical";
  readonly blocker?: WorkflowBlocker;
  readonly dragging?: boolean;
  /** The card a link being dragged, or a SKILL.md being dropped, would land on. */
  readonly highlighted?: boolean;
  /** The card whose inspector is open. */
  readonly selected?: boolean;
  readonly dimmed?: boolean;
  readonly onClickCapture?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onCardPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onLinkPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  /** When set on a workflow (start) card: shows the next scheduled run time. */
  readonly nextRunAt?: string | null;
  /** Set on a nested-workflow card: opens the workflow it runs in the panel. */
  readonly onOpenNested?: (() => void) | undefined;
  /** Set on a nested-workflow card whose steps can be listed: shows or hides them beneath it. */
  readonly onToggleExpand?: (() => void) | undefined;
  readonly expanded?: boolean;
  /** Set on the first card of a workflow: it becomes the start card. */
  readonly start?: {
    readonly triggers?: ReadonlyArray<{ id: string; label: string; enabled: boolean }>;
    readonly onManual?: () => void;
    readonly onTrigger?: () => void;
    readonly trigger: WorkflowTrigger;
    readonly inputs: ReadonlyArray<WorkflowStartInput>;
    /** A run shows the values it started with; the draft shows only what it asks for. */
    readonly showValues: boolean;
    /** The run being viewed, if any: its timer shows on the start card. */
    readonly run?: WorkflowRun | null;
  } | null;
}) {
  const { node, onOpen } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const hasNextRun = node.kind === "workflow" && typeof props.nextRunAt === "string";
  const nextRunAtPreview = hasNextRun ? formatRelativeTimeLabel(props.nextRunAt!) : null;
  const baseWorker =
    props.worker ??
    (node.credentials?.some((entry) => entry.state === "asking")
      ? "Needs approval"
      : node.detail?.includes("skill missing")
        ? "skill missing"
        : node.status === "idle" && node.detail?.includes("ready")
          ? "Ready"
          : STATUS_LABEL[node.status]);
  const body = (
    <>
      <span data-workflow-status className="flex min-w-0 items-center gap-1.5">
        <span
          key={node.status}
          data-workflow-status-dot
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[node.status])}
        />
        <span className="truncate text-xs font-medium">{node.title}</span>
        {props.delegation && (!props.subagentModelLabel || props.editMode) ? (
          <span
            role="img"
            className="shrink-0 text-muted-foreground"
            aria-label={
              props.delegation === "subagent" ? "Runs as a subagent" : "Runs in the chat thread"
            }
          >
            {props.delegation === "subagent" ? (
              <UsersIcon className="size-3" />
            ) : (
              <MessageCircleIcon className="size-3" />
            )}
          </span>
        ) : null}
        {onOpen === null ? null : (
          <ArrowUpRightIcon className="ml-auto size-3 shrink-0 text-muted-foreground" />
        )}
      </span>
      <span className="flex min-w-0 items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="truncate">{node.detail ?? KIND_LABEL[node.kind]}</span>
        <span className="flex shrink-0 items-center gap-1">
          {hasNextRun ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5"
                    data-workflow-next-run
                  />
                }
              >
                <ClockIcon className="size-3" />
                <span>{nextRunAtPreview}</span>
              </TooltipTrigger>
              <TooltipPopup>
                Next scheduled run: {formatRelativeTimeLabel(props.nextRunAt!)}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <span>{baseWorker}</span>
        </span>
      </span>
      <WorkflowAttachmentChips counts={props.chips ?? []} />
      {node.round !== undefined &&
      node.maxRounds !== undefined &&
      (node.round > 1 || node.status === "running") ? (
        <span
          className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-3xs font-medium text-primary"
          data-workflow-round-badge
        >
          Round {node.round} of {node.maxRounds}
        </span>
      ) : null}
      {node.loopExhausted ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="inline-flex w-fit items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-3xs font-medium text-warning"
                data-workflow-loop-exhausted
              />
            }
          >
            Loop reached max rounds
          </TooltipTrigger>
          <TooltipPopup>
            Loop reached max rounds without passing; continuing with last output.
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {props.subagentModelLabel && !props.editMode ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full border bg-muted/40 px-1.5 py-0.5 text-2xs text-muted-foreground">
          <UsersIcon className="size-3" /> Subagent · {props.subagentModelLabel}
        </span>
      ) : null}
      {props.activity}
      {props.childRun ? <WorkflowNestedRunProgress run={props.childRun} /> : null}
    </>
  );
  const approvalBody = node.kind === "approval" ? <WorkflowApprovalCardBody node={node} /> : null;
  const checkBody = node.kind === "check" ? <WorkflowCheckCardBody node={node} /> : null;
  const startBody =
    props.start === null || props.start === undefined ? null : (
      <WorkflowStartCardBody
        name={node.title}
        statusDotClass={STATUS_DOT[node.status]}
        statusLabel={STATUS_LABEL[node.status]}
        {...(props.start.triggers === undefined ? {} : { triggers: props.start.triggers })}
        {...(props.start.onTrigger === undefined ? {} : { onTrigger: props.start.onTrigger })}
        {...(props.start.onManual === undefined ? {} : { onManual: props.start.onManual })}
        trigger={props.start.trigger}
        nextRunAt={typeof props.nextRunAt === "string" ? props.nextRunAt : null}
        inputs={props.start.inputs}
        showValues={props.start.showValues}
        run={props.start.run ?? null}
      />
    );
  const cardBody = startBody ?? approvalBody ?? checkBody ?? body;
  const openLabel =
    node.kind === "approval" && node.approvalFor
      ? `Open approval gate for ${node.approvalFor}`
      : node.kind === "check" && node.checkFor
        ? `Open checks for ${node.checkFor}`
        : startBody === null
          ? `Open ${node.title}`
          : `Open workflow settings for ${node.title}`;
  // Checks hang off a step like satellites, so they take the attachment look.
  const attachment = node.kind === "check";
  const className = cn(
    "absolute flex flex-col justify-center gap-1 px-2.5 text-left",
    attachment
      ? workflowAttachmentClassName(node.status === "running" ? "in-use" : "idle")
      : "rounded-lg border bg-card shadow-xs",
    (node.kind === "turn" || node.kind === "phase") && "border-dashed",
    node.kind === "approval" && "border-warning/50",
    node.detail?.includes("skill missing") && "border-dashed",
    node.status === "running" && "border-info",
    node.credentials?.some((entry) => entry.state === "asking") && "border-warning bg-warning/5",
    props.editMode && props.onCardPointerDown && "select-none cursor-grab active:cursor-grabbing",
    props.dragging && "opacity-80 shadow-lg ring-2 ring-primary/40",
    props.selected && "ring-2 ring-primary",
    props.highlighted && "ring-2 ring-primary",
    props.dimmed && "opacity-35",
    startBody !== null && "border-primary/40",
    props.onOpenNested && "pr-14",
  );
  return (
    <div
      className={className}
      style={attachment ? { ...props.style, ...workflowAttachmentStyle("check") } : props.style}
      data-workflow-node={node.id}
      data-status={node.status}
      data-attachment-kind={attachment ? "check" : undefined}
      data-dragging={props.dragging || undefined}
      data-selected={props.selected || undefined}
      data-appearing={props.appearing || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && props.appearing) props.onAppearanceEnd();
      }}
      data-workflow-step-card
      data-tour={node.kind === "step" && startBody === null ? "step-card" : undefined}
      // Outside edit mode a drag that starts on a card still pans the canvas.
      data-canvas-no-pan={props.editMode || undefined}
      onPointerDown={props.onCardPointerDown}
      onClickCapture={props.onClickCapture}
      onDoubleClick={props.onOpenNested}
      onContextMenu={
        props.onOpenNested
          ? (event) => {
              event.preventDefault();
              setMenuOpen(true);
            }
          : undefined
      }
    >
      {node.status === "running" ? <span aria-hidden data-workflow-sweep /> : null}
      {props.blocker ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "absolute -top-2 right-1 z-10 max-w-[70%] truncate rounded-full",
                  "px-1.5 py-0.5 text-3xs",
                  props.blocker.kind === "missing-skill" || props.blocker.kind === "invalid"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/15 text-warning",
                )}
              />
            }
          >
            {props.blocker.kind === "missing-skill"
              ? "missing skill"
              : props.blocker.message.split(/[,:]/)[0]}
          </TooltipTrigger>
          <TooltipPopup>{props.blocker.message}</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.editMode && node.kind === "step" ? (
        <button
          type="button"
          data-workflow-link-handle
          data-canvas-no-pan
          aria-label={`Link from ${node.title}`}
          className={cn(
            "absolute size-3 cursor-crosshair rounded-full border-2 border-background bg-primary p-0",
            "transition-transform hover:scale-150 motion-reduce:transition-none",
            props.direction === "vertical"
              ? "-bottom-1.5 left-1/2 -translate-x-1/2"
              : "-right-1.5 top-1/2 -translate-y-1/2",
          )}
          onPointerDown={props.onLinkPointerDown}
        />
      ) : null}
      {props.onSelectDetail !== null ? (
        <button
          type="button"
          data-workflow-step-card
          className="flex min-w-0 cursor-pointer flex-col gap-1 text-left hover:text-primary"
          data-workflow-drag-surface
          aria-label={openLabel}
          onClick={props.onSelectDetail}
        >
          {cardBody}
        </button>
      ) : onOpen === null ? (
        <div className="flex min-w-0 flex-col gap-1">{cardBody}</div>
      ) : (
        <button
          type="button"
          className="flex min-w-0 cursor-pointer flex-col gap-1 text-left hover:text-primary"
          data-workflow-drag-surface
          aria-label={openLabel}
          onClick={onOpen}
        >
          {cardBody}
        </button>
      )}
      {props.outputs}
      {props.error ? (
        <Tooltip>
          <TooltipTrigger render={<p className="truncate text-2xs text-destructive" />}>
            {props.error}
          </TooltipTrigger>
          <TooltipPopup>{props.error}</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.actions ? <div className="flex">{props.actions}</div> : null}
      {props.onOpenNested ? (
        <div
          className="absolute right-1 top-1 z-10 flex items-center gap-0.5"
          data-canvas-no-pan
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {props.onToggleExpand ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={
                props.expanded ? `Hide steps of ${node.title}` : `Show steps of ${node.title}`
              }
              aria-expanded={props.expanded === true}
              data-canvas-no-pan
              onClick={props.onToggleExpand}
            >
              {props.expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
          ) : null}
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Workflow actions for ${node.title}`}
                  data-canvas-no-pan
                />
              }
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={props.onOpenNested}>Open workflow</MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      ) : null}
    </div>
  );
}

function WorkflowCheckCardBody({ node }: { readonly node: RunGraphNode }) {
  return (
    <>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <WorkflowAttachmentKindLabel kind="check" />
        <span
          className={cn(
            "shrink-0 text-3xs",
            node.status === "failed"
              ? "text-destructive"
              : node.status === "done"
                ? "text-success"
                : "text-muted-foreground",
          )}
        >
          {STATUS_LABEL[node.status]}
        </span>
      </span>
      <span className="truncate text-2xs text-muted-foreground">
        {node.detail ?? STATUS_LABEL[node.status]}
      </span>
    </>
  );
}
