import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type WorkflowSubagentModel,
  type WorkflowRun,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../test/render";
import { workflowRunFixture } from "./workflowTestFixture";

const state = vi.hoisted(() => ({
  edits: [] as Array<Record<string, unknown>>,
  preferences: 2,
  liveRevision: 0,
  refresh: vi.fn(),
  canEdit: true,
  providers: [] as Array<Record<string, unknown>>,
  entries: [] as Array<Record<string, unknown>>,
}));

vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: { _tag?: string }) =>
    query?._tag === "live"
      ? { data: null, dataUpdatedAt: state.liveRevision, refresh: state.refresh }
      : {
          data: {
            _tag: "preferences",
            preferences: { pinnedSkills: [], maxSubagentModels: state.preferences },
          },
          isPending: false,
          isSuccess: true,
          error: null,
          refresh: state.refresh,
        },
}));
vi.mock("./workflowState", () => ({
  workflowRead: ({ input }: { input: unknown }) => input,
  workflowRunsLive: () => ({ _tag: "live" }),
  useWorkflowEdit: () => ({
    canEdit: state.canEdit,
    busy: false,
    error: null,
    run: (edit: Record<string, unknown>) => {
      state.edits.push(edit);
      return Promise.resolve(edit);
    },
  }),
}));
vi.mock("../state/environments", () => ({
  useEnvironmentProviders: () => new Map([["env", state.providers]]),
}));
vi.mock("../hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({}),
  mergeEnvironmentSettings: () => ({ providerInstances: {}, projectSettingsOverrides: {} }),
}));
vi.mock("../state/server", () => ({ EMPTY_SERVER_PROVIDERS: [] }));
vi.mock("../components/chat/ProviderModelPicker", () => ({
  ProviderModelPicker: (props: {
    selectedModels: ReadonlyArray<{ instanceId: string; model: string }>;
    instanceEntries: ReadonlyArray<{ instanceId: string; models: ReadonlyArray<{ slug: string }> }>;
    onInstanceModelChange: (instanceId: string, model: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      {props.instanceEntries.flatMap((entry) =>
        entry.models.map((model) => {
          const selected = props.selectedModels.some(
            (choice) => choice.instanceId === entry.instanceId && choice.model === model.slug,
          );
          return (
            <button
              key={model.slug}
              aria-pressed={selected}
              disabled={props.disabled}
              onClick={() => props.onInstanceModelChange(entry.instanceId, model.slug)}
            >
              {model.slug}
            </button>
          );
        }),
      )}
    </div>
  ),
}));

import { WorkflowSubagentModelsField } from "./WorkflowSubagentModelsField";
import { WorkflowExecutionControl } from "./WorkflowExecutionControl";

const environmentId = EnvironmentId.make("env");
const projectId = ProjectId.make("project");
const listing = (subagentModels?: ReadonlyArray<WorkflowSubagentModel>) => ({
  projectId,
  workflow: "build",
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-10-23T00:00:00Z",
  scratch: false,
  editedByThreadId: null,
  definition: {
    version: 2 as const,
    name: "Build",
    steps: [],
    ...(subagentModels ? { subagentModels } : {}),
  },
});

function setup() {
  state.edits = [];
  state.canEdit = true;
  state.preferences = 2;
  state.liveRevision = 0;
  state.refresh.mockReset();
  const provider = {
    driver: "opencode",
    instanceId: "opencode-go",
    enabled: true,
    installed: true,
    status: "ready",
    availability: "available",
    auth: { status: "authenticated" },
    supportsTextGeneration: true,
    models: ["deepseek", "haiku", "luna"].map((slug) => ({ slug, name: slug })),
  };
  state.providers = [provider];
  state.entries = [{ instanceId: "opencode-go", driverKind: "opencode", models: provider.models }];
}

it("saves two selected models with drivers and clears the final choice", async () => {
  setup();
  await using screen = await render(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={listing()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "deepseek" }));
  expect(state.edits[0]).toMatchObject({
    subagentModels: [{ driver: "opencode", instanceId: "opencode-go", model: "deepseek" }],
  });
  const withOne = listing([
    {
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode-go"),
      model: "deepseek",
    },
  ]);
  await screen.rerender(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={withOne}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "haiku" }));
  expect(state.edits[1]).toMatchObject({
    subagentModels: [
      { driver: "opencode", instanceId: "opencode-go", model: "deepseek" },
      { driver: "opencode", instanceId: "opencode-go", model: "haiku" },
    ],
  });
  const withTwo = listing([
    {
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode-go"),
      model: "deepseek",
    },
    {
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode-go"),
      model: "haiku",
    },
  ]);
  await screen.rerender(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={withTwo}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "haiku" }));
  await screen.rerender(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={withOne}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "deepseek" }));
  expect(state.edits.slice(-2).map((edit) => edit.subagentModels)).toEqual([
    [{ driver: "opencode", instanceId: "opencode-go", model: "deepseek" }],
    null,
  ]);
});

