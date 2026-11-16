import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  workflowSchedulePrompt,
  type ScheduledTask,
  type WorkflowListing,
  type WorkflowRun,
} from "@t3tools/contracts";
import { useSyncExternalStore } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import type { EnvironmentWorkflowsSnapshot } from "./useAllEnvironmentsWorkflows";

type DeleteEdit = {
  readonly _tag: "delete";
  readonly projectId: ProjectId;
  readonly workflow: string;
};

type KeepEdit = {
  readonly _tag: "keep";
  readonly projectId: ProjectId;
  readonly workflow: string;
};

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/local/thread-1",
  snapshots: [] as EnvironmentWorkflowsSnapshot[],
  projects: [] as unknown[],
  canEdit: true,
  schedules: [] as unknown[],
  deleteWorkflow: vi.fn(),
  keepWorkflow: vi.fn(),
  listeners: new Set<() => void>(),
}));

function notifySnapshots() {
  for (const listener of state.listeners) listener();
}

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
  useLocation: (() => state.pathname) as never,
}));
vi.mock(import("./useAllEnvironmentsWorkflows"), async (original) => ({
  ...(await original()),
  useAllEnvironmentsWorkflows: (() => {
    useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => {
          state.listeners.delete(listener);
        };
      },
      () => state.snapshots,
    );
    return state.snapshots;
  }) as never,
}));
vi.mock(import("./workflowState"), async (original) => ({
  ...(await original()),
  useWorkflowEditPermission: () => state.canEdit,
  useWorkflowEdit: () =>
    ({
      canEdit: state.canEdit,
      busy: false,
      error: null,
      clearError: () => {},
      run: (edit: DeleteEdit | KeepEdit) =>
        edit._tag === "keep" ? state.keepWorkflow(edit) : state.deleteWorkflow(edit),
    }) as never,
}));
vi.mock(import("./useWorkflowSchedules"), () => ({
  useWorkflowSchedules: () => ({
    tasks: state.schedules as never,
    nextRunAt: null,
    isPending: false,
    error: null,
  }),
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
}));
vi.mock(import("./WorkflowRunDialog"), () => ({
  WorkflowRunDialogHost: () => null,
}));

import {
  WORKFLOWS_SIDEBAR_EXPANDED_KEY,
  WORKFLOWS_SIDEBAR_FROM_THREADS_KEY,
  WorkflowsSidebarSection,
} from "./WorkflowsSidebarSection";
import { readLastChatPath } from "./workflowUiStore";

const envId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-1");

function makeRun(overrides: {
  readonly id: string;
  readonly workflow: string;
  readonly name: string;
  readonly status: WorkflowRun["status"];
}): WorkflowRun {
  return {
    id: overrides.id,
    projectId,
    workflow: overrides.workflow,
    driverThreadId: ThreadId.make("driver-1"),
    status: overrides.status,
    startedAt: "2026-10-20T12:00:00.000Z",
    definition: {
      version: 2,
      name: overrides.name,
      steps: [],
    },
    skills: [],
    steps: [
      { stepId: "a", status: "done", threadId: null, attempts: 1 },
      { stepId: "b", status: "done", threadId: null, attempts: 1 },
      { stepId: "c", status: "done", threadId: null, attempts: 1 },
      { stepId: "d", status: "running", threadId: null, attempts: 1 },
      { stepId: "e", status: "queued", threadId: null, attempts: 0 },
      { stepId: "f", status: "queued", threadId: null, attempts: 0 },
      { stepId: "g", status: "queued", threadId: null, attempts: 0 },
    ],
  };
}

function makeScheduledTask(overrides: {
  readonly id: ScheduledTaskId;
  readonly name: string;
  readonly nextRunAt: string;
}): ScheduledTask {
  return {
    id: overrides.id,
    title: overrides.name,
    projectId,
    threadId: ThreadId.make("driver-1"),
    prompt: workflowSchedulePrompt({
      version: 1,
      projectId,
      workflow: "nightly-qa",
      inputs: {},
    }),
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "09:00" },
    workspaceStrategy: { type: "root" },
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    nextRunAt: overrides.nextRunAt,
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
  };
}

function makeScratchListing(overrides: {
  readonly workflow: string;
  readonly name: string;
  readonly createdBy?: ThreadId;
  readonly updatedAt?: string;
}): WorkflowListing {
  const creator = overrides.createdBy ?? ThreadId.make("creator-1");
  return {
    projectId,
    workflow: overrides.workflow,
    definition: {
      version: 2,
      name: overrides.name,
      steps: [{ id: "draft", title: "Draft", skill: "brief" }],
      origin: { kind: "workflow-first", threadId: creator },
    },
    problem: null,
    missingSkills: [],
    skills: [],
    blockers: [],
    updatedAt: overrides.updatedAt ?? "2026-10-20T12:00:00.000Z",
    editedByThreadId: creator,
    scratch: true,
  };
}

