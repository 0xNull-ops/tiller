import {
  EnvironmentId,
  ProjectId,
  type WorkflowListing,
  type WorkflowStep,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";

const state = vi.hoisted(() => ({
  skills: [] as Array<Record<string, unknown>>,
  resourceEdit: vi.fn(),
  inventory: null as Record<string, unknown> | null,
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: { _tag?: string; input?: { _tag: string } } = {}) =>
    (query.input?._tag ?? query._tag) === "mcpInventory"
      ? { data: state.inventory, isPending: false }
      : { data: { _tag: "skills", skills: state.skills }, isPending: false },
}));
vi.mock("./workflowState", () => ({
  useWorkflowEdit: () => ({ canEdit: true, busy: false, error: null, run: state.resourceEdit }),
  workflowRead: ({ input }: { input: { _tag: string } }) => input,
  workflowRunsLive: () => ({ _tag: "live" }),
  editWorkflow: { permissionAtom: () => ({}) },
}));

import { WorkflowStepPicker } from "./WorkflowStepPicker";

const credentialCallbacks = {
  onAttachCredentials: () => {},
  onNewCredential: () => {},
  onOpenCredential: () => {},
  onManageCredentials: () => {},
};

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-1");
const listing = (
  workflow: string,
  name: string,
  steps: ReadonlyArray<WorkflowStep> = [],
): WorkflowListing => ({
  projectId,
  workflow,
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-10-19T12:00:00.000Z",
  scratch: false,
  editedByThreadId: null,
  definition: { version: 2, name, steps },
});

const onPick = vi.fn();
const onResourceAdd = vi.fn();
function setup() {
  onPick.mockReset();
  onResourceAdd.mockReset();
  state.resourceEdit.mockReset().mockResolvedValue({});
  state.skills = [{ name: "project-skill", description: "A project skill", scope: "project" }];
  state.inventory = {
    _tag: "mcpInventory",
    inventory: {
      status: "available",
      message: "Provider reported MCP connections.",
      scope: {
        providerLabel: "Codex",
        modelScoped: false,
        workspaceRoot: "/repo",
        source: "configured",
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
}
function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!found) throw new Error(`No button containing ${text}`);
  return found;
}
function visible(text: string) {
  return [...document.querySelectorAll<HTMLElement>("button")].find((item) =>
    item.textContent?.includes(text),
  );
}
async function click(element: HTMLElement) {
  await userEvent.click(element);
}
function picker() {
  return (
    <WorkflowStepPicker
      environmentId={environmentId}
      projectId={projectId}
      workflow="current"
      workflows={[
        listing("current", "Current workflow"),
        listing("direct-loop", "Direct loop", [
          { id: "back", kind: "workflow", workflow: "current" },
        ]),
        listing("transitive-loop", "Transitive loop", [
          { id: "direct", kind: "workflow", workflow: "direct-loop" },
        ]),
        listing("safe", "Safe workflow"),
        listing("another", "Another safe workflow"),
      ]}
      onPick={onPick}
    >
      <button type="button">Add step</button>
    </WorkflowStepPicker>
  );
}

it("opens, filters safe workflows, searches, selects, and resets when reopened", async () => {
  setup();
  await using _screen = await render(picker());
  await click(button("Add step"));
  expect(button("Skills")).toBeTruthy();
  expect(button("Workflows")).toBeTruthy();
  await click(button("Workflows"));
  expect(visible("Safe workflow")).toBeTruthy();
  expect(visible("Another safe workflow")).toBeTruthy();
  expect(visible("Current workflow")).toBeUndefined();
  expect(visible("Direct loop")).toBeUndefined();
  expect(visible("Transitive loop")).toBeUndefined();

  const search = document.querySelector<HTMLInputElement>('[aria-label="Search workflows"]');
  if (!search) throw new Error("Workflow search input is missing");
  await userEvent.fill(search, "another");
  expect(visible("Another safe workflow")).toBeTruthy();
  expect(visible("Safe workflow")).toBeUndefined();
  await click(button("Another safe workflow"));
  expect(onPick).toHaveBeenCalledExactlyOnceWith({
    kind: "workflow",
    workflow: "another",
    name: "Another safe workflow",
  });
  expect(document.querySelector('[aria-label="Search workflows"]')).toBeNull();

  await click(button("Add step"));
  expect(document.querySelector('[aria-label="Search skills"]')).toBeTruthy();
  expect(visible("project-skill")).toBeTruthy();
  await click(button("Workflows"));
  const reopenedSearch = document.querySelector<HTMLInputElement>(
    '[aria-label="Search workflows"]',
  );
  if (!reopenedSearch) throw new Error("Workflow search input did not reopen");
  expect(reopenedSearch.value).toBe("");
  expect(visible("Safe workflow")).toBeTruthy();
});
it("keeps skill selection available from the Skills tab", async () => {
  setup();
  await using _screen = await render(picker());
  await click(button("Add step"));
  await click(button("project-skill"));
  expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: "skill", skill: "project-skill" });
  expect(document.querySelector('[aria-label="Search skills"]')).toBeNull();
});

