vi.mock("../credentials/useCredentialActivity", () => ({
  useCredentialActivity: () => ({
    live: { historyRevision: 0, pending: [], active: [] },
    history: [],
    error: null,
  }),
}));
import { useSyncExternalStore, type ReactElement } from "react";
import {
  CredentialId,
  EnvironmentId,
  ThreadId,
  workflowSchedulePrompt,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowEdit,
  type WorkflowListing,
  workflowReadinessSpecification,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as DateTime from "effect/DateTime";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";
import { workflowRunFixture } from "./workflowTestFixture";
import { workflowPaletteActions } from "./workflowSurface";
import { resetWorkflowProbeReadinessForTests } from "./workflowState";
import { FIT_PADDING } from "./canvasCamera";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { ComposerHandleContext, type ComposerHandleRef } from "../composerHandleContext";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  activityLabel: null as string | null,
  runs: [] as unknown[],
  workflows: [] as unknown[],
  allowed: true,
  command: vi.fn(),
  queryData: null as unknown,
  navigate: vi.fn(),
  hasShell: true,
  threadShells: [] as unknown[],
  revision: 0,
  listeners: new Set<() => void>(),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("./workflowStepActivityState"), async (original) => ({
  ...(await original()),
  useStepActivityLabel: () => state.activityLabel,
}));
vi.mock(import("../assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlState: () => ({ _tag: "Loading" as const }),
  useAssetUrlRefresh: () => async () => null,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useThreadProjection: (() => ({ projection: state.projection })) as never,
  useThreadShell: (() =>
    state.hasShell
      ? {
          projectId: workflowRunFixture.projectId,
          modelSelection: { model: "gpt-6-luna" },
        }
      : null) as never,
  useThreadShells: (() => state.threadShells) as never,
  useProject: (() => ({ workspaceRoot: "/repo" })) as never,
  readProject: (() => ({ workspaceRoot: "/repo" })) as never,
  useProjects: (() => [
    {
      id: workflowRunFixture.projectId,
      title: "Storefront",
      environmentId: EnvironmentId.make("remote"),
    },
  ]) as never,
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => state.allowed) as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label: string }) =>
    command.label.startsWith("skills:")
      ? async () => ({ _tag: "Success", value: { skills: [], count: 0 } })
      : state.command) as never,
}));
vi.mock(import("../state/use-orchestration-command"), async (original) => ({
  ...(await original()),
  useOrchestrationCommand: (() => state.command) as never,
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => state.allowed) as never,
}));
vi.mock(import("../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: state.queryData,
    isPending: false,
    error: null,
    failure: null,
    isSuccess: true,
    dataUpdatedAt: 0,
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("./workflowState"), async (original) => ({
  ...(await original()),
  useWorkflowRuns: (() => {
    useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => {
          state.listeners.delete(listener);
        };
      },
      () => state.revision,
    );
    return {
      runs: state.runs,
      workflows:
        state.workflows.length > 0
          ? state.workflows
          : state.runs.map((run: any) => ({
              projectId: workflowRunFixture.projectId,
              workflow: run.workflow,
              definition: run.definition,
              problem: null,
              missingSkills: [],
              skills: [],
              blockers: [],
              updatedAt: run.startedAt,
              editedByThreadId: run.driverThreadId,
            })),
      error: null,
    };
  }) as never,
  workflowRead: (() => "draft-query") as never,
}));

vi.mock("../credentials/CredentialsEnvironmentPanel", () => ({
  CredentialsEnvironmentPanel: (props: {
    presetTemplateId?: string | null;
    onCredentialCreated?: (credential: unknown) => void;
  }) => (
    <div>
      <p>add form for {props.presetTemplateId ?? "any type"}</p>
      <button
        type="button"
        onClick={() =>
          props.onCredentialCreated?.({
            id: "cred-appstore",
            name: "App Store Connect — Acme",
            templateId: "app-store-connect",
          })
        }
      >
        Save credential
      </button>
    </div>
  ),
}));

import { WorkflowPanel, WorkflowProjectPanel } from "./WorkflowPanel";

const at = (minute: number) =>
  DateTime.makeUnsafe(`2026-10-19T12:${String(minute).padStart(2, "0")}:00Z`);

function subagent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    threadId: "parent",
    runId: "run-1",
    origin: "app_owned",
    driver: "claudeAgent",
    providerInstanceId: "claudeAgent",
    childThreadId: `${id}-chat`,
    prompt: id,
    title: id,
    model: "claude-sonnet-5-5",
    status: "completed",
    result: null,
    startedAt: at(0),
    completedAt: at(5),
    updatedAt: at(5),
    ...overrides,
  };
}

const launchSite = {
  runs: [{ id: "run-1", ordinal: 1 }],
  subagents: [
    subagent("Research demand", { startedAt: at(1) }),
    subagent("Brand brief", { startedAt: at(2), model: "gpt-6-luna" }),
    subagent("Launch site", {
      startedAt: at(3),
      status: "running",
      completedAt: null,
      childThreadId: null,
      model: null,
      workflow: {
        name: "Launch site",
        phases: [
          { index: 0, title: "Build" },
          { index: 1, title: "Check" },
        ],
        agents: [
          {
            index: 0,
            label: "Landing page",
            state: "running",
            phaseIndex: 0,
            childThreadId: "landing-chat",
          },
          { index: 1, label: "Hero images", state: "completed", phaseIndex: 0 },
          { index: 2, label: "Check & preview", state: "queued", phaseIndex: 1 },
        ],
      },
    }),
  ],
};

function setup(): Disposable {
  resetWorkflowProbeReadinessForTests();
  state.navigate.mockClear();
  state.projection = null;
  state.runs = [];
  state.activityLabel = null;
  state.workflows = [];
  state.allowed = true;
  state.hasShell = true;
  state.threadShells = [
    {
      environmentId: starterRef.environmentId,
      id: starterRef.threadId,
      projectId: workflowRunFixture.projectId,
      deletedAt: null,
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
    },
  ];
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
  state.command.mockReset().mockResolvedValue({ _tag: "Success" });
  state.queryData = null;
  return {
    [Symbol.dispose]() {
      useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
    },
  };
}

function renderPanel(element: ReactElement) {
  const container = document.createElement("div");
  container.style.width = "720px";
  container.style.height = "420px";
  return render(element, { container });
}

const update = () =>
  act(async () => {
    state.revision += 1;
    state.listeners.forEach((listener) => listener());
  });
const click = (element: HTMLElement) => act(async () => element.click());

async function browserDrag(...args: Parameters<typeof userEvent.dragAndDrop>) {
  await userEvent.dragAndDrop(...args);
}

const byLabel = (label: string) => {
  const match = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (match === null) throw new Error(`No element labelled "${label}"`);
  return match;
};
const zoomLabel = () =>
  [...document.body.querySelectorAll("span")].find((span) => /^\d+%$/.test(span.textContent ?? ""))
    ?.textContent;
const waitForCanvasFit = () =>
  vi.waitFor(() => {
    const label = zoomLabel();
    expect(label).toBeDefined();
    expect(label).not.toBe("100%");
  });

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("parent"));

it("explains the empty state until the thread delegates work, then draws it", async () => {
  using _state = setup();
  state.projection = { runs: [], subagents: [] };
  await using screen = await renderPanel(<WorkflowPanel threadRef={threadRef} />);
  const { container } = screen;
  expect(container.textContent).toContain("Choose a workflow");
  expect(container.querySelector('[aria-label="Workflow panel view"]')).toBeNull();

  state.projection = launchSite;
  await update();
  expect(container.textContent).not.toContain("No delegated work yet");
  for (const title of ["Turn 1", "Research demand", "Launch site", "Build", "Check & preview"]) {
    expect(container.textContent).toContain(title);
  }
});

it.each(["Steps", "Subagents"])(
  "offers Save as workflow from the actions menu in %s",
  async (view) => {
    using _state = setup();
    state.workflows = [draftOf([{ id: "brief", title: "Brief", skill: "brief" }])];
    state.projection = launchSite;
    await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
    if (view === "Subagents") await click(button("Subagents"));
    await userEvent.click(byLabel("More workflow actions"));
    const save = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Save as workflow…",
    );
    expect(save).toBeDefined();
    await userEvent.click(save!);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Save as workflow");
  },
);

it("switches between Steps and Subagents and offers a way back from the empty view", async () => {
  using _state = setup();
  state.workflows = [draftOf([{ id: "brief", title: "Brief", skill: "brief" }])];
  state.projection = { runs: [], subagents: [] };
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(byLabel("Workflow panel view")).toBeDefined();
  await click(button("Subagents"));
  expect(container.textContent).toContain("No subagents in this thread yet");
  expect(container.textContent).toContain("Work the chat agent hands to subagents shows up here.");
  await click(button("Back to workflow"));
  expect(container.textContent).toContain("Brief");
});

it("keeps the remote runs placeholder disabled", async () => {
  using _state = setup();
  state.workflows = [draftOf([{ id: "brief", title: "Brief", skill: "brief" }])];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  expect(byLabel("Remote runs").hasAttribute("disabled")).toBe(true);
});

it("opens a delegated thread from its agent card", async () => {
  using _state = setup();
  state.projection = launchSite;
  await using _screen = await renderPanel(<WorkflowPanel threadRef={threadRef} />);

  await click(byLabel("Open Landing page"));
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: "local", threadId: "landing-chat" },
  });
});

it("zooms from the toolbar and fits back to the graph", async () => {
  using _state = setup();
  state.projection = launchSite;
  await using _screen = await renderPanel(<WorkflowPanel threadRef={threadRef} />);
  await waitForCanvasFit();
  const fitted = zoomLabel();

  await click(byLabel("Zoom in"));
  expect(zoomLabel()).not.toBe(fitted);

  await click(byLabel("Fit to view"));
  expect(zoomLabel()).toBe(fitted);
});

const starterRef = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("starter"));
function button(text: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === text,
  )!;
}
function bodyButton(text: string) {
  return [...document.body.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === text,
  )!;
}
function bodyByLabel(label: string) {
  return document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
}
it.each([true, false])("stops a live run only with permission (%s)", async (allowed) => {
  using _state = setup();
  state.allowed = allowed;
  state.runs = [workflowRunFixture];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  expect(screen.container.textContent).toContain("Launch site");
  await click(button("Stop"));
  expect(state.command).toHaveBeenCalledTimes(allowed ? 1 : 0);
  if (allowed)
    expect(state.command).toHaveBeenCalledWith({
      environmentId: starterRef.environmentId,
      input: { runId: workflowRunFixture.id },
    });
});
it("approves a gated step, opens step threads and follows stopped snapshots", async () => {
  using _state = setup();
  state.runs = [workflowRunFixture];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  await click(button("Approve"));
  expect(state.command).toHaveBeenCalledWith({
    environmentId: starterRef.environmentId,
    input: { runId: workflowRunFixture.id, stepId: "images" },
  });
  await click(byLabel("Open build"));
  await click(button("Open thread"));
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: "remote", threadId: "build-thread" },
  });
  state.runs = [
    {
      ...workflowRunFixture,
      status: "stopped",
      steps: workflowRunFixture.steps.map((step) => ({ ...step, status: "skipped" })),
    },
  ];
  await update();
  expect(container.textContent).toContain("Stopped");
  expect(button("Stop")).toBeUndefined();
  expect(button("Approve")).toBeUndefined();
});

