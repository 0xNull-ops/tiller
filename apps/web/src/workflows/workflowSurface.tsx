import type { ScopedThreadRef } from "@t3tools/contracts";
import { WorkflowIcon } from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import {
  ADDON_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
  ITEM_ICON_CLASS,
} from "../components/CommandPalette.logic";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useComposerDraftStore, type DraftSessionState } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import { useRightPanelStore } from "../rightPanelStore";
import { useProjects } from "../state/entities";
import {
  useAllEnvironmentsWorkflows,
  type EnvironmentWorkflowsSnapshot,
} from "./useAllEnvironmentsWorkflows";
import { useTourPaletteItem } from "../fork/tour/tourPalette";
import {
  requestWorkflowSchedule,
  requestWorkflowCreate,
  requestWorkflowRun,
  requestWorkflowSave,
} from "./workflowUiStore";
import { changeActiveWorkflowView } from "./workflowViewPrefs";

export const WorkflowSurfaceIcon = WorkflowIcon;

export function resolveWorkflowSurfaceRef(
  target: ThreadRouteTarget | null,
  draft: DraftSessionState | null,
): ScopedThreadRef | null {
  if (target?.kind === "server") return target.threadRef;
  if (target?.kind !== "draft" || !draft) return null;
  return draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId);
}

/**
 * The Workflow entry for the panel's "open a surface" lists. Returned as a list so the
 * upstream action arrays take it with one spread and no new props through ChatView.
 */
export function useWorkflowSurfaceActions() {
  const target = useThreadRouteTarget();
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  const threadRef = resolveWorkflowSurfaceRef(target, draft);
  return [
    {
      label: "Workflow",
      icon: WorkflowIcon,
      shortcut: "W",
      available: threadRef !== null,
      disabledReason: "Available from a thread.",
      onClick: () => {
        if (threadRef !== null) useRightPanelStore.getState().open(threadRef, "workflow");
      },
    },
  ] as const;
}

function workflowPaletteAction(threadRef: ScopedThreadRef): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:open-thread-workflow",
    // The palette matches only these terms, not the title, so the title leads them.
    searchTerms: ["Show workflow graph", "subagents", "delegated", "tasks", "canvas"],
    title: "Show workflow graph",
    icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      useRightPanelStore.getState().open(threadRef, "workflow");
    },
  };
}

/** A view change for the workflow on screen; opens the panel first when it isn't showing one. */
function workflowViewPaletteAction(
  threadRef: ScopedThreadRef,
  item: {
    readonly value: string;
    readonly title: string;
    readonly searchTerms: ReadonlyArray<string>;
    readonly update: Parameters<typeof changeActiveWorkflowView>[0];
  },
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: item.value,
    searchTerms: [...item.searchTerms],
    title: item.title,
    icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      if (!changeActiveWorkflowView(item.update))
        useRightPanelStore.getState().open(threadRef, "workflow");
    },
  };
}

export function workflowPaletteActions(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
}): CommandPaletteActionItem[] {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  return [
    workflowPaletteAction(threadRef),
    workflowViewPaletteAction(threadRef, {
      value: "action:workflow-outline-view",
      title: "Show workflow as outline",
      searchTerms: ["outline", "list", "tree", "steps", "large workflow", "search steps"],
      update: () => ({ mode: "outline" }),
    }),
    workflowViewPaletteAction(threadRef, {
      value: "action:workflow-canvas-view",
      title: "Show workflow as canvas",
      searchTerms: ["canvas", "graph", "cards", "map"],
      update: () => ({ mode: "canvas" }),
    }),
    workflowViewPaletteAction(threadRef, {
      value: "action:workflow-compact-cards",
      title: "Toggle compact workflow cards",
      searchTerms: ["compact", "smaller cards", "fit more", "canvas"],
      update: (current) => ({ compact: !current.compact }),
    }),
    {
      kind: "action",
      value: "action:schedule-workflow",
      searchTerms: ["Schedule workflow", "trigger", "webhook"],
      title: "Schedule workflow…",
      icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        useRightPanelStore.getState().open(threadRef, "workflow");
        requestWorkflowSchedule(threadRef);
      },
    },
    {
      kind: "action",
      value: "action:new-thread-workflow",
      searchTerms: ["New workflow", "create workflow", "workflow"],
      title: "New workflow…",
      icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        useRightPanelStore.getState().open(threadRef, "workflow");
        requestWorkflowCreate();
      },
    },
    {
      kind: "action",
      value: "action:save-thread-as-workflow",
      searchTerms: ["Save this thread as a workflow", "import delegated work", "workflow"],
      title: "Save this thread as a workflow…",
      icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        useRightPanelStore.getState().open(threadRef, "workflow");
        requestWorkflowSave(threadRef);
      },
    },
  ];
}