it("adds a requirement to the explicitly selected owner without inserting a step", async () => {
  setup();
  const owner: WorkflowStep = {
    id: "build",
    kind: "skill",
    skill: "project-skill",
    title: "Build",
  };
  await using _screen = await render(
    <WorkflowStepPicker
      environmentId={environmentId}
      projectId={projectId}
      workflow="current"
      workflows={[]}
      onPick={onPick}
      resources={{
        listing: listing("current", "Current workflow", [owner]),
        owners: [owner],
        disabled: false,
        onAdd: onResourceAdd,
        ...credentialCallbacks,
      }}
    >
      <button type="button">Add step</button>
    </WorkflowStepPicker>,
  );
  await click(button("Add step"));
  await click(button("Resources"));
  await click(button("Requirements"));
  const requirement = document.querySelector<HTMLInputElement>('[aria-label="Requirement"]');
  if (!requirement) throw new Error("Requirement input is missing");
  await userEvent.fill(requirement, "Node 22");
  await click(button("Add requirement"));
  expect(onResourceAdd).toHaveBeenCalledExactlyOnceWith(
    owner,
    expect.objectContaining({ kind: "requirement", requirement: "Node 22" }),
  );
  expect(onPick).not.toHaveBeenCalled();
});

it("adds a service login with its instructions to the selected owner", async () => {
  setup();
  const owner: WorkflowStep = {
    id: "deploy",
    kind: "skill",
    skill: "project-skill",
    title: "Deploy",
  };
  await using _screen = await render(
    <WorkflowStepPicker
      environmentId={environmentId}
      projectId={projectId}
      workflow="current"
      workflows={[]}
      onPick={onPick}
      resources={{
        listing: listing("current", "Current workflow", [owner]),
        owners: [owner],
        disabled: false,
        onAdd: onResourceAdd,
        ...credentialCallbacks,
      }}
    >
      <button type="button">Add step</button>
    </WorkflowStepPicker>,
  );
  await click(button("Add step"));
  await click(button("Resources"));
  await click(button("Service logins"));
  const service = document.querySelector<HTMLInputElement>('[aria-label="Service"]');
  const status = document.querySelector<HTMLInputElement>('[aria-label="Service status command"]');
  if (!service || !status) throw new Error("Service login fields are missing");
  await userEvent.fill(service, "Vercel");
  await userEvent.fill(status, "vercel whoami");
  await click(button("Add service login"));
  expect(onResourceAdd).toHaveBeenCalledExactlyOnceWith(
    owner,
    expect.objectContaining({ kind: "service-login", service: "Vercel", command: "vercel whoami" }),
  );
  expect(onPick).not.toHaveBeenCalled();
});

