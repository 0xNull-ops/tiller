import {
  buildNestedSearchItems,
  filterCommandPaletteGroups,
} from "../components/CommandPalette.logic";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  workflowSchedulePrompt,
  type ScheduledTask,
  type WorkflowDefinition,
  type WorkflowListing,
  type WorkflowRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildWorkflowUsedInMap,
  selectRunningWorkflowSidebarItems,
  selectSavedWorkflowSidebarItems,
  selectScheduledWorkflowSidebarItems,
  type EnvironmentWorkflowsSnapshot,
} from "./useAllEnvironmentsWorkflows";
import { buildOpenWorkflowSubmenu, buildRunWorkflowSubmenu } from "./workflowSurface";
import { clearWorkflowRunRequest, readWorkflowRunRequest } from "./workflowUiStore";

const envLocal = EnvironmentId.make("local");
const envRemote = EnvironmentId.make("remote");
const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");
const thread1 = ThreadId.make("thread-1");

function makeListing(
  projectId: ProjectId,
  workflow: string,
  name: string,
  steps: WorkflowDefinition["steps"] = [{ id: "s1", title: "Step 1", skill: "brief" }],
): WorkflowListing {
  return {
    projectId,
    workflow,
    definition: {
      version: 2,
      name,
      steps,
    },
    problem: null,
    missingSkills: [],
    skills: [],
    blockers: [],
    updatedAt: "2026-10-20T12:00:00.000Z",
    editedByThreadId: thread1,
    scratch: false,
  };
}

function makeScratchListing(
  projectId: ProjectId,
  workflow: string,
  name: string,
  originThreadId = thread1,
  updatedAt = "2026-10-20T12:00:00.000Z",
): WorkflowListing {
  const base = makeListing(projectId, workflow, name);
  const definition = base.definition;
  if (definition === null) throw new Error("A scratch fixture needs a definition.");
  return {
    ...base,
    updatedAt,
    scratch: true,
    definition: {
      ...definition,
      origin: { kind: "workflow-first", threadId: originThreadId },
    },
  };
}

function makeRun(
  id: string,
  projectId: ProjectId,
  workflow: string,
  name: string,
  status: WorkflowRun["status"],
  startedAt: string,
  steps: WorkflowRun["steps"],
  parent?: WorkflowRun["parent"],
): WorkflowRun {
  return {
    id,
    projectId,
    workflow,
    driverThreadId: thread1,
    definition: {
      version: 2,
      name,
      steps: [{ id: "s1", title: "Step 1", skill: "brief" }],
    },
    status,
    startedAt,
    skills: [],
    steps,
    ...(parent ? { parent } : {}),
  };
}

describe("selectRunningWorkflowSidebarItems", () => {
  it("prioritizes waiting runs with Needs you, computes step progress, excludes child runs, and caps at 5", () => {
    const snapshots: EnvironmentWorkflowsSnapshot[] = [
      {
        environmentId: envLocal,
        workflows: [],
        scheduledTasks: [],
        isPending: false,
        runs: [
          makeRun("r1", projectA, "alpha", "Alpha", "running", "2026-10-20T10:01:00Z", [
            { stepId: "a", status: "done", attempts: 1, threadId: thread1 },
            { stepId: "b", status: "running", attempts: 1, threadId: thread1 },
            { stepId: "c", status: "queued", attempts: 0, threadId: null },
            { stepId: "d", status: "queued", attempts: 0, threadId: null },
          ]),
          makeRun("r2", projectA, "beta", "Beta", "waiting", "2026-10-20T10:00:00Z", [
            { stepId: "a", status: "done", attempts: 1, threadId: thread1 },
            { stepId: "b", status: "done", attempts: 1, threadId: thread1 },
            {
              stepId: "c",
              status: "waiting",
              waitingFor: "approval",
              attempts: 0,
              threadId: null,
            },
          ]),
          makeRun(
            "child",
            projectA,
            "nested",
            "Nested",
            "running",
            "2026-10-20T10:05:00Z",
            [{ stepId: "a", status: "running", attempts: 1, threadId: thread1 }],
            { runId: "r1", stepId: "b" },
          ),
          makeRun("done-run", projectA, "gamma", "Gamma", "done", "2026-10-20T10:06:00Z", []),
        ],
      },
      {
        environmentId: envRemote,
        workflows: [],
        scheduledTasks: [],
        isPending: false,
        runs: [
          makeRun("r3", projectB, "w3", "Three", "running", "2026-10-20T10:03:00Z", []),
          makeRun("r4", projectB, "w4", "Four", "running", "2026-10-20T10:04:00Z", []),
          makeRun("r5", projectB, "w5", "Five", "running", "2026-10-20T10:05:00Z", []),
          makeRun("r6", projectB, "w6", "Six", "running", "2026-10-20T10:06:00Z", []),
        ],
      },
    ];

    const result = selectRunningWorkflowSidebarItems(snapshots);
    expect(result.totalCount).toBe(6);
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({
      runId: "r2",
      title: "Beta",
      needsYou: true,
      progressLabel: "2/3",
    });
    expect(result.items.map((item) => item.runId)).toEqual(["r2", "r6", "r5", "r4", "r3"]);
  });
});

