import { useLocation, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  ClockIcon,
  EllipsisIcon,
  WorkflowIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { SidebarGroup } from "../components/ui/sidebar";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { readLocalApi } from "../localApi";
import { useProjects } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeUntilLabel } from "../timestampFormat";
import {
  selectRunningWorkflowSidebarItems,
  selectSavedWorkflowSidebarItems,
  selectScheduledWorkflowSidebarItems,
  type SavedWorkflowSidebarItem,
  useAllEnvironmentsWorkflows,
} from "./useAllEnvironmentsWorkflows";
import { WorkflowDeleteDialog, type WorkflowDeleteTarget } from "./WorkflowDeleteDialog";
import { useKeepWorkflow } from "./WorkflowKeepButton";
import { WorkflowRunDialogHost } from "./WorkflowRunDialog";
import { WorkflowRunDuration } from "./WorkflowRunElapsed";
import { useWorkflowEditPermission } from "./workflowState";
import { recordLastChatPath } from "./workflowUiStore";

export const WORKFLOWS_SIDEBAR_EXPANDED_KEY = "t3code:sidebar:workflows-expanded";
export const WORKFLOWS_SIDEBAR_FROM_THREADS_KEY = "t3code:sidebar:workflows-from-threads-expanded";

const SAVED_STATUS_LABEL = {
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  running: "Running",
  waiting: "Needs you",
} as const;

