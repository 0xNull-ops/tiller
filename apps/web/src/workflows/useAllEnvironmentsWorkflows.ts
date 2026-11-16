import { useAtomValue } from "@effect/atom-react";
import {
  workflowScheduleBinding,
  type EnvironmentId,
  type ProjectId,
  type ScheduledTask,
  ThreadId,
  type WorkflowListing,
  type WorkflowRun,
} from "@t3tools/contracts";
import { isScratchWorkflow, workflowScratchThreadId } from "@t3tools/shared/workflowScratch";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { useConnectedEnvironmentIds } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { workflowRunsLive } from "./workflowState";
import { isWorkflowNestedStep } from "./workflowStep";

export interface EnvironmentWorkflowsSnapshot {
  readonly environmentId: EnvironmentId;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly runs: ReadonlyArray<WorkflowRun>;
  readonly scheduledTasks: ReadonlyArray<ScheduledTask>;
  readonly isPending: boolean;
}

export interface RunningWorkflowSidebarItem {
  readonly runId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
  readonly title: string;
  readonly needsYou: boolean;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly progressLabel: string;
  readonly startedAt: string;
}

export interface ScheduledWorkflowSidebarItem {
  readonly taskId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
  readonly title: string;
  readonly nextRunAt: string;
}

export interface SavedWorkflowSidebarItem {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
  readonly title: string;
  readonly lastRunId: string | null;
  readonly lastRunStatus: WorkflowRun["status"] | null;
  readonly stepCount: number;
  readonly sortAt: string;
  readonly pinned?: boolean;
  /** A thread's agent created it while Workflow-first was on; it stays under "From threads". */
  readonly scratch: boolean;
  /** The thread that created a scratch workflow, for its small context link. */
  readonly originThreadId: ThreadId | null;
}

const DEFAULT_SIDEBAR_ROW_LIMIT = 5;

const allEnvironmentsWorkflowsAtom = Atom.family((idsKey: string) =>
  Atom.make((get): ReadonlyArray<EnvironmentWorkflowsSnapshot> => {
    if (!idsKey) return [];
    const environmentIds = idsKey.split("\n") as EnvironmentId[];
    return environmentIds.map((environmentId) => {
      const runsResult = get(workflowRunsLive(environmentId));
      const tasksResult = get(serverEnvironment.scheduledTasksLive({ environmentId, input: {} }));
      const runsData = Option.getOrNull(AsyncResult.value(runsResult));
      const tasksData = Option.getOrNull(AsyncResult.value(tasksResult));
      return {
        environmentId,
        workflows: runsData?.workflows ?? [],
        runs: runsData?.runs ?? [],
        scheduledTasks: tasksData?.tasks ?? [],
        isPending: runsResult.waiting || tasksResult.waiting,
      };
    });
  }).pipe(Atom.withLabel(`workflows:all-environments:${idsKey}`)),
);

export function useAllEnvironmentsWorkflows(): ReadonlyArray<EnvironmentWorkflowsSnapshot> {
  const connectedIds = useConnectedEnvironmentIds();
  const key = connectedIds.join("\n");
  return useAtomValue(allEnvironmentsWorkflowsAtom(key));
}

export function selectRunningWorkflowSidebarItems(
  snapshots: ReadonlyArray<EnvironmentWorkflowsSnapshot>,
  limit = DEFAULT_SIDEBAR_ROW_LIMIT,
): {
  readonly items: ReadonlyArray<RunningWorkflowSidebarItem>;
  readonly totalCount: number;
} {
  const all: RunningWorkflowSidebarItem[] = [];
  for (const snapshot of snapshots) {
    for (const run of snapshot.runs) {
      if (run.parent !== undefined) continue;
      if (run.status !== "running" && run.status !== "waiting") continue;
      const completedSteps = run.steps.filter(
        (step) => step.status === "done" || step.status === "skipped",
      ).length;
      const totalSteps = run.steps.length;
      all.push({
        runId: run.id,
        environmentId: snapshot.environmentId,
        projectId: run.projectId,
        workflow: run.workflow,
        title: run.definition.name,
        needsYou: run.status === "waiting",
        completedSteps,
        totalSteps,
        progressLabel: `${completedSteps}/${totalSteps}`,
        startedAt: run.startedAt,
      });
    }
  }
  all.sort((a, b) => {
    if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
    return b.startedAt.localeCompare(a.startedAt);
  });
  return {
    items: all.slice(0, limit),
    totalCount: all.length,
  };
}

