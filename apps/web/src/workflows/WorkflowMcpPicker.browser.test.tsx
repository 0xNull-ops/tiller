import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { act, render } from "../../test/render";

const state = vi.hoisted(() => ({
  data: null as unknown,
  queryError: null as string | null,
  run: vi.fn<(edit: unknown) => Promise<unknown>>(),
  read: vi.fn<(args: { input: unknown }) => unknown>((args) => args.input),
}));

vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: state.data,
    error: state.queryError,
    isPending: false,
    refresh: vi.fn<() => void>(),
  }),
}));
vi.mock("./workflowState", () => ({
  useWorkflowEdit: () => ({ canEdit: true, busy: false, error: null, run: state.run }),
  workflowRead: state.read,
}));

import { WorkflowMcpPicker } from "./WorkflowMcpPicker";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const listing = {
  projectId,
  workflow: "deploy",
  definition: { version: 1, name: "Deploy", steps: [{ id: "build", skill: "build" }] },
} as never;
const providerInstanceId = ProviderInstanceId.make("codex");
const inventory = (overrides: Record<string, unknown> = {}) => ({
  status: "available",
  message: "Provider reported MCP connections.",
  scope: {
    providerInstanceId,
    providerLabel: "Codex",
    modelScoped: false,
    model: { instanceId: providerInstanceId, model: "gpt-6-luna" },
    workspaceRoot: "/repo",
    threadId: ThreadId.make("thread"),
    source: "live",
  },
  servers: [
    {
      name: "linear",
      title: "Linear",
      description: "Issue tracker",
      status: "connected",
      auth: "signed-in",
      toolsStatus: "available",
      tools: [{ name: "create_issue", title: "Create issue", description: "Create a new issue." }],
    },
  ],
  cached: true,
  stale: false,
  excludedInternal: 1,
  limitations: [],
  ...overrides,
});

function setup() {
  state.data = { _tag: "mcpInventory", inventory: inventory() };
  state.queryError = null;
  state.read.mockClear();
  state.run.mockReset().mockResolvedValue({});
}

function picker(props: Record<string, unknown> = {}) {
  return (
    <WorkflowMcpPicker
      environmentId={environmentId}
      listing={listing}
      stepId="build"
      contextThreadId={ThreadId.make("thread")}
      workspaceRoot="/repo"
      modelRevision={JSON.stringify({ instanceId: providerInstanceId, model: "gpt-6-luna" })}
      onSelect={vi.fn<
        (choice: { server: string; providerInstanceId?: ProviderInstanceId } | null) => void
      >()}
      {...props}
    />
  );
}

it("reads cached inventory without refreshing, searches tool details, and selects the server", async () => {
  setup();
  const onSelect =
    vi.fn<(choice: { server: string; providerInstanceId?: ProviderInstanceId } | null) => void>();
  await using screen = await render(picker({ onSelect }));
  expect(state.read).toHaveBeenCalledWith({
    environmentId,
    input: {
      _tag: "mcpInventory",
      projectId,
      workflow: "deploy",
      stepId: "build",
      contextThreadId: ThreadId.make("thread"),
    },
  });
  expect(state.run).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Choose a configured MCP server" }));
  await expect.element(page.getByText("Saved live inventory", { exact: false })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Show tools for linear" }));
  await expect.element(page.getByText("Create issue")).toBeVisible();
  expect(onSelect).not.toHaveBeenCalled();
  expect(state.run).not.toHaveBeenCalled();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Search MCP servers and tools" }),
    "create_issue",
  );
  await userEvent.click(page.getByRole("button", { name: /Linear/ }));
  expect(onSelect).toHaveBeenCalledWith({ server: "linear", providerInstanceId });
  expect(state.run).not.toHaveBeenCalled();
});

it("shows an explicit empty tools result separately from unknown tools", async () => {
  setup();
  state.data = {
    _tag: "mcpInventory",
    inventory: inventory({
      servers: [
        { ...inventory().servers[0], toolsStatus: "empty", tools: [] },
        {
          ...inventory().servers[0],
          name: "offline",
          status: "not-started",
          toolsStatus: "unavailable",
          tools: [],
        },
      ],
    }),
  };
  await using screen = await render(picker());
  await userEvent.click(screen.getByRole("button", { name: "Choose a configured MCP server" }));
  await expect.element(page.getByText("0 tools")).toBeVisible();
  await expect.element(page.getByText("Tools unknown")).toBeVisible();
});

it("hides a cached inventory from a different effective model", async () => {
  setup();
  state.data = {
    _tag: "mcpInventory",
    inventory: inventory({
      scope: {
        ...inventory().scope,
        model: { instanceId: providerInstanceId, model: "another-model" },
      },
    }),
  };
  await using screen = await render(picker());
  await userEvent.click(screen.getByRole("button", { name: "Choose a configured MCP server" }));
  await expect.element(page.getByText(/different model selection/)).toBeVisible();
  expect(screen.container.textContent).not.toContain("Linear");
});