it("uses the default owner and clears fields when the resource kind changes", async () => {
  setup();
  const alpha: WorkflowStep = {
    id: "alpha",
    kind: "skill",
    skill: "project-skill",
    title: "Alpha",
  };
  const beta: WorkflowStep = { ...alpha, id: "beta", title: "Beta" };
  onResourceAdd.mockResolvedValue(false);
  await using _screen = await render(
    <WorkflowStepPicker
      environmentId={environmentId}
      projectId={projectId}
      workflow="current"
      workflows={[]}
      onPick={onPick}
      resources={{
        listing: listing("current", "Current workflow", [alpha, beta]),
        owners: [alpha, beta],
        defaultOwnerId: alpha.id,
        disabled: false,
        onAdd: onResourceAdd,
        ...credentialCallbacks,
      }}
    >
      <button type="button">Add step</button>
    </WorkflowStepPicker>,
  );
  await click(button("Add step"));
  await click(button("Resources"));
  const ownerSelect = document.querySelector<HTMLSelectElement>(
    '[aria-label="Attach resource to step"]',
  );
  if (!ownerSelect) throw new Error("Owner selector is missing");
  expect(ownerSelect.value).toBe(alpha.id);

  await click(button("Requirements"));
  await userEvent.fill(document.querySelector('[aria-label="Requirement"]')!, "Node 22");
  await userEvent.fill(document.querySelector('[aria-label="Resource label"]')!, "Runtime");
  await click(button("Service logins"));
  expect((document.querySelector('[aria-label="Service"]') as HTMLInputElement).value).toBe("");
  expect((document.querySelector('[aria-label="Resource label"]') as HTMLInputElement).value).toBe(
    "",
  );

  await userEvent.fill(document.querySelector('[aria-label="Service"]')!, "Vercel");
  await click(button("Add service login"));
  expect(onResourceAdd).toHaveBeenCalledExactlyOnceWith(
    alpha,
    expect.objectContaining({ kind: "service-login", service: "Vercel" }),
  );
  expect((document.querySelector('[aria-label="Service"]') as HTMLInputElement).value).toBe(
    "Vercel",
  );
});

it("clears unsaved resource fields when the owner changes", async () => {
  setup();
  const alpha: WorkflowStep = {
    id: "alpha",
    kind: "skill",
    skill: "project-skill",
    title: "Alpha",
  };
  const beta: WorkflowStep = { ...alpha, id: "beta", title: "Beta" };
  await using _screen = await render(
    <WorkflowStepPicker
      environmentId={environmentId}
      projectId={projectId}
      workflow="current"
      workflows={[]}
      onPick={onPick}
      resources={{
        listing: listing("current", "Current workflow", [alpha, beta]),
        owners: [alpha, beta],
        defaultOwnerId: alpha.id,
        disabled: false,
        onAdd: onResourceAdd,
        ...credentialCallbacks,
      }}
    >
      <button type="button">Add step</button>
    </WorkflowStepPicker>,
  );
  await click(button("Add step"));
  await click(button("Resources"));
  const manualEntry = document.querySelector<HTMLElement>("summary");
  if (!manualEntry) throw new Error("Manual MCP entry disclosure is missing");
  await click(manualEntry);
  await userEvent.fill(document.querySelector('[aria-label="MCP server name"]')!, "alpha-mcp");
  const ownerSelect = document.querySelector<HTMLSelectElement>(
    '[aria-label="Attach resource to step"]',
  );
  if (!ownerSelect) throw new Error("Owner selector is missing");
  await userEvent.selectOptions(ownerSelect, beta.id);
  expect((document.querySelector('[aria-label="MCP server name"]') as HTMLInputElement).value).toBe(
    "",
  );
});

it("keeps the Resources picker open through explicit MCP inventory refresh", async () => {
  setup();
  const owner: WorkflowStep = {
    id: "build",
    kind: "skill",
    skill: "project-skill",
    title: "Build",
  };
  await using _screen = await render(
    <WorkflowStepPicker
      environmentId={environmentId}
      projectId={projectId}
      workflow="current"
      workflows={[]}
      onPick={onPick}
      resources={{
        listing: listing("current", "Current workflow", [owner]),
        owners: [owner],
        disabled: false,
        onAdd: onResourceAdd,
        ...credentialCallbacks,
      }}
    >
      <button type="button">Add step</button>
    </WorkflowStepPicker>,
  );
  await click(button("Add step"));
  await click(button("Resources"));
  expect(state.resourceEdit).not.toHaveBeenCalled();
  await click(button("Choose a configured MCP server"));
  expect(state.resourceEdit).not.toHaveBeenCalled();
  await click(button("Refresh"));
  expect(state.resourceEdit).toHaveBeenCalledExactlyOnceWith({
    _tag: "mcpInventoryRefresh",
    projectId,
    workflow: "current",
    stepId: owner.id,
  });
  expect(button("Service logins")).toBeTruthy();
});