describe("selectScheduledWorkflowSidebarItems", () => {
  it("picks the earliest enabled schedule per workflow, sorts by nextRunAt, and caps at 5", () => {
    const task = (
      id: string,
      workflow: string,
      nextRunAt: string | null,
      enabled = true,
    ): ScheduledTask =>
      ({
        id,
        projectId: projectA,
        threadId: thread1,
        prompt: workflowSchedulePrompt({
          version: 1,
          projectId: projectA,
          workflow,
          inputs: {},
        }),
        enabled,
        nextRunAt,
        schedule: { type: "interval", everyMs: 86_400_000 },
      }) as unknown as ScheduledTask;

    const snapshots: EnvironmentWorkflowsSnapshot[] = [
      {
        environmentId: envLocal,
        workflows: [makeListing(projectA, "launch", "Launch Site")],
        runs: [],
        isPending: false,
        scheduledTasks: [
          task("t1", "launch", "2026-10-25T09:00:00Z"),
          task("t2", "launch", "2026-10-22T09:00:00Z"),
          task("t3", "paused", "2026-10-21T09:00:00Z", false),
          task("t4", "audit", "2026-10-23T09:00:00Z"),
        ],
      },
    ];

    const result = selectScheduledWorkflowSidebarItems(snapshots);
    expect(result.totalCount).toBe(2);
    expect(result.items).toEqual([
      {
        taskId: "t2",
        environmentId: envLocal,
        projectId: projectA,
        workflow: "launch",
        title: "Launch Site",
        nextRunAt: "2026-10-22T09:00:00Z",
      },
      {
        taskId: "t4",
        environmentId: envLocal,
        projectId: projectA,
        workflow: "audit",
        title: "audit",
        nextRunAt: "2026-10-23T09:00:00Z",
      },
    ]);
  });
});

describe("selectSavedWorkflowSidebarItems", () => {
  it("lists saved workflows not currently running and keeps finished runs visible with their status", () => {
    const snapshots: EnvironmentWorkflowsSnapshot[] = [
      {
        environmentId: envLocal,
        workflows: [
          makeListing(projectA, "active-flow", "Active Flow"),
          makeListing(projectA, "mascot", "Mascot"),
          makeListing(projectA, "never-run", "Never Run", [
            { id: "s1", title: "Step 1", skill: "brief" },
            { id: "s2", title: "Step 2", skill: "build" },
          ]),
        ],
        runs: [
          makeRun(
            "r-live",
            projectA,
            "active-flow",
            "Active Flow",
            "running",
            "2026-10-21T12:00:00Z",
            [],
          ),
          makeRun("r-done", projectA, "mascot", "Mascot", "done", "2026-10-21T13:00:00Z", []),
        ],
        scheduledTasks: [],
        isPending: false,
      },
    ];

    const result = selectSavedWorkflowSidebarItems(snapshots);
    expect(result.totalCount).toBe(2);
    expect(result.scratchTotalCount).toBe(0);
    expect(result.items).toEqual([
      {
        environmentId: envLocal,
        projectId: projectA,
        workflow: "mascot",
        title: "Mascot",
        lastRunId: "r-done",
        lastRunStatus: "done",
        stepCount: 1,
        sortAt: "2026-10-21T13:00:00Z",
        scratch: false,
        originThreadId: null,
      },
      {
        environmentId: envLocal,
        projectId: projectA,
        workflow: "never-run",
        title: "Never Run",
        lastRunId: null,
        lastRunStatus: null,
        stepCount: 2,
        sortAt: "2026-10-20T12:00:00.000Z",
        scratch: false,
        originThreadId: null,
      },
    ]);
  });

  it("keeps scratch workflows out of the ordinary list and carries the creating thread", () => {
    const creator = ThreadId.make("thread-9");
    const snapshots: EnvironmentWorkflowsSnapshot[] = [
      {
        environmentId: envLocal,
        workflows: [
          makeListing(projectA, "kept", "Kept"),
          makeScratchListing(
            projectA,
            "auto-created",
            "Auto Created",
            creator,
            "2026-10-22T12:00:00.000Z",
          ),
        ],
        runs: [],
        scheduledTasks: [],
        isPending: false,
      },
    ];

    const result = selectSavedWorkflowSidebarItems(snapshots);
    expect(result.items.map((item) => item.workflow)).toEqual(["kept"]);
    expect(result.totalCount).toBe(1);
    expect(result.scratchItems.map((item) => item.workflow)).toEqual(["auto-created"]);
    expect(result.scratchTotalCount).toBe(1);
    expect(result.scratchItems[0]).toMatchObject({
      scratch: true,
      originThreadId: creator,
    });
  });

  it("limits each group separately so automatic workflows never hide ordinary ones", () => {
    const snapshots: EnvironmentWorkflowsSnapshot[] = [
      {
        environmentId: envLocal,
        workflows: [
          makeListing(projectA, "ordinary-a", "Ordinary A"),
          makeListing(projectA, "ordinary-b", "Ordinary B"),
          makeListing(projectA, "ordinary-c", "Ordinary C"),
          makeScratchListing(projectA, "auto-a", "Auto A"),
          makeScratchListing(projectA, "auto-b", "Auto B"),
        ],
        runs: [],
        scheduledTasks: [],
        isPending: false,
      },
    ];

    const result = selectSavedWorkflowSidebarItems(snapshots, 2);
    expect(result.items).toHaveLength(2);
    expect(result.totalCount).toBe(3);
    expect(result.scratchItems).toHaveLength(2);
    expect(result.scratchTotalCount).toBe(2);
  });
});

