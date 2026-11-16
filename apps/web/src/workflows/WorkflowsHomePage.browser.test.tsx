import {
  EnvironmentId,
  ProjectId,
  ThreadId,
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
  snapshots: [] as EnvironmentWorkflowsSnapshot[],
  projects: [] as unknown[],
  environments: [] as unknown[],
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
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: state.environments, isReady: true })) as never,
}));

import { WorkflowsHomePage } from "./WorkflowsHomePage";
import {
  clearWorkflowRunRequest,
  readWorkflowRunRequest,
  recordLastChatPath,
} from "./workflowUiStore";

const envId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-1");

function makeListing(
  slug: string,
  name: string,
  steps: NonNullable<WorkflowListing["definition"]>["steps"],
): WorkflowListing {
  return {
    projectId,
    workflow: slug,
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
    editedByThreadId: ThreadId.make("thread-1"),
    scratch: false,
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
    updatedAt: overrides.updatedAt ?? "2026-10-20T14:00:00.000Z",
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

function makeActiveRun(workflow: string, name: string): WorkflowRun {
  return {
    id: `run-${workflow}`,
    projectId,
    workflow,
    driverThreadId: ThreadId.make("thread-1"),
    status: "running",
    startedAt: "2026-10-20T13:00:00.000Z",
    definition: { version: 2, name, steps: [] },
    skills: [],
    steps: [],
  };
}

function setup(): Disposable {
  state.navigate.mockReset();
  state.listeners.clear();
  state.canEdit = true;
  state.schedules = [];
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
  clearWorkflowRunRequest();
  recordLastChatPath("/local/thread-42");
  state.environments = [{ environmentId: envId, label: "Local Mac" }];
  state.projects = [
    {
      environmentId: envId,
      id: projectId,
      title: "Tiller",
      workspaceRoot: "/repo",
    },
  ];
  state.snapshots = [
    {
      environmentId: envId,
      runs: [],
      scheduledTasks: [],
      workflows: [
        makeListing("release-train", "Release Train", [
          { id: "smoke", title: "Smoke check", kind: "workflow", workflow: "smoke-check" },
        ]),
        makeListing("smoke-check", "Smoke Check", [
          { id: "verify", title: "Verify", skill: "verify" },
        ]),
      ],
      isPending: false,
    },
  ];
  return {
    [Symbol.dispose]() {
      clearWorkflowRunRequest();
    },
  };
}

it("groups saved workflows by project, shows Used in for nested workflows, filters by search, and triggers Run", async () => {
  using _setup = setup();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  expect(screen.container.querySelector('[aria-label="Workflow filters"]')?.textContent).toContain(
    "Tiller",
  );
  await expect.element(screen.getByText("Release Train", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText("Smoke Check", { exact: true })).toBeInTheDocument();
  await expect
    .element(screen.getByText("Used in: Release Train", { exact: true }))
    .toBeInTheDocument();
  await expect.element(screen.getByText("From threads")).not.toBeInTheDocument();

  await userEvent.fill(screen.getByRole("searchbox", { name: "Search workflows" }), "Smoke");
  await expect.element(screen.getByText("Smoke Check", { exact: true })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Run Smoke Check" }));
  expect(readWorkflowRunRequest()?.listing.workflow).toBe("smoke-check");

  await userEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  expect(state.navigate).toHaveBeenCalledWith({ to: "/local/thread-42" });
});

it("deletes a workflow from its row menu after confirmation", async () => {
  using _setup = setup();
  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    runs: [makeActiveRun("release-train", "Release Train")],
  }));
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: "Actions for Release Train" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete workflow…", exact: true }));

  await expect
    .element(page.getByText("Delete “Release Train”?", { exact: true }))
    .toBeInTheDocument();
  await expect
    .element(page.getByText(/It has a run in progress/, { exact: false }))
    .toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();

  await userEvent.click(page.getByRole("button", { name: "Delete", exact: true }));

  expect(state.deleteWorkflow).toHaveBeenCalledWith({
    _tag: "delete",
    projectId,
    workflow: "release-train",
  });
  await expect.element(screen.getByText("Release Train", { exact: true })).not.toBeInTheDocument();
});

it("says the workflow's schedules are removed with it", async () => {
  using _setup = setup();
  state.schedules = [{ id: "sched-1" }, { id: "sched-2" }];
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: "Actions for Release Train" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete workflow…", exact: true }));

  await expect
    .element(page.getByText("Its 2 schedules are removed too.", { exact: true }))
    .toBeInTheDocument();
});

it("keeps the workflow when the confirm dialog is cancelled", async () => {
  using _setup = setup();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: "Actions for Release Train" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete workflow…", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));

  expect(state.deleteWorkflow).not.toHaveBeenCalled();
  await expect.element(screen.getByText("Release Train", { exact: true })).toBeInTheDocument();
  await expect
    .element(page.getByText("Delete “Release Train”?", { exact: true }))
    .not.toBeInTheDocument();
});

it("hides the delete action without edit permission", async () => {
  using _setup = setup();
  state.canEdit = false;
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  await expect
    .element(screen.getByRole("button", { name: "Actions for Release Train" }))
    .not.toBeInTheDocument();
});

function withScratchWorkflow(overrides?: {
  readonly workflow?: string;
  readonly name?: string;
  readonly createdBy?: ThreadId;
}): void {
  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    workflows: [
      ...snapshot.workflows,
      makeScratchListing({
        workflow: overrides?.workflow ?? "auto-draft",
        name: overrides?.name ?? "Auto Draft",
        ...(overrides?.createdBy ? { createdBy: overrides.createdBy } : {}),
      }),
    ],
  }));
}