it("does not save a third model at the cap", async () => {
  setup();
  const current = listing([
    {
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode-go"),
      model: "deepseek",
    },
    {
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode-go"),
      model: "haiku",
    },
  ]);
  await using screen = await render(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={current}
    />,
  );
  expect(screen.getByText("Up to 2 models (Settings → General)")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "luna" }));
  expect(state.edits).toHaveLength(0);
});

it("shows fallback copy for a missing hint and Remove clears it", async () => {
  setup();
  state.providers = [{ ...state.providers[0], auth: { status: "unauthenticated" } }];
  const current = listing([
    {
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode-go"),
      model: "deepseek",
    },
    {
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode-go"),
      model: "missing-model",
    },
  ]);
  await using screen = await render(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={current}
    />,
  );
  expect(screen.container.textContent).toContain("deepseek: not signed in · Remove");
  expect(screen.container.textContent).toContain("missing-model: not signed in · Remove");
  expect(
    screen.getByText(
      "No selected models are available, so the agent decides. The file keeps the choice.",
    ),
  ).toBeTruthy();
  expect(screen.container.textContent?.match(/so the agent decides/g)).toHaveLength(1);
  const removeButton = [...screen.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Remove",
  );
  await userEvent.click(removeButton!);
  expect(state.edits[0]).toMatchObject({
    _tag: "meta",
    subagentModels: [{ model: "missing-model" }],
  });
});

it("shows and unticks a hint through its same-driver remap", async () => {
  setup();
  state.providers = [
    {
      ...state.providers[0],
      driver: "codex",
      instanceId: "codex-new",
      models: [{ slug: "gpt", name: "gpt" }],
    },
  ];
  const original = {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex-old"),
    model: "gpt",
  };
  await using screen = await render(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={listing([original])}
    />,
  );
  const model = screen.getByRole("button", { name: "gpt" });
  await expect.element(model).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(model);
  expect(state.edits[0]).toMatchObject({ subagentModels: null });
});

it("refreshes the model cap after a workflow live revision", async () => {
  setup();
  const firstTwo = ["deepseek", "haiku"].map((model) => ({
    driver: ProviderDriverKind.make("opencode"),
    instanceId: ProviderInstanceId.make("opencode-go"),
    model,
  }));
  const current = listing(firstTwo);
  await using screen = await render(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={current}
    />,
  );
  expect(screen.getByText("Up to 2 models (Settings → General)")).toBeTruthy();
  state.preferences = 3;
  state.liveRevision = 1;
  await screen.rerender(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={current}
    />,
  );
  await vi.waitFor(() => expect(state.refresh).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "luna" }));
  expect(state.edits[0]?.subagentModels).toHaveLength(3);
});

it("keeps the picker and missing-model removal disabled without edit permission", async () => {
  setup();
  state.canEdit = false;
  const hint = {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex-old"),
    model: "missing-model",
  };
  await using screen = await render(
    <WorkflowSubagentModelsField
      environmentId={environmentId}
      projectId={projectId}
      listing={listing([hint])}
      disabled={false}
    />,
  );

  expect(screen.getByRole("button", { name: "deepseek" }).element().hasAttribute("disabled")).toBe(
    true,
  );
  expect(screen.getByRole("button", { name: "Remove" }).element().hasAttribute("disabled")).toBe(
    true,
  );
  expect(state.edits).toEqual([]);
});

it("uses the live draft in edit mode and the pinned run definition read-only in history", async () => {
  setup();
  const hint = {
    driver: ProviderDriverKind.make("opencode"),
    instanceId: ProviderInstanceId.make("opencode-go"),
    model: "deepseek",
  };
  const draft = {
    ...listing([hint]),
    definition: { ...listing([hint]).definition!, execution: "prefer-subagents" as const },
  };
  await using draftScreen = await render(
    <WorkflowExecutionControl environmentId={environmentId} listing={draft} />,
  );
  expect(
    draftScreen.getByRole("button", { name: "Workflow subagent settings" }).element().textContent,
  ).toContain("Prefer subagents · deepseek");

  const run: WorkflowRun = {
    ...workflowRunFixture,
    definition: { ...draft.definition, execution: "always-subagents" as const },
    subagents: {
      usable: [
        {
          driver: hint.driver,
          instanceId: hint.instanceId,
          model: "deepseek",
          label: "Pinned model",
        },
      ],
      missing: [],
      fallback: false,
    },
  };
  await using historyScreen = await render(
    <WorkflowExecutionControl environmentId={environmentId} listing={draft} run={run} />,
  );
  const trigger = historyScreen.getByRole("button", { name: "Workflow subagent settings" });
  expect(trigger.element().textContent).toContain("Always subagents · Pinned model");
  await userEvent.click(trigger);
  expect(page.getByRole("combobox", { name: "Run steps" }).element().hasAttribute("disabled")).toBe(
    true,
  );
  const model = page.getByRole("button", { name: "deepseek" });
  expect(model.element().hasAttribute("disabled")).toBe(true);
  expect(state.edits).toEqual([]);
});
