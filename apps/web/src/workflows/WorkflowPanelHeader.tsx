import { MissingSkillActions } from "./MissingSkillActions";
import type { EnvironmentId, WorkflowListing, WorkflowRun } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ClockIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { WorkflowCredentialsSheet } from "./WorkflowCredentialsSheet";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { Button } from "../components/ui/button";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { WorkflowRunButton } from "./WorkflowRunButton";
import { WorkflowRunElapsed } from "./WorkflowRunElapsed";
import { workflowRunProgress } from "./workflowState";
import { formatRunElapsed } from "@t3tools/shared/workflowElapsed";

const NEW_WORKFLOW_SENTINEL = "__new_workflow_action__";

const RUN_STATUS: Record<WorkflowRun["status"], string> = {
  running: "Running",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};
const live = (run: WorkflowRun | null) => run?.status === "running" || run?.status === "waiting";

function Chip(props: { readonly children: ReactNode; readonly onClick?: () => void }) {
  const className = "rounded-full bg-muted px-2 py-0.5";
  return props.onClick ? (
    <button
      type="button"
      className={cn(className, "hover:text-foreground")}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ) : (
    <span className={className}>{props.children}</span>
  );
}

/**
 * Keeps the primary workflow controls together while secondary actions stay in menus.
 */
