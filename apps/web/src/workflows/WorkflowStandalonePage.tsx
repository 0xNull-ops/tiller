import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, ArrowLeftIcon, ServerOffIcon, WorkflowIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { isEditableFocused } from "../lib/editableFocus";
import { useProjects } from "../state/entities";
import { useConnectedEnvironmentIds } from "../state/environments";
import { WorkflowProjectPanel } from "./WorkflowPanel";
import { useWorkflowRuns } from "./workflowState";
import { readLastChatPath } from "./workflowUiStore";

export function WorkflowStandalonePage(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly slug: string;
  readonly runId?: string | null;
  readonly stepId?: string | null;
}) {
  const navigate = useNavigate();
  const connectedIds = useConnectedEnvironmentIds();
  const projects = useProjects();
  const isConnected = Array.isArray(connectedIds)
    ? connectedIds.includes(props.environmentId)
    : true;
  const project =
    (Array.isArray(projects) ? projects : []).find(
      (entry) => entry.environmentId === props.environmentId && entry.id === props.projectId,
    ) ?? null;
  const runsQuery = useWorkflowRuns(props.environmentId, props.projectId);
  const listing = runsQuery.workflows.find((entry) => entry.workflow === props.slug) ?? null;
  const runsForSlug = runsQuery.runs
    .filter((run) => run.workflow === props.slug && run.parent === undefined)
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
  const hasRunsForSlug = runsQuery.runs.some((run) => run.workflow === props.slug);

  const resolveBackPath = () => {
    const last = readLastChatPath();
    if (last !== "/") return last;
    const fallbackThreadId = runsForSlug[0]?.driverThreadId ?? listing?.editedByThreadId ?? null;
    return fallbackThreadId ? `/${props.environmentId}/${fallbackThreadId}` : "/";
  };

  const goBack = () => {
    void navigate({ to: resolveBackPath() as never });
  };

  // oxlint-disable-next-line t3code/react-effect-budget -- Apply route selection to the external workflow canvas state after mount.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      if (isEditableFocused(event.target)) return;
      if (
        document.querySelector(
          '[data-slot="dialog-popup"], [data-slot="select-popup"], [data-slot="menu-popup"], [aria-label="Workflow settings"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      void navigate({ to: resolveBackPath() as never });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!isConnected) {
    return (
      <div className="flex h-dvh min-h-0 flex-1 overflow-hidden overscroll-y-none">
        <SidebarInset>
          {isElectron ? <WorkspacePageHeader electron /> : null}
          <div className="flex items-center gap-2 border-b p-2">
            <Button variant="ghost" size="icon-xs" aria-label="Back to chat" onClick={goBack}>
              <ArrowLeftIcon />
            </Button>
            <span className="text-xs font-medium text-muted-foreground">{props.slug}</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <ServerOffIcon className="size-6 text-muted-foreground" />
            <div className="space-y-1">
              <h1 className="text-sm font-medium">Server not connected</h1>
              <p className="max-w-sm text-xs text-muted-foreground">
                The environment hosting this workflow ({props.environmentId}) is not currently
                connected.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="xs" onClick={goBack}>
                Back to chat
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void navigate({ to: "/workflows" as never })}
              >
                All workflows
              </Button>
            </div>
          </div>
        </SidebarInset>
      </div>
    );
  }

  if (!runsQuery.isPending && listing === null && !hasRunsForSlug) {
    return (
      <div className="flex h-dvh min-h-0 flex-1 overflow-hidden overscroll-y-none">
        <SidebarInset>
          {isElectron ? <WorkspacePageHeader electron /> : null}
          <div className="flex items-center gap-2 border-b p-2">
            <Button variant="ghost" size="icon-xs" aria-label="Back to chat" onClick={goBack}>
              <ArrowLeftIcon />
            </Button>
            <span className="text-xs font-medium text-muted-foreground">{props.slug}</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangleIcon className="size-6 text-muted-foreground" />
            <div className="space-y-1">
              <h1 className="text-sm font-medium">Workflow not found</h1>
              <p className="max-w-sm text-xs text-muted-foreground">
                “{props.slug}” does not exist in {project?.title ?? "this project"} or was deleted.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="xs" onClick={goBack}>
                Back to chat
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void navigate({ to: "/workflows" as never })}
              >
                All workflows
              </Button>
            </div>
          </div>
        </SidebarInset>
      </div>
    );
  }

  if (runsQuery.isPending && listing === null && !hasRunsForSlug) {
    return (
      <div className="flex h-dvh min-h-0 flex-1 overflow-hidden overscroll-y-none">
        <SidebarInset>
          {isElectron ? <WorkspacePageHeader electron /> : null}
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <WorkflowIcon className="size-5 text-muted-foreground" />
            <p role="status" className="text-xs text-muted-foreground">
              Loading workflow…
            </p>
          </div>
        </SidebarInset>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-1 overflow-hidden overscroll-y-none">
      <SidebarInset>
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <WorkflowProjectPanel
          environmentId={props.environmentId}
          projectId={props.projectId}
          workflow={props.slug}
          projectName={project?.title ?? null}
          runId={props.runId ?? null}
          stepId={props.stepId ?? null}
          onBack={goBack}
          onDeleted={() => void navigate({ to: "/workflows" as never })}
          onSelectWorkflow={(nextSlug) => {
            void navigate({
              to: "/workflows/$environmentId/$projectId/$slug" as never,
              params: {
                environmentId: props.environmentId,
                projectId: props.projectId,
                slug: nextSlug,
              } as never,
              search: {} as never,
            });
          }}
          onSelectRun={(nextRunId) => {
            void navigate({
              to: "/workflows/$environmentId/$projectId/$slug" as never,
              params: {
                environmentId: props.environmentId,
                projectId: props.projectId,
                slug: props.slug,
              } as never,
              search: (nextRunId ? { run: nextRunId } : {}) as never,
              replace: true,
            });
          }}
        />
      </SidebarInset>
    </div>
  );
}