it("folds automatic workflows under a collapsed From threads group and keeps one", async () => {
  using _setup = setup();
  withScratchWorkflow();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

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

  // A live arrival joins the group without opening it.
  await expect.element(screen.getByText("Auto Draft 2", { exact: true })).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /From threads/ }))
    .toHaveAttribute("aria-expanded", "false");

  await userEvent.click(screen.getByRole("button", { name: /From threads/ }));
  await expect.element(screen.getByText("Auto Draft", { exact: true })).toBeInTheDocument();
  await expect
    .element(screen.getByText("From thread", { exact: true }).first())
    .toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Keep Auto Draft" }));

  expect(state.keepWorkflow).toHaveBeenCalledWith({
    _tag: "keep",
    projectId,
    workflow: "auto-draft",
  });
  // Promotion clears the origin: the kept row joins the ordinary list and loses Keep.
  await expect.element(screen.getByText("Auto Draft", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText("Auto Draft 2", { exact: true })).toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Keep Auto Draft" }))
    .not.toBeInTheDocument();
});

it("shows only a collapsed From threads group when every workflow came from a thread", async () => {
  using _setup = setup();
  state.snapshots = state.snapshots.map((snapshot) => ({
    ...snapshot,
    workflows: [makeScratchListing({ workflow: "auto-draft", name: "Auto Draft" })],
  }));
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  await expect
    .element(screen.getByRole("button", { name: /From threads/ }))
    .toHaveAttribute("aria-expanded", "false");
  await expect.element(screen.getByText("Auto Draft", { exact: true })).not.toBeInTheDocument();
  await expect.element(screen.getByText("Release Train", { exact: true })).not.toBeInTheDocument();
});

it("reveals a matching automatic workflow while searching", async () => {
  using _setup = setup();
  withScratchWorkflow();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  await expect.element(screen.getByText("Release Train", { exact: true })).toBeInTheDocument();
  await userEvent.fill(screen.getByRole("searchbox", { name: "Search workflows" }), "Auto");

  await expect.element(screen.getByText("Auto Draft", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText("Release Train", { exact: true })).not.toBeInTheDocument();
});

it("shows the creating thread and hides Keep without edit permission", async () => {
  using _setup = setup();
  state.canEdit = false;
  withScratchWorkflow({ createdBy: ThreadId.make("creator-9") });
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(<WorkflowsHomePage />, { router: false });

  await userEvent.click(screen.getByRole("button", { name: /From threads/ }));
  await expect.element(screen.getByText("Auto Draft", { exact: true })).toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Keep Auto Draft" }))
    .not.toBeInTheDocument();

  await userEvent.click(
    screen.getByRole("button", { name: "Open thread that created Auto Draft" }),
  );
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: envId, threadId: ThreadId.make("creator-9") },
  });
});