it("shows approval as a separate card, enforces permission and busy state, and opens its step editor", async () => {
  using _state = setup();
  const definition = {
    ...workflowRunFixture.definition,
    steps: workflowRunFixture.definition.steps.map((step) =>
      step.id === "images" ? { ...step, gate: true } : step,
    ),
  };
  state.runs = [{ ...workflowRunFixture, definition }];
  state.allowed = false;
  let finishApproval!: (value: { _tag: "Success" }) => void;
  state.command.mockImplementation(() => new Promise((resolve) => (finishApproval = resolve)));
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const gate = byLabel("Open approval gate for images");
  expect(gate.textContent).toContain("Waiting for approval");
  expect(gate.parentElement?.parentElement?.textContent).not.toContain("Needs you");
  const approve = button("Approve");
  expect(approve.disabled).toBe(true);

  state.allowed = true;
  await update();
  expect(button("Approve").disabled).toBe(false);
  await click(button("Approve"));
  expect(button("Approve").disabled).toBe(true);
  expect(state.command).toHaveBeenCalledWith({
    environmentId: starterRef.environmentId,
    input: { runId: workflowRunFixture.id, stepId: "images" },
  });
  await act(async () => finishApproval({ _tag: "Success" }));
  state.command.mockResolvedValue({ _tag: "Success" });
  state.runs = [{ ...workflowRunFixture, definition, status: "done" }];
  await update();
  expect(button("Approve")).toBeUndefined();
  await click(byLabel("Open approval gate for images"));
  await click(byLabel("Wait for approval before this step"));
  expect(sentEdits()).toContainEqual(
    expect.objectContaining({
      _tag: "stepPut",
      step: expect.objectContaining({ id: "images", gate: false }),
    }),
  );
});

it("shows approval gates before a draft has ever run", async () => {
  using _state = setup();
  state.workflows = [
    draftOf([
      { id: "build", title: "Build", skill: "build" },
      { id: "publish", title: "Publish", skill: "publish", gate: true },
    ]),
  ];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await expect.element(page.getByText("Required · Draft", { exact: true })).toBeVisible();
  expect(button("Approve")).toBeUndefined();
  expect(document.querySelectorAll('[aria-label^="Open approval gate for"]')).toHaveLength(1);
});

it("shows one derived Check per checked Skill and opens its owner inspector", async () => {
  using _state = setup();
  const definition = {
    ...workflowRunFixture.definition,
    steps: workflowRunFixture.definition.steps.map((step) =>
      step.id === "build"
        ? { ...step, checks: [{ kind: "command" as const, command: "pnpm build" }] }
        : step,
    ),
  };
  state.runs = [{ ...workflowRunFixture, definition }];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);

  await expect.element(page.getByText("Pending", { exact: true })).toBeVisible();
  expect(
    document.querySelectorAll('[data-workflow-node="draft:Launch site:check:build"]'),
  ).toHaveLength(0);
  expect(document.querySelectorAll('[data-workflow-node="run-one:check:build"]')).toHaveLength(1);
  await click(byLabel("Open checks for build"));
  await expect.element(page.getByText("Pending: pnpm build", { exact: true })).toBeVisible();
  expect(document.querySelectorAll('[data-workflow-node="run-one:check:build"]')).toHaveLength(1);
});

it("shows a saved draft, missing skill, and ready step states", async () => {
  using _state = setup();
  state.workflows = [
    {
      projectId: workflowRunFixture.projectId,
      workflow: "launch",
      definition: {
        ...workflowRunFixture.definition,
        steps: [
          { id: "research", title: "Research", skill: "research" },
          { id: "draft-step", title: "Draft step", skill: "missing-skill" },
        ],
      },
      problem: null,
      missingSkills: ["missing-skill"],
      skills: [],
      blockers: [],
      updatedAt: "2026-10-19T12:00:00.000Z",
      editedByThreadId: starterRef.threadId,
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(container.textContent).toContain("Research");
  expect(container.textContent).toContain("Draft step");
  expect(container.textContent).toContain("skill missing");
  const missingSkillCard = byLabel("Open Draft step").parentElement;
  expect(missingSkillCard?.className).toContain("border-dashed");
});

it("disables Run and lists pre-flight blocker messages", async () => {
  using _state = setup();
  state.workflows = [
    {
      projectId: workflowRunFixture.projectId,
      workflow: "launch",
      definition: workflowRunFixture.definition,
      problem: null,
      missingSkills: [],
      skills: [],
      blockers: [{ stepId: "build", kind: "requirement", message: "Needs xcodebuild" }],
      updatedAt: "2026-10-19T12:00:00.000Z",
      editedByThreadId: starterRef.threadId,
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(container.textContent).toContain("Can't run yet");
  expect(container.textContent).toContain("Needs xcodebuild");
  expect(button("Run").hasAttribute("disabled")).toBe(true);
});

it("shows running subagent and approval states, and updates with a new step", async () => {
  using _state = setup();
  state.runs = [
    {
      ...workflowRunFixture,
      steps: workflowRunFixture.steps.map((step) =>
        step.stepId === "build"
          ? { ...step, status: "running" as const, threadId: ThreadId.make("build-thread") }
          : step.stepId === "research"
            ? { ...step, status: "ready" as const }
            : step,
      ),
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(container.textContent).toContain("subagent");
  expect(container.textContent).toContain("Ready");
  expect(button("Approve")).toBeDefined();

  state.runs = [
    {
      ...(state.runs[0] as typeof workflowRunFixture),
      definition: {
        ...workflowRunFixture.definition,
        steps: [
          ...workflowRunFixture.definition.steps,
          { id: "new-step", title: "New step", skill: "new" },
        ],
      },
      steps: [
        ...workflowRunFixture.steps,
        { stepId: "new-step", status: "ready" as const, attempts: 0, threadId: null },
      ],
    },
  ];
  await update();
  expect(container.textContent).toContain("New step");
});

it("shows step summary and outputs in the detail view", async () => {
  using _state = setup();
  state.runs = [
    {
      ...workflowRunFixture,
      steps: workflowRunFixture.steps.map((step) =>
        step.stepId === "build"
          ? {
              ...step,
              summary: "Built the landing page",
              outputs: { page: "out/index.html", preview: "https://example.test" },
            }
          : step,
      ),
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  await click(byLabel("Open build"));
  expect(container.textContent).toContain("Built the landing page");
  expect(container.textContent).toContain("out/index.html");
  expect(container.textContent).toContain("https://example.test");
});

it("opens New workflow when the panel mounts after the palette request", async () => {
  using _state = setup();
  const createAction = workflowPaletteActions({
    environmentId: threadRef.environmentId,
    id: threadRef.threadId,
  }).find((action) => action.value === "action:new-thread-workflow");
  if (!createAction) throw new Error("New workflow palette action is missing");
  await createAction.run();
  await using _screen = await renderPanel(<WorkflowPanel threadRef={threadRef} />);

  expect(document.body.querySelector('[data-slot="dialog-popup"]')).not.toBeNull();
  expect(document.body.textContent).toContain("New workflow");
});

it("imports a reviewed thread draft with cleaned dependencies and only new skills", async () => {
  using _state = setup();
  state.queryData = {
    _tag: "draftFromThread",
    draft: {
      slug: "saved-work",
      definition: {
        version: 1,
        name: "Saved work",
        steps: [
          { id: "research", skill: "research", title: "Research" },
          { id: "design", skill: "design", title: "Design" },
          { id: "build", skill: "build", title: "Build", readsFrom: ["research", "design"] },
        ],
      },
      skills: [
        { name: "research", content: "existing skill", exists: true },
        { name: "design", content: "design skill", exists: false },
        { name: "build", content: "build skill", exists: false },
      ],
    },
  };
  const action = workflowPaletteActions({
    environmentId: starterRef.environmentId,
    id: starterRef.threadId,
  }).find((item) => item.value === "action:save-thread-as-workflow");
  if (!action) throw new Error("Save as workflow palette action is missing");
  await action.run();
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(document.body.textContent).toContain("Save as workflow");
  await click(bodyByLabel("Keep Design"));
  await click(bodyButton("Save workflow"));

  const edit = state.command.mock.calls
    .map(([target]) => (target as { input: { _tag: string } }).input)
    .find((item) => item._tag === "import");
  expect(edit).toMatchObject({
    _tag: "import",
    projectId: workflowRunFixture.projectId,
    workflow: "saved-work",
    definition: {
      name: "Saved work",
      steps: [
        { id: "research", title: "Research" },
        { id: "build", title: "Build", readsFrom: ["research"] },
      ],
    },
    skills: [{ name: "build", content: "build skill" }],
  });
  state.workflows = [
    draftOf([
      { id: "research", title: "Research", skill: "research" },
      { id: "build", title: "Build", skill: "build" },
    ]),
  ];
  await update();
  expect(container.textContent).toContain("Build");
});

it("shows the whole workflow from a step thread and offers Resume", async () => {
  using _state = setup();
  state.runs = [
    {
      ...workflowRunFixture,
      steps: workflowRunFixture.steps.map((step) =>
        step.stepId === "build" ? { ...step, status: "waiting", waitingFor: "resume" } : step,
      ),
    },
  ];
  const stepRef = scopeThreadRef(starterRef.environmentId, ThreadId.make("build-thread"));
  await using screen = await renderPanel(<WorkflowPanel threadRef={stepRef} />);
  expect(screen.container.textContent).toContain("Launch site");
  await click(button("Resume"));
  expect(state.command).toHaveBeenCalledWith({
    environmentId: stepRef.environmentId,
    input: { runId: workflowRunFixture.id, stepId: "build" },
  });
});

function draftOf(steps: ReadonlyArray<WorkflowDefinition["steps"][number]>) {
  return {
    projectId: workflowRunFixture.projectId,
    workflow: "launch",
    definition: { ...workflowRunFixture.definition, steps },
    problem: null,
    missingSkills: [],
    skills: [],
    blockers: [],
    updatedAt: "2026-10-19T12:00:00.000Z",
    editedByThreadId: starterRef.threadId,
  };
}
const centre = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
};
/** Presses on `from`, drags through a few points to `to`, and releases there. */
async function drag(from: Element, to: { clientX: number; clientY: number }, during?: () => void) {
  const start = centre(from);
  const pointer = { bubbles: true, pointerId: 7, button: 0, isPrimary: true };
  await act(async () => {
    from.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, ...start }));
  });
  for (const t of [0.25, 0.5, 0.75, 1]) {
    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          ...pointer,
          clientX: start.clientX + (to.clientX - start.clientX) * t,
          clientY: start.clientY + (to.clientY - start.clientY) * t,
        }),
      );
    });
  }
  during?.();
  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, ...to }));
  });
}
const sentEdits = () =>
  state.command.mock.calls.map(([target]) => (target as { input: { _tag: string } }).input);
const threeSteps = [
  { id: "a", title: "Alpha", skill: "brief" },
  { id: "b", title: "Beta", skill: "design" },
  { id: "c", title: "Gamma", skill: "deploy" },
];