export function WorkflowsSidebarSection() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [expanded, setExpanded] = useLocalStorage(
    WORKFLOWS_SIDEBAR_EXPANDED_KEY,
    true,
    Schema.Boolean,
  );
  // Scratch workflows stay folded away until the user opens the group or keeps one.
  const [fromThreadsExpanded, setFromThreadsExpanded] = useLocalStorage(
    WORKFLOWS_SIDEBAR_FROM_THREADS_KEY,
    false,
    Schema.Boolean,
  );
  const snapshots = useAllEnvironmentsWorkflows();
  const projects = useProjects();
  const running = selectRunningWorkflowSidebarItems(snapshots);
  const scheduled = selectScheduledWorkflowSidebarItems(snapshots);
  const saved = selectSavedWorkflowSidebarItems(snapshots);
  const pinned = saved.items.filter((item) => item.pinned);
  const unpinned = saved.items.filter((item) => !item.pinned);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDeleteTarget | null>(null);
  const projectTitleByKey = new Map(
    (Array.isArray(projects) ? projects : []).map((project) => [
      `${project.environmentId}:${project.id}`,
      project.title,
    ]),
  );

  const renderSavedRow = (item: SavedWorkflowSidebarItem) => (
    <SavedWorkflowRow
      key={`${item.environmentId}:${item.projectId}:${item.workflow}`}
      item={item}
      isActive={pathname === `/workflows/${item.environmentId}/${item.projectId}/${item.workflow}`}
      projectTitle={
        projectTitleByKey.get(`${item.environmentId}:${item.projectId}`) ?? item.projectId
      }
      onOpen={() =>
        void navigate({
          to: "/workflows/$environmentId/$projectId/$slug" as never,
          params: {
            environmentId: item.environmentId,
            projectId: item.projectId,
            slug: item.workflow,
          } as never,
          search: (item.lastRunId ? { run: item.lastRunId } : {}) as never,
        })
      }
      onOpenOriginThread={() => {
        if (item.originThreadId === null) return;
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(item.environmentId, item.originThreadId)),
        });
      }}
      onRequestDelete={setDeleteTarget}
    />
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the selected workflow panel aligned with the external right-panel store.
  useEffect(() => {
    recordLastChatPath(pathname);
  }, [pathname]);

  const waitingCount = running.items.filter((item) => item.needsYou).length;
  const isAllWorkflowsActive = pathname === "/workflows";

  return (
    <div className="border-b border-sidebar-border/60 pb-1.5" data-tour="workflows-sidebar">
      <SidebarGroup role="region" aria-label="Workflows">
        <WorkflowRunDialogHost />
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
          />
          <WorkflowIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">Workflows</span>
          {waitingCount > 0 ? (
            <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning">
              Needs you
            </span>
          ) : running.totalCount > 0 ? (
            <span className="text-2xs tabular-nums text-sidebar-muted-foreground">
              {running.totalCount} running
            </span>
          ) : !expanded && scheduled.totalCount > 0 ? (
            <span className="text-2xs tabular-nums text-sidebar-muted-foreground">
              {scheduled.totalCount} scheduled
            </span>
          ) : !expanded && saved.totalCount + saved.scratchTotalCount > 0 ? (
            <span className="text-2xs tabular-nums text-sidebar-muted-foreground">
              {saved.totalCount + saved.scratchTotalCount} saved
            </span>
          ) : null}
        </button>

        {expanded ? (
          <div className="mt-0.5 flex flex-col gap-1 px-1">
            {pinned.length ? (
              <div className="flex flex-col gap-px">
                <div className="flex items-center justify-between px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-sidebar-muted-foreground/70">
                  <span>Pinned</span>
                  <span className="tabular-nums">{saved.pinnedTotalCount}</span>
                </div>
                {pinned.map(renderSavedRow)}
              </div>
            ) : null}
            {running.items.length > 0 ? (
              <div className="flex flex-col gap-px">
                <div className="flex items-center justify-between px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-sidebar-muted-foreground/70">
                  <span>Running</span>
                  <span className="tabular-nums">{running.totalCount}</span>
                </div>
                {running.items.map((item) => {
                  const targetPath = `/workflows/${item.environmentId}/${item.projectId}/${item.workflow}`;
                  const isActive = pathname === targetPath;
                  return (
                    <button
                      key={item.runId}
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: "/workflows/$environmentId/$projectId/$slug" as never,
                          params: {
                            environmentId: item.environmentId,
                            projectId: item.projectId,
                            slug: item.workflow,
                          } as never,
                          search: { run: item.runId } as never,
                        })
                      }
                      className={cn(
                        "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-sidebar-row-hover",
                        isActive
                          ? "bg-sidebar-row-selected font-medium text-sidebar-foreground"
                          : "text-sidebar-foreground/90",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          item.needsYou ? "bg-warning" : "bg-primary",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.needsYou ? (
                        <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning">
                          Needs you
                        </span>
                      ) : (
                        <span className="shrink-0 font-mono text-2xs tabular-nums text-sidebar-muted-foreground">
                          {item.progressLabel} · <WorkflowRunDuration startedAt={item.startedAt} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {scheduled.items.length > 0 ? (
              <div className="flex flex-col gap-px">
                <div className="flex items-center justify-between px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-sidebar-muted-foreground/70">
                  <span>Scheduled</span>
                  <span className="tabular-nums">{scheduled.totalCount}</span>
                </div>
                {scheduled.items.map((item) => {
                  const targetPath = `/workflows/${item.environmentId}/${item.projectId}/${item.workflow}`;
                  const isActive = pathname === targetPath;
                  return (
                    <button
                      key={item.taskId}
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: "/workflows/$environmentId/$projectId/$slug" as never,
                          params: {
                            environmentId: item.environmentId,
                            projectId: item.projectId,
                            slug: item.workflow,
                          } as never,
                          search: {} as never,
                        })
                      }
                      className={cn(
                        "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-sidebar-row-hover",
                        isActive
                          ? "bg-sidebar-row-selected font-medium text-sidebar-foreground"
                          : "text-sidebar-foreground/90",
                      )}
                    >
                      <ClockIcon
                        aria-hidden
                        className="size-3 shrink-0 text-sidebar-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 text-2xs tabular-nums text-sidebar-muted-foreground">
                        {formatRelativeTimeUntilLabel(item.nextRunAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {unpinned.length > 0 || saved.scratchTotalCount > 0 ? (
              <div className="flex flex-col gap-px">
                {unpinned.length > 0 ? (
                  <div className="flex items-center justify-between px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-sidebar-muted-foreground/70">
                    <span>Saved</span>
                    <span className="tabular-nums">
                      {saved.totalCount - saved.pinnedTotalCount}
                    </span>
                  </div>
                ) : null}
                {unpinned.map(renderSavedRow)}
                {saved.scratchTotalCount > 0 ? (
                  <>
                    <button
                      type="button"
                      aria-expanded={fromThreadsExpanded}
                      onClick={() => setFromThreadsExpanded((current) => !current)}
                      className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md px-2 text-left text-2xs font-medium uppercase tracking-wider text-sidebar-muted-foreground/70 transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-muted-foreground"
                    >
                      <ChevronRightIcon
                        aria-hidden
                        className={cn(
                          "size-3 shrink-0 transition-transform",
                          fromThreadsExpanded && "rotate-90",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">From threads</span>
                      <span className="tabular-nums">{saved.scratchTotalCount}</span>
                    </button>
                    {fromThreadsExpanded ? saved.scratchItems.map(renderSavedRow) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void navigate({ to: "/workflows" as never })}
              className={cn(
                "flex h-7 w-full cursor-pointer items-center justify-between rounded-md px-2 text-left text-xs transition-colors hover:bg-sidebar-row-hover",
                isAllWorkflowsActive
                  ? "bg-sidebar-row-selected font-medium text-sidebar-foreground"
                  : "text-sidebar-muted-foreground hover:text-sidebar-foreground",
              )}
            >
              <span>All workflows</span>
              <ArrowRightIcon aria-hidden className="size-3.5 shrink-0" />
            </button>
          </div>
        ) : null}
      </SidebarGroup>
      {deleteTarget ? (
        <WorkflowDeleteDialog
          key={`${deleteTarget.environmentId}:${deleteTarget.projectId}:${deleteTarget.workflow}`}
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            if (
              pathname ===
              `/workflows/${deleteTarget.environmentId}/${deleteTarget.projectId}/${deleteTarget.workflow}`
            )
              void navigate({ to: "/workflows" as never });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One saved workflow. A div rather than a button so the hover menu can sit inside it,
 * matching how upstream's sidebar thread and draft rows carry their own controls.
 */
function SavedWorkflowRow(props: {
  readonly item: SavedWorkflowSidebarItem;
  readonly isActive: boolean;
  readonly projectTitle: string;
  readonly onOpen: () => void;
  readonly onOpenOriginThread: () => void;
  readonly onRequestDelete: (target: WorkflowDeleteTarget) => void;
}) {
  const { item } = props;
  const canEdit = useWorkflowEditPermission(item.environmentId);
  const keep = useKeepWorkflow(item.environmentId);
  const target: WorkflowDeleteTarget = {
    environmentId: item.environmentId,
    projectId: item.projectId,
    projectTitle: props.projectTitle,
    workflow: item.workflow,
    name: item.title,
    // Saved workflows drop out of this list while a run is active; a run that starts
    // after it was rendered is still safe to delete.
    hasActiveRun: false,
  };
  const openContextMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const clicked = await api.contextMenu.show(
      [{ id: "delete", label: "Delete workflow…", icon: "trash", destructive: true }],
      position,
    );
    if (clicked === "delete") props.onRequestDelete(target);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={props.isActive ? "true" : undefined}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
          return;
        }
        if (!canEdit) return;
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          void openContextMenu({ x: rect.left + 8, y: rect.bottom });
        }
      }}
      onContextMenu={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        void openContextMenu({ x: event.clientX, y: event.clientY });
      }}
      className={cn(
        "group/sidebar-row relative flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.isActive
          ? "bg-sidebar-row-selected font-medium text-sidebar-foreground"
          : "text-sidebar-foreground/90",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          item.lastRunStatus === "done"
            ? "bg-success"
            : item.lastRunStatus === "failed"
              ? "bg-destructive"
              : "bg-sidebar-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span
        className={cn(
          "pointer-events-none shrink-0 text-2xs tabular-nums text-sidebar-muted-foreground",
          (canEdit || item.originThreadId !== null) && "group-any-hover/sidebar-row:opacity-0",
        )}
      >
        {item.lastRunStatus
          ? SAVED_STATUS_LABEL[item.lastRunStatus]
          : `${item.stepCount} ${item.stepCount === 1 ? "step" : "steps"}`}
      </span>
      {canEdit || item.originThreadId !== null ? (
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label={`Actions for ${item.title}`}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                className="absolute inset-y-0 right-1 my-auto inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground focus-visible:opacity-100 group-any-hover/sidebar-row:opacity-100"
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup side="bottom" align="end" width="content">
            {item.originThreadId !== null ? (
              <MenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenOriginThread();
                }}
              >
                Open creating thread
              </MenuItem>
            ) : null}
            {canEdit && item.scratch ? (
              <MenuItem
                disabled={keep.busy}
                onClick={(event) => {
                  event.stopPropagation();
                  void keep.keep({
                    projectId: item.projectId,
                    workflow: item.workflow,
                    name: item.title,
                  });
                }}
              >
                Keep workflow
              </MenuItem>
            ) : null}
            {canEdit ? (
              <MenuItem
                variant="destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onRequestDelete(target);
                }}
              >
                Delete workflow…
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}
