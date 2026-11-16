import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type WorkflowRun,
  type WorkflowStepRun,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowRunner from "../workflows/WorkflowRunner.ts";
import * as WorkflowStore from "../workflows/WorkflowStore.ts";
import * as CredentialCaller from "./CredentialCaller.ts";

const driver = ThreadId.make("driver");
const child = ThreadId.make("child");
const sibling = ThreadId.make("sibling");
const projectId = ProjectId.make("project");
const step = (threadId: ThreadId | null, status: WorkflowStepRun["status"]) =>
  ({ stepId: "upload", status, threadId, attempts: 1 }) satisfies WorkflowStepRun;
const run = (
  steps: ReadonlyArray<WorkflowStepRun>,
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun =>
  ({
    id: "run",
    projectId,
    workflow: "release",
    driverThreadId: driver,
    status: "running",
    definition: { steps: [{ id: "upload", title: "Upload", kind: "skill" }] },
    steps,
    ...overrides,
  }) as unknown as WorkflowRun;
const layer = (runs: ReadonlyArray<WorkflowRun>) => {
  const active = (item: WorkflowRun) => item.status === "running" || item.status === "waiting";
  // The claim a real runner persists on the step; shared by every resolve in one test.
  const claimed = new Map<string, ThreadId>();
  return CredentialCaller.layer.pipe(
    Layer.provide(
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        getInstance: () => Effect.succeed({ driverKind: "codex" } as never),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed({
            deletedAt: null,
            title: "Release",
            projectId,
            modelSelection: {
              instanceId: ProviderInstanceId.make("work-codex"),
              model: "gpt-6.1-sol",
            },
            lineage: { parentThreadId: threadId === driver ? null : driver },
            worktreePath: threadId === child ? "/workspace/child" : null,
          } as never),
      }),
    ),
    Layer.provide(
      Layer.mock(WorkflowRunner.WorkflowRunner)({
        activeRunsForThread: (threadId, project) =>
          Effect.succeed(
            runs.filter(
              (item) =>
                active(item) &&
                item.projectId === project &&
                (item.driverThreadId === threadId ||
                  item.steps.some((entry) => entry.threadId === threadId)),
            ),
          ),
        activeRunsForProject: (project) =>
          Effect.succeed(runs.filter((item) => active(item) && item.projectId === project)),
        claimStepThread: ({ runId, stepId, threadId }) =>
          Effect.sync(() => {
            const key = `${runId}/${stepId}`;
            const owner = claimed.get(key);
            if (owner !== undefined) return owner === threadId;
            claimed.set(key, threadId);
            return true;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(WorkflowStore.WorkflowStore)({
        projectRoot: () => Effect.succeed("/workspace/project"),
      }),
    ),
  );
};
it.effect("resolves provider, model, role, workflow and workspace from trusted thread state", () =>
  Effect.gen(function* () {
    const resolver = yield* CredentialCaller.CredentialCallerResolver;
    const main = yield* resolver.resolve(driver);
    assert.include(main.caller, {
      provider: "codex",
      model: "gpt-6.1-sol",
      agentRole: "main",
      runId: "run",
      credentialApprovals: "once-per-run",
    });
    assert.equal(main.cwd, "/workspace/project");
    const subagent = yield* resolver.resolve(child);
    assert.include(subagent.caller, {
      agentRole: "subagent",
      stepId: "upload",
      stepTitle: "Upload",
    });
    assert.equal(subagent.cwd, "/workspace/child");
  }).pipe(Effect.provide(layer([run([step(child, "running")])]))),
);
it.effect("refuses ambiguous driver contexts rather than reuse the wrong run's grant", () =>
  Effect.gen(function* () {
    const resolver = yield* CredentialCaller.CredentialCallerResolver;
    assert.equal((yield* resolver.resolve(driver).pipe(Effect.flip)).reason, "ambiguous-run");
  }).pipe(Effect.provide(layer([run([step(child, "running")]), run([], { id: "other" })]))),
);
it.effect(
  "accepts a step hint from a delegated child of the driver before the step is linked",
  () =>
    Effect.gen(function* () {
      const resolver = yield* CredentialCaller.CredentialCallerResolver;
      const resolved = yield* resolver.resolve(child, { runId: "run", stepId: "upload" });
      assert.include(resolved.caller, {
        workflow: "release",
        runId: "run",
        stepId: "upload",
        stepTitle: "Upload",
        agentRole: "subagent",
      });
    }).pipe(Effect.provide(layer([run([step(null, "running")])]))),
);
it.effect("lets one child claim an unlinked step so a sibling cannot inherit its approval", () =>
  Effect.gen(function* () {
    const resolver = yield* CredentialCaller.CredentialCallerResolver;
    const claimed = yield* resolver.resolve(child, { runId: "run", stepId: "upload" });
    assert.include(claimed.caller, {
      runId: "run",
      stepId: "upload",
      credentialApprovals: "pre-approved",
    });
    // Any other child of the driver naming the same step is refused, even with the same hint.
    const refused = yield* resolver.resolve(sibling, { runId: "run", stepId: "upload" });
    assert.notProperty(refused.caller, "runId");
    assert.notProperty(refused.caller, "stepId");
    assert.notProperty(refused.caller, "workflow");
    assert.notProperty(refused.caller, "credentialApprovals");
    // The child that claimed it keeps working through later calls.
    assert.include((yield* resolver.resolve(child, { runId: "run", stepId: "upload" })).caller, {
      stepId: "upload",
    });
  }).pipe(
    Effect.provide(
      layer([
        run([step(null, "running")], {
          definition: {
            credentialApprovals: "pre-approved",
            steps: [{ id: "upload", title: "Upload", kind: "skill" }],
          } as never,
        }),
      ]),
    ),
  ),
);
it.effect("still lets the driver act for its own unlinked step", () =>
  Effect.gen(function* () {
    const resolver = yield* CredentialCaller.CredentialCallerResolver;
    const resolved = yield* resolver.resolve(driver, { runId: "run", stepId: "upload" });
    assert.include(resolved.caller, { runId: "run", stepId: "upload" });
    // The driver never consumes the claim, so a child can still take the step.
    const childResolved = yield* resolver.resolve(child, { runId: "run", stepId: "upload" });
    assert.include(childResolved.caller, { runId: "run", stepId: "upload" });
  }).pipe(Effect.provide(layer([run([step(null, "running")])]))),
);
it.effect("ignores a hint naming a step linked to another thread", () =>
  Effect.gen(function* () {
    const resolver = yield* CredentialCaller.CredentialCallerResolver;
    const resolved = yield* resolver.resolve(child, { runId: "run", stepId: "upload" });
    assert.notProperty(resolved.caller, "runId");
    assert.notProperty(resolved.caller, "stepId");
    assert.notProperty(resolved.caller, "workflow");
  }).pipe(Effect.provide(layer([run([step(sibling, "running")])]))),
);
const parallelRun = run(
  [
    { stepId: "one", status: "running", threadId: child, attempts: 1 },
    { stepId: "two", status: "running", threadId: sibling, attempts: 1 },
  ],
  {
    definition: {
      steps: [
        { id: "one", title: "One", kind: "skill" },
        { id: "two", title: "Two", kind: "skill" },
      ],
    } as unknown as WorkflowRun["definition"],
  },
);
it.effect("never cross-attributes parallel steps", () =>
  Effect.gen(function* () {
    const resolver = yield* CredentialCaller.CredentialCallerResolver;
    const own = yield* resolver.resolve(child, { runId: "run", stepId: "one" });
    assert.equal(own.caller.stepId, "one");
    const crossed = yield* resolver.resolve(child, { runId: "run", stepId: "two" });
    assert.equal(crossed.caller.stepId, "one");
    assert.equal(crossed.caller.runId, "run");
  }).pipe(Effect.provide(layer([parallelRun]))),
);
it.effect("ignores a hint once the run is over", () =>
  Effect.gen(function* () {
    const resolver = yield* CredentialCaller.CredentialCallerResolver;
    const resolved = yield* resolver.resolve(child, { runId: "run", stepId: "upload" });
    assert.notProperty(resolved.caller, "runId");
  }).pipe(Effect.provide(layer([run([step(null, "running")], { status: "done" })]))),
);
