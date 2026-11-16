import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, type WorkflowListing } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";

const state = vi.hoisted(() => ({
  allowed: true,
  command: vi.fn(),
  kickoffRun: vi.fn(),
  kickoffBusy: false,
  kickoffError: null as string | null,
  navigate: vi.fn(),
  projects: [] as unknown[],
  shells: [] as unknown[],
  providers: new Map<string, unknown[]>(),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => state.allowed) as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.command) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
  useThreadShells: (() => state.shells) as never,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() => state.providers) as never,
}));
vi.mock(import("./draftWorkflowKickoff"), async (original) => ({
  ...(await original()),
  useDraftWorkflowKickoff: (() => ({
    run: state.kickoffRun,
    busy: state.kickoffBusy,
    error: state.kickoffError,
  })) as never,
}));
vi.mock(import("./workflowState"), async (original) => ({
  ...(await original()),
  useWorkflowRuns: (() => ({
    runs: [],
    workflows: [],
    error: null,
    isPending: false,
  })) as never,
}));

import { WorkflowRunDialog, WorkflowRunDialogHost } from "./WorkflowRunDialog";
import { WorkflowRunInputsDialog } from "./WorkflowRunInputsDialog";
import { clearWorkflowRunRequest, requestWorkflowRun } from "./workflowUiStore";

const envId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-1");

const sampleListing: WorkflowListing = {
  projectId,
  workflow: "launch-site",
  definition: {
    version: 2,
    name: "Launch Site",
    inputs: [{ id: "topic", label: "Topic", kind: "text", required: true }],
    steps: [{ id: "brief", title: "Brief", skill: "brief" }],
  },
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-10-20T12:00:00.000Z",
  scratch: false,
  editedByThreadId: ThreadId.make("thread-1"),
};

function setup(): Disposable {
  state.allowed = true;
  state.command.mockReset().mockResolvedValue({ _tag: "Success", value: { runId: "run-99" } });
  state.kickoffRun.mockReset().mockResolvedValue(true);
  state.kickoffBusy = false;
  state.kickoffError = null;
  state.navigate.mockReset();
  state.projects = [
    {
      environmentId: envId,
      id: projectId,
      title: "Tiller",
      workspaceRoot: "/repo",
      defaultModelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-4-5" },
    },
  ];
  state.shells = [
    {
      environmentId: envId,
      id: ThreadId.make("existing-chat"),
      projectId,
      title: "Release coordinator",
      updatedAt: "2026-10-20T12:00:00.000Z",
      deletedAt: null,
      archivedAt: null,
      lineage: { parentThreadId: null, relationshipToParent: null },
    },
    {
      environmentId: envId,
      id: ThreadId.make("thread:delegated-task:sub-1"),
      projectId,
      title: "Write a single-file HTML",
      updatedAt: "2026-10-20T12:05:00.000Z",
      deletedAt: null,
      archivedAt: null,
      lineage: { parentThreadId: ThreadId.make("existing-chat"), relationshipToParent: "subagent" },
    },
    {
      environmentId: envId,
      id: ThreadId.make("step-chat"),
      projectId,
      title: 'Workflow "mascot", step "test" (run wf-20261021-9b50f683)',
      updatedAt: "2026-10-20T12:06:00.000Z",
      deletedAt: null,
      archivedAt: null,
      lineage: { parentThreadId: null, relationshipToParent: null },
    },
  ];
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  state.providers = new Map([
    [
      envId,
      [
        {
          driver: "claudeAgent",
          provider: "claudeAgent",
          instanceId: "claudeAgent",
          enabled: true,
          status: "ready",
          supportsTextGeneration: true,
          models: [
            { slug: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", isDefault: true },
            { slug: "claude-opus-4-6", name: "Claude Opus 4.6", isDefault: false },
          ],
        },
      ],
    ],
  ]);
  clearWorkflowRunRequest();
  return {
    [Symbol.dispose]() {
      clearWorkflowRunRequest();
    },
  };
}

it("defaults to a new chat in the project with its default model and mode, and starts the workflow", async () => {
  using _state = setup();
  const onClose = vi.fn();
  const onStarted = vi.fn();
  await using _screen = await render(
    <WorkflowRunDialog
      environmentId={envId}
      projectId={projectId}
      listing={sampleListing}
      onClose={onClose}
      onStarted={onStarted}
    />,
  );

  expect(document.body.textContent).toContain("Run “Launch Site”");
  expect(document.body.textContent).toContain("New chat in Tiller");
  expect(document.body.textContent).toContain("Build");
  expect(document.body.textContent).toContain("Full access");

  const runButton = [...document.body.querySelectorAll("button")].find(
    (btn) => btn.textContent?.trim() === "Run",
  )!;
  expect(runButton.hasAttribute("disabled")).toBe(true);

  const input = document.body.querySelector<HTMLInputElement>('[aria-label="Topic *"]')!;
  await userEvent.fill(input, "Workflows launch");
  expect(runButton.hasAttribute("disabled")).toBe(false);

  await userEvent.click(runButton);
  expect(state.kickoffRun).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId: envId,
      projectId,
      workflow: "launch-site",
      modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-4-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      inputs: { topic: "Workflows launch" },
    }),
  );
  expect(onStarted).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("lets the user pick an existing project chat to drive the workflow run and opens the canvas via WorkflowRunDialogHost", async () => {
  using _state = setup();
  requestWorkflowRun({
    environmentId: envId,
    projectId,
    listing: sampleListing,
  });
  await using _screen = await render(<WorkflowRunDialogHost />);

  const driverTrigger = document.body.querySelector<HTMLElement>('[aria-label="Driving chat"]')!;
  await userEvent.click(driverTrigger);
  const optionTexts = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (option) => option.textContent ?? "",
  );
  expect(optionTexts.some((text) => text.includes("Write a single-file HTML"))).toBe(false);
  expect(optionTexts.some((text) => text.includes('Workflow "mascot"'))).toBe(false);
  const existingOption = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent?.includes("Release coordinator"),
  )!;
  await userEvent.click(existingOption);

  const input = document.body.querySelector<HTMLInputElement>('[aria-label="Topic *"]')!;
  await userEvent.fill(input, "Existing chat run");

  const runButton = [...document.body.querySelectorAll("button")].find(
    (btn) => btn.textContent?.trim() === "Run",
  )!;
  await userEvent.click(runButton);

  expect(state.command).toHaveBeenCalledWith({
    environmentId: envId,
    input: {
      _tag: "runStart",
      projectId,
      workflow: "launch-site",
      driverThreadId: "existing-chat",
      inputs: { topic: "Existing chat run" },
    },
  });
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: {
      environmentId: envId,
      threadId: "existing-chat",
    },
  });
  const panelState = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    scopeThreadRef(envId, ThreadId.make("existing-chat")),
  );
  expect(panelState.surfaces.some((surface) => surface.kind === "workflow")).toBe(true);
});