it("shows Start inputs and the bound schedule, and opens the saved workflow settings from a run", async () => {
  using _state = setup();
  const listing = draftOf(threeSteps);
  state.workflows = [
    {
      ...listing,
      definition: {
        ...listing.definition,
        trigger: "manual",
        inputs: [{ id: "current", label: "Current input", kind: "text" }],
      },
    },
  ];
  state.runs = [
    {
      ...workflowRunFixture,
      definition: {
        ...workflowRunFixture.definition,
        inputs: [{ id: "appName", label: "Pinned app name", kind: "text" }],
      },
      inputs: { appName: "Kimchi" },
    },
  ];
  state.queryData = {
    tasks: [
      {
        projectId: workflowRunFixture.projectId,
        threadId: starterRef.threadId,
        prompt: workflowSchedulePrompt({
          version: 1,
          projectId: workflowRunFixture.projectId,
          workflow: "launch",
          inputs: {},
        }),
        enabled: true,
        nextRunAt: "2099-01-01T00:00:00Z",
        schedule: { type: "interval", everyMs: 30 * 86_400_000 },
      },
    ],
  };
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  const start = container.querySelector("[data-workflow-start-card]")!;
  expect(start.textContent).toContain("Pinned app name");
  expect(start.textContent).toContain("Kimchi");
  expect(start.textContent).not.toContain("Current input");
  expect(start.textContent).toContain("Every 43200m");
  expect(start.textContent).toContain("Next:");
  await click(byLabel("Open workflow settings for Launch site"));
  expect(container.querySelector('[aria-label="Workflow settings"]')).not.toBeNull();
  expect((byLabel("Input 1 label") as HTMLInputElement).value).toBe("Current input");
});

it("shows child progress, opens its pinned canvas and returns to its parent without listing child runs", async () => {
  using _state = setup();
  const parent: WorkflowRun = {
    ...workflowRunFixture,
    definition: {
      version: 2,
      name: "iOS launch",
      steps: [
        { id: "screenshots", title: "Screenshots", kind: "workflow", workflow: "screenshots" },
      ],
    },
    steps: [
      {
        stepId: "screenshots",
        status: "running",
        threadId: starterRef.threadId,
        attempts: 1,
        childRunId: "child-run",
      },
    ],
  };
  const child: WorkflowRun = {
    ...workflowRunFixture,
    id: "child-run",
    workflow: "screenshots",
    startedAt: "2026-10-20T12:01:00Z",
    parent: { runId: parent.id, stepId: "screenshots" },
    definition: {
      version: 2,
      name: "Screenshots",
      steps: Array.from({ length: 5 }, (_, index) => ({
        id: `capture-${index + 1}`,
        title: `Capture ${index + 1}`,
        skill: "capture",
      })),
    },
    steps: Array.from({ length: 5 }, (_, index) => ({
      stepId: `capture-${index + 1}`,
      status: index < 3 ? "done" : index === 3 ? "waiting" : "queued",
      ...(index === 3 ? { waitingFor: "approval" as const } : {}),
      attempts: index < 3 ? 1 : 0,
      threadId: starterRef.threadId,
    })),
    status: "waiting",
  };
  state.runs = [parent, child];
  state.workflows = [
    { ...draftOf([]), definition: parent.definition },
    {
      ...draftOf([]),
      workflow: child.workflow,
      definition: {
        ...child.definition,
        steps: [{ id: "changed", title: "Changed after start", skill: "changed" }],
      },
      editedByThreadId: null,
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(container.textContent).toContain("3 of 5");
  expect(container.textContent).toContain("Needs you");
  expect(container.querySelector('[aria-label="Open Capture 1"]')).toBeNull();
  await userEvent.click(byLabel("Workflow run"));
  const runOptions = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(runOptions).toHaveLength(1);
  await userEvent.click(runOptions[0]!);
  await click(byLabel("Open Screenshots"));
  expect(byLabel("Open Capture 1")).not.toBeNull();
  expect(container.textContent).not.toContain("Changed after start");
  await click(button("Approve"));
  expect(state.command).toHaveBeenCalledWith({
    environmentId: starterRef.environmentId,
    input: { runId: child.id, stepId: "capture-4" },
  });
  await click(byLabel("Back to parent workflow"));
  expect(container.querySelector('[aria-label="Open Capture 1"]')).toBeNull();
  expect(container.textContent).toContain("3 of 5");
  state.runs = [
    parent,
    {
      ...child,
      status: "running",
      steps: child.steps.map((step) =>
        step.stepId === "capture-4" ? { ...step, status: "done" } : step,
      ),
    },
  ];
  await update();
  expect(container.textContent).toContain("4 of 5");
});

it.each(["header", "connection", "append", "empty"])(
  "adds a saved workflow from the %s + picker",
  async (entry) => {
    using _state = setup();
    state.workflows = [
      draftOf(entry === "empty" ? [] : threeSteps),
      {
        ...draftOf([{ id: "capture", title: "Capture", skill: "capture" }]),
        workflow: "screenshots",
        definition: {
          version: 2,
          name: "Screenshots",
          steps: [{ id: "capture", skill: "capture" }],
        },
        editedByThreadId: null,
      },
    ];
    await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
    const { container } = screen;
    const trigger =
      entry === "empty"
        ? button("Add the first step")
        : entry === "header"
          ? byLabel("Add a step")
          : container.querySelector<HTMLElement>(
              entry === "connection"
                ? '[aria-label="Insert a step here"]'
                : '[aria-label="Add a step after this"]',
            )!;
    await userEvent.click(trigger);
    await userEvent.click(bodyButton("Workflows"));
    await userEvent.fill(bodyByLabel("Search workflows"), "Screenshots");
    const choice = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Screenshotsscreenshots",
    )!;
    expect(choice).toBeDefined();
    await userEvent.click(choice);
    expect(sentEdits()).toEqual([
      expect.objectContaining({
        _tag: "stepPut",
        workflow: "launch",
        after: entry === "header" || entry === "append" ? "c" : null,
        step: expect.objectContaining({
          kind: "workflow",
          workflow: "screenshots",
          title: "Screenshots",
        }),
      }),
    ]);
    expect(document.querySelector('[aria-label="Search workflows"]')).toBeNull();
  },
);

it("collects required inputs before starting in an existing chat and preserves them on failure", async () => {
  using _state = setup();
  const listing = draftOf(threeSteps);
  state.workflows = [
    {
      ...listing,
      definition: {
        ...listing.definition,
        inputs: [
          { id: "appName", label: "App name", kind: "text", required: true },
          { id: "homepage", label: "Homepage", kind: "url" },
          { id: "notes", label: "Notes", kind: "multiline" },
        ],
      },
    },
  ];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(button("Run"));
  const dialog = () => document.querySelector('[role="dialog"]')!;
  const start = () =>
    [...dialog().querySelectorAll("button")].find((item) => item.textContent === "Run")!;
  expect(start().disabled).toBe(true);
  expect(state.command).not.toHaveBeenCalled();
  await userEvent.fill(bodyByLabel("App name *"), "Kimchi");
  await userEvent.fill(bodyByLabel("Homepage"), "ftp://example.test");
  expect(start().disabled).toBe(true);
  await userEvent.fill(bodyByLabel("Homepage"), "https://example.test");
  await userEvent.fill(bodyByLabel("Notes"), "First line\nSecond line");
  state.command.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Disconnected")),
  });
  await click(start());
  expect(dialog()).not.toBeNull();
  expect(dialog().textContent).toContain("Disconnected");
  expect((bodyByLabel("App name *") as HTMLInputElement).value).toBe("Kimchi");
  state.command.mockResolvedValueOnce({ _tag: "Success", value: { runId: "run-inputs" } });
  await click(start());
  expect(sentEdits().at(-1)).toMatchObject({
    _tag: "runStart",
    workflow: "launch",
    driverThreadId: starterRef.threadId,
    inputs: {
      appName: "Kimchi",
      homepage: "https://example.test",
      notes: "First line\nSecond line",
    },
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("starts empty in a new chat and opens a saved workflow only when chosen", async () => {
  using _state = setup();
  state.workflows = [{ ...draftOf(threeSteps), editedByThreadId: null }];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(container.textContent).toContain("Choose a workflow");
  expect(container.querySelector('[aria-label="Open Alpha"]')).toBeNull();
  expect(button("Run")).toBeUndefined();
  expect(container.querySelector('[aria-label="More workflow actions"]')).toBeNull();
  expect(container.querySelector('[aria-label="Run in another chat…"]')).toBeNull();
  await openSavedWorkflow();
  expect(byLabel("Open Alpha")).not.toBeNull();
  expect(button("New workflow")).toBeUndefined();
  expect(button("Run")).toBeDefined();
  await click(button("Run"));
  expect(sentEdits()).toEqual([
    expect.objectContaining({ _tag: "runStart", driverThreadId: starterRef.threadId }),
  ]);
  expect(container.textContent).not.toContain("Choose a workflow");
  await screen.rerender(
    <WorkflowPanel
      threadRef={scopeThreadRef(starterRef.environmentId, ThreadId.make("new-chat"))}
    />,
  );
  expect(container.textContent).toContain("Choose a workflow");
  expect(container.querySelector('[aria-label="Open Alpha"]')).toBeNull();
});

it("opens the creation dialog directly from the empty panel", async () => {
  using _state = setup();
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  expect(byLabel("Open workflow").hasAttribute("disabled")).toBe(true);
  await click(button("New workflow"));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("New workflow");
});

async function openSavedWorkflow() {
  await userEvent.click(byLabel("Open workflow"));
  const option = document.querySelector<HTMLElement>('[role="option"]');
  expect(option).not.toBeNull();
  await userEvent.click(option!);
}

it.each([
  { success: true, withInputs: false, planModeEnabled: true, providerAvailable: true },
  { success: false, withInputs: false, planModeEnabled: true, providerAvailable: true },
  { success: true, withInputs: true, planModeEnabled: true, providerAvailable: true },
  { success: true, withInputs: false, planModeEnabled: false, providerAvailable: true },
  { success: true, withInputs: false, planModeEnabled: false, providerAvailable: false },
])(
  "runs a workflow from an unsent draft without consuming composer text ($success, inputs: $withInputs, plan mode: $planModeEnabled, available: $providerAvailable)",
  async ({ success, withInputs, planModeEnabled, providerAvailable }) => {
    using _state = setup();
    state.hasShell = false;
    const listing = draftOf(threeSteps);
    state.workflows = [
      {
        ...listing,
        definition: {
          ...listing.definition,
          ...(withInputs
            ? { inputs: [{ id: "appName", label: "App name", kind: "text", required: true }] }
            : {}),
        },
        editedByThreadId: null,
      },
    ];
    const draftId = DraftId.make("unsent-workflow");
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(
      scopeProjectRef(starterRef.environmentId, workflowRunFixture.projectId),
      draftId,
      {
        threadId: starterRef.threadId,
        envMode: "worktree",
        branch: "feature/base",
        startFromOrigin: true,
        runtimeMode: "full-access",
      },
    );
    store.setPrompt(draftId, "Keep this unsent message");
    const selection = {
      instanceId: "codex",
      model: "gpt-6-luna",
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const composer = {
      current: {
        getSendContext: () => ({
          providerAvailable,
          interactionModeEnabled: planModeEnabled,
          interactionMode: "default",
          selectedModelSelection: selection,
        }),
      },
    } as unknown as ComposerHandleRef;
    if (!success)
      state.command.mockResolvedValue({
        _tag: "Failure",
        cause: Cause.fail(new Error("Disconnected")),
      });
    await using screen = await renderPanel(
      <ComposerHandleContext value={composer}>
        <WorkflowPanel threadRef={starterRef} />
      </ComposerHandleContext>,
    );
    const { container } = screen;
    expect(container.textContent).toContain("Choose a workflow");
    await openSavedWorkflow();
    expect(button("Run").disabled).toBe(false);
    await click(button("Run"));
    if (withInputs) {
      expect(state.command).not.toHaveBeenCalled();
      await userEvent.fill(bodyByLabel("App name *"), "Kimchi");
      const dialogRun = [
        ...document.querySelector('[role="dialog"]')!.querySelectorAll("button"),
      ].find((item) => item.textContent === "Run")!;
      await click(dialogRun);
    }
    if (!providerAvailable) {
      expect(state.command).not.toHaveBeenCalled();
      expect(container.textContent).toContain(
        "Select an available model in the composer before running this workflow.",
      );
      expect(store.getComposerDraft(draftId)?.prompt).toBe("Keep this unsent message");
      expect(useComposerDraftStore.getState().getDraftSession(draftId)?.promotedTo).toBeNull();
      expect(state.navigate).not.toHaveBeenCalled();
      return;
    }
    expect(state.command).toHaveBeenCalledExactlyOnceWith({
      environmentId: starterRef.environmentId,
      input: expect.objectContaining({
        threadId: starterRef.threadId,
        modelSelection: selection,
        message: expect.objectContaining({
          text: withInputs
            ? expect.stringContaining("Kimchi")
            : 'Run the Launch site workflow.\n\nUse workflow_run for "launch" in this chat.',
        }),
        bootstrap: expect.objectContaining({
          createThread: expect.objectContaining({
            projectId: workflowRunFixture.projectId,
            runtimeMode: "full-access",
          }),
          prepareWorktree: {
            projectCwd: "/repo",
            baseBranch: "feature/base",
            startFromOrigin: true,
          },
        }),
      }),
    });
    expect(store.getComposerDraft(draftId)?.prompt).toBe("Keep this unsent message");
    if (success) {
      expect(useComposerDraftStore.getState().getDraftSession(draftId)?.promotedTo).toEqual(
        starterRef,
      );
      expect(state.navigate).toHaveBeenCalledWith({
        to: "/$environmentId/$threadId",
        params: starterRef,
      });
    } else {
      expect(useComposerDraftStore.getState().getDraftSession(draftId)?.promotedTo).toBeNull();
      expect(state.navigate).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Disconnected");
    }
  },
);

const canvasScale = (container: HTMLElement) => {
  const layer = container.querySelector<HTMLElement>(".origin-top-left")!;
  const match = /scale\(([^)]+)\)/.exec(layer.style.transform);
  if (!match) throw new Error("Canvas has no scale");
  return Number(match[1]);
};

/**
 * The camera fits from state its ResizeObserver filled in, so while a resize animates the layer is
 * still centred on the previous viewport height. Requires the fit the settled height implies.
 */
const expectFittedToSettledHeight = (canvas: HTMLElement, layer: HTMLElement) => {
  const scale = Number(/scale\(([^)]+)\)/.exec(layer.style.transform)![1]);
  const top = Number(/translate\([^,]+,\s*(.+?)px\)/.exec(layer.style.transform)![1]);
  // The browser rounds the inline transform to four decimals, so match it rather than repeat it.
  expect(top).toBeCloseTo(
    Math.max(FIT_PADDING, (canvas.getBoundingClientRect().height - layer.offsetHeight * scale) / 2),
    3,
  );
};

it("saves one position per drop when a step card is dragged, and doesn't open it", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  await waitForCanvasFit();
  const gamma = byLabel("Open Gamma").parentElement!;
  const left = Number.parseFloat(gamma.style.left);
  const top = Number.parseFloat(gamma.style.top);
  const edge = container.querySelector<SVGPathElement>(
    '[data-canvas-edge-from="b"][data-canvas-edge-to="c"]',
  )!;
  const before = edge.getAttribute("d");
  let whileDragging = "";
  const start = centre(gamma);
  await drag(gamma, { clientX: start.clientX + 80, clientY: start.clientY + 60 }, () => {
    whileDragging = edge.getAttribute("d")!;
  });
  // The connected edge follows the card while it moves, before any edit is saved.
  expect(whileDragging).not.toBe(before);
  const scale = canvasScale(container);
  const edits = sentEdits();
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({ _tag: "layoutSet", workflow: "launch" });
  const positions = (edits[0] as unknown as { positions: Record<string, { x: number; y: number }> })
    .positions;
  expect(positions.c!.x).toBeCloseTo(left + 80 / scale, 1);
  expect(positions.c!.y).toBeCloseTo(top + 60 / scale, 1);
  expect(container.querySelector('[aria-label="Alpha editor"], [aria-label="Gamma editor"]')).toBe(
    null,
  );
  expect(gamma.style.translate).toBe("");
});

it("saves a gate card's position without changing the gate", async () => {
  using _state = setup();
  const gated = threeSteps.map((step) => (step.id === "c" ? { ...step, gate: true } : step));
  state.workflows = [draftOf(gated)];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  const gate = byLabel("Open approval gate for c").parentElement!;
  const start = centre(gate);
  await drag(gate, { clientX: start.clientX + 40, clientY: start.clientY + 30 });
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "layoutSet",
      positions: { "gate:c": expect.objectContaining({ x: expect.any(Number) }) },
    }),
  ]);
});