describe("buildWorkflowUsedInMap", () => {
  it("maps nested workflow slugs to the parent workflow names that reference them", () => {
    const workflows: WorkflowListing[] = [
      makeListing(projectA, "screenshots", "Screenshots"),
      makeListing(projectA, "ios-launch", "iOS Launch", [
        { id: "shots", title: "Take screenshots", kind: "workflow", workflow: "screenshots" },
      ]),
      makeListing(projectA, "store-refresh", "Store Refresh", [
        { id: "shots", title: "Refresh screenshots", kind: "workflow", workflow: "screenshots" },
      ]),
    ];

    const usedIn = buildWorkflowUsedInMap(workflows);
    expect(usedIn.get("screenshots")).toEqual(["iOS Launch", "Store Refresh"]);
    expect(usedIn.get("ios-launch")).toBeUndefined();
  });
});

describe("buildRunWorkflowSubmenu", () => {
  it("lists saved workflows across projects and requests the Run dialog when invoked", async () => {
    clearWorkflowRunRequest();
    const base = makeListing(projectA, "launch", "Launch Site");
    const listing = { ...base, definition: { ...base.definition!, tags: ["brand"] } };
    const snapshots = [
      {
        environmentId: envLocal,
        workflows: [listing],
        runs: [],
        scheduledTasks: [],
        isPending: false,
      },
    ];
    const projectNames = new Map([[`${envLocal}:${projectA}`, "Tiller"]]);
    const submenu = buildRunWorkflowSubmenu(snapshots, projectNames);
    expect(submenu?.title).toBe("Run workflow…");
    const item = submenu?.groups[0]?.items[0];
    expect(item?.title).toBe("Launch Site");
    expect(item?.description).toBe("Tiller");
    if (!item || item.kind !== "action") throw new Error("Expected action item");
    await item.run();
    expect(readWorkflowRunRequest()).toEqual({
      environmentId: envLocal,
      projectId: projectA,
      listing,
    });
    clearWorkflowRunRequest();
    let opened: unknown;
    const open = buildOpenWorkflowSubmenu(snapshots, projectNames, async (target) => {
      opened = target;
    });
    if (!open) throw new Error("Expected Open workflow submenu");
    expect(open.title).toBe("Open workflow…");
    const scoped = filterCommandPaletteGroups({
      activeGroups: open.groups,
      query: "brand",
      isInSubmenu: true,
      projectSearchItems: [],
      threadSearchItems: [],
    });
    const match = scoped[0]?.items[0];
    if (match?.kind !== "action") throw new Error("Expected tag to match workflow");
    await match.run();
    expect(opened).toEqual({ environmentId: envLocal, projectId: projectA, workflow: "launch" });
    const global = filterCommandPaletteGroups({
      activeGroups: [
        { value: "workflows", label: "Workflows", items: buildNestedSearchItems([open], "brand") },
      ],
      query: "brand",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });
    expect(global.flatMap((group) => group.items).map((item) => item.value)).toContain(match.value);
    expect(readWorkflowRunRequest()).toBeNull();
  });
});

it("puts existing pinned workflows first and never recreates a deleted workflow from run history", () => {
  const snapshot: EnvironmentWorkflowsSnapshot = {
    environmentId: envLocal,
    workflows: [
      { ...makeListing(projectA, "recent", "Recent"), updatedAt: "2026-10-25T12:00:00.000Z" },
      { ...makeListing(projectA, "pinned", "Pinned"), pinned: true },
    ],
    runs: [
      makeRun("old-run", projectA, "deleted", "Deleted", "done", "2026-10-26T12:00:00Z", []),
      makeRun("pinned-run", projectA, "pinned", "Pinned", "running", "2026-10-25T12:00:00Z", []),
    ],
    scheduledTasks: [],
    isPending: false,
  };
  expect(selectSavedWorkflowSidebarItems([snapshot]).items.map((item) => item.workflow)).toEqual([
    "pinned",
    "recent",
  ]);
  expect(
    selectSavedWorkflowSidebarItems([
      {
        ...snapshot,
        workflows: snapshot.workflows.filter((listing) => listing.workflow !== "pinned"),
      },
    ]).items.map((item) => item.workflow),
  ).toEqual(["recent"]);
});