it("requires an owner before showing resource fields", async () => {
  setup();
  await using _screen = await render(
    <WorkflowStepPicker
      environmentId={environmentId}
      projectId={projectId}
      workflow="current"
      workflows={[]}
      onPick={onPick}
      resources={{
        listing: listing("current", "Current workflow"),
        owners: [],
        disabled: false,
        onAdd: onResourceAdd,
        ...credentialCallbacks,
      }}
    >
      <button type="button">Add step</button>
    </WorkflowStepPicker>,
  );
  await click(button("Add step"));
  await click(button("Resources"));
  expect(document.body.textContent).toContain("Add a skill or workflow step first.");
  expect(document.querySelector('[aria-label="Requirement"]')).toBeNull();
  expect(onResourceAdd).not.toHaveBeenCalled();
});

it("keeps Resources usable in a narrow panel and adds a selected MCP connection", async () => {
  setup();
  const owner: WorkflowStep = {
    id: "build",
    kind: "skill",
    skill: "project-skill",
    title: "Build",
  };
  await using _screen = await render(
    <div style={{ position: "fixed", top: 0, right: 0, width: 320 }}>
      <WorkflowStepPicker
        environmentId={environmentId}
        projectId={projectId}
        workflow="current"
        workflows={[listing("next", "Next workflow")]}
        onPick={onPick}
        resources={{
          listing: listing("current", "Current workflow", [owner]),
          owners: [owner],
          disabled: false,
          onAdd: onResourceAdd,
          ...credentialCallbacks,
        }}
      >
        <button type="button">Add step</button>
      </WorkflowStepPicker>
    </div>,
  );

  await click(button("Add step"));
  await click(button("Resources"));
  const popup = document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
  const ownerSelect = document.querySelector<HTMLSelectElement>(
    '[aria-label="Attach resource to step"]',
  );
  const addButton = button("Add MCP connection");
  if (!popup || !ownerSelect) throw new Error("Resources form is missing");
  const popupBounds = popup.getBoundingClientRect();
  expect(popupBounds.left).toBeGreaterThanOrEqual(0);
  expect(popupBounds.right).toBeLessThanOrEqual(window.innerWidth);
  for (const element of [ownerSelect, addButton]) {
    const bounds = element.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(popupBounds.left);
    expect(bounds.right).toBeLessThanOrEqual(popupBounds.right);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
  }

  await click(button("Choose a configured MCP server"));
  const popups = [...document.querySelectorAll<HTMLElement>('[data-slot="popover-popup"]')];
  const nestedPopup = popups.at(-1);
  const serverButton = button("Linear");
  if (!nestedPopup) throw new Error("MCP server picker did not open");
  const nestedBounds = nestedPopup.getBoundingClientRect();
  const serverBounds = serverButton.getBoundingClientRect();
  expect(nestedBounds.left).toBeGreaterThanOrEqual(0);
  expect(nestedBounds.right).toBeLessThanOrEqual(window.innerWidth);
  expect(serverBounds.left).toBeGreaterThanOrEqual(nestedBounds.left);
  expect(serverBounds.right).toBeLessThanOrEqual(nestedBounds.right);
  await click(serverButton);
  await click(button("Add MCP connection"));
  expect(onResourceAdd).toHaveBeenCalledExactlyOnceWith(
    owner,
    expect.objectContaining({ kind: "mcp-connection", server: "linear" }),
  );

  await click(button("Add step"));
  await click(button("Workflows"));
  expect(button("Next workflow")).toBeTruthy();
  await click(button("Resources"));
  await click(button("Requirements"));
  expect(document.querySelector('[aria-label="Requirement"]')).toBeTruthy();
  await click(button("Service logins"));
  expect(document.querySelector('[aria-label="Service status command"]')).toBeTruthy();
});