it("prefills defaults and submits them with user overrides when starting a new chat", async () => {
  using _state = setup();
  await using _screen = await render(
    <WorkflowRunDialog
      environmentId={envId}
      projectId={projectId}
      listing={{
        ...sampleListing,
        definition: {
          ...sampleListing.definition!,
          inputs: [
            { id: "topic", label: "Topic", kind: "text", required: true, defaultValue: "Launch" },
            {
              id: "site",
              label: "Site",
              kind: "url",
              required: true,
              defaultValue: "https://example.com",
            },
            {
              id: "notes",
              label: "Notes",
              kind: "multiline",
              defaultValue: "Keep this spacing",
            },
          ],
        },
      }}
      onClose={vi.fn()}
    />,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Topic *", exact: true }))
    .toHaveValue("Launch");
  await expect
    .element(page.getByRole("textbox", { name: "Site *", exact: true }))
    .toHaveValue("https://example.com");
  await expect
    .element(page.getByRole("textbox", { name: "Notes", exact: true }))
    .toHaveValue("Keep this spacing");
  await expect.element(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  await userEvent.fill(
    page.getByRole("textbox", { name: "Topic *", exact: true }),
    "Updated launch",
  );
  await userEvent.click(page.getByRole("button", { name: "Run", exact: true }));
  expect(state.kickoffRun).toHaveBeenCalledWith(
    expect.objectContaining({
      inputs: {
        topic: "Updated launch",
        site: "https://example.com",
        notes: "Keep this spacing",
      },
    }),
  );
});

it("prefills input-only runs and restores defaults after closing and reopening", async () => {
  using _state = setup();
  const onStart = vi.fn();
  const listing: WorkflowListing = {
    ...sampleListing,
    definition: {
      ...sampleListing.definition!,
      inputs: [
        { id: "topic", label: "Topic", kind: "text", required: true, defaultValue: "Launch" },
      ],
    },
  };
  await using screen = await render(
    <WorkflowRunInputsDialog listing={listing} busy={false} onStart={onStart} onClose={vi.fn()} />,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Topic *", exact: true }))
    .toHaveValue("Launch");
  await userEvent.fill(
    page.getByRole("textbox", { name: "Topic *", exact: true }),
    "One-time override",
  );
  await userEvent.click(page.getByRole("button", { name: "Run", exact: true }));
  expect(onStart).toHaveBeenCalledWith({ topic: "One-time override" });

  await screen.rerender(<></>);
  await screen.rerender(
    <WorkflowRunInputsDialog listing={listing} busy={false} onStart={onStart} onClose={vi.fn()} />,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Topic *", exact: true }))
    .toHaveValue("Launch");
  await userEvent.click(page.getByRole("button", { name: "Run", exact: true }));
  expect(onStart).toHaveBeenLastCalledWith({ topic: "Launch" });
});