export function selectScheduledWorkflowSidebarItems(
  snapshots: ReadonlyArray<EnvironmentWorkflowsSnapshot>,
  limit = DEFAULT_SIDEBAR_ROW_LIMIT,
): {
  readonly items: ReadonlyArray<ScheduledWorkflowSidebarItem>;
  readonly totalCount: number;
} {
  const byWorkflowKey = new Map<string, ScheduledWorkflowSidebarItem>();
  for (const snapshot of snapshots) {
    const titleByProjectAndSlug = new Map(
      snapshot.workflows.map((listing) => [
        `${listing.projectId}:${listing.workflow}`,
        listing.definition?.name ?? listing.workflow,
      ]),
    );
    for (const task of snapshot.scheduledTasks) {
      if (!task.enabled || !task.nextRunAt) continue;
      const binding = workflowScheduleBinding(task);
      if (!binding) continue;
      const key = `${snapshot.environmentId}:${binding.projectId}:${binding.workflow}`;
      const existing = byWorkflowKey.get(key);
      if (existing && existing.nextRunAt.localeCompare(task.nextRunAt) <= 0) continue;
      byWorkflowKey.set(key, {
        taskId: task.id,
        environmentId: snapshot.environmentId,
        projectId: binding.projectId,
        workflow: binding.workflow,
        title:
          titleByProjectAndSlug.get(`${binding.projectId}:${binding.workflow}`) ?? binding.workflow,
        nextRunAt: task.nextRunAt,
      });
    }
  }
  const all = [...byWorkflowKey.values()].toSorted((a, b) =>
    a.nextRunAt.localeCompare(b.nextRunAt),
  );
  return {
    items: all.slice(0, limit),
    totalCount: all.length,
  };
}

export function selectSavedWorkflowSidebarItems(
  snapshots: ReadonlyArray<EnvironmentWorkflowsSnapshot>,
  limit = DEFAULT_SIDEBAR_ROW_LIMIT,
): {
  readonly items: ReadonlyArray<SavedWorkflowSidebarItem>;
  readonly totalCount: number;
  readonly pinnedTotalCount: number;
  readonly scratchItems: ReadonlyArray<SavedWorkflowSidebarItem>;
  readonly scratchTotalCount: number;
} {
  const all: SavedWorkflowSidebarItem[] = [];
  for (const snapshot of snapshots) {
    const activeWorkflowKeys = new Set<string>();
    const latestRunByWorkflowKey = new Map<string, WorkflowRun>();
    for (const run of snapshot.runs) {
      if (run.parent !== undefined) continue;
      const key = `${run.projectId}:${run.workflow}`;
      if (run.status === "running" || run.status === "waiting") {
        activeWorkflowKeys.add(key);
      }
      const existing = latestRunByWorkflowKey.get(key);
      if (!existing || existing.startedAt.localeCompare(run.startedAt) < 0) {
        latestRunByWorkflowKey.set(key, run);
      }
    }
    for (const listing of snapshot.workflows) {
      const key = `${listing.projectId}:${listing.workflow}`;
      if (activeWorkflowKeys.has(key) && !listing.pinned) continue;
      const latestRun = latestRunByWorkflowKey.get(key) ?? null;
      const originThreadId = workflowScratchThreadId(listing);
      all.push({
        environmentId: snapshot.environmentId,
        projectId: listing.projectId,
        workflow: listing.workflow,
        title: listing.definition?.name ?? listing.workflow,
        lastRunId: latestRun?.id ?? null,
        lastRunStatus: latestRun?.status ?? null,
        stepCount: listing.definition?.steps.length ?? 0,
        sortAt: latestRun?.startedAt ?? listing.updatedAt,
        ...(listing.pinned ? { pinned: true } : {}),
        scratch: isScratchWorkflow(listing),
        originThreadId: originThreadId === null ? null : ThreadId.make(originThreadId),
      });
    }
  }
  all.sort(
    (a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      b.sortAt.localeCompare(a.sortAt) ||
      a.title.localeCompare(b.title),
  );
  // Scratch rows get their own group and their own preview limit, so a thread's automatic
  // workflows can never push an ordinary saved workflow out of the sidebar.
  const scratch = all.filter((item) => item.scratch);
  const regular = all.filter((item) => !item.scratch);
  return {
    items: regular.slice(0, limit),
    totalCount: regular.length,
    pinnedTotalCount: regular.filter((item) => item.pinned).length,
    scratchItems: scratch.slice(0, limit),
    scratchTotalCount: scratch.length,
  };
}

/**
 * Maps each nested workflow slug in a project to the names of parent workflows that call it.
 */
export function buildWorkflowUsedInMap(
  workflows: ReadonlyArray<WorkflowListing>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const map = new Map<string, string[]>();
  for (const listing of workflows) {
    const parentName = listing.definition?.name ?? listing.workflow;
    for (const step of listing.definition?.steps ?? []) {
      if (!isWorkflowNestedStep(step)) continue;
      const existing = map.get(step.workflow);
      if (!existing) {
        map.set(step.workflow, [parentName]);
      } else if (!existing.includes(parentName)) {
        existing.push(parentName);
      }
    }
  }
  return map;
}