it("still selects a card when pressed without moving", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  const gamma = byLabel("Open Gamma").parentElement!;
  expect(screen.container.querySelector("[data-selected]")).toBeNull();
  await userEvent.click(byLabel("Open Gamma"));
  expect(sentEdits()).toEqual([]);
  expect(screen.container.querySelector('[aria-label="Gamma editor"]')).not.toBeNull();
  expect(gamma.dataset.selected).toBe("true");
  await userEvent.click(byLabel("Close step editor"));
  expect(gamma.dataset.selected).toBeUndefined();
});

it("tidies saved positions back to automatic layout from the actions menu", async () => {
  using _state = setup();
  const listing = draftOf(threeSteps);
  state.workflows = [
    {
      ...listing,
      definition: {
        ...listing.definition,
        version: 3 as const,
        layout: { c: { x: 700, y: 20 } },
      },
    },
  ];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  const gamma = byLabel("Open Gamma").parentElement!;
  expect(gamma.style.left).toBe("700px");
  state.command.mockResolvedValue({ _tag: "Success", value: {} });
  await click(byLabel("Tidy up"));
  expect(sentEdits()).toEqual([
    expect.objectContaining({ _tag: "layoutSet", workflow: "launch", positions: {}, reset: true }),
  ]);
  expect(byLabel("Open Gamma").parentElement!.style.left).not.toBe("700px");
});

it("moves a note by dragging it and saves its position through notePut", async () => {
  using _state = setup();
  const listing = draftOf(threeSteps);
  state.workflows = [
    {
      ...listing,
      definition: {
        ...listing.definition,
        version: 3 as const,
        notes: [{ id: "remember", text: "Keep the release checklist visible.", x: 40, y: 60 }],
      },
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  await waitForCanvasFit();
  const note = container.querySelector<HTMLElement>('[data-workflow-note-card="remember"]')!;
  const start = centre(note);
  await drag(note, { clientX: start.clientX + 70, clientY: start.clientY + 50 });
  const scale = canvasScale(container);
  const edits = sentEdits();
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({
    _tag: "notePut",
    note: expect.objectContaining({ id: "remember" }),
  });
  const moved = (edits[0] as unknown as { note: { x: number; y: number } }).note;
  expect(moved.x).toBeCloseTo(40 + 70 / scale, 1);
  expect(moved.y).toBeCloseTo(60 + 50 / scale, 1);
});

it("withdraws the Add note here offer on Escape or a press elsewhere", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  const canvas = byLabel("Workflow canvas");
  const offer = () => screen.getByRole("button", { name: "Add note here" });
  const openOffer = () =>
    act(async () => {
      canvas.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
  await openOffer();
  await expect.element(offer()).toBeVisible();
  await act(async () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 }),
    );
  });
  await expect.element(offer()).not.toBeInTheDocument();
  await openOffer();
  await expect.element(offer()).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(offer()).not.toBeInTheDocument();
  expect(sentEdits()).toEqual([]);
});

it("links two cards by dragging from a card's handle", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  let opacityAtDrop: number[] = [];
  window.addEventListener(
    "pointerup",
    () => {
      opacityAtDrop = ["Alpha", "Beta", "Gamma"].map((name) =>
        Number(getComputedStyle(byLabel(`Open ${name}`).parentElement!).opacity),
      );
    },
    { capture: true, once: true },
  );
  await browserDrag(byLabel("Link from Alpha"), byLabel("Open Gamma"));
  expect(opacityAtDrop).toEqual([0.35, 0.35, 1]);
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "stepPut",
      step: expect.objectContaining({ id: "c", readsFrom: ["b", "a"] }),
    }),
  ]);
});

it("opens the skill picker on blank canvas and adds a step reading the source", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  state.queryData = {
    _tag: "skills",
    skills: [{ name: "review", scope: "project", description: "Review work" }],
  };
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  const source = byLabel("Open Alpha");
  const viewport = source.parentElement!.parentElement!.parentElement!;
  await click(byLabel("Zoom out"));
  await act(async () =>
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        deltaX: 15,
        deltaY: 20,
      }),
    ),
  );
  const rect = viewport.getBoundingClientRect();
  let dropPoint = { x: 0, y: 0 };
  window.addEventListener(
    "pointerup",
    (event) => {
      const bounds = viewport.getBoundingClientRect();
      dropPoint = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    },
    { capture: true, once: true },
  );
  await browserDrag(byLabel("Link from Alpha"), viewport, {
    targetPosition: { x: rect.width - 40, y: rect.height - 50 },
  });
  const anchor = centre(byLabel("Add a step after linked source"));
  const bounds = viewport.getBoundingClientRect();
  // Within a pixel: Linux Chromium centres the anchor on a fractional coordinate.
  expect(Math.abs(anchor.clientX - bounds.left - dropPoint.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(anchor.clientY - bounds.top - dropPoint.y)).toBeLessThanOrEqual(1);
  expect(bodyByLabel("Search skills")).not.toBeNull();
  const review = [...document.body.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Review work"),
  );
  expect(review).toBeDefined();
  await userEvent.click(review!);
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "stepPut",
      after: "a",
      step: expect.objectContaining({ skill: "review", readsFrom: ["a"] }),
    }),
  ]);
});

