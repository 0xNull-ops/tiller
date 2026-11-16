vi.mock("./WorkflowCredentialApprovals", () => ({ WorkflowCredentialApprovals: () => null }));
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { act, render } from "../../test/render";

const state = vi.hoisted(() => ({
  edits: [] as Array<Record<string, unknown>>,
  skills: [] as Array<Record<string, unknown>>,
  skill: null as Record<string, unknown> | null,
  workflows: [] as Array<Record<string, unknown>>,
  workflowsPending: false,
  queries: [] as string[],
  mcpInventory: null as unknown,
  run: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: { _tag: string }) => {
    state.queries.push(query._tag);
    return {
      data:
        query._tag === "skills"
          ? { _tag: "skills", skills: state.skills }
          : query._tag === "mcpInventory"
            ? state.mcpInventory
            : state.skill
              ? { _tag: "skill", skill: state.skill }
              : null,
      isPending: false,
      isSuccess: true,
      error: null,
      refresh: state.refresh,
    };
  },
}));
vi.mock("./workflowState", () => ({
  useWorkflowEdit: () => ({
    canEdit: true,
    busy: false,
    error: null,
    clearError: vi.fn(),
    run: state.run,
  }),
  useWorkflowRuns: () => ({
    workflows: state.workflows,
    runs: [],
    isPending: state.workflowsPending,
    isSuccess: !state.workflowsPending,
    error: null,
    refresh: state.refresh,
  }),
  workflowRead: ({ input }: { input: { _tag: string } }) => input,
  workflowRunsLive: () => ({ _tag: "live" }),
}));
vi.mock("./WorkflowModelField", () => ({
  WorkflowModelField: () => <div aria-label="Workflow model" />,
}));
vi.mock("../assets/assetUrls", () => ({
  useAssetUrlState: () => ({ _tag: "Loading" }),
  useAssetUrlRefresh: () => async () => null,
}));

import { WorkflowMetaEditor } from "./WorkflowMetaEditor";
import { WorkflowResourceEditor } from "./WorkflowResourceEditor";
import { WorkflowSkillEditor } from "./WorkflowSkillEditor";
import { WorkflowStepEditor } from "./WorkflowStepEditor";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";

const environmentId = EnvironmentId.make("local");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("chat"));
const projectId = ProjectId.make("project-1");
const step = {
  id: "build",
  skill: "frontend-design",
  title: "Build",
  gate: false,
  readsFrom: [],
  checks: [],
} as const;
const listing = {
  projectId,
  workflow: "launch-site",
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-10-19T12:00:00.000Z",
  scratch: false,
  editedByThreadId: null,
  definition: {
    version: 1,
    name: "Launch site",
    steps: [step, { id: "review", skill: "review", title: "Review" }],
  },
} as const;
const withInputs = {
  ...listing,
  definition: {
    ...listing.definition,
    inputs: [{ id: "appName", label: "App name", kind: "text" as const }],
  },
};
const nestedStep = {
  id: "child",
  kind: "workflow",
  workflow: "",
  title: "Child",
} as const;
const workflowListing = (workflow: string, definition: Record<string, unknown>) => ({
  projectId,
  workflow,
  definition,
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-10-19T12:00:00.000Z",
  scratch: false,
  editedByThreadId: null,
});

