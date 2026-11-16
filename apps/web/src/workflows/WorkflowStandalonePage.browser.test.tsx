import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type WorkflowListing,
  type WorkflowRun,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  connectedIds: ["local"] as string[],
  projects: [] as unknown[],
  runs: [] as WorkflowRun[],
  workflows: [] as WorkflowListing[],
  isPending: false,
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useConnectedEnvironmentIds: (() => state.connectedIds) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
}));
vi.mock(import("./workflowState"), async (original) => ({
  ...(await original()),
  useWorkflowRuns: (() => ({
    runs: state.runs,
    workflows: state.workflows,
    error: null,
    isPending: state.isPending,
  })) as never,
}));
vi.mock(import("./WorkflowPanel"), () => ({
  WorkflowProjectPanel: (props: {
    readonly workflow: string;
    readonly projectName?: string | null;
    readonly onBack?: () => void;
  }) => (
    <div data-testid="workflow-project-panel">
      <span>{props.projectName}</span>
      <span>{props.workflow}</span>
      <button type="button" onClick={props.onBack}>
        Header back
      </button>
    </div>
  ),
}));

import { WorkflowStandalonePage } from "./WorkflowStandalonePage";
import { recordLastChatPath } from "./workflowUiStore";

const envId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-1");

function setup(): Disposable {
  state.navigate.mockReset();
  state.connectedIds = [envId];
  state.projects = [
    {
      environmentId: envId,
      id: projectId,
      title: "Tiller",
      workspaceRoot: "/repo",
    },
  ];
  state.runs = [];
  state.workflows = [];
  state.isPending = false;
  recordLastChatPath("/local/thread-9");
  return {
    [Symbol.dispose]() {},
  };
}

it("renders server not connected when the environment is offline", async () => {
  using _setup = setup();
  state.connectedIds = [];
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(
    <WorkflowStandalonePage
      environmentId={EnvironmentId.make("remote-box")}
      projectId={projectId}
      slug="launch-site"
    />,
    { router: false },
  );

  await expect.element(screen.getByText("Server not connected")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Back to chat" }).first());
  expect(state.navigate).toHaveBeenCalledWith({ to: "/local/thread-9" });
});

it("renders workflow not found when the workflow is missing and has no runs", async () => {
  using _setup = setup();
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(
    <WorkflowStandalonePage environmentId={envId} projectId={projectId} slug="deleted-workflow" />,
    { router: false },
  );

  await expect.element(screen.getByText("Workflow not found")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "All workflows" }));
  expect(state.navigate).toHaveBeenCalledWith({ to: "/workflows" });
});

it("renders WorkflowProjectPanel when the workflow exists and returns to last chat on Escape", async () => {
  using _setup = setup();
  state.workflows = [
    {
      projectId,
      workflow: "launch-site",
      definition: {
        version: 2,
        name: "Launch Site",
        steps: [{ id: "brief", title: "Brief", skill: "brief" }],
      },
      problem: null,
      missingSkills: [],
      skills: [],
      blockers: [],
      updatedAt: "2026-10-20T12:00:00.000Z",
      scratch: false,
      editedByThreadId: ThreadId.make("thread-1"),
    },
  ];
  // Router hooks are mocked above so navigation calls can be asserted directly.
  await using screen = await render(
    <WorkflowStandalonePage environmentId={envId} projectId={projectId} slug="launch-site" />,
    { router: false },
  );

  await expect.element(screen.getByText("Tiller")).toBeInTheDocument();
  await expect.element(screen.getByText("launch-site")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  expect(state.navigate).toHaveBeenCalledWith({ to: "/local/thread-9" });
});