it("keeps picker wheel and pointer gestures from moving the canvas", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  state.queryData = {
    _tag: "skills",
    skills: Array.from({ length: 30 }, (_, index) => ({
      name: `skill-${index}`,
      scope: "project",
      description: `Skill ${index}`,
    })),
  };
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  const source = byLabel("Open Alpha");
  const layer = source.parentElement!.parentElement!;
  const viewport = layer.parentElement!;
  await click(screen.container.querySelector<HTMLElement>('[aria-label="Insert a step here"]')!);
  const search = bodyByLabel("Search skills")!;
  const list = search
    .closest('[data-slot="popover-popup"]')!
    .querySelector<HTMLElement>(".overflow-auto")!;
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  const transform = layer.style.transform;
  for (const scrollTop of [0, list.scrollHeight]) {
    list.scrollTop = scrollTop;
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 });
    await act(async () => list.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(false);
    expect(layer.style.transform).toBe(transform);
  }
  await browserDrag(search, list, { targetPosition: { x: 40, y: 60 } });
  expect(layer.style.transform).toBe(transform);
  await act(async () =>
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        deltaY: 30,
      }),
    ),
  );
  expect(layer.style.transform).not.toBe(transform);
});

it("links an earlier producer or creates a loop when dragging backwards without opening the skill picker", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  let ancestorOpacity = 1;
  window.addEventListener(
    "pointerup",
    () => {
      ancestorOpacity = Number(getComputedStyle(byLabel("Open Alpha").parentElement!).opacity);
    },
    { capture: true, once: true },
  );
  await browserDrag(byLabel("Link from Gamma"), byLabel("Open Alpha"));
  expect(ancestorOpacity).toBe(1);
  expect(document.body.querySelector('[aria-label="Search skills"]')).toBeNull();
  await click(button("Read from step"));
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "stepPut",
      step: expect.objectContaining({ id: "c", readsFrom: ["b", "a"] }),
    }),
  ]);
  await browserDrag(byLabel("Link from Gamma"), byLabel("Open Alpha"));
  await click(button("Make a loop"));
  expect(sentEdits()).toContainEqual(
    expect.objectContaining({
      _tag: "loopPut",
      loop: expect.objectContaining({ from: "c", to: "a" }),
    }),
  );
});

it("still pans when a drag starts on a card of a run", async () => {
  using _state = setup();
  state.runs = [workflowRunFixture];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const card = screen.container.querySelector("[data-workflow-step-card]")!;
  expect(card.hasAttribute("data-canvas-no-pan")).toBe(false);
});

it("keeps the latest run HTML thumbnail and open action visible while editing", async () => {
  using _state = setup();
  state.workflows = [draftOf(workflowRunFixture.definition.steps)];
  state.runs = [
    {
      ...workflowRunFixture,
      status: "done",
      steps: workflowRunFixture.steps.map((step) => ({
        ...step,
        status: "done",
        waitingFor: undefined,
        ...(step.stepId === "build"
          ? {
              outputs: { html: ".t3/workflows/out/mascot.html", validation: "Syntax check passed" },
              outputPreviews: { html: { status: "ready", attachmentId: "mascot-preview" } },
            }
          : {}),
      })),
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(container.textContent).toContain("Last run");
  const build = container.querySelector<HTMLElement>('[data-workflow-node="run-one:build"]')!;
  expect(build.style.height).toBe("287px");
  expect(build.querySelector('[aria-label="Open output html"]')?.textContent).toContain(
    "Open HTML",
  );
  expect(build.textContent).toContain("Syntax check passed");
  await click(byLabel("Open build"));
  expect(container.querySelector('[aria-label="Last run"]')).not.toBeNull();
  expect(build.querySelector('[aria-label="Open output html"]')).not.toBeNull();
});

it("grows a finished card for outputs and keeps its links aligned with the card edges", async () => {
  using _state = setup();
  state.runs = [
    {
      ...workflowRunFixture,
      steps: workflowRunFixture.steps.map((step) =>
        step.stepId === "research"
          ? { ...step, outputs: { site: "https://example.com/", report: "report.md" } }
          : step,
      ),
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  const research = container.querySelector<HTMLElement>('[data-workflow-node="run-one:research"]')!;
  const build = container.querySelector<HTMLElement>('[data-workflow-node="run-one:build"]')!;
  expect(research.style.height).toBe("297px");
  expect(build.style.height).toBe("112px");
  expect(research.querySelector<HTMLAnchorElement>('[aria-label="Open output site"]')?.href).toBe(
    "https://example.com/",
  );
  expect(research.querySelector('[aria-label="Open output report"]')).not.toBeNull();
  const edge = container.querySelector<SVGPathElement>(
    '[data-workflow-edge="run-one:research->run-one:build"]',
  );
  expect(container.querySelectorAll("[data-workflow-node]")).toHaveLength(5);
  const points = edge!
    .getAttribute("d")!
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  const x = Number.parseFloat(research.style.left);
  const y = Number.parseFloat(research.style.top);
  const toX = Number.parseFloat(build.style.left);
  const toY = Number.parseFloat(build.style.top);
  const vertical = toY > y && toX === x;
  expect(points.slice(0, 2)).toEqual(vertical ? [x + 100, y + 297] : [x + 200, y + 148.5]);
  expect(points.slice(-2)).toEqual(vertical ? [toX + 100, toY] : [toX, toY + 56]);
});

it("shows activity only for an unambiguous running step and clears it when the step finishes", async () => {
  using _state = setup();
  const run = {
    ...workflowRunFixture,
    steps: workflowRunFixture.steps.map((step) =>
      step.stepId === "build" ? { ...step, startedAt: "2026-10-21T12:00:00Z" } : step,
    ),
  };
  state.runs = [run];
  state.activityLabel = "Editing index.html";
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  expect(container.querySelector("[data-workflow-step-activity]")?.textContent).toBe(
    "Editing index.html",
  );
  state.runs = [
    {
      ...run,
      steps: run.steps.map((step) =>
        step.stepId === "build" ? { ...step, status: "done" } : step,
      ),
    },
  ];
  await update();
  expect(container.querySelector("[data-workflow-step-activity]")).toBeNull();
  state.runs = [
    {
      ...run,
      steps: run.steps.map((step) =>
        step.stepId === "research"
          ? {
              ...step,
              status: "running",
              threadId: ThreadId.make("build-thread"),
              startedAt: "2026-10-21T12:00:01Z",
            }
          : step,
      ),
    },
  ];
  await update();
  expect(container.querySelector("[data-workflow-step-activity]")).toBeNull();
});

it("keeps workflow settings open when choosing a portalled execution option", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Open workflow settings for Launch site"));
  await userEvent.click(byLabel("Run steps"));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent?.trim() === "Prefer subagents",
  )!;
  await userEvent.click(option);
  expect(screen.container.querySelector('[aria-label="Workflow settings"]')).not.toBeNull();
  expect(sentEdits()).toContainEqual(
    expect.objectContaining({ _tag: "meta", execution: "prefer-subagents" }),
  );
});

it("closes the execution menu before dismissing settings with Escape", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  await click(byLabel("Open workflow settings for Launch site"));
  await userEvent.click(byLabel("Run steps"));
  await userEvent.keyboard("{Escape}");
  expect(byLabel("Run steps").getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[aria-label="Workflow settings"]')).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() =>
    expect(container.querySelector('[aria-label="Workflow settings"]')).toBeNull(),
  );
  expect(sentEdits()).toEqual([]);
});

it("creates, edits, and reloads notes through notePut without adding workflow work", async () => {
  using _state = setup();
  let saved = draftOf(threeSteps);
  saved = {
    ...saved,
    definition: { ...saved.definition, version: 3, notes: [] },
  };
  state.workflows = [saved];
  state.command.mockImplementation(async ({ input }: { input: WorkflowEdit }) => {
    if (input._tag === "notePut") {
      saved = {
        ...saved,
        definition: {
          ...saved.definition,
          notes: [
            ...(saved.definition.notes ?? []).filter((note) => note.id !== input.note.id),
            input.note,
          ],
        },
      };
      state.workflows = [saved];
      state.revision += 1;
      state.listeners.forEach((listener) => listener());
    }
    if (input._tag === "noteRemove") {
      saved = {
        ...saved,
        definition: {
          ...saved.definition,
          notes: (saved.definition.notes ?? []).filter((note) => note.id !== input.noteId),
        },
      };
      state.workflows = [saved];
      state.revision += 1;
      state.listeners.forEach((listener) => listener());
    }
    return { _tag: "Success", value: {} };
  });
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Add note"));
  const noteEditor = () => screen.getByRole("textbox", { name: "Note text" });
  await expect.element(noteEditor()).toHaveFocus();
  await userEvent.fill(noteEditor(), "Keep the release checklist visible.");
  await click(button("Save note"));
  expect(saved.definition.notes).toMatchObject([{ text: "Keep the release checklist visible." }]);
  expect(saved.definition.steps).toHaveLength(threeSteps.length);
  await click(screen.container.querySelector<HTMLElement>("[data-workflow-note-card]")!);
  await expect.element(noteEditor()).toHaveValue("Keep the release checklist visible.");
  await click(button("Delete note"));
  expect(saved.definition.notes).toEqual([]);
  expect(sentEdits().map((edit) => edit._tag)).toEqual(["notePut", "notePut", "noteRemove"]);
});

it("attaches, copies, and detaches independent resource records through stepPut", async () => {
  using _state = setup();
  let saved = draftOf(threeSteps);
  state.workflows = [saved];
  state.command.mockImplementation(async ({ input }: { input: WorkflowEdit }) => {
    if (input._tag === "stepPut") {
      saved = {
        ...saved,
        definition: {
          ...saved.definition,
          steps: saved.definition.steps.map((step) =>
            step.id === input.step.id ? input.step : step,
          ),
        },
      };
      state.workflows = [saved];
      state.revision += 1;
      state.listeners.forEach((listener) => listener());
    }
    return { _tag: "Success", value: {} };
  });
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Open Alpha"));
  await click(byLabel("Add resource"));
  await userEvent.click(page.getByRole("menuitem", { name: "Requirement", exact: true }));
  await expect.element(byLabel("Requirement")).toHaveFocus();
  await userEvent.fill(byLabel("Requirement"), "Node 22");
  await click(button("Add requirement"));
  const owner = saved.definition.steps.find((step) => step.id === "a")!;
  expect(owner.attachments).toMatchObject([{ kind: "requirement", requirement: "Node 22" }]);
  expect(sentEdits().map((edit) => edit._tag)).toEqual(["stepPut"]);
  await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
  await userEvent.click(byLabel("Node 22 actions"));
  await userEvent.click(byLabel("Copy Node 22 to step"));
  await userEvent.click(page.getByRole("menuitem", { name: "Beta", exact: true }));
  const copy = saved.definition.steps.find((step) => step.id === "b")!.attachments?.[0];
  expect(copy).toMatchObject({ kind: "requirement", requirement: "Node 22" });
  expect(copy?.id).not.toBe(owner.attachments?.[0]?.id);
  await userEvent.click(byLabel("Node 22 actions"));
  await userEvent.click(page.getByRole("menuitem", { name: "Detach", exact: true }));
  expect(saved.definition.steps.find((step) => step.id === "a")!.attachments).toEqual([]);
  expect(saved.definition.steps.find((step) => step.id === "b")!.attachments).toHaveLength(1);
  expect(sentEdits().map((edit) => edit._tag)).toEqual(["stepPut", "stepPut", "stepPut"]);
});

it("adds a manual MCP requirement from the Needs menu through stepPut", async () => {
  using _state = setup();
  let saved = draftOf(threeSteps);
  state.workflows = [saved];
  state.command.mockImplementation(async ({ input }: { input: WorkflowEdit }) => {
    if (input._tag === "stepPut") {
      saved = {
        ...saved,
        definition: {
          ...saved.definition,
          steps: saved.definition.steps.map((step) =>
            step.id === input.step.id ? input.step : step,
          ),
        },
      };
      state.workflows = [saved];
      state.revision += 1;
      state.listeners.forEach((listener) => listener());
    }
    return { _tag: "Success", value: {} };
  });
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Open Alpha"));
  await click(byLabel("Add resource"));
  await userEvent.click(page.getByRole("menuitem", { name: "MCP connection", exact: true }));
  await userEvent.click(page.getByText("Enter a server name manually", { exact: true }));
  await userEvent.fill(byLabel("MCP server name"), "RevenueCat MCP");
  await click(button("Add MCP connection"));
  expect(saved.definition.steps.find((step) => step.id === "a")?.attachments).toMatchObject([
    { kind: "mcp-connection", server: "RevenueCat MCP" },
  ]);
  expect(sentEdits().map((edit) => edit._tag)).toEqual(["stepPut"]);
});

it("preselects the selected step as the header resource owner", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  state.command.mockResolvedValue({ _tag: "Success", value: {} });
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Open Alpha"));
  await click(byLabel("Add a step"));
  await click(bodyButton("Resources"));

  const owner = bodyByLabel("Attach resource to step") as HTMLSelectElement;
  expect(owner.value).toBe("a");
  await click(bodyButton("Requirements"));
  await userEvent.fill(bodyByLabel("Requirement"), "Node 22");
  await click(bodyButton("Add requirement"));
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "stepPut",
      step: expect.objectContaining({
        id: "a",
        attachments: [expect.objectContaining({ kind: "requirement", requirement: "Node 22" })],
      }),
    }),
  ]);
});