export function WorkflowPanelHeader(props: {
  readonly environmentId?: EnvironmentId;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly selected: WorkflowListing | null;
  readonly runs: ReadonlyArray<WorkflowRun>;
  readonly run: WorkflowRun | null;
  readonly editMode: boolean;
  readonly showSubagents: boolean;
  readonly canEdit: boolean;
  readonly canRun?: boolean;
  readonly runDisabledReason?: string | null;
  readonly hasProject: boolean;
  readonly busy: boolean;
  readonly onSelectWorkflow: (workflow: string) => void;
  readonly onSelectRun: (runId: string | null) => void;
  readonly stepAction: ReactNode;
  readonly executionControl?: ReactNode;
  readonly onNew: () => void;
  readonly onToggleSubagents?: () => void;
  readonly subagentsAvailable?: boolean;
  readonly onSaveAsWorkflow?: () => void;
  readonly onStop: () => void;
  readonly canStop: boolean;
  readonly onRun: () => void;
  readonly onEditWorkflow: () => void;
  readonly onOpenBlocker: (stepId: string | null) => void;
  readonly latestRun: WorkflowRun | null;
  readonly changedSinceRun: boolean;
  readonly onOpenLastRun: () => void;
  readonly rerunOf: WorkflowRun["rerunOf"] | null;
  readonly onBack?: () => void;
  readonly projectName?: string | null;
  readonly driverChat?: { readonly id: string; readonly title: string } | null;
  readonly onOpenDriverChat?: () => void;
  /** When provided, a Clock action opens the schedule panel mounted by the parent. */
  readonly onSchedule?: () => void;
  /** False only when the schedule button should be disabled (e.g. unsent draft). */
  readonly canSchedule?: boolean;
  readonly scheduleDisabledReason?: string | null;
  /** Reloads workflow definitions from disk and retries any missing or failed output previews. */
  readonly onRefresh?: () => void;
  readonly onFit?: (() => void) | undefined;
}) {
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  if (!props.selected && !props.showSubagents) return null;
  const workflowRuns = props.runs
    .filter((entry) => entry.parent === undefined && entry.workflow === props.selected?.workflow)
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
  const blockers = props.selected?.blockers ?? [];
  const canRun =
    props.canEdit && props.canRun !== false && props.selected !== null && blockers.length === 0;
  const disabledReason =
    props.runDisabledReason ??
    (!props.canEdit || props.canRun === false
      ? "You don't have permission to run workflows here."
      : blockers.length > 0
        ? "Fix the problems listed below first."
        : null);
  const viewingRun = !props.showSubagents && !props.editMode && props.run !== null;
  const progress = viewingRun ? workflowRunProgress(props.run!) : null;
  const showStop = !props.showSubagents && live(props.run);
  const showSubagentsToggle =
    props.subagentsAvailable !== false &&
    Boolean(props.onToggleSubagents) &&
    (props.selected !== null || props.showSubagents);
  const canSaveAsWorkflow =
    Boolean(props.onSaveAsWorkflow) &&
    props.canEdit &&
    Boolean(props.selected || props.showSubagents);
  const canEditWorkflowFromMenu = viewingRun && props.canEdit;
  const chips = [
    viewingRun && (live(props.run) || props.run!.endedAt !== undefined) ? (
      <Chip key="elapsed">
        <WorkflowRunElapsed run={props.run!} />
      </Chip>
    ) : null,
    viewingRun && progress ? (
      <Chip key="work-progress">
        Work {progress.workDone}/{progress.workTotal}
      </Chip>
    ) : null,
    viewingRun && progress && progress.checksTotal > 0 ? (
      <Chip key="check-progress">
        Checks {progress.checksPassed}/{progress.checksTotal}
      </Chip>
    ) : null,
    viewingRun && props.driverChat && props.onOpenDriverChat ? (
      <Chip key="driver" onClick={props.onOpenDriverChat}>
        Driven by {props.driverChat.title} ↗
      </Chip>
    ) : null,
    props.editMode && props.latestRun ? (
      <Chip key="last" onClick={props.onOpenLastRun}>
        Last run · {RUN_STATUS[props.latestRun.status]}
        {!live(props.latestRun) && props.latestRun.endedAt !== undefined
          ? ` · ${formatRunElapsed(
              Date.parse(props.latestRun.endedAt) - Date.parse(props.latestRun.startedAt),
            )}`
          : ""}
      </Chip>
    ) : null,
    props.editMode && props.changedSinceRun ? (
      <Chip key="changed">Changed since last run</Chip>
    ) : null,
    props.editMode && live(props.latestRun) ? (
      <Chip key="next">Edits apply to the next run</Chip>
    ) : null,
    viewingRun && props.rerunOf ? (
      <Chip key="rerun">Rerun from “{props.rerunOf.stepId}”</Chip>
    ) : null,
  ].filter((chip) => chip !== null);

  return (
    <>
      {props.environmentId ? (
        <WorkflowCredentialsSheet
          environmentId={props.environmentId}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
          returnFocus={menuTrigger}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 border-b p-2">
        {props.onBack ? (
          <Button variant="ghost" size="icon-xs" aria-label="Back to chat" onClick={props.onBack}>
            <ArrowLeftIcon />
          </Button>
        ) : null}
        {props.projectName ? (
          <span className="truncate rounded-md bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            {props.projectName}
          </span>
        ) : null}
        {props.workflows.length > 0 ? (
          <div className="min-w-36 flex-1">
            <Select
              value={props.selected?.workflow ?? null}
              onValueChange={(value) => {
                if (value === NEW_WORKFLOW_SENTINEL) props.onNew();
                else if (value) props.onSelectWorkflow(value);
              }}
            >
              <SelectTrigger size="compact" aria-label="Workflow">
                <SelectValue>
                  {props.selected?.definition?.name ?? props.selected?.workflow ?? "Open workflow…"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                {props.workflows.map((workflow) => (
                  <SelectItem key={workflow.workflow} value={workflow.workflow}>
                    {workflow.definition?.name ?? workflow.workflow}
                    {workflow.problem ? " · invalid" : ""}
                  </SelectItem>
                ))}
                <div role="separator" className="my-1 h-px bg-border" />
                <SelectItem
                  value={NEW_WORKFLOW_SENTINEL}
                  disabled={!props.canEdit || !props.hasProject}
                >
                  New workflow…
                </SelectItem>
              </SelectPopup>
            </Select>
          </div>
        ) : null}
        {workflowRuns.length > 0 ? (
          <Select value={viewingRun ? props.run!.id : null} onValueChange={props.onSelectRun}>
            <SelectTrigger size="compact" variant="ghost" aria-label="Workflow run">
              <span
                className={cn("flex items-center gap-1", !viewingRun && "text-muted-foreground")}
              >
                <HistoryIcon className="size-3.5" />
                <SelectValue>
                  {viewingRun ? formatRelativeTimeLabel(props.run!.startedAt) : "Runs"}
                </SelectValue>
              </span>
            </SelectTrigger>
            <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS} align="end">
              {workflowRuns.map((run) => (
                <SelectItem key={run.id} value={run.id}>
                  <span className="flex w-full items-center justify-between gap-4">
                    <span>{formatRelativeTimeLabel(run.startedAt)}</span>
                    <span className="text-muted-foreground">{RUN_STATUS[run.status]}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        {props.editMode && props.canEdit ? props.stepAction : null}
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
            <Button variant="ghost" size="icon-xs" aria-label="Remote runs" disabled>
              <ServerIcon />
            </Button>
          </TooltipTrigger>
          <TooltipPopup>Remote runs · Coming soon (beta)</TooltipPopup>
        </Tooltip>
        {props.onSchedule && !props.showSubagents && props.selected ? (
          props.canSchedule === false ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                <Button variant="ghost" size="icon-xs" aria-label="Workflow schedules" disabled>
                  <ClockIcon />
                </Button>
              </TooltipTrigger>
              <TooltipPopup>
                {props.scheduleDisabledReason ??
                  "Send the first message to schedule this workflow."}
              </TooltipPopup>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Workflow schedules"
              onClick={() => props.onSchedule?.()}
            >
              <ClockIcon />
            </Button>
          )
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                ref={menuTrigger}
                aria-label="More workflow actions"
                data-workflow-camera-control
                disabled={
                  !canSaveAsWorkflow &&
                  !canEditWorkflowFromMenu &&
                  !props.onFit &&
                  !props.environmentId
                }
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {props.onFit ? (
              <MenuItem data-workflow-camera-control onClick={props.onFit}>
                Fit steps
              </MenuItem>
            ) : null}
            {canSaveAsWorkflow ? (
              <MenuItem onClick={() => props.onSaveAsWorkflow?.()}>Save as workflow…</MenuItem>
            ) : null}
            {canEditWorkflowFromMenu ? (
              <MenuItem onClick={props.onEditWorkflow}>Edit workflow</MenuItem>
            ) : null}
            {props.environmentId ? (
              <MenuItem onClick={() => setCredentialsOpen(true)}>Credentials…</MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
        {props.onRefresh && !props.showSubagents && props.selected ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Refresh workflow"
                disabled={props.busy}
                onClick={props.onRefresh}
              >
                <RefreshCwIcon />
              </Button>
            </TooltipTrigger>
            <TooltipPopup>Refresh workflow &amp; output previews</TooltipPopup>
          </Tooltip>
        ) : null}
        {showStop ? (
          <Button
            variant="outline"
            size="xs"
            disabled={!props.canStop || props.busy}
            onClick={props.onStop}
          >
            Stop
          </Button>
        ) : !props.showSubagents && props.selected?.definition ? (
          <WorkflowRunButton
            disabled={!canRun}
            disabledReason={disabledReason}
            busy={props.busy}
            onRun={props.onRun}
          />
        ) : null}
      </div>
      {showSubagentsToggle || props.executionControl || chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5 text-2xs text-muted-foreground">
          {showSubagentsToggle ? (
            <ToggleGroup
              aria-label="Workflow panel view"
              className="shrink-0"
              value={[props.showSubagents ? "subagents" : "steps"]}
              onValueChange={(values) => {
                const value = values[0];
                if (value === "steps" && props.showSubagents) props.onToggleSubagents?.();
                if (value === "subagents" && !props.showSubagents) props.onToggleSubagents?.();
              }}
            >
              <Toggle value="steps">Steps</Toggle>
              <Toggle value="subagents">Subagents</Toggle>
            </ToggleGroup>
          ) : null}
          {props.executionControl ? (
            <div className="flex min-w-0 items-center gap-1.5">
              {props.executionControl}
              {viewingRun ? <span className="shrink-0">Next run</span> : null}
            </div>
          ) : null}
          {chips}
        </div>
      ) : null}
      {!props.showSubagents && props.editMode && blockers.length > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 border-b bg-warning/8 px-3 py-1.5 text-xs text-warning"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <span className="font-medium">Can't run yet</span>
            {props.environmentId && props.selected && props.selected.missingSkills.length > 0 ? (
              <MissingSkillActions
                environmentId={props.environmentId}
                listing={props.selected}
                onChanged={props.onRefresh}
              />
            ) : null}
            <ul className="mt-0.5 space-y-0.5">
              {blockers.map((blocker) => (
                <li key={`${blocker.stepId}:${blocker.message}`}>
                  <button
                    type="button"
                    className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    onClick={() => props.onOpenBlocker(blocker.stepId)}
                  >
                    {blocker.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
