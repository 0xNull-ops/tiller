import {
  workflowScheduleBinding,
  type EnvironmentId,
  type ProjectId,
  type WorkflowListing,
  type WorkflowRun,
  type ScheduledTask,
} from "@t3tools/contracts";
import { isScratchWorkflow } from "@t3tools/shared/workflowScratch";
import { buildWorkflowUsedInMap } from "./useAllEnvironmentsWorkflows";
import type { EnvironmentWorkflowsSnapshot } from "./useAllEnvironmentsWorkflows";
import type { GalleryItem } from "./workflowGallery";
import { workflowWorkStepCount } from "./workflowWorkStepCount";

export interface LocalGalleryItem extends GalleryItem {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly listing: WorkflowListing;
  readonly usedIn: ReadonlyArray<string>;
}
export function localGalleryItems(
  snapshots: ReadonlyArray<EnvironmentWorkflowsSnapshot>,
  projects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly title: string;
  }>,
): LocalGalleryItem[] {
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}/${project.id}`, project.title]),
  );
  return snapshots.flatMap((snapshot) => {
    const byProject = new Map<ProjectId, WorkflowListing[]>();
    const runsByWorkflow = new Map<string, WorkflowRun[]>();
    const schedulesByWorkflow = new Map<string, ScheduledTask[]>();
    for (const listing of snapshot.workflows) {
      const group = byProject.get(listing.projectId) ?? [];
      group.push(listing);
      byProject.set(listing.projectId, group);
    }
    const projectData = new Map(
      [...byProject].map(([projectId, workflows]) => [
        projectId,
        {
          definitions: new Map(
            workflows.flatMap((listing) =>
              listing.definition ? [[listing.workflow, listing.definition] as const] : [],
            ),
          ),
          usedIn: buildWorkflowUsedInMap(workflows),
        },
      ]),
    );
    for (const run of snapshot.runs) {
      if (run.parent) continue;
      const key = `${run.projectId}/${run.workflow}`;
      const group = runsByWorkflow.get(key) ?? [];
      group.push(run);
      runsByWorkflow.set(key, group);
    }
    for (const [key, runs] of runsByWorkflow)
      runsByWorkflow.set(
        key,
        runs.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt)),
      );
    for (const task of snapshot.scheduledTasks) {
      const binding = workflowScheduleBinding(task);
      if (!task.enabled || !binding) continue;
      const key = `${binding.projectId}/${binding.workflow}`;
      const group = schedulesByWorkflow.get(key) ?? [];
      group.push(task);
      schedulesByWorkflow.set(key, group);
    }
    return snapshot.workflows.map((listing) => {
      const definition = listing.definition;
      const data = projectData.get(listing.projectId)!;
      const key = `${listing.projectId}/${listing.workflow}`;
      const runs = runsByWorkflow.get(key) ?? [];
      const running = runs.find((run) => run.status === "running" || run.status === "waiting");
      const schedules = schedulesByWorkflow.get(key) ?? [];
      const steps = definition?.steps ?? [];
      const edges = steps.flatMap((step, index) =>
        (step.readsFrom ?? [])
          .filter((from) => from !== steps[index - 1]?.id)
          .map((from) => ({
            from,
            to: step.id,
          })),
      );
      const loops = (definition?.loops ?? []).map((loop) => ({ from: loop.from, to: loop.to }));
      return {
        key: `local:${snapshot.environmentId}/${listing.projectId}/${listing.workflow}`,
        source: "mine",
        environmentId: snapshot.environmentId,
        projectId: listing.projectId,
        listing,
        project: `${snapshot.environmentId}/${listing.projectId}`,
        projectTitle:
          projectTitles.get(`${snapshot.environmentId}/${listing.projectId}`) ?? listing.projectId,
        title: definition?.name ?? listing.workflow,
        brief: definition?.brief,
        tags: definition?.tags ?? [],
        steps: steps.map((step) => ({
          id: step.id,
          kind: step.kind === "workflow" ? "workflow" : "skill",
        })),
        edges,
        loops,
        digest: JSON.stringify(definition),
        workSteps: definition
          ? workflowWorkStepCount(definition, listing.workflow, data.definitions)
          : 0,
        triggers: [
          ...(definition?.trigger === "webhook" ||
          schedules.some((task) => task.schedule.type === "webhook")
            ? ["webhook" as const]
            : []),
          ...(definition?.trigger === "schedule" ||
          schedules.some((task) => task.schedule.type !== "webhook")
            ? ["schedule" as const]
            : []),
          ...(definition?.startAfter?.length ? ["after" as const] : []),
        ],
        pinned: listing.pinned === true,
        scratch: isScratchWorkflow(listing),
        updatedAt: listing.updatedAt,
        usedIn: data.usedIn.get(listing.workflow) ?? [],
        status: {
          running: running
            ? {
                step: Math.min(
                  running.steps.filter((step) => step.status === "done").length + 1,
                  running.steps.length,
                ),
                total: running.steps.length,
              }
            : undefined,
          nextRunAt: schedules
            .flatMap((task) => (task.nextRunAt ? [task.nextRunAt] : []))
            .toSorted()[0],
          lastRunAt: runs[0]?.startedAt,
          runCount: runs.length,
          problem:
            listing.problem ??
            (listing.blockers
              .filter((blocker) => blocker.kind !== "missing-skill")
              .map((blocker) => blocker.message)
              .join("; ") ||
              undefined),
          missingSkills: listing.missingSkills,
        },
      };
    });
  });
}