it("preselects the predecessor as the canvas insertion resource owner", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  state.command.mockResolvedValue({ _tag: "Success", value: {} });
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const connector = document.querySelectorAll<HTMLElement>('[aria-label="Insert a step here"]')[1];
  if (!connector) throw new Error("Canvas insertion connector after Alpha is missing");
  await click(connector);
  await click(bodyButton("Resources"));

  const owner = bodyByLabel("Attach resource to step") as HTMLSelectElement;
  expect(owner.value).toBe("a");
  await click(bodyButton("Requirements"));
  await userEvent.fill(bodyByLabel("Requirement"), "Node 22");
  await click(bodyButton("Add requirement"));
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "stepPut",
      step: expect.objectContaining({
        id: "a",
        attachments: [expect.objectContaining({ kind: "requirement", requirement: "Node 22" })],
      }),
    }),
  ]);
});

it("binds a missing credential by adding it from the card and saving", async () => {
  using _state = setup();
  const definition = {
    ...workflowRunFixture.definition,
    steps: [
      {
        id: "a",
        title: "Alpha",
        skill: "brief",
        attachments: [
          {
            id: "resource-1",
            kind: "credential" as const,
            templateId: "app-store-connect",
          },
        ],
      },
    ],
  };
  state.workflows = [
    {
      ...draftOf(definition.steps),
      definition,
      readiness: {
        entries: [
          {
            stepId: "a",
            attachmentId: "resource-1",
            kind: "credential" as const,
            status: "missing" as const,
            message: "Missing",
            credential: {
              state: "missing" as const,
              templateId: "app-store-connect",
              statusLabel: "Missing",
              envVars: [],
              candidates: [],
              optional: false,
            },
          },
        ],
        blocksRun: false,
        context: {
          threadId: starterRef.threadId,
          workspaceRoot: "/repo",
          model: { instanceId: "codex", model: "gpt-6-luna" },
          specification: workflowReadinessSpecification(definition),
        },
      },
    },
  ];
  state.command.mockResolvedValue({ _tag: "Success", value: {} });
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Add App Store Connect API key"));
  expect(document.body.textContent).toContain("add form for app-store-connect");
  await click(button("Save credential"));
  const edit = sentEdits()[0] as {
    _tag: string;
    step: { id: string; attachments: ReadonlyArray<Record<string, unknown>> };
  };
  expect(edit._tag).toBe("stepPut");
  expect(edit.step.id).toBe("a");
  expect(edit.step.attachments).toHaveLength(2);
  expect(edit.step.attachments.at(-1)).toMatchObject({
    kind: "credential",
    templateId: "app-store-connect",
    credentialId: "cred-appstore",
    label: "App Store Connect — Acme",
  });
});

it("shows a freshly attached credential's real state inside a thread whose workspace was never checked", async () => {
  using _state = setup();
  state.queryData = {
    credentials: [
      {
        id: "cred-appstore",
        name: "App Store Connect — Acme",
        templateId: "app-store-connect",
        fields: [
          {
            id: "key",
            label: "Key id",
            kind: "secret",
            envVar: "ASC_KEY_ID",
            required: true,
            highRisk: false,
            secret: { set: true },
          },
        ],
        policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        useCount: 0,
        status: "ready",
      },
    ],
  };
  state.workflows = [draftOf(threeSteps)];
  state.command.mockResolvedValue({ _tag: "Success", value: {} });
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Open Alpha"));
  await click(byLabel("Add a step"));
  await click(bodyButton("Resources"));
  await click(bodyButton("Credentials"));
  await userEvent.click(page.getByRole("checkbox", { name: "Attach App Store Connect — Acme" }));
  await click(bodyButton("Attach 1"));

  const attached = (
    sentEdits().find((entry) => entry._tag === "stepPut") as Extract<
      WorkflowEdit,
      { _tag: "stepPut" }
    >
  ).step;
  const attachment = attached.attachments!.find((entry) => entry.kind === "credential")!;
  const definition = { ...workflowRunFixture.definition, steps: [attached] };
  // What the server publishes next: readiness for the new attachment, read in the project root.
  state.workflows = [
    {
      ...draftOf([attached]),
      definition,
      readiness: {
        entries: [
          {
            stepId: "a",
            attachmentId: attachment.id,
            kind: "credential" as const,
            status: "available" as const,
            message: '"Alpha" uses "App Store Connect — Acme" (App Store Connect API key).',
            credential: {
              state: "ready" as const,
              templateId: "app-store-connect",
              statusLabel: "Ready",
              credentialId: CredentialId.make("cred-appstore"),
              name: "App Store Connect — Acme",
              envVars: [{ name: "ASC_KEY_ID", file: false }],
              candidates: [],
              optional: false,
            },
          },
        ],
        blocksRun: false,
        // The server reads a card in the project root; this panel sits in a thread's workspace.
        context: {
          workspaceRoot: "/repo",
          specification: workflowReadinessSpecification(definition),
        },
      },
    },
  ];
  await update();
  const card = screen.container.querySelector("[data-workflow-credential-card]");
  expect(card?.getAttribute("data-credential-state")).toBe("ready");
  expect(screen.container.textContent).not.toContain("Not checked");
  expect(screen.container.textContent).not.toContain("Credential vault unavailable");
});

it("attaches vault credentials from the Resources tab in one stepPut", async () => {
  using _state = setup();
  state.queryData = {
    credentials: [
      {
        id: "cred-appstore",
        name: "App Store Connect — Acme",
        templateId: "app-store-connect",
        fields: [
          {
            id: "key",
            label: "Key id",
            kind: "secret",
            envVar: "ASC_KEY_ID",
            required: true,
            highRisk: false,
            secret: { set: true },
          },
        ],
        policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        useCount: 0,
        status: "ready",
      },
    ],
  };
  state.workflows = [draftOf(threeSteps)];
  state.command.mockResolvedValue({ _tag: "Success", value: {} });
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Open Alpha"));
  await click(byLabel("Add a step"));
  await click(bodyButton("Resources"));
  await click(bodyButton("Credentials"));
  await userEvent.click(page.getByRole("checkbox", { name: "Attach App Store Connect — Acme" }));
  await click(bodyButton("Attach 1"));
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "stepPut",
      step: expect.objectContaining({
        id: "a",
        attachments: [
          expect.objectContaining({
            kind: "credential",
            templateId: "app-store-connect",
            credentialId: "cred-appstore",
            label: "App Store Connect — Acme",
          }),
        ],
      }),
    }),
  ]);
});