it("shows an attached provider mismatch when only a not-checked snapshot is saved", async () => {
  setup();
  state.data = {
    _tag: "mcpInventory",
    inventory: inventory({ status: "not-checked", servers: [] }),
  };
  await using screen = await render(
    picker({
      value: { server: "linear", providerInstanceId: ProviderInstanceId.make("claude") },
    }),
  );
  await expect.element(screen.getByText(/saved for another provider/)).toBeVisible();
});

it("keeps unsupported and no active session states distinct and refreshes only on request", async () => {
  setup();
  state.data = {
    _tag: "mcpInventory",
    inventory: inventory({ status: "unsupported", servers: [] }),
  };
  state.run.mockResolvedValue({
    mcpInventory: inventory({
      status: "unavailable",
      message: "No matching active session.",
      servers: [],
    }),
  });
  await using screen = await render(picker());
  await userEvent.click(screen.getByRole("button", { name: "Choose a configured MCP server" }));
  await expect.element(page.getByText(/does not expose MCP inventory/)).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Refresh" }));
  expect(state.run).toHaveBeenCalledWith({
    _tag: "mcpInventoryRefresh",
    projectId,
    workflow: "deploy",
    stepId: "build",
    contextThreadId: ThreadId.make("thread"),
  });
  await expect.element(page.getByText("No matching active session.")).toBeVisible();
});

it("ignores a refresh result after the selected step context changes", async () => {
  setup();
  state.data = null;
  let resolveRefresh: ((value: unknown) => void) | undefined;
  state.run.mockReturnValue(
    new Promise((resolve) => {
      resolveRefresh = resolve;
    }),
  );
  await using screen = await render(picker());
  await userEvent.click(screen.getByRole("button", { name: "Choose a configured MCP server" }));
  await userEvent.click(page.getByRole("button", { name: "Refresh" }));
  state.data = null;
  await screen.rerender(picker({ stepId: "review" }));
  await act(async () => resolveRefresh?.({ mcpInventory: inventory() }));
  await userEvent.click(screen.getByRole("button", { name: "Choose a configured MCP server" }));
  await expect
    .element(
      screen.getByText(
        "No saved inventory yet. Refresh asks the provider for its configured MCP servers.",
      ),
    )
    .toBeVisible();
  expect(screen.container.textContent).not.toContain("Linear");
});

it("labels configured servers separately from a live session", async () => {
  setup();
  state.data = {
    _tag: "mcpInventory",
    inventory: inventory({
      message:
        "Codex lists 1 configured MCP server. Connection status and tools stay unknown until Codex runs.",
      scope: { ...inventory().scope, source: "configured", providerSessionId: undefined },
      cached: false,
      servers: [
        {
          name: "linear",
          status: "unknown",
          toolsStatus: "unavailable",
          tools: [],
          toolsDetail: "Tools are only listed while Codex runs for this instance.",
        },
        {
          name: "off",
          status: "disabled",
          toolsStatus: "unavailable",
          tools: [],
          statusDetail: "Disabled in Codex configuration.",
        },
      ],
    }),
  };
  await using screen = await render(picker());
  await userEvent.click(screen.getByRole("button", { name: "Choose a configured MCP server" }));
  await expect.element(page.getByText(/Configured servers/)).toBeVisible();
  await expect.element(page.getByText("Unknown")).toBeVisible();
  await expect.element(page.getByText("Tools unknown").first()).toBeVisible();
  await expect.element(page.getByText("Disabled in Codex configuration.")).toBeVisible();
  await expect.element(page.getByText(/stay unknown until Codex runs/)).toBeVisible();
});

it("keeps a saved server when configuration does not list it", async () => {
  setup();
  const onSelect =
    vi.fn<(choice: { server: string; providerInstanceId?: ProviderInstanceId } | null) => void>();
  state.data = {
    _tag: "mcpInventory",
    inventory: inventory({ status: "not-checked", servers: [] }),
  };
  state.run.mockResolvedValue({
    mcpInventory: inventory({
      scope: { ...inventory().scope, source: "configured", providerSessionId: undefined },
      servers: [
        {
          name: "other",
          status: "unknown",
          toolsStatus: "unavailable",
          tools: [],
        },
      ],
    }),
  });
  await using screen = await render(
    picker({ onSelect, value: { server: "plugin-server", providerInstanceId } }),
  );
  await userEvent.click(screen.getByRole("button", { name: /plugin-server/ }));
  await userEvent.click(page.getByRole("button", { name: "Refresh" }));
  await expect.element(page.getByText(/Configured servers/)).toBeVisible();
  await expect.element(page.getByText(/isn’t in the readable configuration/)).toBeVisible();
  expect(onSelect).not.toHaveBeenCalled();
});

it("does not offer refresh in a read-only historical view", async () => {
  setup();
  await using screen = await render(picker({ disabled: true }));
  const trigger = screen.getByRole("button", { name: "Choose a configured MCP server" });
  await expect.element(trigger).toBeDisabled();
  expect(state.run).not.toHaveBeenCalled();
});
