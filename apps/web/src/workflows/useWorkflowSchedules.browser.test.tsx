import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  workflowSchedulePrompt,
  type ScheduledTask,
  type ScheduledTaskListResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { useWorkflowSchedules } from "./useWorkflowSchedules";

const environmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const workflow = "pillar-flow";

const state = vi.hoisted(() => ({
  result: null as Atom.Atom<
    AsyncResult.AsyncResult<ScheduledTaskListResult, Cause.NoSuchElementError>
  > | null,
}));

// The live subscription stays open like the real one, so its atom keeps waiting
// after every chunk until the stream completes.
vi.mock("../state/server", () => ({
  serverEnvironment: {
    scheduledTasksLive: () => {
      if (state.result === null) throw new Error("The test did not start the schedule stream.");
      return state.result;
    },
  },
}));

const boundTask: ScheduledTask = {
  id: ScheduledTaskId.make("scheduled-task:one"),
  title: "Nightly pillar flow",
  prompt: workflowSchedulePrompt({ version: 1, projectId, workflow, inputs: {} }),
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId,
  threadId: ThreadId.make("driver"),
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

function setup() {
  const snapshots = Deferred.makeUnsafe<ScheduledTaskListResult>();
  const result = Atom.make(
    Stream.fromEffect(Deferred.await(snapshots)).pipe(Stream.concat(Stream.never)),
  );
  state.result = result;
  return { snapshots, result };
}

function Probe() {
  const { tasks, isPending } = useWorkflowSchedules(environmentId, projectId, workflow);
  return (
    <div>
      <p>{isPending ? "Loading schedules…" : "Schedules settled"}</p>
      <p>{`tasks:${tasks.length}`}</p>
    </div>
  );
}

async function renderProbe(registry: AtomRegistry.AtomRegistry) {
  return render(
    <RegistryContext.Provider value={registry}>
      <Probe />
    </RegistryContext.Provider>,
    { router: false }, // The hook and the probe use no links or navigation.
  );
}

it("settles once the live schedule snapshot arrives", async () => {
  const { snapshots } = setup();
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  await using screen = await renderProbe(registry);

  await expect.element(screen.getByText("Loading schedules…")).toBeInTheDocument();

  Deferred.doneUnsafe(snapshots, Effect.succeed({ tasks: [boundTask] }));

  await expect.element(screen.getByText("tasks:1")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Loading schedules…");
});

it("settles to empty once the live snapshot says there are no schedules", async () => {
  const { snapshots, result } = setup();
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  await using screen = await renderProbe(registry);

  const received = new Promise<void>((resolve) => {
    registry.subscribe(
      result,
      (next) => {
        if (AsyncResult.isSuccess(next)) resolve();
      },
      { immediate: true },
    );
  });

  Deferred.doneUnsafe(snapshots, Effect.succeed({ tasks: [] }));
  await received;

  await expect.element(screen.getByText("Schedules settled")).toBeInTheDocument();
  await expect.element(screen.getByText("tasks:0")).toBeInTheDocument();
});