it("keeps resource controls unavailable without edit permission", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  state.allowed = false;
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await click(byLabel("Open Alpha"));
  expect((byLabel("Add resource") as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector('[aria-label="Add a resource"]')).toBeNull();
  expect(sentEdits()).toEqual([]);

  state.allowed = true;
  await update();
  expect((byLabel("Add resource") as HTMLButtonElement).disabled).toBe(false);
  const listing = state.workflows[0] as WorkflowListing;
  state.workflows = [
    {
      ...listing,
      definition: {
        ...listing.definition!,
        steps: listing.definition!.steps.map((step) =>
          step.id === "a"
            ? {
                ...step,
                attachments: Array.from({ length: 12 }, (_, index) => ({
                  id: `resource-${index}`,
                  kind: "requirement" as const,
                  requirement: `Requirement ${index + 1}`,
                })),
              }
            : step,
        ),
      },
    },
  ];
  await update();
  expect((byLabel("Add resource") as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector('[aria-label="Add a resource"]')).toBeNull();
  expect(document.body.textContent).toContain("already has the maximum of 12 resources");
  expect(sentEdits()).toEqual([]);
});

it("does not probe attached resources while rendering or selecting them", async () => {
  using _state = setup();
  const listing = draftOf(threeSteps);
  const definition = {
    ...listing.definition,
    version: 3 as const,
    steps: listing.definition.steps.map((step) =>
      step.id === "a"
        ? {
            ...step,
            attachments: [{ id: "node", kind: "requirement" as const, requirement: "Node 22" }],
          }
        : step,
    ),
  };
  state.workflows = [{ ...listing, definition }];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  expect(sentEdits()).toEqual([]);
  const resource = screen.container.querySelector<HTMLElement>("[data-workflow-resource-card]");
  expect(resource).not.toBeNull();
  await click(resource!);
  expect(sentEdits()).toEqual([]);
  expect(screen.container.textContent).toContain("Unknown");
  state.command.mockResolvedValue({
    _tag: "Success",
    value: {
      readiness: {
        entries: [
          {
            stepId: "a",
            attachmentId: "node",
            kind: "requirement",
            status: "available",
            message: "Node 22 is installed",
            checkedAt: "2026-10-21T12:00:00Z",
            workspaceRoot: "/repo",
          },
        ],
        blocksRun: false,
        evaluatedAt: "2026-10-21T12:00:00Z",
        context: {
          threadId: starterRef.threadId,
          workspaceRoot: "/repo",
          model: { instanceId: "codex", model: "gpt-6-luna" },
          specification: workflowReadinessSpecification(definition),
        },
      },
    },
  });
  await click(button("Check readiness"));
  expect(sentEdits()).toMatchObject([
    { _tag: "probe", contextThreadId: starterRef.threadId, stepIds: ["a"] },
  ]);
  await expect.element(resource!).toHaveTextContent("RequirementNode 22Available");
  expect(screen.container.textContent).toContain("Node 22 is installed");
  await click(button("Close"));
  await click(byLabel("Open Alpha"));
  await click(button("Check readiness"));
  expect(sentEdits()).toMatchObject([
    { _tag: "probe", contextThreadId: starterRef.threadId, stepIds: ["a"] },
    { _tag: "probe", contextThreadId: starterRef.threadId, stepIds: ["a"] },
  ]);
});

it("keeps readiness observations scoped to the thread that checked them", async () => {
  using _state = setup();
  const secondThread = ThreadId.make("second-thread");
  state.threadShells = [
    ...(state.threadShells as Array<Record<string, unknown>>),
    {
      environmentId: starterRef.environmentId,
      id: secondThread,
      projectId: workflowRunFixture.projectId,
      deletedAt: null,
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
    },
  ];
  const listing = draftOf(threeSteps);
  const definition = {
    ...listing.definition,
    version: 3 as const,
    steps: listing.definition.steps.map((step) =>
      step.id === "a"
        ? {
            ...step,
            attachments: [{ id: "node", kind: "requirement" as const, requirement: "Node 22" }],
          }
        : step,
    ),
  };
  state.workflows = [
    {
      ...listing,
      definition,
      readiness: {
        entries: [
          {
            stepId: "a",
            attachmentId: "node",
            kind: "requirement" as const,
            status: "available" as const,
            message: "Node is installed in the first workspace",
          },
        ],
        blocksRun: false,
        context: {
          threadId: starterRef.threadId,
          workspaceRoot: "/repo",
          model: { instanceId: "codex", model: "gpt-6-luna" },
          specification: workflowReadinessSpecification(definition),
        },
      },
    },
  ];
  state.command.mockResolvedValue({
    _tag: "Success",
    value: {
      readiness: {
        entries: [
          {
            stepId: "a",
            attachmentId: "node",
            kind: "requirement",
            status: "available",
            message: "Node is installed in the first workspace",
          },
        ],
        blocksRun: false,
        context: {
          threadId: starterRef.threadId,
          workspaceRoot: "/repo",
          model: { instanceId: "codex", model: "gpt-6-luna" },
          specification: workflowReadinessSpecification(definition),
        },
      },
    },
  });
  {
    await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
    const resource = screen.container.querySelector<HTMLElement>("[data-workflow-resource-card]")!;
    await click(resource);
    await click(button("Check readiness"));
    await expect.element(resource).toHaveTextContent("RequirementNode 22Available");
  }
  {
    const otherRef = scopeThreadRef(starterRef.environmentId, secondThread);
    state.workflows = [
      {
        ...(state.workflows[0] as ReturnType<typeof draftOf>),
        editedByThreadId: secondThread,
      },
    ];
    await using screen = await renderPanel(<WorkflowPanel threadRef={otherRef} />);
    const resource = screen.container.querySelector<HTMLElement>("[data-workflow-resource-card]")!;
    await click(resource);
    expect(screen.container.textContent).toContain("Unknown");
    expect(screen.container.textContent).not.toContain("first workspace");
  }
});

it("omits probe thread context on the standalone page without a known project chat", async () => {
  using _state = setup();
  const listing = draftOf(threeSteps);
  state.workflows = [
    {
      ...listing,
      editedByThreadId: ThreadId.make("deleted-or-unknown"),
      definition: {
        ...listing.definition,
        version: 3 as const,
        steps: listing.definition.steps.map((step) =>
          step.id === "a"
            ? {
                ...step,
                attachments: [{ id: "node", kind: "requirement" as const, requirement: "Node 22" }],
              }
            : step,
        ),
      },
    },
  ];
  await using screen = await renderPanel(
    <WorkflowProjectPanel
      environmentId={starterRef.environmentId}
      projectId={workflowRunFixture.projectId}
      workflow={listing.workflow}
    />,
  );
  const resource = screen.container.querySelector<HTMLElement>("[data-workflow-resource-card]")!;
  await click(resource);
  state.command.mockResolvedValue({
    _tag: "Success",
    value: {
      readiness: {
        entries: [
          {
            stepId: "a",
            attachmentId: "node",
            kind: "requirement",
            status: "available",
            message: "Node is installed in project root",
            workspaceRoot: "/repo",
          },
        ],
        blocksRun: false,
        context: {
          workspaceRoot: "/repo",
          specification: workflowReadinessSpecification(
            (state.workflows[0] as ReturnType<typeof draftOf>).definition!,
          ),
        },
      },
    },
  });
  await click(button("Check readiness"));
  expect(sentEdits()).toMatchObject([{ _tag: "probe", stepIds: ["a"] }]);
  expect(sentEdits()[0]).not.toHaveProperty("contextThreadId");
  await expect.element(resource).toHaveTextContent("RequirementNode 22Available");
  expect(screen.container.textContent).toContain("Node is installed in project root");
});

it("shows matching streamed MCP readiness without probing and rejects another model context", async () => {
  using _state = setup();
  const listing = draftOf(threeSteps);
  const definition = {
    ...listing.definition,
    version: 3 as const,
    steps: listing.definition.steps.map((step) =>
      step.id === "a"
        ? {
            ...step,
            attachments: [{ id: "mcp", kind: "mcp-connection" as const, server: "docs" }],
          }
        : step,
    ),
  };
  state.workflows = [
    {
      ...listing,
      definition,
      readiness: {
        entries: [
          {
            stepId: "a",
            attachmentId: "mcp",
            kind: "mcp-connection" as const,
            status: "unknown" as const,
            message: "The provider has not verified this connection",
          },
        ],
        blocksRun: false,
        context: {
          threadId: starterRef.threadId,
          workspaceRoot: "/repo",
          model: { instanceId: "codex", model: "gpt-6-luna" },
          specification: workflowReadinessSpecification(definition),
        },
      },
    },
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const resource = screen.container.querySelector<HTMLElement>("[data-workflow-resource-card]")!;
  await click(resource);
  expect(screen.container.textContent).toContain("The provider has not verified this connection");
  expect(sentEdits()).toEqual([]);

  state.workflows = [
    {
      ...(state.workflows[0] as ReturnType<typeof draftOf>),
      readiness: {
        ...(state.workflows[0] as WorkflowListing).readiness!,
        context: {
          threadId: starterRef.threadId,
          workspaceRoot: "/repo",
          model: { instanceId: "codex", model: "gpt-6-astra" },
          specification: workflowReadinessSpecification(definition),
        },
      },
    },
  ];
  state.revision += 1;
  state.listeners.forEach((listener) => listener());
  await vi.waitFor(() =>
    expect(screen.container.textContent).not.toContain(
      "The provider has not verified this connection",
    ),
  );
});

function persistExecutionEdits() {
  let saved = draftOf(threeSteps);
  state.workflows = [saved];
  state.command.mockImplementation(async ({ input }: { input: WorkflowEdit }) => {
    if (input._tag === "meta" && input.execution !== undefined) {
      const { execution: _execution, delegation: _delegation, ...definition } = saved.definition;
      saved = {
        ...saved,
        definition: {
          ...definition,
          ...(input.execution === null ? {} : { execution: input.execution }),
        },
      };
      state.workflows = [saved];
      state.revision += 1;
      state.listeners.forEach((listener) => listener());
    }
    return { _tag: "Success", value: {} };
  });
}
async function pickExecution(value: string) {
  if (document.querySelector('[aria-label="Run steps"]') === null) {
    await userEvent.click(byLabel("Workflow subagent settings"));
  }
  await userEvent.click(byLabel("Run steps"));
  await userEvent.click(page.getByRole("option", { name: value, exact: true }));
  await expect.poll(() => byLabel("Run steps").getAttribute("aria-expanded")).toBe("false");
}

it("keeps header and Start execution preferences in sync through saved snapshots and reopening", async () => {
  using _state = setup();
  persistExecutionEdits();
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const views = byLabel("Workflow panel view").getBoundingClientRect();
  const control = byLabel("Workflow subagent settings").getBoundingClientRect();
  expect(control.left).toBeGreaterThanOrEqual(views.right);
  expect(Math.abs(control.top + control.height / 2 - views.top - views.height / 2)).toBeLessThan(1);
  await pickExecution("Prefer subagents");
  expect(byLabel("Workflow subagent settings").textContent).toContain("Prefer subagents");
  await click(byLabel("Open workflow settings for Launch site"));
  expect(byLabel("Run steps").textContent).toContain("Prefer subagents");
  await pickExecution("Always subagents");
  expect(byLabel("Workflow subagent settings").textContent).toContain("Always subagents");
  expect(byLabel("Run steps").textContent).toContain("Always subagents");
  await click(byLabel("Close workflow editor"));
  await click(byLabel("Open workflow settings for Launch site"));
  expect(byLabel("Run steps").textContent).toContain("Always subagents");
  await pickExecution("Agent decides");
  expect(byLabel("Run steps").textContent).toContain("Agent decides");
  expect(sentEdits()).toContainEqual(expect.objectContaining({ _tag: "meta", execution: null }));
  await pickExecution("Prefer subagents");
  await screen.rerender(<></>);
  await screen.rerender(<WorkflowPanel threadRef={starterRef} />);
  expect(byLabel("Workflow subagent settings").textContent).toContain("Prefer subagents");
});

it("uses the saved execution setting for future runs without changing the pinned run", async () => {
  using _state = setup();
  persistExecutionEdits();
  const run = {
    ...workflowRunFixture,
    definition: { ...workflowRunFixture.definition, execution: "always-subagents" as const },
  };
  state.runs = [run];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  expect(byLabel("Workflow subagent settings").textContent).toContain("Always subagents");
  expect(screen.container.textContent).toContain("Next run");
  await click(byLabel("Open workflow settings for Launch site"));
  expect(byLabel("Run steps").textContent).toContain("Agent decides");
  await pickExecution("Prefer subagents");
  expect(byLabel("Run steps").textContent).toContain("Prefer subagents");
  expect(byLabel("Workflow subagent settings").textContent).toContain("Always subagents");
  expect(run.definition.execution).toBe("always-subagents");
});

it("keeps the saved preference and shows the error when saving execution fails", async () => {
  using _state = setup();
  persistExecutionEdits();
  state.command.mockResolvedValue({
    _tag: "Failure",
    cause: Cause.fail(new Error("Preference could not be saved")),
  });
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  const { container } = screen;
  await click(byLabel("Open workflow settings for Launch site"));
  await pickExecution("Prefer subagents");
  expect(container.querySelector('[aria-label="Workflow settings"]')).not.toBeNull();
  expect(container.textContent).toContain("Preference could not be saved");
  expect(byLabel("Run steps").textContent).toContain("Agent decides");
  expect(byLabel("Workflow subagent settings").textContent).toContain("Agent decides");
});

it("lets view-only users inspect execution preferences while keeping controls disabled", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  state.allowed = false;
  await using _screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  expect(byLabel("Workflow subagent settings").hasAttribute("disabled")).toBe(false);
  await click(byLabel("Workflow subagent settings"));
  expect(byLabel("Run steps").hasAttribute("disabled")).toBe(true);
  expect(document.body.textContent).toContain("Subagent models");
  expect(document.body.textContent).toContain("Agent decides");
  expect(sentEdits()).toEqual([]);
});

it("renders WorkflowProjectPanel in page mode with all project runs, Driven by header chip, and subagent-only step links", async () => {
  using _state = setup();
  state.workflows = [draftOf(workflowRunFixture.definition.steps)];
  state.runs = [workflowRunFixture];
  await using screen = await renderPanel(
    <WorkflowProjectPanel
      environmentId={starterRef.environmentId}
      projectId={workflowRunFixture.projectId}
      workflow="launch"
      projectName="Tiller"
    />,
  );
  expect(screen.container.textContent).toContain("Tiller");
  expect(screen.container.textContent).toContain("Driven by starter ↗");
  expect(screen.container.querySelector('[aria-label="Workflow panel view"]')).toBeNull();
  // "brief" ran in the driving chat ("starter"), so its card has no chat link;
  // "build" ran in its own subagent chat ("build-thread"), so only it links to a chat.
  expect(screen.container.querySelector('[aria-label="Open brief thread"]')).toBeNull();
  await click(button("Driven by starter ↗"));
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: "remote", threadId: "starter" },
  });
});