/** What a successful keep does on the server: the definition stays, its origin goes. */
function withoutOrigin(listing: WorkflowListing): WorkflowListing {
  const definition = listing.definition;
  if (definition === null || !("origin" in definition)) return listing;
  const { origin: _origin, ...kept } = definition;
  return { ...listing, definition: kept, scratch: false };
}

function setup(): Disposable {
  // The running run started 252 s before "now", so its timer reads 4:12. Set before render:
  // the first render reads the clock.
  const now = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse("2026-10-20T12:00:00.000Z") + 252_000);
  state.navigate.mockReset();
  state.pathname = "/local/thread-1";
  state.listeners.clear();
  state.canEdit = true;
  state.schedules = [];
  state.projects = [
    {
      environmentId: envId,
      id: projectId,
      title: "Tiller",
      workspaceRoot: "/repo",
    },
  ];
  state.deleteWorkflow.mockReset();
  state.deleteWorkflow.mockImplementation(async (edit: DeleteEdit) => {
    state.snapshots = state.snapshots.map((snapshot) => ({
      ...snapshot,
      workflows: snapshot.workflows.filter(
        (listing) => listing.projectId !== edit.projectId || listing.workflow !== edit.workflow,
      ),
    }));
    notifySnapshots();
    return { deleted: true };
  });
  state.keepWorkflow.mockReset();
  state.keepWorkflow.mockImplementation(async (edit: KeepEdit) => {
    state.snapshots = state.snapshots.map((snapshot) => ({
      ...snapshot,
      workflows: snapshot.workflows.map((listing) =>
        listing.projectId === edit.projectId && listing.workflow === edit.workflow
          ? withoutOrigin(listing)
          : listing,
      ),
    }));
    notifySnapshots();
    return { kept: true };
  });
  window.localStorage.removeItem(WORKFLOWS_SIDEBAR_EXPANDED_KEY);
  window.localStorage.removeItem(WORKFLOWS_SIDEBAR_FROM_THREADS_KEY);
  state.snapshots = [
    {
      environmentId: envId,
      runs: [
        makeRun({
          id: "run-waiting",
          workflow: "deploy-prod",
          name: "Deploy Prod",
          status: "waiting",
        }),
        makeRun({
          id: "run-active",
          workflow: "launch-site",
          name: "Launch Site",
          status: "running",
        }),
        makeRun({
          id: "run-done",
          workflow: "mascot",
          name: "Mascot",
          status: "done",
        }),
      ],
      workflows: [
        {
          projectId,
          workflow: "mascot",
          definition: {
            version: 2,
            name: "Mascot",
            steps: [{ id: "test", title: "test", skill: "threejs-3d-graphics" }],
          },
          problem: null,
          missingSkills: [],
          skills: [],
          blockers: [],
          updatedAt: "2026-10-20T12:00:00.000Z",
          editedByThreadId: ThreadId.make("driver-1"),
          scratch: false,
        },
      ],
      scheduledTasks: [
        makeScheduledTask({
          id: ScheduledTaskId.make("sched-1"),
          name: "Nightly QA",
          nextRunAt: "2026-10-21T09:00:00.000Z",
        }),
      ],
      isPending: false,
    },
  ];
  return {
    [Symbol.dispose]() {
      now.mockRestore();
      window.localStorage.removeItem(WORKFLOWS_SIDEBAR_EXPANDED_KEY);
      window.localStorage.removeItem(WORKFLOWS_SIDEBAR_FROM_THREADS_KEY);
    },
  };
}

it("renders Running (with Needs you and step progress), Scheduled, and All workflows link", async () => {
  using _setup = setup();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await expect.element(screen.getByText("Deploy Prod")).toBeInTheDocument();
  await expect.element(screen.getByText("Launch Site")).toBeInTheDocument();
  await expect.element(screen.getByText("3/7 · 4:12")).toBeInTheDocument();
  await expect.element(screen.getByText("nightly-qa")).toBeInTheDocument();
  await expect.element(screen.getByText("Mascot")).toBeInTheDocument();
  await expect.element(screen.getByText("Done")).toBeInTheDocument();
  expect(readLastChatPath()).toBe("/local/thread-1");

  await userEvent.click(screen.getByRole("button", { name: /Launch Site/i }));
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/workflows/$environmentId/$projectId/$slug",
    params: {
      environmentId: envId,
      projectId,
      slug: "launch-site",
    },
    search: { run: "run-active" },
  });

  await userEvent.click(screen.getByRole("button", { name: /All workflows/i }));
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/workflows",
  });
});

it("keeps Needs you on a waiting run instead of its timer", async () => {
  using _setup = setup();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await expect
    .element(screen.getByRole("button", { name: /Deploy Prod/ }).getByText("Needs you"))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /Deploy Prod/ }).getByText("4:12"))
    .not.toBeInTheDocument();
});