type OpenWorkflow = (target: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
}) => Promise<void>;

export function buildRunWorkflowSubmenu(
  snapshots: ReadonlyArray<EnvironmentWorkflowsSnapshot>,
  projectNameByKey: ReadonlyMap<string, string>,
) {
  return buildWorkflowSubmenu(snapshots, projectNameByKey);
}
export function buildOpenWorkflowSubmenu(
  snapshots: ReadonlyArray<EnvironmentWorkflowsSnapshot>,
  projectNameByKey: ReadonlyMap<string, string>,
  open: OpenWorkflow,
) {
  return buildWorkflowSubmenu(snapshots, projectNameByKey, open);
}
function buildWorkflowSubmenu(
  snapshots: ReadonlyArray<EnvironmentWorkflowsSnapshot>,
  projectNameByKey: ReadonlyMap<string, string>,
  open?: OpenWorkflow,
): CommandPaletteSubmenuItem | null {
  const mode = open ? "open" : "run";
  const items: CommandPaletteActionItem[] = [];
  for (const snapshot of snapshots) {
    for (const listing of snapshot.workflows) {
      const projectName =
        projectNameByKey.get(`${snapshot.environmentId}:${listing.projectId}`) ?? listing.projectId;
      const title = listing.definition?.name ?? listing.workflow;
      const disabled = listing.definition === null || listing.blockers.length > 0;
      items.push({
        kind: "action",
        value: `action:${mode}-workflow:${snapshot.environmentId}:${listing.projectId}:${listing.workflow}`,
        searchTerms: [
          title,
          listing.workflow,
          projectName,
          `${mode} workflow`,
          "workflow",
          ...(listing.definition?.tags ?? []),
        ],
        searchTitle: [title, ...(listing.definition?.tags ?? []).map((tag) => `#${tag}`)].join(" "),
        // Root search uses searchTitle for React titles, preserving tags when flattening this submenu.
        title: open ? <span>{title}</span> : title,
        description: projectName,
        disabled: !open && disabled,
        icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          if (open)
            return open({
              environmentId: snapshot.environmentId,
              projectId: listing.projectId,
              workflow: listing.workflow,
            });
          requestWorkflowRun({
            environmentId: snapshot.environmentId,
            projectId: listing.projectId,
            listing,
          });
        },
      });
    }
  }
  if (items.length === 0) return null;
  return {
    kind: "submenu",
    value: `action:${mode}-workflow`,
    searchTerms: open
      ? ["Open workflow", "view workflow", "workflow"]
      : ["Run workflow", "start workflow", "execute workflow", "workflow"],
    title: open ? "Open workflow…" : "Run workflow…",
    icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <WorkflowIcon className={ADDON_ICON_CLASS} />,
    groups: [
      {
        value: "workflows",
        label: "Saved workflows",
        items,
      },
    ],
  };
}

export function useWorkflowPaletteItems(
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
  } | null,
): Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> {
  const navigate = useNavigate();
  const snapshots = useAllEnvironmentsWorkflows();
  const projects = useProjects();
  const projectNameByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
  );
  const runSubmenu = buildRunWorkflowSubmenu(snapshots, projectNameByKey);
  const openSubmenu = buildOpenWorkflowSubmenu(snapshots, projectNameByKey, async (target) => {
    await navigate({
      to: "/workflows/$environmentId/$projectId/$slug" as never,
      params: {
        environmentId: target.environmentId,
        projectId: target.projectId,
        slug: target.workflow,
      } as never,
      search: {} as never,
    });
  });
  const openAllAction: CommandPaletteActionItem = {
    kind: "action",
    value: "action:open-workflows",
    searchTerms: ["All workflows", "Open workflows", "saved workflows", "scheduled workflows"],
    title: "All workflows",
    icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/workflows" as never });
    },
  };
  const tourItem = useTourPaletteItem();
  return [
    ...(thread ? workflowPaletteActions(thread) : []),
    ...(openSubmenu ? [openSubmenu] : []),
    ...(runSubmenu ? [runSubmenu] : []),
    openAllAction,
    {
      kind: "action",
      value: "action:new-workflow-from-template",
      title: "New workflow from template…",
      searchTerms: ["New workflow from template", "built-in", "templates"],
      icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/workflows" as never, search: { templates: true } as never });
      },
    },
    tourItem,
    {
      kind: "action",
      value: "action:find-skill",
      title: "Find a skill…",
      searchTerms: ["skills.sh browse install"],
      icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/settings/skills" as never });
      },
    },
  ];
}