it("brings offscreen steps back with the pill, shortcut, and menu without interrupting note typing", async () => {
  using _state = setup();
  state.workflows = [draftOf(threeSteps)];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  const canvas = byLabel("Workflow canvas");
  const panAway = () =>
    act(() =>
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          deltaX: 10000,
          deltaY: 10000,
        }),
      ),
    );
  const back = screen.getByRole("button", { name: "Back to steps" });
  await panAway();
  await expect.element(back).toBeVisible();
  await back.click();
  await expect.element(back).not.toBeInTheDocument();

  await act(() => {
    byLabel("More workflow actions").focus();
    canvas.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
  await panAway();
  await userEvent.keyboard("{Shift>}1{/Shift}");
  await expect.element(back).toBeVisible();
  await act(() =>
    canvas.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    ),
  );
  await userEvent.keyboard("{Shift>}1{/Shift}");
  await expect.element(back).not.toBeInTheDocument();

  await click(byLabel("Open Alpha"));
  const note = screen.getByRole("textbox", { name: "Step note" });
  await note.click();
  await panAway();
  await userEvent.keyboard("{Shift>}1{/Shift}");
  await expect.element(note).toHaveValue("1");
  await expect.element(back).toBeVisible();
  await act(() => canvas.focus());
  await userEvent.keyboard("{Shift>}1{/Shift}");
  await expect.element(back).not.toBeInTheDocument();

  await panAway();
  await click(byLabel("More workflow actions"));
  await page.getByRole("menuitem", { name: "Fit steps" }).click();
  await expect.element(back).not.toBeInTheDocument();
});

it("keeps following the graph and fits the current viewport after resizing details", async () => {
  using _state = setup();
  const key = "t3code:workflow-inspector-height:thread";
  localStorage.removeItem(key);
  using _storage = {
    [Symbol.dispose]() {
      localStorage.removeItem(key);
    },
  };
  state.workflows = [draftOf(threeSteps)];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  screen.container.style.height = "900px";
  await click(byLabel("Open Alpha"));
  const separator = screen.getByRole("separator", { name: "Inspector height" });
  await expect.element(separator).toHaveAttribute("aria-orientation", "horizontal");
  await separator.click();
  await userEvent.keyboard("{End}");
  const canvas = byLabel("Workflow canvas");
  await vi.waitFor(() => expect(canvas.getBoundingClientRect().height).toBe(160));
  const layer = canvas.querySelector<HTMLElement>(".origin-top-left")!;
  // The drawer's last frame reaches layout a frame before the camera's ResizeObserver delivers it,
  // so the reference fit only exists once the camera has fitted the settled height.
  await vi.waitFor(() => expectFittedToSettledHeight(canvas, layer));
  const fitTransform = layer.style.transform;
  // Layout rounding can shift the fit by a fraction of a pixel between measurements.
  const expectSameFit = async (transform: string) => {
    const parts = (value: string) =>
      (value.match(/-?\d+(?:\.\d+)?/g) ?? []).map((part) => Number(part));
    const [fitX, fitY, fitScale] = parts(transform);
    await vi.waitFor(() => {
      const [x, y, scale] = parts(layer.style.transform);
      expect(x).toBeCloseTo(fitX!, 0);
      expect(y).toBeCloseTo(fitY!, 0);
      expect(scale).toBeCloseTo(fitScale!, 5);
    });
  };
  await act(() =>
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        deltaY: 10000,
      }),
    ),
  );
  await expect.element(screen.getByRole("button", { name: "Back to steps" })).toBeVisible();
  await screen.getByRole("button", { name: "Fit to view" }).click();
  await expect.element(separator).toBeVisible();
  await expectSameFit(fitTransform);
  await act(() =>
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        deltaY: 10000,
      }),
    ),
  );
  await screen.getByRole("button", { name: "More workflow actions" }).click();
  await expect.element(separator).toBeVisible();
  await page.getByRole("menuitem", { name: "Fit steps" }).click();
  await expect.element(separator).toBeVisible();
  await expectSameFit(fitTransform);
  await separator.click();
  await userEvent.keyboard("{Home}");
  await vi.waitFor(() => {
    expect(layer.style.transform).not.toBe(fitTransform);
    expect(canvas.getBoundingClientRect().height).toBeGreaterThan(160);
  });
  await expect
    .element(screen.getByRole("button", { name: "Back to steps" }))
    .not.toBeInTheDocument();
});

vi.mock("./WorkflowOutputPreviewButton", () => ({ WorkflowOutputPreviewButton: () => null }));

it("removes a reads arc without removing its steps", async () => {
  using _state = setup();
  state.workflows = [
    draftOf(
      threeSteps.map((step) => (step.id === "c" ? { ...step, readsFrom: ["b", "a"] } : step)),
    ),
  ];
  await using screen = await renderPanel(<WorkflowPanel threadRef={starterRef} />);
  await waitForCanvasFit();
  await click(byLabel("Remove Gamma reads Alpha"));
  expect(sentEdits()).toEqual([
    expect.objectContaining({
      _tag: "stepPut",
      step: expect.objectContaining({ id: "c", readsFrom: ["b"] }),
    }),
  ]);
  await expect
    .element(screen.getByRole("button", { name: "Open Beta", exact: true }))
    .toBeVisible();
});

/** A saved workflow in the test project, for the nested-workflow tests below. */
function savedWorkflow(workflow: string, definition: WorkflowDefinition) {
  return {
    projectId: workflowRunFixture.projectId,
    workflow,
    definition,
    scratch: false,
    problem: null,
    missingSkills: [],
    skills: [],
    blockers: [],
    updatedAt: "2026-10-19T12:00:00.000Z",
    editedByThreadId: null,
  };
}
const nestedLaunch: WorkflowDefinition = {
  version: 3,
  name: "Launch site",
  steps: [
    { id: "research", kind: "skill", skill: "research", title: "Research" },
    { id: "kit", kind: "workflow", workflow: "brand-kit", title: "Run brand kit" },
  ],
} as WorkflowDefinition;
const brandKit: WorkflowDefinition = {
  version: 3,
  name: "Brand Kit",
  steps: [
    { id: "palette", kind: "skill", skill: "design", title: "Palette" },
    { id: "logo", kind: "skill", skill: "logo-generator", title: "Logo" },
    { id: "page", kind: "skill", skill: "frontend-design", title: "Brand page" },
  ],
} as WorkflowDefinition;

it("expands a nested card into its steps and collapses it back", async () => {
  using _state = setup();
  state.workflows = [savedWorkflow("launch", nestedLaunch), savedWorkflow("brand-kit", brandKit)];
  await using screen = await renderPanel(
    <WorkflowProjectPanel
      environmentId={starterRef.environmentId}
      projectId={workflowRunFixture.projectId}
      workflow="launch"
    />,
  );
  const toggle = () =>
    screen.container.querySelector<HTMLElement>('[aria-label="Show steps of Run brand kit"]');
  expect(screen.container.querySelectorAll("[data-expanded-step]")).toHaveLength(0);
  await click(toggle()!);
  await vi.waitFor(() =>
    expect(screen.container.querySelectorAll("[data-expanded-step]")).toHaveLength(3),
  );
  expect(
    screen.container.querySelector('[aria-label="Hide steps of Run brand kit"]'),
  ).not.toBeNull();
  await click(
    screen.container.querySelector<HTMLElement>('[aria-label="Hide steps of Run brand kit"]')!,
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelectorAll("[data-expanded-step]")).toHaveLength(0),
  );
  expect(toggle()).not.toBeNull();
});

it("opens a nested workflow on double-click, shows the path back, and returns to the parent", async () => {
  using _state = setup();
  state.workflows = [savedWorkflow("launch", nestedLaunch), savedWorkflow("brand-kit", brandKit)];
  await using screen = await renderPanel(
    <WorkflowProjectPanel
      environmentId={starterRef.environmentId}
      projectId={workflowRunFixture.projectId}
      workflow="launch"
    />,
  );
  expect(screen.container.querySelector('nav[aria-label="Workflow path"]')).toBeNull();
  const card = screen.container.querySelector<HTMLElement>('[data-workflow-node$=":kit"]')!;
  await act(async () =>
    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelector('nav[aria-label="Workflow path"]')).not.toBeNull(),
  );
  const path = screen.container.querySelector('nav[aria-label="Workflow path"]')!;
  expect(path.textContent).toContain("Launch site");
  expect(path.textContent).toContain("Brand Kit");
  expect(screen.container.querySelector('[data-workflow-node$=":palette"]')).not.toBeNull();
  expect(screen.container.querySelector('[data-workflow-node$=":research"]')).toBeNull();
  await click(path.querySelector<HTMLElement>('[aria-label="Back to Launch site"]')!);
  await vi.waitFor(() =>
    expect(screen.container.querySelector('nav[aria-label="Workflow path"]')).toBeNull(),
  );
  expect(screen.container.querySelector('[data-workflow-node$=":research"]')).not.toBeNull();
});

it("switches a workflow to the outline and back, and remembers the choice when it reopens", async () => {
  using _state = setup();
  state.workflows = [savedWorkflow("launch", nestedLaunch), savedWorkflow("brand-kit", brandKit)];
  const panel = () => (
    <WorkflowProjectPanel
      environmentId={starterRef.environmentId}
      projectId={workflowRunFixture.projectId}
      workflow="launch"
    />
  );
  {
    await using screen = await renderPanel(panel());
    await click(button("Outline"));
    await vi.waitFor(() =>
      expect(
        screen.container.querySelector('[role="tree"][aria-label="Workflow steps"]'),
      ).not.toBeNull(),
    );
    expect(screen.container.querySelector('[data-workflow-node$=":research"]')).toBeNull();
    await click(button("Canvas"));
    await vi.waitFor(() => expect(screen.container.querySelector('[role="tree"]')).toBeNull());
    await click(button("Outline"));
  }
  await using reopened = await renderPanel(panel());
  await vi.waitFor(() =>
    expect(
      reopened.container.querySelector('[role="tree"][aria-label="Workflow steps"]'),
    ).not.toBeNull(),
  );
  await click(button("Canvas"));
});