it("persists collapsed state in localStorage", async () => {
  using _setup = setup();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await expect.element(screen.getByText("Launch Site")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^Workflows/i }));

  expect(window.localStorage.getItem(WORKFLOWS_SIDEBAR_EXPANDED_KEY)).toBe("false");
  expect(document.body.textContent).not.toContain("All workflows");
});

it("deletes a saved workflow from its hover menu", async () => {
  using _setup = setup();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: "Actions for Mascot" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete workflow…", exact: true }));

  await expect.element(page.getByText("Delete “Mascot”?", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByText(/Tiller/, { exact: false })).toBeInTheDocument();

  await userEvent.click(page.getByRole("button", { name: "Delete", exact: true }));

  expect(state.deleteWorkflow).toHaveBeenCalledWith({
    _tag: "delete",
    projectId,
    workflow: "mascot",
  });
  await expect.element(screen.getByText("Mascot", { exact: true })).not.toBeInTheDocument();
});

it("navigates away after deleting the workflow that is open", async () => {
  using _setup = setup();
  state.pathname = "/workflows/local/project-1/mascot";
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: "Actions for Mascot" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete workflow…", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Delete", exact: true }));

  expect(state.navigate).toHaveBeenCalledWith({ to: "/workflows" });
});

it("hides the delete action without edit permission", async () => {
  using _setup = setup();
  state.canEdit = false;
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await expect
    .element(screen.getByRole("button", { name: "Actions for Mascot" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText("From threads")).not.toBeInTheDocument();
});

it("folds automatic workflows into a collapsed From threads group that live updates leave closed", async () => {
  using _setup = setup();
  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    workflows: [
      ...snapshot.workflows,
      makeScratchListing({ workflow: "auto-draft", name: "Auto Draft" }),
    ],
  }));
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await expect
    .element(screen.getByRole("button", { name: /From threads/ }))
    .toHaveAttribute("aria-expanded", "false");
  await expect.element(screen.getByText("Auto Draft", { exact: true })).not.toBeInTheDocument();

  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    workflows: [
      ...snapshot.workflows,
      makeScratchListing({ workflow: "auto-draft-2", name: "Auto Draft 2" }),
    ],
  }));
  notifySnapshots();

  await expect.element(screen.getByText("Auto Draft 2", { exact: true })).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /From threads/ }))
    .toHaveAttribute("aria-expanded", "false");

  await userEvent.click(screen.getByRole("button", { name: /From threads/ }));

  await expect.element(screen.getByText("Auto Draft", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText("Auto Draft 2", { exact: true })).toBeInTheDocument();
  expect(window.localStorage.getItem(WORKFLOWS_SIDEBAR_FROM_THREADS_KEY)).toBe("true");
});

it("shows only a collapsed From threads group when every saved workflow came from a thread", async () => {
  using _setup = setup();
  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    runs: [],
    scheduledTasks: [],
    workflows: [makeScratchListing({ workflow: "auto-draft", name: "Auto Draft" })],
  }));
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await expect
    .element(screen.getByRole("button", { name: /From threads/ }))
    .toHaveAttribute("aria-expanded", "false");
  await expect.element(screen.getByText("Auto Draft", { exact: true })).not.toBeInTheDocument();
  await expect.element(screen.getByText("Saved", { exact: true })).not.toBeInTheDocument();
});

it("keeps a From threads workflow into the saved list without leaving the page", async () => {
  using _setup = setup();
  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    workflows: [
      ...snapshot.workflows,
      makeScratchListing({ workflow: "auto-draft", name: "Auto Draft" }),
    ],
  }));
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: /From threads/ }));
  await userEvent.click(screen.getByRole("button", { name: "Actions for Auto Draft" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Keep workflow", exact: true }));

  expect(state.keepWorkflow).toHaveBeenCalledWith({
    _tag: "keep",
    projectId,
    workflow: "auto-draft",
  });
  // Promotion clears the origin, so the workflow joins Saved and the group goes away.
  await expect.element(screen.getByText("Auto Draft", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText("From threads")).not.toBeInTheDocument();
  expect(state.navigate).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Actions for Auto Draft" }));
  await expect
    .element(page.getByRole("menuitem", { name: "Keep workflow", exact: true }))
    .not.toBeInTheDocument();
});

it("shows From threads without Keep to a read-only client and links its creating thread", async () => {
  using _setup = setup();
  state.canEdit = false;
  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    workflows: [
      ...snapshot.workflows,
      makeScratchListing({
        workflow: "auto-draft",
        name: "Auto Draft",
        createdBy: ThreadId.make("creator-9"),
      }),
    ],
  }));
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsSidebarSection />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: /From threads/ }));
  await expect.element(screen.getByText("Auto Draft", { exact: true })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Actions for Auto Draft" }));
  await expect
    .element(page.getByRole("menuitem", { name: "Keep workflow", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("menuitem", { name: "Delete workflow…", exact: true }))
    .not.toBeInTheDocument();

  await userEvent.click(page.getByRole("menuitem", { name: "Open creating thread" }));
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: envId, threadId: ThreadId.make("creator-9") },
  });
});