function byLabel(label: string) {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No element labelled ${label}`);
  return element;
}
function maybeByLabel(label: string) {
  return document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}
function button(text: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!element) throw new Error(`No button containing ${text}`);
  return element;
}
function option(text: string) {
  const element = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!element) throw new Error(`No option containing ${text}`);
  return element;
}
function maybeOption(text: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function setup() {
  state.edits.length = 0;
  state.skills = [];
  state.skill = null;
  state.workflows = [];
  state.queries.length = 0;
  state.mcpInventory = null;
  state.workflowsPending = false;
  state.refresh.mockReset();
  state.run.mockReset().mockImplementation(async (edit: Record<string, unknown>) => {
    state.edits.push(edit);
    return {};
  });
}

it("writes one stepPut with the edited title on blur", async () => {
  setup();
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  const title = byLabel("Step title") as HTMLInputElement;
  await userEvent.click(title);
  await userEvent.fill(title, "Build the launch page");
  await userEvent.tab();
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "stepPut",
    step: { id: "build", title: "Build the launch page" },
  });
});

it("shows the note's value hint only as a quiet insert menu and saves the token", async () => {
  setup();
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  // Without declared inputs or a carry-over schedule there is nothing to insert.
  expect(maybeByLabel("Insert a value")).toBeNull();
  expect(document.body.textContent).not.toContain("to interpolate this workflow");
});

it("inserts a declared input token into the note from the value menu", async () => {
  setup();
  state.edits.length = 0;
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={withInputs}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  const note = byLabel("Step note") as HTMLTextAreaElement;
  await userEvent.click(note);
  await userEvent.fill(note, "Ship ");
  await userEvent.click(byLabel("Insert a value"));
  await userEvent.click(page.getByRole("menuitem", { name: /appName/ }));
  await expect.element(note).toHaveValue("Ship {{input.appName}}");
  await userEvent.tab();
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { id: "build", note: "Ship {{input.appName}}" },
  });
});

it("adds a selected live MCP connection to the step definition", async () => {
  setup();
  state.mcpInventory = {
    _tag: "mcpInventory",
    inventory: {
      status: "available",
      message: "Provider reported MCP connections.",
      scope: {
        providerInstanceId: "codex",
        providerLabel: "Codex",
        model: { instanceId: "codex", model: "gpt-6-luna" },
        modelScoped: false,
        workspaceRoot: "/repo",
        threadId: threadRef.threadId,
      },
      servers: [
        {
          name: "linear",
          title: "Linear",
          description: "Issue tracker",
          status: "connected",
          auth: "signed-in",
          toolsStatus: "available",
          tools: [{ name: "create_issue", description: "Create an issue." }],
        },
      ],
      cached: true,
      stale: false,
      excludedInternal: 0,
      limitations: [],
    },
  };
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn<() => void>()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await userEvent.click(byLabel("Add resource"));
  await userEvent.click(page.getByRole("menuitem", { name: "MCP connection", exact: true }));
  await userEvent.click(button("Choose a configured MCP server"));
  const linear = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes("Linear"),
  );
  if (!linear) throw new Error("No MCP server row for Linear");
  await userEvent.click(linear);
  await userEvent.click(button("Add MCP connection"));
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "stepPut",
    step: {
      id: "build",
      attachments: [
        {
          kind: "mcp-connection",
          server: "linear",
          providerInstanceId: "codex",
        },
      ],
    },
  });
  expect(button("Add MCP connection")).toBeDisabled();
  await userEvent.click(button("Choose a configured MCP server"));
  const reselectLinear = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes("Linear"),
  );
  if (!reselectLinear) throw new Error("No MCP server row for Linear after adding the first one");
  await userEvent.click(reselectLinear);
  await userEvent.click(button("Add MCP connection"));
  expect(state.edits).toHaveLength(2);
  expect(state.edits[1]).toMatchObject({
    _tag: "stepPut",
    step: {
      attachments: [
        {
          kind: "mcp-connection",
          server: "linear",
          providerInstanceId: "codex",
        },
      ],
    },
  });
});

it("clears an unsaved MCP choice when the effective model changes", async () => {
  setup();
  const providerInstanceId = ProviderInstanceId.make("codex");
  const modelA = { instanceId: providerInstanceId, model: "gpt-6-luna" };
  const modelB = { instanceId: providerInstanceId, model: "another-model" };
  const modelStepA = { ...step, model: modelA };
  const modelStepB = { ...step, model: modelB };
  state.mcpInventory = {
    _tag: "mcpInventory",
    inventory: {
      status: "available",
      message: "Provider reported MCP connections.",
      scope: {
        providerInstanceId,
        providerLabel: "Codex",
        model: modelA,
        modelScoped: true,
        workspaceRoot: "/repo",
        threadId: threadRef.threadId,
      },
      servers: [
        {
          name: "linear",
          title: "Linear",
          description: "Issue tracker",
          status: "connected",
          auth: "signed-in",
          toolsStatus: "available",
          tools: [],
        },
      ],
      cached: true,
      stale: false,
      excludedInternal: 0,
      limitations: [],
    },
  };
  await using screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={modelStepA}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await userEvent.click(byLabel("Add resource"));
  await userEvent.click(page.getByRole("menuitem", { name: "MCP connection", exact: true }));
  await userEvent.click(button("Choose a configured MCP server"));
  const linear = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes("Linear"),
  );
  if (!linear) throw new Error("No MCP server row for Linear");
  await userEvent.click(linear);
  await screen.rerender(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={modelStepB}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await userEvent.click(byLabel("Add resource"));
  await userEvent.click(page.getByRole("menuitem", { name: "MCP connection", exact: true }));
  expect(button("Add MCP connection")).toBeDisabled();
  expect(screen.container.textContent).not.toContain("Linear");
  expect(state.edits).toHaveLength(0);
});

it("drops the saved provider binding when the MCP server name is edited manually", async () => {
  setup();
  await using _screen = await render(
    <WorkflowResourceEditor
      environmentId={environmentId}
      listing={listing}
      owner={{
        ...step,
        attachments: [
          {
            id: "mcp-linear",
            kind: "mcp-connection",
            server: "linear",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
        ],
      }}
      attachment={{
        id: "mcp-linear",
        kind: "mcp-connection",
        server: "linear",
        providerInstanceId: ProviderInstanceId.make("codex"),
      }}
      editMode
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  await userEvent.click(document.querySelector("summary")!);
  const name = document.querySelector<HTMLInputElement>('[aria-label="MCP server name"]');
  if (!name) throw new Error("No manual MCP server field");
  await userEvent.fill(name, "linear-custom");
  await userEvent.click(button("Save resource"));
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "stepPut",
    step: {
      attachments: [{ id: "mcp-linear", kind: "mcp-connection", server: "linear-custom" }],
    },
  });
  expect(JSON.stringify(state.edits[0])).not.toContain("providerInstanceId");
});

it("saves the gate toggle immediately", async () => {
  setup();
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await click(byLabel("Wait for approval before this step"));
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({ _tag: "stepPut", step: { id: "build", gate: true } });
});

it("confirms before clearing a multi-check group", async () => {
  setup();
  const checkedStep = {
    ...step,
    checks: [
      { kind: "command" as const, command: "pnpm build" },
      { kind: "file" as const, path: "dist/index.html" },
    ],
  };
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={{
        ...listing,
        definition: { ...listing.definition, steps: [checkedStep, listing.definition.steps[1]!] },
      }}
      step={checkedStep}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await click(button("Remove checks"));
  expect(document.body.textContent).toContain("Remove all 2 checks?");
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-slot="alert-dialog-popup"] button'),
  ].find((item) => item.textContent?.includes("Remove checks"));
  if (!confirm) throw new Error("No confirm checks button in alert dialog");
  await click(confirm);
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "stepPut",
    step: { id: "build", checks: undefined },
  });
});

it("sets and clears the per-step delegation override", async () => {
  setup();
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await click(byLabel("Run this step"));
  await click(option("Subagent"));
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { id: "build", delegation: "subagent" },
  });

  await click(byLabel("Run this step"));
  await click(option("Workflow default"));
  expect(state.edits.at(-1)).toMatchObject({ _tag: "stepPut", step: { id: "build" } });
  const resetEdit = state.edits.at(-1);
  if (!resetEdit) throw new Error("The reset edit was not sent");
  expect((resetEdit.step as Record<string, unknown>).delegation).toBeUndefined();
});

it("sets workflow delegation and sends null for Agent decides", async () => {
  setup();
  await using _screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={listing}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  await click(byLabel("Run steps"));
  await click(option("Prefer subagents"));
  expect(state.edits.at(-1)).toMatchObject({ _tag: "meta", execution: "prefer-subagents" });

  await click(byLabel("Run steps"));
  await click(option("Agent decides"));
  expect(state.edits.at(-1)).toMatchObject({ _tag: "meta", execution: null });
});

it("confirms before removing a step", async () => {
  setup();
  const onClose = vi.fn();
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={onClose}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await userEvent.click(byLabel("Step actions"));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete step", exact: true }));
  expect(state.edits).toHaveLength(0);
  expect(document.body.textContent).toContain("It will detach 1 dependent step: Review.");
  const dialogDelete = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-slot="alert-dialog-popup"] button'),
  ].find((item) => item.textContent?.includes("Delete step"));
  if (!dialogDelete) throw new Error("No confirm delete button in alert dialog");
  await click(dialogDelete);
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({ _tag: "stepRemove", stepId: "build" });
  expect(onClose).toHaveBeenCalledOnce();
});

it("lists project skills before global skills and saves the selected skill", async () => {
  setup();
  state.skills = [
    {
      name: "global-helper",
      description: "Shared helper",
      scope: "global",
      path: "/global/SKILL.md",
      requires: [],
    },
    {
      name: "project-helper",
      description: "Project helper",
      scope: "project",
      path: "/project/SKILL.md",
      requires: [],
    },
  ];
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await click(button("Change"));
  const projectRow = button("project-helper");
  const globalRow = button("global-helper");
  expect(
    [...document.querySelectorAll("h3")].find((item) => item.textContent === "This project"),
  ).toBeTruthy();
  expect(document.body.textContent!.indexOf("This project")).toBeLessThan(
    document.body.textContent!.indexOf("Global"),
  );
  await click(projectRow);
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "stepPut",
    step: { id: "build", skill: "project-helper" },
  });
  expect(globalRow).toBeTruthy();
});

it("shows global skill scope and copies the skill into the project", async () => {
  setup();
  state.skill = {
    name: "global-helper",
    description: "Shared",
    scope: "global",
    path: "/home/.agents/skills/global-helper/SKILL.md",
    requires: [],
    text: "# Shared",
  };
  await using _screen = await render(
    <WorkflowSkillEditor
      environmentId={environmentId}
      projectId={projectId}
      name="global-helper"
      onClose={vi.fn()}
    />,
  );
  expect(document.body.textContent).toContain(
    "Editing a global skill changes it for every project.",
  );
  await click(button("Make a project copy"));
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toEqual({ _tag: "skillCopyToProject", projectId, name: "global-helper" });
  expect(state.refresh).toHaveBeenCalledOnce();
});

it("clears a workflow brief with a meta edit", async () => {
  setup();
  const onDeleted = vi.fn();
  const withBrief = {
    ...listing,
    definition: { ...listing.definition, brief: "Build an excellent launch site" },
  };
  await using _screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={withBrief}
      onClose={vi.fn()}
      onDeleted={onDeleted}
    />,
  );
  const brief = byLabel("Workflow brief") as HTMLTextAreaElement;
  await userEvent.click(brief);
  await userEvent.fill(brief, "");
  await userEvent.tab();
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({ _tag: "meta", brief: null });
});

it("saves the declared inputs once a field loses focus, and keeps a row without a label local", async () => {
  setup();
  await using _screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={withInputs}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  const label = byLabel("Input 1 label") as HTMLInputElement;
  await userEvent.click(label);
  await userEvent.fill(label, "");
  await userEvent.tab();
  expect(state.edits).toHaveLength(0);
  expect(document.body.textContent).toContain("needs a label");

  await userEvent.click(label);
  await userEvent.fill(label, "Product name");
  await userEvent.tab();
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "inputsSet",
    inputs: [{ id: "appName", label: "Product name", kind: "text" }],
  });
});

it("edits and clears an input default while preserving it through other input edits", async () => {
  setup();
  await using _screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={{
        ...withInputs,
        definition: {
          ...withInputs.definition,
          inputs: [{ ...withInputs.definition.inputs[0]!, defaultValue: "Tiller" }],
        },
      }}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Input 1 default" }))
    .toHaveValue("Tiller");
  await userEvent.fill(byLabel("Input 1 label"), "Product name");
  await userEvent.tab();
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "inputsSet",
    inputs: [{ label: "Product name", defaultValue: "Tiller" }],
  });

  await userEvent.fill(byLabel("Input 1 default"), "New product");
  await userEvent.tab();
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "inputsSet",
    inputs: [{ defaultValue: "New product" }],
  });

  await userEvent.fill(byLabel("Input 1 default"), "");
  await userEvent.tab();
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "inputsSet",
    inputs: [{ id: "appName", label: "Product name", kind: "text" }],
  });
  const clearedEdit = state.edits.at(-1);
  if (!clearedEdit) throw new Error("The cleared default was not saved");
  expect((clearedEdit.inputs as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
    "defaultValue",
  );
});

it("keeps invalid URL defaults local until they become http(s) URLs", async () => {
  setup();
  await using _screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={{
        ...withInputs,
        definition: {
          ...withInputs.definition,
          inputs: [{ id: "site", label: "Site", kind: "url" }],
        },
      }}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  await userEvent.fill(byLabel("Input 1 default"), "file:///repo/site");
  await userEvent.tab();
  expect(state.edits).toHaveLength(0);
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Site needs an http(s) URL as its default.");

  await userEvent.fill(byLabel("Input 1 default"), "https://example.com");
  await userEvent.tab();
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "inputsSet",
    inputs: [{ id: "site", defaultValue: "https://example.com" }],
  });
});

it("marks a declared input as required and saves the list", async () => {
  setup();
  await using _screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={withInputs}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  await click(byLabel("Required for input 1"));
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "inputsSet",
    inputs: [{ id: "appName", label: "App name", kind: "text", required: true }],
  });
});

it("adds an input with an id no other input uses", async () => {
  setup();
  await using _screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={withInputs}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  await click(button("Add input"));
  expect(state.edits).toHaveLength(1);
  expect(state.edits[0]).toMatchObject({
    _tag: "inputsSet",
    inputs: [
      { id: "appName", label: "App name", kind: "text" },
      { id: "input2", label: "Input 2", kind: "text" },
    ],
  });
});

it("picks a child workflow and maps the inputs that child declares", async () => {
  setup();
  state.workflows = [
    workflowListing("launch-site", { version: 2, name: "Launch site", steps: [] }),
    workflowListing("child-flow", {
      version: 2,
      name: "Child flow",
      steps: [],
      inputs: [
        { id: "appName", label: "App name", kind: "text", required: true },
        { id: "notes", label: "Notes", kind: "multiline" },
      ],
    }),
  ];
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={withInputs}
      step={nestedStep}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await click(byLabel("Nested workflow"));
  await click(option("Child flow"));
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { workflow: "child-flow", inputs: {} },
  });

  const editsAfterPick = state.edits.length;
  const mapping = byLabel("Mapping for appName") as HTMLInputElement;
  await userEvent.click(mapping);
  await userEvent.fill(mapping, "{{input.appName}}");
  const notes = byLabel("Mapping for notes") as HTMLTextAreaElement;
  expect(notes.tagName).toBe("TEXTAREA");
  await userEvent.click(notes);
  await userEvent.fill(notes, "extra detail");
  await userEvent.tab();
  // One save per field that loses focus, never one per keystroke.
  expect(state.edits).toHaveLength(editsAfterPick + 2);
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { inputs: { appName: "{{input.appName}}", notes: "extra detail" } },
  });
  expect(document.body.textContent).toContain("required");
});

it("shows the last run outputs and opens an artifact in the file panel", async () => {
  setup();
  await using screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={{
        stepId: "build",
        status: "done",
        threadId: ThreadId.make("worker"),
        attempts: 1,
        outputs: { artifact: "out/mascot.html" },
      }}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  const row = screen.container.querySelector<HTMLElement>('[data-workflow-output="artifact"]');
  expect(row?.textContent).toContain("out/mascot.html");
  const open = row?.querySelector<HTMLButtonElement>("button");
  if (!open) throw new Error("The artifact has no open action");
  await click(open);
  const surfaces = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  ).surfaces;
  expect(
    surfaces.some(
      (surface) => surface.kind === "file" && surface.relativePath === "out/mascot.html",
    ),
  ).toBe(true);
});

it("hides the current workflow and every workflow that runs back into it", async () => {
  setup();
  state.workflows = [
    workflowListing("launch-site", { version: 2, name: "Launch site", steps: [] }),
    workflowListing("direct-child", {
      version: 2,
      name: "Direct child",
      steps: [{ id: "back", kind: "workflow", workflow: "launch-site" }],
    }),
    workflowListing("transitive-child", {
      version: 2,
      name: "Transitive child",
      steps: [{ id: "direct", kind: "workflow", workflow: "direct-child" }],
    }),
    workflowListing("safe-child", {
      version: 2,
      name: "Safe child",
      steps: [{ id: "capture", skill: "capture" }],
    }),
  ];
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={nestedStep}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await click(byLabel("Nested workflow"));
  expect(maybeOption("Safe child")).toBeTruthy();
  expect(maybeOption("Launch site")).toBeUndefined();
  expect(maybeOption("Direct child")).toBeUndefined();
  expect(maybeOption("Transitive child")).toBeUndefined();
});

it("maps the new child's own inputs and drops the old mapping when the reference changes", async () => {
  setup();
  state.workflows = [
    workflowListing("child-one", {
      version: 2,
      name: "Child one",
      steps: [],
      inputs: [{ id: "appName", label: "App name", kind: "text" }],
    }),
    workflowListing("child-two", {
      version: 2,
      name: "Child two",
      steps: [],
      inputs: [{ id: "targetUrl", label: "Target URL", kind: "url" }],
    }),
  ];
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={{ ...nestedStep, workflow: "child-one" }}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  const mapping = byLabel("Mapping for appName") as HTMLInputElement;
  await userEvent.click(mapping);
  await userEvent.fill(mapping, "{{input.appName}}");
  await userEvent.tab();
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { inputs: { appName: "{{input.appName}}" } },
  });

  await click(byLabel("Nested workflow"));
  await click(option("Child two"));
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { workflow: "child-two", inputs: {} },
  });
  expect(maybeByLabel("Mapping for appName")).toBeNull();
  expect(byLabel("Mapping for targetUrl")).toBeTruthy();
});

it("keeps an unavailable reference on screen without offering it as a choice", async () => {
  setup();
  state.workflows = [workflowListing("other-flow", { version: 2, name: "Other flow", steps: [] })];
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={{ ...nestedStep, workflow: "gone-flow" }}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  expect(byLabel("Nested workflow").textContent).toContain("gone-flow");
  expect(document.body.textContent).toContain("isn’t in this project any more");
  expect(document.body.textContent).toContain("Pick another one.");
  expect(document.body.textContent).not.toContain("takes no inputs");
  await click(byLabel("Nested workflow"));
  expect(option("gone-flow").getAttribute("aria-disabled")).toBe("true");
  expect(maybeOption("Other flow")).toBeTruthy();
});

it("doesn't load skills for a workflow step", async () => {
  setup();
  state.workflows = [workflowListing("child-flow", { version: 2, name: "Child flow", steps: [] })];
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={nestedStep}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  expect(state.queries).not.toContain("skills");
  expect(document.querySelector('[aria-label="Skill"]')).toBeNull();
});

it("retains exact mapping values and lets a failed save be retried", async () => {
  setup();
  state.workflows = [
    workflowListing("child-one", {
      version: 2,
      name: "Child one",
      steps: [],
      inputs: [{ id: "notes", label: "Notes", kind: "multiline" }],
    }),
    workflowListing("child-two", { version: 2, name: "Child two", steps: [] }),
  ];
  await using _screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={{ ...nestedStep, workflow: "child-one" }}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  const notes = byLabel("Mapping for notes") as HTMLTextAreaElement;
  const value = "  First line\nSecond line  ";
  await userEvent.fill(notes, value);
  state.run.mockResolvedValueOnce(null);
  await userEvent.tab();
  expect(notes.value).toBe(value);
  expect(state.run).toHaveBeenCalledTimes(1);
  await userEvent.click(notes);
  await userEvent.tab();
  expect(state.run).toHaveBeenCalledTimes(2);
  expect(state.edits.at(-1)).toMatchObject({ step: { inputs: { notes: value } } });
  state.run.mockResolvedValueOnce(null);
  await click(byLabel("Nested workflow"));
  await click(option("Child two"));
  expect(byLabel("Nested workflow").textContent).toContain("Child one");
  expect((byLabel("Mapping for notes") as HTMLTextAreaElement).value).toBe(value);
  await userEvent.fill(byLabel("Mapping for notes"), "Retry after refused reference");
  await userEvent.tab();
  expect(state.edits.at(-1)).toMatchObject({
    step: { workflow: "child-one", inputs: { notes: "Retry after refused reference" } },
  });
});

it("opens resource forms only after choosing a type and cancels without saving", async () => {
  setup();
  await using screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await expect
    .element(screen.getByRole("textbox", { name: "Requirement", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add resource", exact: true }));
  await expect
    .element(screen.getByRole("textbox", { name: "Requirement", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(page.getByRole("menuitem", { name: "Requirement", exact: true }));
  await expect
    .element(screen.getByRole("textbox", { name: "Requirement", exact: true }))
    .toHaveFocus();
  await userEvent.fill(
    screen.getByRole("textbox", { name: "Requirement", exact: true }),
    "Node 22",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  await expect
    .element(screen.getByRole("textbox", { name: "Requirement", exact: true }))
    .not.toBeInTheDocument();
  expect(state.edits).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Add resource", exact: true }));
  await userEvent.click(page.getByRole("menuitem", { name: "Service login", exact: true }));
  await expect.element(screen.getByRole("textbox", { name: "Service", exact: true })).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(state.edits).toHaveLength(0);
});

it("opens workflow deletion from its menu and allows cancelling", async () => {
  setup();
  const onDeleted = vi.fn();
  await using screen = await render(
    <WorkflowMetaEditor
      environmentId={environmentId}
      projectId={projectId}
      listing={listing}
      onClose={vi.fn()}
      onDeleted={onDeleted}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Workflow actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete workflow", exact: true }));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  expect(state.edits).toHaveLength(0);
  await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
  expect(state.edits).toHaveLength(0);
  expect(onDeleted).not.toHaveBeenCalled();
});

vi.mock("./WorkflowOutputPreviewButton", () => ({ WorkflowOutputPreviewButton: () => null }));

it("writes delay, until, and none through the wait control", async () => {
  setup();
  await using screen = await render(
    <WorkflowStepEditor
      threadRef={threadRef}
      projectId={projectId}
      listing={listing}
      step={step}
      lastRunState={null}
      onClose={vi.fn()}
      onOpenWorkflow={vi.fn()}
    />,
  );
  await click(button("Wait: None"));
  await click(button("Delay"));
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { waitBefore: { kind: "delay", minutes: 15 } },
  });
  await act(() =>
    screen.rerender(
      <WorkflowStepEditor
        threadRef={threadRef}
        projectId={projectId}
        listing={listing}
        step={{ ...step, waitBefore: { kind: "delay", minutes: 15 } }}
        lastRunState={null}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
      />,
    ),
  );
  await click(button("Until"));
  expect(state.edits.at(-1)).toMatchObject({
    _tag: "stepPut",
    step: { waitBefore: { kind: "until", timeOfDay: "09:00" } },
  });
  await act(() =>
    screen.rerender(
      <WorkflowStepEditor
        threadRef={threadRef}
        projectId={projectId}
        listing={listing}
        step={{ ...step, waitBefore: { kind: "until", timeOfDay: "09:00" } }}
        lastRunState={null}
        onClose={vi.fn()}
        onOpenWorkflow={vi.fn()}
      />,
    ),
  );
  await click(button("None"));
  expect(state.edits.at(-1)).toMatchObject({ _tag: "stepPut", step: { waitBefore: undefined } });
});
