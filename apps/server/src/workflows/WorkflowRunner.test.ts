import { workflowTemplates } from "@t3tools/shared/workflowTemplates";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  CREDENTIAL_REAPPROVAL_WARNING,
  CredentialAccessError,
  CredentialId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  ScheduledTaskId,
  type WorkflowScheduleKnobs,
  ScheduledTaskError,
  type Credential,
  type WorkflowMcpServerInventory,
  ThreadId,
  type WorkflowDefinition,
  type WorkflowCredentialAttachment,
  type WorkflowSlug,
  type WorkflowsSnapshot,
  workflowSchedulePrompt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../config.ts";
import * as TestClock from "effect/testing/TestClock";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../processRunner.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SkillCatalog from "./SkillCatalog.ts";
import { CredentialPolicySession } from "../credentials/CredentialPolicySession.ts";
import { credentialRedactor } from "../credentials/redactSecrets.ts";
import * as CredentialStore from "../credentials/CredentialStore.ts";
import * as CredentialUnlock from "../credentials/CredentialUnlock.ts";
import * as CredentialRedaction from "../credentials/CredentialRedaction.ts";
import * as WorkflowCredentialPreapprovals from "../credentials/WorkflowCredentialPreapprovals.ts";
import * as WorkflowRunner from "./WorkflowRunner.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts"; // fork(workflow-first)
import * as WorkflowSchedules from "./WorkflowSchedules.ts";
import * as WorkflowStore from "./WorkflowStore.ts";
import * as WorkflowOutputPreviews from "./WorkflowOutputPreviews.ts";
import * as WorkflowUrlCapture from "./WorkflowUrlCapture.ts";
import { MAX_WAKE_CHARS } from "./driverContext.ts";
import { CommandAvailability } from "@t3tools/shared/shell";

const nodeLayer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

const projectId = ProjectId.make("project-1");
const driver = ThreadId.make("driver");
const child = ThreadId.make("child");
const claimedChild = ThreadId.make("claimed-child");
const stranger = ThreadId.make("stranger");
const foreignContext = ThreadId.make("foreign-context");
/** A thread id that no longer exists, as a deleted thread's origin is. */
const missingThread = ThreadId.make("missing-thread");
const probeContext = ThreadId.make("probe-context");
const changedModelContext = ThreadId.make("changed-model-context");
const slug = "launch-site";
/** A ready GitHub credential, shaped as the store lists it. */
const githubCredential: Credential = {
  id: CredentialId.make("cred-github"),
  name: "GitHub token",
  templateId: "github",
  fields: [
    {
      id: "token",
      label: "Token",
      kind: "secret",
      envVar: "GITHUB_TOKEN",
      required: true,
      highRisk: false,
      secret: { set: true },
    },
  ],
  policy: { projects: "all", alwaysAsk: false, revealAllowed: false },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  useCount: 0,
  status: "ready",
};

/** A second ready credential for tests that attach one after an approval. */
const gitlabCredential: Credential = {
  ...githubCredential,
  id: CredentialId.make("cred-gitlab"),
  name: "GitLab token",
  fields: [
    {
      ...githubCredential.fields[0]!,
      envVar: "GITLAB_TOKEN",
    },
  ],
};
/** A ready credential that never lets a grant stand in for the user. */
const alwaysAskCredential: Credential = {
  ...githubCredential,
  id: CredentialId.make("cred-always-ask"),
  name: "Always-ask token",
  policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
};
/** The portable attachment a workflow file keeps: the type, plus this environment's id. */
const attachmentOf = (credential: Credential): WorkflowCredentialAttachment => ({
  id: credential.templateId,
  kind: "credential",
  templateId: credential.templateId,
  credentialId: credential.id,
});
const preapprovalSession = AuthSessionId.make("user-session");

/** Unexpected external calls must fail loudly, including any obsolete watcher or launch behavior. */
function fake<S extends object>(implemented: Partial<S>): S {
  return new Proxy(implemented, {
    get: (target, key) =>
      key in target
        ? target[key as keyof S]
        : () => Effect.die(`Unexpected call to ${String(key)}`),
  }) as S;
}
const workflow = (steps: WorkflowDefinition["steps"]): WorkflowDefinition => ({
  version: 1,
  name: "Launch site",
  brief: "A site for Kimchi Red.",
  steps,
});
const setup = (
  previewLayer: Layer.Layer<
    WorkflowOutputPreviews.WorkflowOutputPreviews,
    never,
    FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
  > = Layer.succeed(WorkflowOutputPreviews.WorkflowOutputPreviews, {
    prepare: () => Effect.succeed({}),
  }),
  processRun?: ProcessRunner.ProcessRunner["Service"]["run"],
  notify?: {
    redact?: (text: string) => string;
    credentialsAvailable?: boolean;
    unlocked?: boolean;
    /** The vault's credentials as readiness and the pre-approved policy see them. */
    credentials?: ReadonlyArray<Credential>;
    /** Workflow slugs with a scheduled task bound to them. */
    scheduledWorkflows?: ReadonlyArray<string>;
    scheduleKnobs?: WorkflowScheduleKnobs;
    /** The vault's own change signal, so a test can make readiness re-read it. */
    credentialChanges?: Stream.Stream<number>;
    providers?: Effect.Effect<ReadonlyArray<ServerProvider>>;
    projectIds?: ReadonlyArray<ProjectId>;
    mcpList?: () => Effect.Effect<{ servers: ReadonlyArray<WorkflowMcpServerInventory> }>;
    /** Decides whether this delivery attempt succeeds; the count is 1-based. */
    send?: (input: {
      readonly threadId: ThreadId;
      readonly text: string;
      readonly commandId: string;
      readonly messageId: string;
    }) => Effect.Effect<boolean>;
  },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workflow-project-" });
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workflow-home-" });
    const sends: Array<{
      threadId: ThreadId;
      text: string;
      commandId: string;
      messageId: string;
    }> = [];
    const interrupts: ThreadId[] = [];
    const schedules = {
      removals: [] as Array<{ projectId: ProjectId; workflow: WorkflowSlug }>,
      updatedBindings: [] as Array<{
        id: ScheduledTaskId;
        binding: import("@t3tools/contracts").WorkflowScheduleBinding;
      }>,
      failRemoval: false,
      failUpdateBinding: false,
    };
    const probes: Array<{ command: string; args: ReadonlyArray<string>; cwd: string | null }> = [];
    const threads = fake<ThreadManagementService.ThreadManagementService["Service"]>({
      getThreadShell: (threadId) =>
        Effect.succeed(
          threadId === missingThread
            ? null
            : ({
                id: threadId,
                projectId:
                  threadId === foreignContext ? ProjectId.make("another-project") : projectId,
                deletedAt: null,
              } as never),
        ),
      getThreadProjection: (threadId) =>
        Effect.succeed({
          thread: {
            projectId: threadId === foreignContext ? ProjectId.make("another-project") : projectId,
            worktreePath:
              threadId === probeContext
                ? "/tmp/workflow-probe-worktree"
                : threadId === claimedChild
                  ? "/tmp/workflow-claimed-child-worktree"
                  : null,
            modelSelection:
              threadId === probeContext ||
              threadId === changedModelContext ||
              notify?.mcpList !== undefined
                ? {
                    instanceId: "codex-work",
                    model: threadId === probeContext ? "gpt-5-codex" : "gpt-5.1-codex",
                  }
                : undefined,
            lineage: { parentThreadId: threadId === child ? driver : null },
          },
        } as never),
      getProjectThreadRecords: ({ projectId, threadId }) =>
        Effect.succeed({
          thread: {
            id: threadId,
            projectId,
            modelSelection:
              notify?.mcpList === undefined
                ? undefined
                : { instanceId: "codex-work", model: "gpt-5.1-codex" },
            worktreePath: null,
          },
          providerThreads:
            notify?.mcpList === undefined
              ? []
              : [
                  {
                    providerInstanceId: "codex-work",
                    providerSessionId: "mcp-session",
                    ownerNodeId: null,
                    status: "active",
                    driver: "codex",
                  },
                ],
        } as never),
      sendToThread: (input) =>
        Effect.gen(function* () {
          sends.push({
            threadId: input.threadId,
            text: input.text,
            commandId: String(input.commandId),
            messageId: String(input.messageId),
          });
          const ok = notify?.send === undefined ? true : yield* notify.send(input);
          if (!ok)
            return yield* Effect.fail({
              _tag: "ThreadManagementThreadNotFoundError",
              message: "thread unavailable",
            } as never);
          return {} as never;
        }),
      hasReceipt: () => Effect.succeed(false),
      interruptThread: (input) =>
        Effect.sync(() => interrupts.push(input.threadId)).pipe(Effect.as({} as never)),
    });
    const processes = fake<ProcessRunner.ProcessRunner["Service"]>({
      run: (input) => {
        const args = input.args as ReadonlyArray<string>;
        probes.push({ command: input.command, args, cwd: input.cwd ?? null });
        if (processRun !== undefined) return processRun(input);
        const command = String(args.at(-1));
        return Effect.succeed({
          stdout: command.startsWith("node --version")
            ? "v22.11.0\n"
            : command === "vercel whoami"
              ? "t3-user\n"
              : "",
          stderr: "1 test failed",
          code: command.includes("fail") ? 1 : 0,
          timedOut: false,
        } as never);
      },
    });
    const projects = fake<ProjectService.ProjectService["Service"]>({
      getById: (id) =>
        id === projectId
          ? Effect.succeedSome({ id: projectId, workspaceRoot: projectRoot } as never)
          : Effect.succeedNone,
      listShells: () =>
        Effect.succeed((notify?.projectIds ?? [projectId]).map((id) => ({ id })) as never),
    });
    const unlock = Layer.mock(CredentialUnlock.CredentialUnlock)({
      requireUnlocked: () =>
        notify?.unlocked
          ? Effect.void
          : Effect.fail(new CredentialAccessError({ reason: "unlock-required" })),
    });
    const credentialStore = Layer.mock(CredentialStore.CredentialStore)({
      list: () => Effect.succeed(notify?.credentials ?? []),
      ...(notify?.credentialChanges === undefined ? {} : { changes: notify.credentialChanges }),
    });
    const config = ServerConfig.layerTest(projectRoot, path.join(home, "server-state"));
    // The real grant store, so a test sees exactly what the unlocked action recorded.
    const preapprovals = WorkflowCredentialPreapprovals.layer.pipe(
      Layer.provideMerge(unlock),
      Layer.provideMerge(config),
      Layer.provideMerge(nodeLayer),
    );
    const makeLayer = () =>
      WorkflowRunner.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(WorkflowStore.layer, SkillCatalog.layerWithHome(home), previewLayer),
        ),
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(ThreadManagementService.ThreadManagementService, threads),
            Layer.succeed(ProcessRunner.ProcessRunner, processes),
            // Host PATH differs across machines; these fixtures model only the commands they probe.
            Layer.succeed(CommandAvailability, (command) =>
              Effect.succeed(command === "vercel" || command === "node"),
            ),
            unlock,
            Layer.succeed(CredentialRedaction.CredentialRedaction, {
              matcher: () =>
                Effect.succeed(
                  Object.assign(notify?.redact ?? ((text: string) => text), { safeMargin: 0 }),
                ),
              include: () =>
                Effect.succeed(
                  Object.assign(notify?.redact ?? ((text: string) => text), { safeMargin: 0 }),
                ),
              text: (text) => Effect.succeed(text),
              available: () => Effect.succeed(notify?.credentialsAvailable ?? false),
            }),
            Layer.succeed(ProjectService.ProjectService, projects),
            Layer.succeed(
              WorkflowSchedules.WorkflowSchedules,
              WorkflowSchedules.WorkflowSchedules.of({
                add: () => Effect.die("schedule add unused in runner tests"),
                testWebhook: () => Effect.die("webhook test unused in runner tests"),
                list: () =>
                  Effect.succeed({
                    tasks: (notify?.scheduledWorkflows ?? []).map((slug) => {
                      const taskId = `scheduled-${slug}`;
                      const latestBinding = schedules.updatedBindings.findLast(
                        (entry) => entry.id === taskId,
                      )?.binding;
                      return {
                        id: taskId,
                        projectId,
                        threadId: driver,
                        prompt: workflowSchedulePrompt(
                          latestBinding ?? {
                            ...notify?.scheduleKnobs,
                            version: 2,
                            projectId,
                            workflow: slug as WorkflowSlug,
                            inputs: {},
                          },
                        ),
                      };
                    }) as never,
                  }),
                remove: () => Effect.die("schedule remove unused in runner tests"),
                setEnabled: () => Effect.die("schedule setEnabled unused in runner tests"),
                updateBinding: (input) =>
                  schedules.failUpdateBinding
                    ? Effect.fail(new ScheduledTaskError({ message: "Schedules are unavailable." }))
                    : Effect.sync(() => {
                        schedules.updatedBindings.push(input);
                        return { task: {} as never };
                      }),
                removeForWorkflow: (input) =>
                  schedules.failRemoval
                    ? Effect.fail(new ScheduledTaskError({ message: "Schedules are unavailable." }))
                    : Effect.sync(() => {
                        schedules.removals.push(input);
                      }),
              }),
            ),
            credentialStore,
            Layer.mock(ProviderRegistry.ProviderRegistry)({
              getProviders: notify?.providers ?? Effect.succeed([]),
              streamChanges: Stream.empty,
            }),
            config,
          ),
        ),
        // The runner captures this instance, and a test asserts it through the runner's own reads.
        Layer.provideMerge(WorkflowFirst.layer),
        Layer.provideMerge(preapprovals),
        Layer.provideMerge(nodeLayer),
        Layer.provide(
          notify?.mcpList === undefined
            ? Layer.empty
            : Layer.mergeAll(
                Layer.succeed(
                  ProviderInstanceRegistry.ProviderInstanceRegistry,
                  fake<ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]>({
                    getInstance: (instanceId) =>
                      Effect.succeed({
                        instanceId,
                        driverKind: "codex",
                        displayName: "Work Codex",
                      } as never),
                    listUnavailable: Effect.succeed([]),
                    streamChanges: Stream.never,
                  }),
                ),
                Layer.succeed(
                  ProviderSessionManager.ProviderSessionManagerV2,
                  fake<ProviderSessionManager.ProviderSessionManagerV2["Service"]>({
                    get: () =>
                      Effect.succeedSome({
                        instanceId: ProviderInstanceId.make("codex-work"),
                        mcpInventory: { list: notify.mcpList },
                      } as never),
                  }),
                ),
              ),
        ),
      );
    const layer = makeLayer();
    const writeSkill = (name: string, text = name.toUpperCase()) =>
      Effect.gen(function* () {
        const dir = path.join(projectRoot, ".agents", "skills", name);
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* fs.writeFileString(path.join(dir, "SKILL.md"), text);
      });
    return {
      layer,
      makeLayer,
      fs,
      path,
      projectRoot,
      home,
      sends,
      interrupts,
      probes,
      schedules,
      writeSkill,
    };
  });
const start = (definition: WorkflowDefinition) =>
  Effect.gen(function* () {
    const runner = yield* WorkflowRunner.WorkflowRunner;
    yield* runner.save({ projectId, slug, definition, callerThreadId: driver });
    return yield* runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver });
  });
const done = (runId: string, stepId: string, callerThreadId = driver, failed = false) =>
  Effect.gen(function* () {
    const runner = yield* WorkflowRunner.WorkflowRunner;
    return yield* runner.stepDone({
      runId,
      stepId,
      callerThreadId,
      summary: "Finished the research.",
      outputs: { report: "out/report.md" },
      failed,
    });
  });

const scenario = <E>(
  body: (
    h: Effect.Success<ReturnType<typeof setup>>,
  ) => Effect.Effect<
    void,
    E,
    | WorkflowRunner.WorkflowRunner
    | WorkflowStore.WorkflowStore
    | FileSystem.FileSystem
    | Path.Path
    | ServerConfig.ServerConfig
    | import("effect/Scope").Scope
  >,
  processRun?: ProcessRunner.ProcessRunner["Service"]["run"],
) =>
  Effect.gen(function* () {
    const h = yield* setup(undefined, processRun);
    yield* body(h).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer));

/** A scenario whose delivery attempts succeed or fail on demand, to exercise retries. */
const notifyScenario = <E>(
  notify: NonNullable<Parameters<typeof setup>[2]>,
  body: (
    h: Effect.Success<ReturnType<typeof setup>>,
  ) => Effect.Effect<
    void,
    E,
    | WorkflowRunner.WorkflowRunner
    | WorkflowStore.WorkflowStore
    | FileSystem.FileSystem
    | Path.Path
    | ServerConfig.ServerConfig
    | import("effect/Scope").Scope
  >,
) =>
  Effect.gen(function* () {
    const h = yield* setup(undefined, undefined, notify);
    yield* body(h).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer));

describe("WorkflowRunner", () => {
  it.effect("copies templates, preserves clashing files and leaves the bundle untouched", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const before = JSON.stringify(workflowTemplates);
        const template = workflowTemplates[0]!;
        const first = yield* runner.templateUse({ templateId: template.id, projectId });
        const second = yield* runner.templateUse({ templateId: template.id, projectId });
        expect(first.slug).toBe(template.id);
        expect(first.suggestedSchedule).toBeUndefined();
        const scheduled = yield* runner.templateUse({
          templateId: "weekly-growth-loop",
          projectId,
        });
        expect(scheduled.suggestedSchedule).toEqual({
          schedule: { type: "fixed_time", timeOfDay: "10:00", weekdays: [5] },
          knobs: {
            carryOver: true,
            rotate: { inputId: "page", values: ["home", "pricing", "features", "signup"], next: 0 },
          },
        });
        expect(second.slug).toBe(`${template.id}-2`);
        expect(first.path).toBe(`.t3/workflows/${template.id}.json`);
        const copied = JSON.parse(
          yield* h.fs.readFileString(h.path.join(h.projectRoot, second.path)),
        );
        expect(copied).toEqual({ ...template.definition, builtinTemplate: template.id });
        yield* runner.meta({ projectId, slug: first.slug, name: "My copy" });
        expect(JSON.stringify(workflowTemplates)).toBe(before);
        expect((yield* runner.templatesList).length).toBe(10);
        expect(
          (yield* runner.templateUse({ templateId: "missing", projectId }).pipe(Effect.flip))._tag,
        ).toBe("WorkflowInvalidError");
      }),
    ),
  );

  it.effect("broadcasts the new-thread default when the environment has no projects", () =>
    notifyScenario({ projectIds: [] }, () =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const firstClient = yield* Queue.unbounded<WorkflowsSnapshot>();
        const secondClient = yield* Queue.unbounded<WorkflowsSnapshot>();
        yield* runner.subscribeRuns({}).pipe(
          Stream.runForEach((snapshot) => Queue.offer(firstClient, snapshot)),
          Effect.forkScoped,
        );
        yield* runner.subscribeRuns({ projectId }).pipe(
          Stream.runForEach((snapshot) => Queue.offer(secondClient, snapshot)),
          Effect.forkScoped,
        );
        expect((yield* Queue.take(firstClient)).workflows).toEqual([]);
        expect((yield* Queue.take(secondClient)).workflows).toEqual([]);

        yield* runner.setWorkflowFirstForNewThreads(true);

        expect((yield* Queue.take(firstClient)).workflows).toEqual([]);
        expect((yield* Queue.take(secondClient)).workflows).toEqual([]);
      }),
    ),
  );

  it.effect.each([
    { pauseAfter: false, captureFails: false },
    { pauseAfter: true, captureFails: false },
    { pauseAfter: false, captureFails: true },
  ])("captures successful URL output asynchronously (%j)", ({ pauseAfter, captureFails }) =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const bytes = new Uint8Array([255, 216, 255, 217]);
      const h = yield* setup(
        WorkflowOutputPreviews.layer.pipe(
          Layer.provide(
            Layer.succeed(WorkflowUrlCapture.WorkflowUrlCapture, {
              capture: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    captureFails
                      ? Effect.fail(
                          new WorkflowUrlCapture.WorkflowUrlCaptureError({
                            cause: new Error("capture failed"),
                          }),
                        )
                      : Effect.succeed(bytes),
                  ),
                ),
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const config = yield* ServerConfig.ServerConfig;
        const run = yield* start(workflow([{ id: "build", skill: "build", pauseAfter }]));
        const snapshots = yield* Queue.unbounded<WorkflowsSnapshot>();
        yield* runner.subscribeRuns({}).pipe(
          Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
          Effect.forkScoped,
        );
        yield* Queue.take(snapshots);
        const completed = yield* runner.stepDone({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
          summary: "Published",
          failed: false,
          outputs: { site: "https://example.com/?token=private", file: "out/a.png" },
        });
        expect(completed.steps[0]).toMatchObject({
          status: pauseAfter ? "waiting" : "done",
          outputPreviews: { site: { status: "pending" } },
        });
        yield* Deferred.await(started);
        // A blocked capture leaves status and other runner operations available.
        expect((yield* runner.status(run.id)).steps[0]?.status).toBe(
          pauseAfter ? "waiting" : "done",
        );
        yield* Deferred.succeed(release, undefined);
        const updated = yield* Stream.fromQueue(snapshots).pipe(
          Stream.filter((snapshot) =>
            snapshot.runs.some(
              (item) =>
                item.id === run.id &&
                item.steps[0]?.outputPreviews?.site?.status ===
                  (captureFails ? "unavailable" : "ready"),
            ),
          ),
          Stream.runHead,
        );
        expect(updated._tag).toBe("Some");
        const saved = yield* store.readRun(run.id);
        const preview = saved.steps[0]?.outputPreviews?.site;
        expect(preview?.status).toBe(captureFails ? "unavailable" : "ready");
        if (preview?.status === "ready") {
          expect(
            Array.from(
              yield* h.fs.readFile(
                h.path.join(config.attachmentsDir, `${preview.attachmentId}.jpg`),
              ),
            ),
          ).toEqual(Array.from(bytes));
        }
        expect(saved.steps[0]?.outputPreviews).not.toHaveProperty("file");
        expect(saved.status).toBe(pauseAfter ? "waiting" : "done");
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect(
    "backfills an older completed HTML output on restart and preserves the cached preview",
    () =>
      Effect.gen(function* () {
        let captures = 0;
        const h = yield* setup(
          WorkflowOutputPreviews.layer.pipe(
            Layer.provide(
              Layer.succeed(WorkflowUrlCapture.WorkflowUrlCapture, {
                capture: (_url, html) =>
                  Effect.sync(() => {
                    expect(html).toContain("Mochi");
                    captures += 1;
                    return new Uint8Array([255, 216, 255, 217]);
                  }),
              }),
            ),
          ),
        );
        const htmlPath = ".t3/workflows/out/mascot.html";
        yield* h.fs.makeDirectory(h.path.join(h.projectRoot, ".t3/workflows/out"), {
          recursive: true,
        });
        yield* h.fs.writeFileString(
          h.path.join(h.projectRoot, htmlPath),
          "<html><body>Mochi</body></html>",
        );
        const id = yield* Effect.gen(function* () {
          yield* h.writeSkill("build");
          const run = yield* start(workflow([{ id: "build", skill: "build" }]));
          const store = yield* WorkflowStore.WorkflowStore;
          yield* store.writeRun({
            ...run,
            status: "done",
            steps: run.steps.map((step) => ({
              ...step,
              status: "done",
              threadId: child,
              attempts: 1,
              outputs: { html: htmlPath, validation: "Syntax check passed" },
            })),
          });
          return run.id;
        }).pipe(Effect.provide(h.layer));
        const preview = yield* Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const snapshot = yield* runner.subscribeRuns({}).pipe(
            Stream.filter((snapshot) =>
              snapshot.runs.some(
                (run) => run.id === id && run.steps[0]?.outputPreviews?.html?.status === "ready",
              ),
            ),
            Stream.runHead,
          );
          expect(snapshot._tag).toBe("Some");
          const saved = yield* (yield* WorkflowStore.WorkflowStore).readRun(id);
          expect(saved.status).toBe("done");
          expect(saved.steps[0]?.outputs?.html).toBe(htmlPath);
          expect(h.sends).toEqual([]);
          return saved.steps[0]?.outputPreviews?.html;
        }).pipe(Effect.provide(h.layer));
        yield* Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          expect((yield* runner.status(id)).steps[0]?.outputPreviews?.html).toEqual(preview);
        }).pipe(Effect.provide(h.layer));
        expect(captures).toBe(1);
      }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("reconciles interrupted pending previews on restart without recapturing", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      let captures = 0;
      const h = yield* setup(
        WorkflowOutputPreviews.layer.pipe(
          Layer.provide(
            Layer.succeed(WorkflowUrlCapture.WorkflowUrlCapture, {
              capture: () =>
                Effect.gen(function* () {
                  captures += 1;
                  yield* Deferred.succeed(started, undefined);
                  return yield* Effect.never;
                }).pipe(Effect.ensuring(Deferred.succeed(closed, undefined))),
            }),
          ),
        ),
      );
      const runId = yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(workflow([{ id: "build", skill: "build" }]));
        yield* runner.stepDone({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
          summary: "Published",
          failed: false,
          outputs: { site: "https://example.com" },
        });
        yield* Deferred.await(started);
        return run.id;
      }).pipe(Effect.provide(h.layer));
      yield* Deferred.await(closed);
      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const updated = yield* runner.subscribeRuns({}).pipe(
          Stream.filter((snapshot) =>
            snapshot.runs.some(
              (run) =>
                run.id === runId && run.steps[0]?.outputPreviews?.site?.status === "unavailable",
            ),
          ),
          Stream.runHead,
        );
        expect(updated._tag).toBe("Some");
        expect((yield* runner.status(runId)).status).toBe("done");
      }).pipe(Effect.provide(h.layer));
      expect(captures).toBe(1);
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect.each(["agent", "check"])("does not capture URL outputs after %s failure", (failure) =>
    Effect.gen(function* () {
      let captures = 0;
      const h = yield* setup(
        Layer.succeed(WorkflowOutputPreviews.WorkflowOutputPreviews, {
          prepare: () =>
            Effect.sync(() => {
              captures += 1;
              return {};
            }),
        }),
      );
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            {
              id: "build",
              skill: "build",
              ...(failure === "check"
                ? { checks: [{ kind: "command" as const, command: "fail" }] }
                : {}),
            },
          ]),
        );
        const result = yield* runner.stepDone({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
          summary: "Failed",
          failed: failure === "agent",
          outputs: { site: "https://example.com" },
        });
        expect(result.steps[0]?.status).toBe(failure === "agent" ? "failed" : "ready");
        expect(result.steps[0]?.outputPreviews).toBeUndefined();
      }).pipe(Effect.provide(h.layer));
      expect(captures).toBe(0);
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("includes externally added workflow files when choosing draft names", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        yield* runner.listRuns({ projectId });
        yield* store.writeDefinition({ projectId, slug, definition: workflow([]) });
        expect(yield* runner.workflowSlugs(projectId)).toEqual([slug]);
      }),
    ),
  );
  it.effect("resolves runAs for workflow defaults and step overrides in ready steps", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        for (const delegation of [
          undefined,
          "auto",
          "prefer-subagents",
          "always-subagents",
        ] as const) {
          const run = yield* start({
            ...workflow([
              { id: "default", skill: "build", readsFrom: [] },
              { id: "delegated", skill: "build", delegation: "subagent", readsFrom: [] },
              { id: "self", skill: "build", delegation: "self", readsFrom: [] },
            ]),
            ...(delegation === undefined ? {} : { delegation }),
          });
          const expected =
            delegation === "always-subagents"
              ? "subagent"
              : delegation === "prefer-subagents"
                ? "prefer-subagent"
                : "agent-decides";
          expect(run.ready.map((step) => step.runAs)).toEqual([expected, "subagent", "self"]);
          expect(run.ready[0]?.prompt).toContain(`runAs=${expected}`);
          const runner = yield* WorkflowRunner.WorkflowRunner;
          expect((yield* runner.status(run.id)).ready.map((step) => step.runAs)).toEqual([
            expected,
            "subagent",
            "self",
          ]);
          yield* runner.stop(run.id, driver);
        }
      }),
    ),
  );

  it.effect("sets, preserves, and clears execution metadata", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.create({ projectId, slug, name: "Delegation" });
        let item = yield* runner.meta({ projectId, slug, execution: "always-subagents" });
        expect(item.definition?.execution).toBe("always-subagents");
        item = yield* runner.meta({ projectId, slug, brief: "Keep the setting" });
        expect(item.definition?.execution).toBe("always-subagents");
        item = yield* runner.meta({ projectId, slug, execution: null });
        expect(item.definition).not.toHaveProperty("execution");
        const store = yield* WorkflowStore.WorkflowStore;
        expect(yield* store.readDefinition({ projectId, slug })).not.toHaveProperty("execution");
      }),
    ),
  );

  it.effect(
    "imports skills before the workflow, preserves project skills, and rejects duplicates",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const store = yield* WorkflowStore.WorkflowStore;
          yield* h.writeSkill("existing", "KEEP THIS");
          const claudeDirectory = h.path.join(h.projectRoot, ".claude", "skills", "claude-skill");
          yield* h.fs.makeDirectory(claudeDirectory, { recursive: true });
          yield* h.fs.writeFileString(h.path.join(claudeDirectory, "SKILL.md"), "KEEP CLAUDE");
          const input = {
            projectId,
            slug,
            definition: workflow([
              { id: "first", skill: "new-skill" },
              { id: "second", skill: "existing" },
              { id: "third", skill: "claude-skill" },
            ]),
            skills: [
              { name: "new-skill", content: "NEW SKILL" },
              { name: "existing", content: "DO NOT WRITE" },
              { name: "claude-skill", content: "DO NOT COPY" },
            ],
          };
          const saved = yield* runner.importWorkflow(input);
          expect(saved).toEqual({ path: ".t3/workflows/launch-site.json", missingSkills: [] });
          expect(yield* store.readDefinition({ projectId, slug })).toEqual({
            ...input.definition,
            version: 3,
          });
          const raw = JSON.parse(
            yield* h.fs.readFileString(
              h.path.join(h.projectRoot, ".t3", "workflows", "launch-site.json"),
            ),
          );
          expect(raw).toMatchObject({
            version: 3,
            name: "Launch site",
            brief: input.definition.brief,
          });
          expect((yield* runner.skillRead({ projectId, name: "new-skill" })).text).toBe(
            "NEW SKILL\n",
          );
          expect((yield* runner.skillRead({ projectId, name: "existing" })).text).toBe("KEEP THIS");
          expect((yield* runner.skillRead({ projectId, name: "claude-skill" })).text).toBe(
            "KEEP CLAUDE",
          );
          expect(
            yield* h.fs.exists(h.path.join(h.projectRoot, ".agents", "skills", "claude-skill")),
          ).toBe(false);
          const snapshot = yield* runner.listRuns({ projectId });
          expect(snapshot.workflows[0]?.missingSkills).toEqual([]);
          const duplicate = yield* Effect.flip(
            runner.importWorkflow({
              ...input,
              skills: [{ name: "must-not-exist", content: "NO" }],
            }),
          );
          expect(duplicate.message).toContain("already exists");
          expect(
            yield* h.fs.exists(h.path.join(h.projectRoot, ".agents", "skills", "must-not-exist")),
          ).toBe(false);
        }),
      ),
  );

  it.effect("validates an import before writing skills", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const error = yield* Effect.flip(
          runner.importWorkflow({
            projectId,
            slug,
            definition: workflow([{ id: "bad", skill: "new-skill", readsFrom: ["absent"] }]),
            skills: [{ name: "new-skill", content: "NO" }],
          }),
        );
        expect(error._tag).toBe("WorkflowInvalidError");
        expect(yield* h.fs.exists(h.path.join(h.projectRoot, ".agents"))).toBe(false);
      }),
    ),
  );

  it.effect("creates, lists, updates metadata, moves steps, and removes workflows", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.setWorkflowPinned({ projectId, workflow: "missing-workflow" }, true);
        yield* runner.create({ projectId, slug, name: "Created" });
        const initial = yield* runner.listRuns({ projectId });
        expect(initial.workflows).toHaveLength(1);
        expect(initial.workflows[0]?.pinned).toBe(false);
        expect(initial.workflows[0]?.definition?.steps).toEqual([]);
        expect(
          (yield* Effect.flip(runner.create({ projectId, slug, name: "Duplicate" })))._tag,
        ).toBe("WorkflowInvalidError");
        let listing = yield* runner.meta({ projectId, slug, name: "Renamed", brief: "Brief" });
        expect(listing.definition).toMatchObject({ name: "Renamed", brief: "Brief" });
        listing = yield* runner.meta({ projectId, slug, brief: null });
        expect(listing.definition?.brief).toBeUndefined();
        yield* runner.stepPut({ projectId, slug, step: { id: "a", skill: "x" }, after: null });
        yield* runner.stepPut({ projectId, slug, step: { id: "b", skill: "x" }, after: null });
        yield* runner.stepPut({ projectId, slug, step: { id: "c", skill: "x" } });
        listing = yield* runner.stepMove({ projectId, slug, stepId: "c", after: null });
        expect(listing.definition?.steps.map((step) => step.id)).toEqual(["c", "b", "a"]);
        listing = yield* runner.stepMove({ projectId, slug, stepId: "a", after: "c" });
        expect(listing.definition?.steps.map((step) => step.id)).toEqual(["c", "a", "b"]);
        expect(
          (yield* Effect.flip(runner.stepMove({ projectId, slug, stepId: "b", after: "absent" })))
            ._tag,
        ).toBe("WorkflowInvalidError");
        yield* runner.setWorkflowPinned({ projectId, workflow: slug }, true);
        yield* runner.meta({ projectId, slug, name: "Renamed workflow" });
        expect((yield* runner.listRuns({ projectId })).workflows[0]?.pinned).toBe(true);
        expect((yield* runner.preferencesRead).pinnedWorkflows).toContainEqual({
          projectId,
          workflow: slug,
        });
        yield* runner.remove({ projectId, slug });
        expect((yield* runner.preferencesRead).pinnedWorkflows).not.toContainEqual({
          projectId,
          workflow: slug,
        });
        expect((yield* runner.listRuns({ projectId })).workflows).toEqual([]);
      }),
    ),
  );

  it.effect(
    "removes a workflow's schedules with it, and keeps the workflow if they cannot go",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          yield* runner.create({ projectId, slug, name: "Doomed" });
          h.schedules.failRemoval = true;
          const failed = yield* Effect.flip(runner.remove({ projectId, slug }));
          expect(failed._tag).toBe("ScheduledTaskError");
          expect(yield* runner.workflowSlugs(projectId)).toEqual([slug]);
          h.schedules.failRemoval = false;
          yield* runner.remove({ projectId, slug });
          expect(h.schedules.removals).toEqual([{ projectId, workflow: slug }]);
          expect(yield* runner.workflowSlugs(projectId)).toEqual([]);
        }),
      ),
  );

  it.effect(
    "merges and resets saved layout, broadcasts edits, and keeps pinned run definitions",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const store = yield* WorkflowStore.WorkflowStore;
          yield* h.writeSkill("build");
          const note = { id: "remember", text: "Keep this", x: 22, y: 33 };
          const initial = { build: { x: 10, y: 20 } };
          const run = yield* start({
            ...workflow([
              { id: "build", skill: "build" },
              { id: "after", skill: "build" },
            ]),
            notes: [note],
            layout: initial,
          });
          const snapshots = yield* Queue.unbounded<WorkflowsSnapshot>();
          yield* runner.subscribeRuns({}).pipe(
            Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
            Effect.forkScoped,
          );
          yield* Queue.take(snapshots);
          const changed = yield* runner.layoutSet({
            projectId,
            slug,
            callerThreadId: child,
            positions: { after: { x: -50, y: 60 }, absent: { x: 1, y: 1 } },
          });
          expect(changed.definition?.layout).toEqual({ ...initial, after: { x: -50, y: 60 } });
          expect(changed.editedByThreadId).toBe(child);
          expect((yield* Queue.take(snapshots)).workflows[0]?.definition?.layout).toEqual(
            changed.definition?.layout,
          );
          const updated = yield* runner.layoutSet({
            projectId,
            slug,
            positions: { build: { x: 70, y: 80 } },
          });
          expect(updated.definition?.layout).toEqual({
            build: { x: 70, y: 80 },
            after: { x: -50, y: 60 },
          });
          yield* Queue.take(snapshots);
          const reset = yield* runner.layoutSet({
            projectId,
            slug,
            reset: true,
            positions: { after: { x: 9, y: 8 } },
          });
          expect(reset.definition?.layout).toEqual({ after: { x: 9, y: 8 } });
          yield* Queue.take(snapshots);
          const cleared = yield* runner.layoutSet({ projectId, slug, reset: true, positions: {} });
          expect(cleared.definition?.layout).toBeUndefined();
          expect(cleared.definition?.notes).toEqual([note]);
          expect(cleared.definition?.steps).toEqual(run.definition.steps);
          expect((yield* store.readDefinition({ projectId, slug })).layout).toBeUndefined();
          expect((yield* store.readRun(run.id)).definition).toEqual(run.definition);
          expect((yield* runner.status(run.id)).definition.layout).toEqual(initial);
          expect(h.probes).toEqual([]);
          expect(
            (yield* Effect.flip(runner.layoutSet({ projectId, slug: "missing", positions: {} })))
              ._tag,
          ).toBe("WorkflowNotFoundError");
        }),
      ),
  );

  it.effect("keeps the definition revision stable when only card positions move", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.writeSkill("build");
        const definition = workflow([{ id: "build", skill: "build" }]);
        const before = yield* start(definition);
        yield* runner.layoutSet({
          projectId,
          slug,
          positions: { build: { x: 15, y: -20 } },
        });
        const after = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        expect(after.context.definitionRevision).toBe(before.context.definitionRevision);
        expect(after.definition.layout).toEqual({ build: { x: 15, y: -20 } });
      }),
    ),
  );

  it.effect("prunes removed step, approval, check and resource positions on draft writes", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const point = { x: 1, y: 2 };
        const build = {
          id: "build",
          skill: "build",
          gate: true,
          checks: [{ kind: "file" as const, path: "result.txt" }],
          attachments: [{ id: "node", kind: "requirement" as const, requirement: "node" }],
        };
        yield* runner.save({
          projectId,
          slug,
          definition: {
            ...workflow([build, { id: "after", skill: "build" }]),
            layout: {
              build: point,
              after: point,
              "gate:build": point,
              "checks:build": point,
              "resource:build:node": point,
            },
          },
        });
        yield* runner.stepPut({
          projectId,
          slug,
          step: { id: "build", skill: "build", gate: false, checks: [], attachments: [] },
        });
        expect((yield* store.readDefinition({ projectId, slug })).layout).toEqual({
          build: point,
          after: point,
        });
        yield* runner.stepRemove({ projectId, slug, stepId: "build" });
        expect((yield* store.readDefinition({ projectId, slug })).layout).toEqual({ after: point });
      }),
    ),
  );

  it.effect("stores, updates and removes notes without changing the executable graph", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        yield* h.writeSkill("build");
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
        });
        const note = {
          id: "remember",
          text: "Keep the copy short.",
          anchorStepId: "build" as WorkflowSlug,
          x: 12,
          y: 8,
        };
        let listing = yield* runner.notePut({ projectId, slug, note, callerThreadId: driver });
        expect(listing.definition?.notes).toEqual([note]);
        expect(listing.definition?.steps.map((step) => step.id)).toEqual(["build"]);
        expect(listing.editedByThreadId).toBe(driver);
        // Each note edit saves the definition, so a fresh read sees it too.
        expect(yield* store.readDefinition({ projectId, slug })).toMatchObject({
          version: 3,
          steps: [{ id: "build", skill: "build" }],
          notes: [note],
        });

        listing = yield* runner.notePut({
          projectId,
          slug,
          note: { id: "remember", text: "Now shorter." },
        });
        expect(listing.definition?.notes).toEqual([{ id: "remember", text: "Now shorter." }]);

        listing = yield* runner.notePut({
          projectId,
          slug,
          note: { id: "second", text: "Second note." },
        });
        expect(listing.definition?.notes?.map((item) => item.id)).toEqual(["remember", "second"]);
        // Notes are not work: no run is created and the step list is unchanged.
        expect((yield* runner.listRuns({ projectId })).runs).toEqual([]);
        expect(listing.definition?.steps).toHaveLength(1);

        listing = yield* runner.noteRemove({ projectId, slug, noteId: "remember" });
        expect(listing.definition?.notes).toEqual([{ id: "second", text: "Second note." }]);
        listing = yield* runner.noteRemove({ projectId, slug, noteId: "second" });
        expect(listing.definition?.notes).toBeUndefined();

        const missing = yield* Effect.flip(
          runner.noteRemove({ projectId, slug, noteId: "remember" }),
        );
        expect(missing.message).toContain('No note named "remember" exists.');
        const dangling = yield* Effect.flip(
          runner.notePut({
            projectId,
            slug,
            note: { id: "lost", text: "Anchored to nothing.", anchorStepId: "absent" },
          }),
        );
        expect(dangling._tag).toBe("WorkflowInvalidError");
        expect(dangling.message).toContain('anchored to "absent"');
      }),
    ),
  );

  it.effect("rejects duplicate attachment ids and clears a removed step's note anchor", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.writeSkill("build");
        const duplicate = yield* Effect.flip(
          runner.save({
            projectId,
            slug,
            definition: workflow([
              {
                id: "build",
                skill: "build",
                attachments: [
                  { id: "resource", kind: "requirement", requirement: "node" },
                  { id: "resource", kind: "mcp-connection", server: "linear" },
                ],
              },
            ]),
          }),
        );
        expect(duplicate._tag).toBe("WorkflowInvalidError");
        expect(duplicate.message).toContain('more than one attachment named "resource"');

        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
        });
        yield* runner.notePut({
          projectId,
          slug,
          note: { id: "remember", text: "Beside build.", anchorStepId: "build" },
        });
        const listing = yield* runner.stepRemove({ projectId, slug, stepId: "build" });
        expect(listing.definition?.notes).toEqual([{ id: "remember", text: "Beside build." }]);
        expect(listing.definition?.steps).toEqual([]);
      }),
    ),
  );

  it.effect("preflights skill and platform requirements and blocks starts", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.create({ projectId, slug, name: "Check" });
        expect((yield* runner.preflight({ projectId, slug })).map((b) => b.kind)).toContain(
          "invalid",
        );
        yield* runner.stepPut({ projectId, slug, step: { id: "build", skill: "missing" } });
        expect(yield* runner.preflight({ projectId, slug })).toContainEqual(
          expect.objectContaining({ kind: "missing-skill", stepId: "build" }),
        );
        yield* h.writeSkill("missing", "---\nrequires: t3-definitely-missing-cmd\n---\nbody");
        expect((yield* runner.preflight({ projectId, slug })).map((b) => b.kind)).toContain(
          "requirement",
        );
        const current = (yield* HostProcess.Platform) === "darwin" ? "macos" : "linux";
        const other = current === "macos" ? "linux" : "macos";
        yield* h.writeSkill("missing", `---\nrequires: [${current}]\n---\nbody`);
        expect(yield* runner.preflight({ projectId, slug })).toEqual([]);
        yield* h.writeSkill("missing", `---\nrequires: [${other}]\n---\nbody`);
        expect((yield* runner.preflight({ projectId, slug })).map((b) => b.kind)).toContain(
          "requirement",
        );
        expect(
          (yield* Effect.flip(runner.start({ projectId, slug, driverThreadId: driver })))._tag,
        ).toBe("WorkflowBlockedError");
      }),
    ),
  );

  it.effect("notifies the driver for canvas starts and avoids notifying the driver caller", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
        });
        yield* runner.start({ projectId, slug, driverThreadId: driver });
        expect(h.sends).toHaveLength(1);
        yield* runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver });
        expect(h.sends).toHaveLength(1);
      }),
    ),
  );

  it.effect.each(["done", "waiting", "ready", "failed"] as const)(
    "wakes the driver when a subagent reports a step as %s",
    (status) =>
      scenario((h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const run = yield* start(
            workflow([
              {
                id: "build",
                skill: "build",
                ...(status === "waiting" ? { pauseAfter: true } : {}),
                ...(status === "ready"
                  ? { checks: [{ kind: "file" as const, path: "missing.html" }] }
                  : {}),
              },
            ]),
          );
          yield* runner.stepStart({
            runId: run.id,
            stepId: "build",
            callerThreadId: driver,
            threadId: child,
          });
          const result = yield* done(run.id, "build", child, status === "failed");
          expect(result.steps[0]?.status).toBe(status);
          expect(h.sends).toHaveLength(1);
          expect(h.sends[0]?.threadId).toBe(driver);
          expect(h.sends[0]?.text).toContain(`Step "build" in run ${run.id} is ${status}`);
          expect(h.sends[0]?.text).toContain(
            status === "done"
              ? "Report the final result"
              : status === "failed"
                ? "Report the failure"
                : "Call workflow_status",
          );
          if (status !== "ready") {
            yield* Effect.flip(done(run.id, "build", child));
            expect(h.sends).toHaveLength(1);
          }
        }),
      ),
  );

  it.effect("a nested subagent completion wakes the driver with its settled root run", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug: "child-flow",
          definition: workflow([{ id: "work", skill: "build" }]),
        });
        const root = yield* start(
          workflow([{ id: "nested", kind: "workflow", workflow: "child-flow" }]),
        );
        const nested = yield* runner.stepStart({
          runId: root.id,
          stepId: "nested",
          callerThreadId: driver,
        });
        yield* runner.stepStart({
          runId: nested.id,
          stepId: "work",
          callerThreadId: driver,
          threadId: child,
        });
        yield* done(nested.id, "work", child);
        expect((yield* runner.status(root.id)).status).toBe("done");
        expect(h.sends).toHaveLength(1);
        expect(h.sends[0]?.text).toContain(`Workflow run ${root.id}`);
        expect(h.sends[0]?.text).toContain("Report the final result");
      }),
    ),
  );

  it.effect("writes and copies skills and lists project skills first", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.fs.makeDirectory(h.path.join(h.home, ".codex", "skills", "global", "scripts"), {
          recursive: true,
        });
        yield* h.fs.writeFileString(
          h.path.join(h.home, ".codex", "skills", "global", "SKILL.md"),
          "GLOBAL",
        );
        yield* h.fs.writeFileString(
          h.path.join(h.home, ".codex", "skills", "global", "scripts", "x.sh"),
          "echo x",
        );
        yield* runner.skillWrite({
          projectId,
          name: "global",
          content: "REWRITTEN",
          target: "installed",
        });
        expect(
          yield* h.fs.readFileString(h.path.join(h.home, ".codex", "skills", "global", "SKILL.md")),
        ).toBe("REWRITTEN\n");
        yield* runner.skillCopyToProject({ projectId, name: "global" });
        expect(
          yield* h.fs.readFileString(
            h.path.join(h.projectRoot, ".agents", "skills", "global", "scripts", "x.sh"),
          ),
        ).toBe("echo x");
        expect((yield* runner.skillRead({ projectId, name: "global" })).scope).toBe("project");
        expect(
          (yield* Effect.flip(runner.skillCopyToProject({ projectId, name: "global" })))._tag,
        ).toBe("WorkflowSkillError");
        yield* h.writeSkill("local");
        yield* h.fs.makeDirectory(h.path.join(h.home, ".codex", "skills", "another"), {
          recursive: true,
        });
        yield* h.fs.writeFileString(
          h.path.join(h.home, ".codex", "skills", "another", "SKILL.md"),
          "ANOTHER",
        );
        yield* runner.skillWrite({
          projectId,
          name: "local",
          content: "LOCAL EDIT",
          target: "project",
        });
        yield* runner.setSkillPinned("ANOTHER", true);
        const listedSkills = yield* runner.skillList({ projectId });
        expect(listedSkills.map((s) => s.scope)).toEqual(["project", "project", "global"]);
        expect(listedSkills.find((skill) => skill.name === "another")?.pinned).toBe(true);
        expect(
          (yield* Effect.flip(runner.skillCopyToProject({ projectId, name: "local" })))._tag,
        ).toBe("WorkflowSkillError");
      }),
    ),
  );

  it.effect("reruns downstream steps with copied results and fresh skill text", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build", "OLD TEXT");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            { id: "a", skill: "build" },
            { id: "b", skill: "build", readsFrom: ["a"] },
            { id: "c", skill: "build", readsFrom: ["b"] },
          ]),
        });
        const old = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        yield* done(old.id, "a");
        yield* done(old.id, "b");
        yield* done(old.id, "c");
        yield* h.writeSkill("build", "NEW TEXT");
        const rerun = yield* runner.stepRerun({
          runId: old.id,
          stepId: "b",
          callerThreadId: driver,
        });
        expect(rerun.rerunOf).toMatchObject({ runId: old.id, stepId: "b" });
        expect(rerun.steps.map((s) => s.status)).toEqual(["done", "ready", "queued"]);
        expect(rerun.steps[0]?.summary).toBe("Finished the research.");
        expect(rerun.ready[0]?.prompt).toContain("NEW TEXT");
        expect((yield* runner.status(old.id)).steps.map((s) => s.status)).toEqual([
          "done",
          "done",
          "done",
        ]);
        const live = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        expect((yield* Effect.flip(runner.stepRerun({ runId: live.id, stepId: "a" })))._tag).toBe(
          "WorkflowStepStateError",
        );
      }),
    ),
  );

  it.effect("blocks a rerun when its current resources are unavailable", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const original = yield* start(workflow([{ id: "build", skill: "build" }]));
        yield* done(original.id, "build");
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [
                {
                  id: "vercel",
                  kind: "service-login",
                  service: "vercel",
                  command: "vercel whoami fail",
                },
              ],
            },
          ]),
          callerThreadId: driver,
        });
        const blocked = yield* Effect.flip(
          runner.stepRerun({ runId: original.id, stepId: "build", callerThreadId: driver }),
        );
        expect(blocked._tag).toBe("WorkflowBlockedError");
        expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(1);
        expect((yield* runner.status(original.id)).steps[0]?.outputs).toEqual({
          report: "out/report.md",
        });
      }),
    ),
  );

  it.effect("skips ready steps, promotes followers, and notifies for canvas skips", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            { id: "a", skill: "build" },
            { id: "b", skill: "build", readsFrom: ["a"] },
          ]),
        );
        const skipped = yield* runner.stepSkip({ runId: run.id, stepId: "a" });
        expect(skipped.steps.map((s) => s.status)).toEqual(["skipped", "ready"]);
        expect(h.sends).toHaveLength(1);
        const doneRun = yield* done(run.id, "b");
        expect((yield* Effect.flip(runner.stepSkip({ runId: doneRun.id, stepId: "b" })))._tag).toBe(
          "WorkflowStepStateError",
        );
      }),
    ),
  );

  it.effect(
    "starts ready steps, links a subagent once, checks results and promotes followers",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("research", "PINNED RESEARCH");
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const run = yield* start(
            workflow([
              { id: "research", skill: "research" },
              {
                id: "build",
                skill: "build",
                checks: [
                  { kind: "file", path: "site.html", minBytes: 3 },
                  { kind: "command", command: "pass" },
                ],
              },
            ]),
          );
          expect(run.steps.map((step) => step.status)).toEqual(["ready", "queued"]);
          expect(run.ready[0]?.prompt).toContain("PINNED RESEARCH");
          yield* h.writeSkill("research", "CHANGED SKILL");
          expect((yield* runner.status(run.id)).ready[0]?.prompt).toContain("PINNED RESEARCH");
          const running = yield* runner.stepStart({
            runId: run.id,
            stepId: "research",
            callerThreadId: driver,
            threadId: child,
          });
          expect(running.steps[0]).toMatchObject({
            status: "running",
            threadId: child,
            attempts: 1,
          });
          expect(
            (yield* runner.stepStart({
              runId: run.id,
              stepId: "research",
              callerThreadId: driver,
              threadId: child,
            })).steps[0]?.attempts,
          ).toBe(1);
          const next = yield* done(run.id, "research", child);
          expect(next.steps.map((step) => step.status)).toEqual(["done", "ready"]);
          expect(next.ready[0]?.prompt).toContain("Finished the research.");
          expect(next.ready[0]?.prompt).toContain("report: out/report.md");
          yield* h.fs.writeFileString(h.path.join(h.projectRoot, "site.html"), "SITE");
          const finished = yield* done(run.id, "build");
          expect(finished.status).toBe("done");
          expect(finished.steps[1]).toMatchObject({
            attempts: 1,
            threadId: driver,
            checks: [{ ok: true }, { ok: true }],
          });
          expect(finished.ready).toEqual([]);
          expect(h.sends).toHaveLength(1);
          expect(h.sends[0]?.text).toContain('Step "research"');
        }),
      ),
  );

  it.effect.each([true, false])(
    "checks an absolute output outside the project (exists: %s)",
    (exists) =>
      scenario((h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const directory = yield* h.fs.makeTempDirectoryScoped({ prefix: "t3-workflow-output-" });
          const output = h.path.join(directory, "index.html");
          if (exists) yield* h.fs.writeFileString(output, "<h1>Mars</h1>");
          const run = yield* start(
            workflow([
              {
                id: "build",
                skill: "build",
                checks: [{ kind: "file", path: output, minBytes: 3 }],
              },
            ]),
          );
          const finished = yield* done(run.id, "build");
          expect(finished.steps[0]?.checks).toEqual([
            expect.objectContaining({
              ok: exists,
              message: expect.stringContaining(exists ? "exists" : "is missing"),
            }),
          ]);
          expect(finished.steps[0]?.status).toBe(exists ? "done" : "ready");
        }),
      ),
  );

  it.effect("returns failed checks to ready and fails the third attempt", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            { id: "build", skill: "build", checks: [{ kind: "command", command: "fail" }] },
            { id: "deploy", skill: "build", gate: true, readsFrom: ["build"] },
          ]),
        );
        for (let attempt = 1; attempt <= 3; attempt++) {
          yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
          const updated = yield* done(run.id, "build");
          expect(updated.steps[0]).toMatchObject({
            status: attempt === 3 ? "failed" : "ready",
            attempts: attempt,
            checks: [{ ok: false }],
          });
          expect(updated.steps[0]?.error).toContain("1 test failed");
          expect(updated.status).toBe(attempt === 3 ? "failed" : "running");
          // The gated dependent is never released by a failed check, and the run dying skips it.
          expect(updated.steps[1]?.status).toBe(attempt === 3 ? "skipped" : "queued");
          expect(updated.ready).toEqual(
            attempt === 3 ? [] : [expect.objectContaining({ stepId: "build" })],
          );
          if (attempt < 3)
            expect(updated.ready[0]?.prompt).toContain(`This is attempt ${attempt + 1}`);
        }
        expect(h.sends).toEqual([]);
      }),
    ),
  );

  it.effect.each([1, 3])(
    "rechecks recorded outputs without consuming an agent attempt (attempts: %s)",
    (attempts) =>
      scenario((h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const output = h.path.join(h.home, "index.html");
          const run = yield* start(
            workflow([
              { id: "build", skill: "build", checks: [{ kind: "file", path: output }] },
              { id: "deploy", skill: "build", gate: true },
            ]),
          );
          for (let i = 0; i < attempts; i++) yield* done(run.id, "build");
          const failed = yield* runner.stepChecksRun({ runId: run.id, stepId: "build" });
          expect(failed.steps[0]).toMatchObject({ attempts, checks: [{ ok: false }] });
          yield* h.fs.writeFileString(output, "<h1>Mars</h1>");
          const checked = yield* runner.stepChecksRun({ runId: run.id, stepId: "build" });
          expect(checked.steps[0]).toMatchObject({
            attempts,
            status: "done",
            threadId: driver,
            summary: "Finished the research.",
            outputs: { report: "out/report.md" },
            checks: [{ ok: true }],
          });
          expect(checked.steps[0]?.error).toBeUndefined();
          expect(h.sends.some((message) => message.text.includes('Step "build"'))).toBe(true);
          expect(checked.steps[0]?.checking).toBeUndefined();
          // Historical runs stay finished; a checks-only action must not restart cancelled work.
          expect(checked.status).toBe(attempts === 3 ? "failed" : "waiting");
          expect(checked.steps[1]?.status).toBe(attempts === 3 ? "skipped" : "waiting");
          expect(
            (yield* Effect.flip(runner.stepChecksRun({ runId: run.id, stepId: "build" })))._tag,
          ).toBe("WorkflowStepStateError");
        }),
      ),
  );

  it.effect("cancels checks-only retries on stop and refuses concurrent validation", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let calls = 0;
      const h = yield* setup(undefined, () => {
        calls += 1;
        return calls === 1
          ? Effect.succeed({
              code: ChildProcessSpawner.ExitCode(1),
              stdout: "",
              stderr: "failed",
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            })
          : Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
      });
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            { id: "build", skill: "build", checks: [{ kind: "command", command: "validate" }] },
          ]),
        );
        yield* done(run.id, "build");
        const denied = yield* Effect.flip(
          runner.stepChecksRun({ runId: run.id, stepId: "build", callerThreadId: stranger }),
        );
        expect(denied._tag).toBe("WorkflowStepCallerError");
        const retry = yield* runner
          .stepChecksRun({ runId: run.id, stepId: "build" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        expect((yield* runner.status(run.id)).steps[0]).toMatchObject({
          status: "running",
          attempts: 1,
          checking: { token: expect.any(String) },
        });
        const duplicate = yield* Effect.flip(
          runner.stepChecksRun({ runId: run.id, stepId: "build" }),
        );
        expect(duplicate._tag).toBe("WorkflowStepStateError");
        yield* runner.stop(run.id);
        const stopped = yield* Fiber.join(retry);
        expect(stopped.status).toBe("stopped");
        expect(stopped.steps[0]?.checking).toBeUndefined();
        expect(calls).toBe(2);
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("resolves home-relative check paths in the server's home", () =>
    Effect.gen(function* () {
      const h = yield* setup();
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        yield* h.fs.writeFileString(h.path.join(h.home, "index.html"), "Mars");
        const run = yield* start(
          workflow([
            {
              id: "build",
              skill: "build",
              checks: [{ kind: "file", path: "~/index.html", minBytes: 4 }],
            },
          ]),
        );
        expect((yield* done(run.id, "build")).steps[0]?.checks).toEqual([
          expect.objectContaining({ ok: true }),
        ]);
      }).pipe(Effect.provide(h.layer), Effect.provideService(HostProcess.HomeDirectory, h.home));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("keeps the runner free while a command check runs", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const h = yield* setup(undefined, (input) => {
        const command = String(input.args.at(-1));
        if (!command.includes("slow-check")) return Effect.die(`unexpected command ${command}`);
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.map(() => ({ stdout: "", stderr: "", code: 0, timedOut: false }) as never),
        );
      });
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            {
              id: "build",
              skill: "build",
              checks: [{ kind: "command", command: "slow-check" }],
            },
            { id: "ship", skill: "build", readsFrom: ["build"] },
          ]),
        );
        yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
        const finishing = yield* done(run.id, "build").pipe(Effect.forkScoped);
        yield* Deferred.await(started);

        // Status and another run's stop both need the lock; the slow check must not hold it.
        const validating = yield* runner.status(run.id);
        expect(validating.steps[0]).toMatchObject({
          status: "running",
          attempts: 1,
          checking: { token: expect.any(String) },
        });
        expect(validating.steps[1]?.status).toBe("queued");
        expect(validating.ready).toEqual([]);
        const otherRun = yield* start(workflow([{ id: "other", skill: "build" }]));
        expect((yield* runner.stop(otherRun.id)).status).toBe("stopped");

        yield* Deferred.succeed(release, undefined);
        const finished = yield* Fiber.join(finishing);
        expect(finished.steps[0]).toMatchObject({ status: "done", attempts: 1 });
        expect(finished.steps[0]?.checking).toBeUndefined();
        expect(finished.steps[1]?.status).toBe("ready");
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("stop during checking cancels the check and cannot revive the run", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let cancelled = false;
      const h = yield* setup(undefined, (input) => {
        const command = String(input.args.at(-1));
        if (!command.includes("slow-check")) return Effect.die(`unexpected command ${command}`);
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.map(() => ({ stdout: "", stderr: "", code: 0, timedOut: false }) as never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancelled = true;
            }),
          ),
        );
      });
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            {
              id: "build",
              skill: "build",
              checks: [{ kind: "command", command: "slow-check" }],
            },
            { id: "ship", skill: "build", readsFrom: ["build"] },
          ]),
        );
        yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
        const finishing = yield* done(run.id, "build").pipe(Effect.forkScoped);
        yield* Deferred.await(started);

        const stopped = yield* runner.stop(run.id, driver);
        expect(stopped.status).toBe("stopped");
        expect(stopped.steps.map((step) => step.status)).toEqual(["skipped", "skipped"]);
        expect(stopped.steps[0]?.checking).toBeUndefined();
        const settled = yield* Fiber.join(finishing);
        expect(settled.status).toBe("stopped");
        expect(settled.steps.every((step) => step.status === "skipped")).toBe(true);
        expect(cancelled).toBe(true);

        // A result arriving after the stop is ignored instead of un-skipping the step.
        yield* Deferred.succeed(release, undefined);
        const after = yield* runner.status(run.id);
        expect(after.status).toBe("stopped");
        expect(after.steps.every((step) => step.status === "skipped")).toBe(true);
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("rejects a duplicate completion while checks are in flight", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const h = yield* setup(undefined, (input) => {
        const command = String(input.args.at(-1));
        if (!command.includes("slow-check")) return Effect.die(`unexpected command ${command}`);
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.map(() => ({ stdout: "", stderr: "", code: 0, timedOut: false }) as never),
        );
      });
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            {
              id: "build",
              skill: "build",
              checks: [{ kind: "command", command: "slow-check" }],
            },
          ]),
        );
        yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
        const finishing = yield* done(run.id, "build").pipe(Effect.forkScoped);
        yield* Deferred.await(started);

        const duplicate = yield* Effect.flip(done(run.id, "build"));
        expect(duplicate).toMatchObject({
          _tag: "WorkflowStepStateError",
          expected: "validating",
        });
        // Starting again is also a no-op: it neither clears nor consumes the reserved attempt.
        const restarted = yield* runner.stepStart({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
        });
        expect(restarted.steps[0]).toMatchObject({
          status: "running",
          attempts: 1,
          checking: { token: expect.any(String) },
        });

        yield* Deferred.succeed(release, undefined);
        const finished = yield* Fiber.join(finishing);
        expect(finished.steps[0]).toMatchObject({ status: "done", attempts: 1 });
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("clears a failed check on retry and opens the gate only after it passes", () =>
    Effect.gen(function* () {
      let checksRun = 0;
      const h = yield* setup(undefined, () =>
        Effect.sync(() => {
          checksRun += 1;
          const failed = checksRun < 3;
          return {
            stdout: "",
            stderr: failed ? "1 test failed" : "",
            code: failed ? 1 : 0,
            timedOut: false,
          } as never;
        }),
      );
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            { id: "build", skill: "build", checks: [{ kind: "command", command: "flaky" }] },
            { id: "deploy", skill: "build", gate: true, readsFrom: ["build"] },
          ]),
        );
        yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
        const first = yield* done(run.id, "build");
        expect(first.steps[0]).toMatchObject({
          status: "ready",
          attempts: 1,
          checks: [{ ok: false }],
        });
        expect(first.steps[1]?.status).toBe("queued");
        expect(first.ready[0]?.prompt).toContain("1 test failed");

        const retry = yield* runner.stepStart({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
        });
        expect(retry.steps[0]).toMatchObject({ status: "running", attempts: 2 });
        expect(retry.steps[0]?.checks).toBeUndefined();
        expect(retry.steps[0]?.error).toBeUndefined();

        const second = yield* done(run.id, "build");
        expect(second.steps[0]).toMatchObject({ status: "ready", attempts: 2 });
        expect(second.steps[1]?.status).toBe("queued");

        yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
        const passed = yield* done(run.id, "build");
        expect(passed.steps[0]).toMatchObject({ status: "done", attempts: 3 });
        expect(passed.steps[1]).toMatchObject({ status: "waiting", waitingFor: "approval" });
        expect(passed.ready).toEqual([]);
        expect(passed.status).toBe("waiting");

        const approved = yield* runner.approve({
          runId: run.id,
          stepId: "deploy",
          callerThreadId: driver,
        });
        expect(approved.steps[1]?.status).toBe("ready");
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect(
    "returns an interrupted validation to ready on restart without unlocking dependents",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const never = yield* Deferred.make<void>();
        let runId = "";
        const h = yield* setup(undefined, (input) => {
          const command = String(input.args.at(-1));
          if (!command.includes("slow-check")) return Effect.die(`unexpected command ${command}`);
          return Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(never)),
            Effect.map(() => ({ stdout: "", stderr: "", code: 0, timedOut: false }) as never),
          );
        });
        yield* Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const run = yield* start(
            workflow([
              {
                id: "build",
                skill: "build",
                checks: [{ kind: "command", command: "slow-check" }],
              },
              { id: "ship", skill: "build", readsFrom: ["build"] },
            ]),
          );
          runId = run.id;
          yield* runner.stepStart({ runId, stepId: "build", callerThreadId: driver });
          const finishing = yield* done(runId, "build").pipe(Effect.forkScoped);
          yield* Deferred.await(started);
          // Interrupting the request must return the unverified attempt to the driver.
          yield* Fiber.interrupt(finishing);
          const recovered = yield* runner.status(runId);
          expect(recovered.steps[0]).toMatchObject({
            status: "ready",
            attempts: 1,
            error: expect.stringContaining("interrupted"),
          });
          expect(recovered.steps[0]?.checking).toBeUndefined();
        }).pipe(Effect.provide(h.layer));

        // A fresh runner reads the persisted record the way a restarted server would.
        yield* Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const recovered = yield* runner.status(runId);
          expect(recovered.steps[0]).toMatchObject({
            status: "ready",
            attempts: 1,
            error: expect.stringContaining("interrupted"),
          });
          expect(recovered.steps[0]?.checking).toBeUndefined();
          expect(recovered.steps[1]?.status).toBe("queued");
          expect(recovered.ready.map((step) => step.stepId)).toEqual(["build"]);
          const retried = yield* runner.stepStart({
            runId,
            stepId: "build",
            callerThreadId: driver,
          });
          expect(retried.steps[0]).toMatchObject({ status: "running", attempts: 2 });
        }).pipe(Effect.provide(h.makeLayer()));
      }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("does not offer a fourth attempt when validation recovery reaches the cap", () =>
    Effect.gen(function* () {
      let runId = "";
      const h = yield* setup();
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const store = yield* WorkflowStore.WorkflowStore;
        const run = yield* start(
          workflow([
            { id: "build", skill: "build", checks: [{ kind: "command", command: "check" }] },
            { id: "ship", skill: "build", readsFrom: ["build"] },
          ]),
        );
        runId = run.id;
        const saved = yield* store.readRun(runId);
        yield* store.writeRun({
          ...saved,
          steps: saved.steps.map((step) =>
            step.stepId === "build"
              ? {
                  ...step,
                  status: "running" as const,
                  attempts: 3,
                  checking: { token: "interrupted", startedAt: "2026-01-01T00:00:00.000Z" },
                }
              : step,
          ),
        });
      }).pipe(Effect.provide(h.layer));

      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const recovered = yield* runner.status(runId);
        expect(recovered.status).toBe("failed");
        expect(recovered.steps[0]).toMatchObject({
          status: "failed",
          attempts: 3,
          error: expect.stringContaining("interrupted"),
        });
        expect(recovered.steps[0]?.checking).toBeUndefined();
        expect(recovered.steps[1]?.status).toBe("skipped");
        expect(recovered.ready).toEqual([]);
        const startError = yield* Effect.flip(
          runner.stepStart({ runId, stepId: "build", callerThreadId: driver }),
        );
        expect(startError._tag).toBe("WorkflowStepStateError");
      }).pipe(Effect.provide(h.makeLayer()));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("keeps a terminal validation terminal when reconciling a stray checking token", () =>
    Effect.gen(function* () {
      let runId = "";
      const h = yield* setup();
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const store = yield* WorkflowStore.WorkflowStore;
        const run = yield* start(workflow([{ id: "build", skill: "build" }]));
        runId = run.id;
        yield* done(runId, "build");
        const saved = yield* store.readRun(runId);
        yield* store.writeRun({
          ...saved,
          steps: saved.steps.map((step) => ({
            ...step,
            checking: { token: "stale", startedAt: "2026-01-01T00:00:00.000Z" },
          })),
        });
      }).pipe(Effect.provide(h.layer));

      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const recovered = yield* runner.status(runId);
        expect(recovered.status).toBe("done");
        expect(recovered.steps[0]?.status).toBe("done");
        expect(recovered.steps[0]?.checking).toBeUndefined();
      }).pipe(Effect.provide(h.makeLayer()));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("holds a gate and notifies the driver on UI approval only", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("deploy");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const definition = workflow([{ id: "deploy", skill: "deploy", gate: true }]);
        const run = yield* start(definition);
        expect(run).toMatchObject({
          status: "waiting",
          ready: [],
          steps: [{ status: "waiting", waitingFor: "approval", attempts: 0 }],
        });
        expect((yield* Effect.flip(done(run.id, "deploy")))._tag).toBe("WorkflowStepStateError");
        const approved = yield* runner.approve({ runId: run.id, stepId: "deploy" });
        expect(approved.steps[0]).toMatchObject({ status: "ready", attempts: 0 });
        expect(h.sends).toHaveLength(1);
        expect(h.sends[0]).toMatchObject({ threadId: driver });
        expect(h.sends[0]?.text).toContain("Call workflow_status");
        const second = yield* start(definition);
        yield* runner.approve({ runId: second.id, stepId: "deploy", callerThreadId: driver });
        expect(h.sends).toHaveLength(1);
        expect((yield* Effect.flip(runner.approve({ runId: run.id, stepId: "deploy" })))._tag).toBe(
          "WorkflowStepStateError",
        );
      }),
    ),
  );

  it.effect("pauses after completion until resume promotes followers", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            { id: "build", skill: "build", pauseAfter: true },
            { id: "ship", skill: "build" },
          ]),
        );
        const paused = yield* done(run.id, "build");
        expect(paused.steps.map((step) => step.status)).toEqual(["waiting", "queued"]);
        expect(paused.steps[0]?.waitingFor).toBe("resume");
        const resumed = yield* runner.resume({ runId: run.id, stepId: "build" });
        expect(resumed.steps.map((step) => step.status)).toEqual(["done", "ready"]);
        expect(h.sends).toHaveLength(1);
        yield* done(run.id, "ship");
        expect((yield* runner.status(run.id)).status).toBe("done");
      }),
    ),
  );

  it.effect("stops parallel steps, interrupts only subagents and notifies the driver", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            { id: "page", skill: "build", readsFrom: [] },
            { id: "images", skill: "build", readsFrom: [] },
            { id: "final", skill: "build" },
          ]),
        );
        expect(run.steps.map((step) => step.status)).toEqual(["ready", "ready", "queued"]);
        expect(run.ready.map((step) => step.stepId)).toEqual(["page", "images"]);
        yield* runner.stepStart({ runId: run.id, stepId: "page", callerThreadId: driver });
        yield* runner.stepStart({
          runId: run.id,
          stepId: "images",
          callerThreadId: driver,
          threadId: child,
        });
        const stopped = yield* runner.stop(run.id);
        expect(stopped.status).toBe("stopped");
        expect(stopped.steps.every((step) => step.status === "skipped")).toBe(true);
        expect(h.interrupts).toEqual([child]);
        expect(h.sends).toHaveLength(1);
        expect((yield* Effect.flip(done(run.id, "page")))._tag).toBe("WorkflowStepStateError");
      }),
    ),
  );

  it.effect("explicit failure stops other running subagents without retrying", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const run = yield* start(
          workflow([
            { id: "page", skill: "build", readsFrom: [] },
            { id: "images", skill: "build", readsFrom: [] },
          ]),
        );
        yield* runner.stepStart({
          runId: run.id,
          stepId: "images",
          callerThreadId: driver,
          threadId: child,
        });
        const failed = yield* done(run.id, "page", driver, true);
        expect(failed.status).toBe("failed");
        expect(failed.steps.map((step) => step.status)).toEqual(["failed", "skipped"]);
        expect(h.interrupts).toEqual([child]);
      }),
    ),
  );

  it.effect(
    "rejects unrelated reporters and starters, accepts driver children on ready steps",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const run = yield* start(workflow([{ id: "build", skill: "build" }]));
          expect((yield* Effect.flip(done(run.id, "build", stranger)))._tag).toBe(
            "WorkflowStepCallerError",
          );
          expect(
            (yield* Effect.flip(
              runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: child }),
            ))._tag,
          ).toBe("WorkflowStepCallerError");
          const completed = yield* done(run.id, "build", child);
          expect(completed.steps[0]).toMatchObject({
            status: "done",
            threadId: child,
            attempts: 1,
          });
        }),
      ),
  );

  it.effect("builds definitions live and broadcasts edits and missing-skill changes", () =>
    scenario((_h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const snapshots = yield* Queue.unbounded<WorkflowsSnapshot>();
        yield* runner.subscribeRuns({}).pipe(
          Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
          Effect.forkScoped,
        );
        expect((yield* Queue.take(snapshots)).workflows).toEqual([]);
        yield* runner.save({ projectId, slug, definition: workflow([]), callerThreadId: driver });
        expect((yield* Queue.take(snapshots)).workflows[0]).toMatchObject({
          workflow: slug,
          editedByThreadId: driver,
        });
        expect(
          (yield* Effect.flip(
            runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver }),
          ))._tag,
        ).toBe("WorkflowInvalidError");
        yield* runner.stepPut({
          projectId,
          slug,
          step: { id: "build", skill: "missing" },
          callerThreadId: driver,
        });
        expect((yield* Queue.take(snapshots)).workflows[0]?.missingSkills).toEqual(["missing"]);
        expect(
          (yield* Effect.flip(
            runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver }),
          ))._tag,
        ).toBe("WorkflowSkillsMissingError");
        yield* runner.skillSave({
          projectId,
          name: "missing",
          content: "NEW SKILL",
          callerThreadId: child,
        });
        expect((yield* Queue.take(snapshots)).workflows[0]).toMatchObject({
          missingSkills: [],
          editedByThreadId: child,
        });
        yield* runner.stepPut({
          projectId,
          slug,
          step: { id: "after", skill: "missing", readsFrom: ["build"] },
          after: "build",
          callerThreadId: driver,
        });
        yield* Queue.take(snapshots);
        yield* runner.stepPut({
          projectId,
          slug,
          step: { id: "build", skill: "missing", note: "Changed" },
          callerThreadId: driver,
        });
        expect((yield* Queue.take(snapshots)).workflows[0]?.definition?.steps[0]?.note).toBe(
          "Changed",
        );
        const removed = yield* runner.stepRemove({
          projectId,
          slug,
          stepId: "build",
          callerThreadId: driver,
        });
        expect(removed.definition?.steps).toEqual([
          { id: "after", skill: "missing", readsFrom: [] },
        ]);
        expect((yield* Queue.take(snapshots)).workflows[0]?.definition?.steps).toEqual(
          removed.definition?.steps,
        );
        expect(
          (yield* Effect.flip(
            runner.stepPut({ projectId, slug: "absent", step: { id: "build", skill: "missing" } }),
          ))._tag,
        ).toBe("WorkflowNotFoundError");
        expect((yield* runner.listRuns({ projectId: ProjectId.make("other") })).workflows).toEqual(
          [],
        );
      }),
    ),
  );

  it.effect("refuses skill path traversal and symlink writes outside the project", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        expect(
          (yield* Effect.flip(runner.skillSave({ projectId, name: "../escape", content: "NO" })))
            ._tag,
        ).toBe("WorkflowFileError");
        yield* h.fs.makeDirectory(h.path.join(h.projectRoot, ".agents", "skills"), {
          recursive: true,
        });
        yield* h.fs.makeDirectory(h.path.join(h.home, "global"));
        yield* h.fs.writeFileString(h.path.join(h.home, "global", "SKILL.md"), "GLOBAL");
        yield* h.fs.symlink(
          h.path.join(h.home, "global"),
          h.path.join(h.projectRoot, ".agents", "skills", "shared"),
        );
        expect(
          (yield* Effect.flip(runner.skillSave({ projectId, name: "shared", content: "NO" })))._tag,
        ).toBe("WorkflowFileError");
        expect(yield* h.fs.readFileString(h.path.join(h.home, "global", "SKILL.md"))).toBe(
          "GLOBAL",
        );
        yield* h.fs.symlink(
          h.path.join(h.home, "not-created"),
          h.path.join(h.projectRoot, ".agents", "skills", "dangling"),
        );
        expect(
          (yield* Effect.flip(runner.skillSave({ projectId, name: "dangling", content: "NO" })))
            ._tag,
        ).toBe("WorkflowFileError");
        expect(yield* h.fs.exists(h.path.join(h.home, "not-created"))).toBe(false);
      }),
    ),
  );

  it.effect("keeps cached runs, caps at newest 30 and skips old-format files", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const config = yield* ServerConfig.ServerConfig;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
        });
        const started = yield* Effect.forEach(Array.from({ length: 32 }), () =>
          runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver }),
        );
        const newest = started
          .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
          .slice(0, 30);
        expect((yield* runner.listRuns({})).runs.map((run) => run.id)).toEqual(
          newest.map((run) => run.id),
        );
        yield* h.fs.remove(h.path.join(config.stateDir, "workflow-runs", `${newest[0]!.id}.json`));
        expect((yield* runner.status(newest[0]!.id)).id).toBe(newest[0]!.id);
        yield* h.fs.writeFileString(
          h.path.join(config.stateDir, "workflow-runs", "old-run.json"),
          JSON.stringify({
            ...newest[0],
            id: "old-run",
            driverThreadId: undefined,
            startedByThreadId: driver,
            launch: {},
          }),
        );
        expect((yield* store.listRuns).some((run) => run.id === "old-run")).toBe(false);
        expect((yield* runner.listRuns({ projectId: ProjectId.make("unrelated") })).runs).toEqual(
          [],
        );
      }),
    ),
  );

  it.effect("pins omitted input defaults and lets explicit run values override them", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.writeSkill("test", "Build {{input.appName}} from {{input.homepage}}");
        yield* runner.save({
          projectId,
          slug,
          definition: {
            ...workflow([{ id: "build", skill: "test" }]),
            inputs: [
              {
                id: "appName",
                label: "App name",
                kind: "text",
                required: true,
                defaultValue: "Kimchi",
              },
              {
                id: "homepage",
                label: "Homepage",
                kind: "url",
                defaultValue: "https://example.test",
              },
            ],
          },
        });
        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        expect(run.inputs).toEqual({ appName: "Kimchi", homepage: "https://example.test" });
        expect(run.ready[0]?.prompt).toContain("Build Kimchi from https://example.test");
        expect((yield* runner.status(run.id)).inputs).toEqual(run.inputs);
        yield* done(run.id, "build");
        const override = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
          inputs: { appName: "Override", homepage: "" },
        });
        expect(override.inputs).toEqual({ appName: "Override", homepage: "" });
        const blank = yield* Effect.flip(
          runner.start({
            projectId,
            slug,
            driverThreadId: driver,
            callerThreadId: driver,
            inputs: { appName: " " },
          }),
        );
        expect(blank._tag).toBe("WorkflowInputsError");
      }),
    ),
  );

  it.effect("uses child input defaults when a nested step omits their mappings", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.writeSkill("test", "Build {{input.app}} from {{input.homepage}}");
        yield* runner.save({
          projectId,
          slug: "child-workflow",
          definition: {
            ...workflow([{ id: "work", skill: "test" }]),
            inputs: [
              { id: "app", label: "App", kind: "text", required: true, defaultValue: "Kimchi" },
              {
                id: "homepage",
                label: "Homepage",
                kind: "url",
                defaultValue: "https://default.test",
              },
            ],
          },
        });
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "nested",
              kind: "workflow",
              workflow: "child-workflow",
              inputs: { homepage: "https://mapped.test" },
            },
          ]),
        });
        const parent = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        const nested = yield* runner.stepStart({
          runId: parent.id,
          stepId: "nested",
          callerThreadId: driver,
        });
        expect(nested.inputs).toEqual({ app: "Kimchi", homepage: "https://mapped.test" });
        expect(nested.ready[0]?.prompt).toContain("Build Kimchi from https://mapped.test");
      }),
    ),
  );

  it.effect("validates run inputs and interpolates them into ready prompts", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.writeSkill("test", "Build {{input.appName}} from {{input.homepage}}");
        const definition: WorkflowDefinition = {
          ...workflow([{ id: "build", skill: "test" }]),
          inputs: [
            { id: "appName", label: "App name", kind: "text", required: true },
            { id: "homepage", label: "Homepage", kind: "url" },
          ],
          brief: "Launch {{input.appName}}",
        };
        yield* runner.save({ projectId, slug, definition, callerThreadId: driver });
        const invalid = yield* Effect.flip(
          runner.start({
            projectId,
            slug,
            driverThreadId: driver,
            callerThreadId: driver,
            inputs: {},
          }),
        );
        expect(invalid._tag).toBe("WorkflowInputsError");
        const invalidInputs: ReadonlyArray<Record<string, string>> = [
          { appName: "Kimchi", homepage: "ftp://example.test" },
          { appName: "Kimchi", undeclared: "value" },
        ];
        for (const inputs of invalidInputs) {
          const rejected = yield* Effect.flip(
            runner.start({
              projectId,
              slug,
              driverThreadId: driver,
              callerThreadId: driver,
              inputs,
            }),
          );
          expect(rejected._tag).toBe("WorkflowInputsError");
        }
        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
          inputs: { appName: "Kimchi", homepage: "https://example.test" },
        });
        expect(run.inputs).toEqual({ appName: "Kimchi", homepage: "https://example.test" });
        const ready = run.ready.find((item) => item.stepId === "build")!;
        expect(ready.prompt).toContain("Kimchi");
        expect(ready.prompt).toContain("Build Kimchi from https://example.test");
        yield* done(run.id, "build");
        const rerun = yield* runner.stepRerun({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
        });
        expect(rerun.inputs).toEqual(run.inputs);
        expect(rerun.ready[0]?.prompt).toContain("Kimchi");
      }),
    ),
  );

  it.effect("runs a child workflow and settles the parent step on completion", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const childSlug = "child-workflow" as WorkflowSlug;
        yield* h.writeSkill("test");
        const child = workflow([{ id: "child-step", skill: "test" }]);
        const parent = workflow([
          { id: "setup", skill: "test" },
          { id: "child", kind: "workflow", workflow: childSlug },
        ]);
        yield* runner.save({
          projectId,
          slug: childSlug,
          definition: child,
          callerThreadId: driver,
        });
        yield* runner.save({ projectId, slug, definition: parent, callerThreadId: driver });
        const parentRun = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        yield* done(parentRun.id, "setup");
        const childRun = yield* runner.stepStart({
          runId: parentRun.id,
          stepId: "child",
          callerThreadId: driver,
        });
        expect(childRun.parent).toEqual({ runId: parentRun.id, stepId: "child" });
        expect(childRun.driverThreadId).toBe(driver);
        const childDone = yield* done(childRun.id, "child-step");
        expect(childDone.status).toBe("done");
        const parentAfter = yield* runner.status(parentRun.id);
        expect(parentAfter.steps.find((s) => s.stepId === "child")?.status).toBe("done");
        expect(parentAfter.status).toBe("done");
      }),
    ),
  );

  it.effect("blocks nested child creation before consuming the parent attempt", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const childSlug = "blocked-child" as WorkflowSlug;
        yield* h.writeSkill("test");
        yield* runner.save({
          projectId,
          slug: childSlug,
          definition: workflow([
            {
              id: "child-step",
              skill: "test",
              attachments: [
                {
                  id: "vercel",
                  kind: "service-login",
                  service: "vercel",
                  command: "vercel whoami fail",
                },
              ],
            },
          ]),
          callerThreadId: driver,
        });
        const parent = yield* start(
          workflow([{ id: "nested", kind: "workflow", workflow: childSlug }]),
        );
        const blocked = yield* Effect.flip(
          runner.stepStart({ runId: parent.id, stepId: "nested", callerThreadId: driver }),
        );
        expect(blocked._tag).toBe("WorkflowBlockedError");
        const current = yield* runner.status(parent.id);
        expect(current.steps[0]).toMatchObject({ status: "ready", attempts: 0 });
        expect(current.steps[0]?.childRunId).toBeUndefined();
        expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(1);
      }),
    ),
  );

  it.effect("rechecks the nested owner attachments before creating its child", () => {
    let calls = 0;
    return scenario(
      (h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const childSlug = "owner-resource-child" as WorkflowSlug;
          yield* h.writeSkill("test");
          yield* runner.save({
            projectId,
            slug: childSlug,
            definition: workflow([{ id: "child-step", skill: "test" }]),
            callerThreadId: driver,
          });
          const parent = yield* start(
            workflow([
              {
                id: "nested",
                kind: "workflow",
                workflow: childSlug,
                attachments: [{ id: "login", kind: "service-login", service: "vercel" }],
              },
            ]),
          );
          const blocked = yield* Effect.flip(
            runner.stepStart({ runId: parent.id, stepId: "nested", callerThreadId: driver }),
          );
          expect(blocked._tag).toBe("WorkflowBlockedError");
          expect(calls).toBe(2);
          expect((yield* runner.status(parent.id)).steps[0]).toMatchObject({
            status: "ready",
            attempts: 0,
          });
          expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(1);
        }),
      (_input) => {
        calls++;
        return Effect.succeed({
          stdout: calls === 1 ? "t3-user\n" : "",
          stderr: calls === 1 ? "" : "not logged in",
          code: calls === 1 ? 0 : 1,
          timedOut: false,
        } as never);
      },
    );
  });

  it.effect("does not create a nested child when the parent stops during its readiness probe", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const h = yield* setup(undefined, () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.map(() => ({ stdout: "", stderr: "", code: 0, timedOut: false }) as never),
        ),
      );
      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const childSlug = "slow-child" as WorkflowSlug;
        yield* h.writeSkill("test");
        yield* runner.save({
          projectId,
          slug: childSlug,
          definition: workflow([
            {
              id: "child-step",
              skill: "test",
              attachments: [
                { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
              ],
            },
          ]),
          callerThreadId: driver,
        });
        const parent = yield* start(
          workflow([{ id: "nested", kind: "workflow", workflow: childSlug }]),
        );
        const starting = yield* runner
          .stepStart({ runId: parent.id, stepId: "nested", callerThreadId: driver })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        expect((yield* runner.stop(parent.id)).status).toBe("stopped");
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.await(starting))._tag).toBe("Failure");
        expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(1);
        expect((yield* runner.status(parent.id)).steps[0]).toMatchObject({
          status: "skipped",
          attempts: 0,
        });
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect(
    "rechecks required resources at dispatch and leaves initial preflight historical",
    () => {
      let calls = 0;
      return scenario(
        (h) =>
          Effect.gen(function* () {
            yield* h.writeSkill("build");
            const runner = yield* WorkflowRunner.WorkflowRunner;
            const run = yield* start(
              workflow([
                {
                  id: "build",
                  skill: "build",
                  attachments: [
                    {
                      id: "vercel",
                      kind: "service-login",
                      service: "vercel",
                      command: "vercel whoami",
                    },
                  ],
                },
              ]),
            );
            expect(run.preflight?.entries[0]?.status).toBe("available");
            const blocked = yield* Effect.flip(
              runner.stepStart({
                runId: run.id,
                stepId: "build",
                callerThreadId: driver,
                threadId: probeContext,
              }),
            );
            expect(blocked._tag).toBe("WorkflowBlockedError");
            const current = yield* runner.status(run.id);
            expect(current.preflight?.entries[0]?.status).toBe("available");
            expect(current.steps[0]).toMatchObject({ status: "ready", attempts: 0 });
            expect(calls).toBe(2);
            expect(h.probes[1]?.cwd).toBe("/tmp/workflow-probe-worktree");
          }),
        () =>
          Effect.succeed({
            stdout: "t3-user",
            stderr: "",
            code: ++calls === 1 ? 0 : 1,
            timedOut: false,
          } as never),
      );
    },
  );

  it.effect("marks a parent step failed when its child fails or stops", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const childSlug = "child-workflow" as WorkflowSlug;
        yield* h.writeSkill("test");
        yield* runner.save({
          projectId,
          slug: childSlug,
          definition: workflow([{ id: "child-step", skill: "test" }]),
          callerThreadId: driver,
        });
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            { id: "setup", skill: "test" },
            { id: "child", kind: "workflow", workflow: childSlug },
          ]),
          callerThreadId: driver,
        });
        const parentRun = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        yield* done(parentRun.id, "setup");
        const childRun = yield* runner.stepStart({
          runId: parentRun.id,
          stepId: "child",
          callerThreadId: driver,
        });
        yield* done(childRun.id, "child-step", driver, true);
        const parentAfter = yield* runner.status(parentRun.id);
        expect(parentAfter.steps.find((s) => s.stepId === "child")?.status).toBe("failed");
      }),
    ),
  );

  it.effect("stops every run below the stopped one, grandchildren included", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.writeSkill("test");
        const childSlug = "child-workflow" as WorkflowSlug;
        const grandchildSlug = "grandchild-workflow" as WorkflowSlug;
        yield* runner.save({
          projectId,
          slug: grandchildSlug,
          definition: workflow([{ id: "grandchild-step", skill: "test" }]),
          callerThreadId: driver,
        });
        yield* runner.save({
          projectId,
          slug: childSlug,
          definition: workflow([{ id: "grandchild", kind: "workflow", workflow: grandchildSlug }]),
          callerThreadId: driver,
        });
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "child", kind: "workflow", workflow: childSlug }]),
          callerThreadId: driver,
        });
        const parentRun = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        const childRun = yield* runner.stepStart({
          runId: parentRun.id,
          stepId: "child",
          callerThreadId: driver,
        });
        const grandchildRun = yield* runner.stepStart({
          runId: childRun.id,
          stepId: "grandchild",
          callerThreadId: driver,
        });
        yield* runner.stepStart({
          runId: grandchildRun.id,
          stepId: "grandchild-step",
          callerThreadId: driver,
          threadId: child,
        });
        const stopped = yield* runner.stop(parentRun.id);
        expect(stopped.status).toBe("stopped");
        expect((yield* runner.status(childRun.id)).status).toBe("stopped");
        expect((yield* runner.status(grandchildRun.id)).status).toBe("stopped");
        expect(h.interrupts).toEqual([child]);
      }),
    ),
  );

  it.effect(
    "reuses the child, preserves mapped inputs, and exposes ready ownership after approval",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          yield* h.writeSkill("test");
          yield* runner.save({
            projectId,
            slug: "child-workflow",
            definition: {
              ...workflow([{ id: "work", skill: "test", gate: true }]),
              inputs: [{ id: "app", label: "App", kind: "text", required: true }],
              brief: "Build {{input.app}}",
            },
          });
          yield* runner.save({
            projectId,
            slug,
            definition: {
              ...workflow([
                {
                  id: "nested",
                  kind: "workflow",
                  workflow: "child-workflow",
                  inputs: { app: "{{input.name}} mobile" },
                },
              ]),
              execution: "always-subagents",
              inputs: [{ id: "name", label: "Name", kind: "text", required: true }],
            },
          });
          const parent = yield* runner.start({
            projectId,
            slug,
            driverThreadId: driver,
            callerThreadId: driver,
            inputs: { name: "Kimchi" },
          });
          expect(parent.ready[0]).toMatchObject({ runId: parent.id, runAs: "self" });
          expect(parent.ready[0]?.prompt).toContain("workflow_step_start");
          expect(parent.ready[0]?.prompt).not.toContain("workflow_run");
          expect(parent.ready[0]?.prompt).toContain("Kimchi mobile");
          const nested = yield* runner.stepStart({
            runId: parent.id,
            stepId: "nested",
            callerThreadId: driver,
            threadId: child,
          });
          expect(nested.inputs).toEqual({ app: "Kimchi mobile" });
          const beforeApproval = yield* runner.stepStart({
            runId: parent.id,
            stepId: "nested",
            callerThreadId: driver,
            threadId: stranger,
          });
          expect(beforeApproval.id).toBe(nested.id);
          expect(beforeApproval.ready).toEqual([]);
          expect((yield* runner.status(parent.id)).ready).toEqual([]);
          yield* runner.approve({ runId: nested.id, stepId: "work", callerThreadId: driver });
          const repeated = yield* runner.stepStart({
            runId: parent.id,
            stepId: "nested",
            callerThreadId: driver,
            threadId: stranger,
          });
          expect(repeated.id).toBe(nested.id);
          expect(repeated.ready[0]).toMatchObject({ runId: nested.id, stepId: "work" });
          expect(repeated.ready[0]?.prompt).toContain("Kimchi mobile");
          const status = yield* runner.status(parent.id);
          expect(status.ready).toEqual(repeated.ready);
          expect(status.steps[0]).toMatchObject({
            attempts: 1,
            threadId: driver,
            childRunId: nested.id,
          });
          expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(2);
          yield* done(nested.id, "work");
          expect((yield* runner.status(parent.id)).status).toBe("done");
          expect(h.interrupts).toEqual([]);
        }),
      ),
  );

  it.effect("settles concurrent child completions against the latest parent record", () =>
    Effect.gen(function* () {
      const started = yield* Queue.unbounded<void>();
      const release = yield* Deferred.make<void>();
      const h = yield* setup(undefined, () =>
        Queue.offer(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({ stdout: "", stderr: "", code: 0, timedOut: false } as never),
        ),
      );
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug: "child",
          definition: workflow([
            { id: "build", skill: "build", checks: [{ kind: "command", command: "check" }] },
          ]),
        });
        const parent = yield* start(
          workflow([
            { id: "first", kind: "workflow", workflow: "child" },
            { id: "second", kind: "workflow", workflow: "child", readsFrom: [] },
          ]),
        );
        const first = yield* runner.stepStart({
          runId: parent.id,
          stepId: "first",
          callerThreadId: driver,
        });
        const second = yield* runner.stepStart({
          runId: parent.id,
          stepId: "second",
          callerThreadId: driver,
        });
        yield* runner.stepStart({ runId: first.id, stepId: "build", callerThreadId: driver });
        yield* runner.stepStart({ runId: second.id, stepId: "build", callerThreadId: driver });
        const firstCompletion = done(first.id, "build").pipe(Effect.forkScoped);
        const secondCompletion = done(second.id, "build").pipe(Effect.forkScoped);
        const firstFiber = yield* firstCompletion;
        const secondFiber = yield* secondCompletion;
        yield* Queue.take(started);
        yield* Queue.take(started);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(firstFiber);
        yield* Fiber.join(secondFiber);

        const settled = yield* runner.status(parent.id);
        expect(settled.status).toBe("done");
        expect(settled.steps.map((step) => step.status)).toEqual(["done", "done"]);
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect.each(["success", "failure", "stop", "skip", "resume"] as const)(
    "cascades grandchild %s through every ancestor",
    (outcome) =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          yield* h.writeSkill("test");
          yield* runner.save({
            projectId,
            slug: "leaf",
            definition: workflow([{ id: "work", skill: "test", pauseAfter: outcome === "resume" }]),
          });
          yield* runner.save({
            projectId,
            slug: "middle",
            definition: workflow([{ id: "nested", kind: "workflow", workflow: "leaf" }]),
          });
          const parent = yield* start(
            workflow([{ id: "nested", kind: "workflow", workflow: "middle" }]),
          );
          const middle = yield* runner.stepStart({
            runId: parent.id,
            stepId: "nested",
            callerThreadId: driver,
          });
          const leaf = yield* runner.stepStart({
            runId: middle.id,
            stepId: "nested",
            callerThreadId: driver,
          });
          expect((yield* runner.status(parent.id)).ready[0]).toMatchObject({
            runId: leaf.id,
            stepId: "work",
          });
          if (outcome === "skip")
            yield* runner.stepSkip({ runId: leaf.id, stepId: "work", callerThreadId: driver });
          else if (outcome === "stop") yield* runner.stop(leaf.id, driver);
          else {
            const finished = yield* done(leaf.id, "work", driver, outcome === "failure");
            if (outcome === "resume") {
              expect(finished.status).toBe("waiting");
              expect((yield* runner.status(parent.id)).status).toBe("running");
              yield* runner.resume({ runId: leaf.id, stepId: "work", callerThreadId: driver });
            }
          }
          const expected = outcome === "failure" || outcome === "stop" ? "failed" : "done";
          expect((yield* runner.status(middle.id)).status).toBe(expected);
          expect((yield* runner.status(parent.id)).status).toBe(expected);
        }),
      ),
  );

  it.effect.each(["resume", "skip"] as const)(
    "honors a nested pauseAfter until %s, then settles its parent",
    (action) =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          yield* h.writeSkill("test");
          yield* runner.save({
            projectId,
            slug: "leaf",
            definition: workflow([{ id: "work", skill: "test" }]),
          });
          yield* runner.save({
            projectId,
            slug: "middle",
            definition: workflow([
              { id: "nested", kind: "workflow", workflow: "leaf", gate: true, pauseAfter: true },
            ]),
          });
          const parent = yield* start(
            workflow([
              { id: "nested", kind: "workflow", workflow: "middle" },
              { id: "continue", skill: "test" },
            ]),
          );
          const middle = yield* runner.stepStart({
            runId: parent.id,
            stepId: "nested",
            callerThreadId: driver,
          });
          yield* runner.approve({ runId: middle.id, stepId: "nested", callerThreadId: driver });
          expect((yield* runner.status(parent.id)).ready[0]).toMatchObject({
            runId: middle.id,
            stepId: "nested",
          });
          const leaf = yield* runner.stepStart({
            runId: middle.id,
            stepId: "nested",
            callerThreadId: driver,
          });
          yield* done(leaf.id, "work");
          const paused = yield* runner.status(middle.id);
          expect(paused.status).toBe("waiting");
          expect(paused.steps[0]).toMatchObject({ status: "waiting", waitingFor: "resume" });
          expect((yield* runner.status(parent.id)).ready).toEqual([]);
          if (action === "resume")
            yield* runner.resume({ runId: middle.id, stepId: "nested", callerThreadId: driver });
          else
            yield* runner.stepSkip({ runId: middle.id, stepId: "nested", callerThreadId: driver });
          expect((yield* runner.status(middle.id)).status).toBe("done");
          expect((yield* runner.status(parent.id)).ready[0]).toMatchObject({
            runId: parent.id,
            stepId: "continue",
          });
        }),
      ),
  );

  it.effect("rejects manual completion of ready and running nested steps", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* h.writeSkill("test");
        yield* runner.save({
          projectId,
          slug: "leaf",
          definition: workflow([{ id: "work", skill: "test" }]),
        });
        const parent = yield* start(
          workflow([{ id: "nested", kind: "workflow", workflow: "leaf" }]),
        );
        for (const running of [false, true]) {
          if (running)
            yield* runner.stepStart({ runId: parent.id, stepId: "nested", callerThreadId: driver });
          for (const failed of [false, true]) {
            const error = yield* Effect.flip(done(parent.id, "nested", driver, failed));
            expect(error._tag).toBe("WorkflowStepStateError");
            expect(error.message).toContain("complete its child run");
          }
          expect((yield* runner.status(parent.id)).steps[0]?.status).toBe(
            running ? "running" : "ready",
          );
        }
      }),
    ),
  );

  it.effect("blocks unreadable child files in preflight and at run start", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "nested", kind: "workflow", workflow: "broken" }]),
        });
        yield* h.fs.writeFileString(
          h.path.join(h.projectRoot, ".t3", "workflows", "broken.json"),
          "not json",
        );
        expect(yield* runner.preflight({ projectId, slug })).toEqual([
          expect.objectContaining({ stepId: "nested", kind: "missing-workflow" }),
        ]);
        const error = yield* Effect.flip(
          runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver }),
        );
        expect(error._tag).toBe("WorkflowBlockedError");
      }),
    ),
  );

  it.effect.each(["loop", "depth"] as const)(
    "rejects externally introduced nesting %s at run start",
    (problem) =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const store = yield* WorkflowStore.WorkflowStore;
          yield* h.writeSkill("test");
          yield* runner.save({
            projectId,
            slug: "leaf",
            definition: workflow([{ id: "work", skill: "test" }]),
          });
          yield* runner.save({
            projectId,
            slug: "middle",
            definition: workflow([{ id: "nested", kind: "workflow", workflow: "leaf" }]),
          });
          yield* runner.save({
            projectId,
            slug,
            definition: workflow([{ id: "nested", kind: "workflow", workflow: "middle" }]),
          });
          yield* store.writeDefinition({
            projectId,
            slug: "leaf",
            definition: workflow([
              { id: "nested", kind: "workflow", workflow: problem === "loop" ? slug : "deeper" },
            ]),
          });
          const error = yield* Effect.flip(
            runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver }),
          );
          expect(error._tag).toBe(
            problem === "loop" ? "WorkflowNestingError" : "WorkflowInvalidError",
          );
          expect(error.message).toContain(problem === "loop" ? "loop" : "two levels");
          expect((yield* runner.listRuns({ projectId })).runs).toEqual([]);
        }),
      ),
  );

  it.effect(
    "checks edited child definitions against pinned ancestors before starting children",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const store = yield* WorkflowStore.WorkflowStore;
          yield* h.writeSkill("test");
          yield* runner.save({
            projectId,
            slug: "leaf",
            definition: workflow([{ id: "work", skill: "test" }]),
          });
          const parent = yield* start(
            workflow([{ id: "nested", kind: "workflow", workflow: "leaf" }]),
          );
          // The files no longer loop, but the running parent's pinned definition still does.
          yield* store.writeDefinition({
            projectId,
            slug,
            definition: workflow([{ id: "work", skill: "test" }]),
          });
          yield* store.writeDefinition({
            projectId,
            slug: "leaf",
            definition: workflow([{ id: "nested", kind: "workflow", workflow: slug }]),
          });
          const error = yield* Effect.flip(
            runner.stepStart({ runId: parent.id, stepId: "nested", callerThreadId: driver }),
          );
          expect(error._tag).toBe("WorkflowNestingError");
          expect(error.message).toContain("loop");
          expect((yield* runner.status(parent.id)).steps[0]?.status).toBe("ready");
          expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(1);
        }),
      ),
  );

  it.effect("ignores a stale child's completion when the parent owns another child", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        yield* h.writeSkill("test");
        yield* runner.save({
          projectId,
          slug: "leaf",
          definition: workflow([{ id: "work", skill: "test" }]),
        });
        const parent = yield* start(
          workflow([{ id: "nested", kind: "workflow", workflow: "leaf" }]),
        );
        const active = yield* runner.stepStart({
          runId: parent.id,
          stepId: "nested",
          callerThreadId: driver,
        });
        const { ready: _, ...stale } = active;
        yield* store.writeRun({ ...stale, id: "stale-child" });
        yield* done("stale-child", "work");
        const unchanged = yield* runner.status(parent.id);
        expect(unchanged.status).toBe("running");
        expect(unchanged.steps[0]).toMatchObject({ status: "running", childRunId: active.id });
        expect(unchanged.ready[0]).toMatchObject({ runId: active.id, stepId: "work" });
        yield* done(active.id, "work");
        expect((yield* runner.status(parent.id)).status).toBe("done");
      }),
    ),
  );

  it.effect("guards cyclic run records when collecting ready steps, starting, and stopping", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        yield* h.writeSkill("test");
        yield* runner.save({
          projectId,
          slug: "leaf",
          definition: workflow([{ id: "work", skill: "test" }]),
        });
        const parent = yield* start(
          workflow([{ id: "nested", kind: "workflow", workflow: "leaf" }]),
        );
        const { ready: _, ...record } = parent;
        yield* store.writeRun({
          ...record,
          id: "cycle-ready",
          parent: { runId: "cycle-ready", stepId: "nested" },
        });
        const error = yield* Effect.flip(
          runner.stepStart({ runId: "cycle-ready", stepId: "nested", callerThreadId: driver }),
        );
        expect(error._tag).toBe("WorkflowNestingError");
        yield* store.writeRun({
          ...record,
          id: "cycle-running",
          parent: { runId: "cycle-running", stepId: "nested" },
          steps: [
            {
              stepId: "nested",
              status: "running",
              attempts: 1,
              threadId: driver,
              childRunId: "cycle-running",
            },
          ],
        });
        expect((yield* runner.status("cycle-running")).ready).toEqual([]);
        expect((yield* runner.stop("cycle-running", driver)).status).toBe("stopped");
      }),
    ),
  );

  it.effect("rejects saving a workflow that nests deeper than two levels", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const deepSlug = "deep" as WorkflowSlug;
        const leafSlug = "leaf" as WorkflowSlug;
        const midSlug = "mid" as WorkflowSlug;
        const topSlug = "top" as WorkflowSlug;
        yield* runner.save({
          projectId,
          slug: deepSlug,
          definition: workflow([{ id: "d", skill: "test" }]),
          callerThreadId: driver,
        });
        yield* runner.save({
          projectId,
          slug: leafSlug,
          definition: workflow([{ id: "c", kind: "workflow", workflow: deepSlug }]),
          callerThreadId: driver,
        });
        yield* runner.save({
          projectId,
          slug: midSlug,
          definition: workflow([{ id: "b", kind: "workflow", workflow: leafSlug }]),
          callerThreadId: driver,
        });
        const rejected = yield* Effect.flip(
          runner.save({
            projectId,
            slug: topSlug,
            definition: workflow([{ id: "a", kind: "workflow", workflow: midSlug }]),
            callerThreadId: driver,
          }),
        );
        expect(rejected._tag).toBe("WorkflowInvalidError");
        if (rejected._tag !== "WorkflowInvalidError") {
          return expect.fail("Expected WorkflowInvalidError");
        }
        expect(rejected.problems.join(" ")).toContain("two levels");
      }),
    ),
  );

  it.effect("rejects a workflow nesting loop on save", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const aSlug = "a" as WorkflowSlug;
        const bSlug = "b" as WorkflowSlug;
        const a = workflow([{ id: "x", kind: "workflow", workflow: bSlug }]);
        const b = workflow([{ id: "y", kind: "workflow", workflow: aSlug }]);
        yield* runner.save({ projectId, slug: aSlug, definition: a, callerThreadId: driver });
        const rejected = yield* Effect.flip(
          runner.save({ projectId, slug: bSlug, definition: b, callerThreadId: driver }),
        );
        expect(rejected._tag).toBe("WorkflowInvalidError");
        if (rejected._tag !== "WorkflowInvalidError") {
          return expect.fail("Expected WorkflowInvalidError");
        }
        expect(rejected.problems.join(" ")).toContain("loop");
      }),
    ),
  );

  it.effect("shows static readiness in listings without running a probe", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "vercel", kind: "service-login", service: "vercel" }],
            },
            {
              id: "deploy",
              skill: "deploy",
              attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }],
            },
          ]),
          callerThreadId: driver,
        });
        const listing = (yield* runner.list({ projectId })).workflows[0];
        expect(h.probes).toEqual([]);
        expect(listing?.readiness).toMatchObject({
          entries: [
            { stepId: "build", attachmentId: "vercel", status: "unknown" },
            { stepId: "deploy", attachmentId: "linear", status: "unknown" },
          ],
          blocksRun: false,
        });
      }),
    ),
  );

  it.effect("publishes a credential's real state right after the step edit that attaches it", () =>
    notifyScenario({ credentials: [githubCredential] }, (h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
          callerThreadId: driver,
        });
        const snapshots: WorkflowsSnapshot[] = [];
        const emitted = yield* Queue.unbounded<WorkflowsSnapshot>();
        yield* runner.subscribeRuns({ projectId }).pipe(
          Stream.runForEach((snapshot) =>
            Effect.sync(() => snapshots.push(snapshot)).pipe(
              Effect.andThen(Queue.offer(emitted, snapshot)),
            ),
          ),
          Effect.forkScoped,
        );
        yield* Queue.take(emitted);
        yield* runner.stepPut({
          projectId,
          slug,
          callerThreadId: driver,
          step: {
            id: "build",
            skill: "build",
            attachments: [{ id: "gh", kind: "credential", templateId: "github" }],
          },
        });
        yield* Queue.take(emitted);
        expect(snapshots[1]?.workflows[0]?.readiness?.entries[0]).toMatchObject({
          stepId: "build",
          attachmentId: "gh",
          kind: "credential",
          status: "available",
          credential: {
            state: "matched",
            credentialId: "cred-github",
            envVars: [{ name: "GITHUB_TOKEN", file: false }],
          },
        });
      }),
    ),
  );

  it.effect("republishes readiness when the vault gains a missing credential", () =>
    Effect.gen(function* () {
      const credentials: Credential[] = [];
      const vault = yield* Queue.unbounded<number>();
      const h = yield* setup(undefined, undefined, {
        credentials,
        credentialChanges: Stream.fromQueue(vault),
      });
      yield* Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "gh", kind: "credential", templateId: "github" }],
            },
          ]),
          callerThreadId: driver,
        });
        const snapshots: WorkflowsSnapshot[] = [];
        const emitted = yield* Queue.unbounded<WorkflowsSnapshot>();
        yield* runner.subscribeRuns({ projectId }).pipe(
          Stream.runForEach((snapshot) =>
            Effect.sync(() => snapshots.push(snapshot)).pipe(
              Effect.andThen(Queue.offer(emitted, snapshot)),
            ),
          ),
          Effect.forkScoped,
        );
        yield* Queue.take(emitted);
        expect(snapshots[0]?.workflows[0]?.readiness?.entries[0]?.credential?.state).toBe(
          "missing",
        );
        // The user saves the credential in Settings, or from the satellite's Add.
        credentials.push(githubCredential);
        yield* Queue.offer(vault, 1);
        yield* Queue.take(emitted);
        expect(snapshots[1]?.workflows[0]?.readiness?.entries[0]).toMatchObject({
          status: "available",
          credential: { state: "matched", credentialId: "cred-github" },
        });
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("shows attached credential readiness in listings without blocking a manual run", () =>
    notifyScenario({ credentials: [] }, (h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "gh", kind: "credential", templateId: "github" }],
            },
          ]),
          callerThreadId: driver,
        });
        const listing = (yield* runner.list({ projectId })).workflows[0];
        expect(listing?.readiness?.blocksRun).toBe(false);
        expect(listing?.readiness?.warnings).toBeUndefined();
        expect(listing?.readiness?.entries[0]).toMatchObject({
          stepId: "build",
          attachmentId: "gh",
          kind: "credential",
          status: "missing",
          credential: { state: "missing", templateId: "github", optional: false },
        });
        // A manual run is advisory: the step prompt says what to fix.
        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        expect(run.status).toBe("running");
      }),
    ),
  );

  it.effect(
    "blocks an unattended start on a missing required credential and allows a ready one",
    () =>
      Effect.gen(function* () {
        const attempt = (credentials: ReadonlyArray<Credential>) => {
          let outcome: { readonly ok: boolean; readonly message?: string } | undefined;
          return notifyScenario({ credentials }, (h) =>
            Effect.gen(function* () {
              yield* h.writeSkill("build");
              const runner = yield* WorkflowRunner.WorkflowRunner;
              yield* runner.save({
                projectId,
                slug,
                definition: workflow([
                  {
                    id: "build",
                    skill: "build",
                    attachments: [{ id: "gh", kind: "credential", templateId: "github" }],
                  },
                ]),
                callerThreadId: driver,
              });
              const result = yield* runner
                .start({
                  projectId,
                  slug,
                  driverThreadId: driver,
                  callerThreadId: driver,
                  unattended: true,
                })
                .pipe(Effect.result);
              outcome =
                result._tag === "Success"
                  ? { ok: true }
                  : { ok: false, message: result.failure.message };
            }),
          ).pipe(Effect.map(() => outcome!));
        };
        const missing = yield* attempt([]);
        expect(missing.ok).toBe(false);
        expect(missing.message).toContain("No GitHub token credential exists");
        expect((yield* attempt([githubCredential])).ok).toBe(true);
      }),
  );

  it.effect("warns that a scheduled workflow needs pre-approved credentials", () =>
    notifyScenario(
      { credentials: [githubCredential], scheduledWorkflows: [slug], unlocked: true },
      (h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          yield* runner.save({
            projectId,
            slug,
            definition: workflow([
              {
                id: "build",
                skill: "build",
                attachments: [{ id: "gh", kind: "credential", templateId: "github" }],
              },
            ]),
            callerThreadId: driver,
          });
          expect((yield* runner.list({ projectId })).workflows[0]?.readiness?.warnings).toEqual([
            "Scheduled runs need Pre-approved credentials.",
          ]);
          yield* runner
            .meta({
              projectId,
              slug,
              credentialApprovals: "pre-approved",
              callerThreadId: driver,
            })
            .pipe(
              Effect.provideService(CredentialPolicySession, AuthSessionId.make("user-session")),
            );
          expect(
            (yield* runner.list({ projectId })).workflows[0]?.readiness?.warnings,
          ).toBeUndefined();
        }),
    ),
  );

  it.effect("probes at Run, records the snapshot, and blocks a signed-out login", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const definition = workflow([
          {
            id: "build",
            skill: "build",
            attachments: [
              {
                id: "vercel",
                kind: "service-login",
                service: "vercel",
                command: "vercel whoami fail",
                signInCommand: "vercel login",
              },
            ],
          },
        ]);
        yield* runner.save({ projectId, slug, definition, callerThreadId: driver });
        const blocked = yield* Effect.flip(
          runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver }),
        );
        expect(blocked._tag).toBe("WorkflowBlockedError");
        if (blocked._tag !== "WorkflowBlockedError") return;
        expect(blocked.problems.join(" ")).toContain("sign in with `vercel login`");
        expect(h.probes).toHaveLength(1);
        expect(h.probes[0]?.args.at(-1)).toBe("vercel whoami fail");
        expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(0);
      }),
    ),
  );

  it.effect("keeps MCP evidence unknown without blocking the Run", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const run = yield* start(
          workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }],
            },
          ]),
        );
        expect(run.preflight).toMatchObject({
          blocksRun: false,
          entries: [{ status: "unknown", kind: "mcp-connection" }],
        });
        expect(run.preflight?.entries[0]?.message).toContain("No provider is selected");
      }),
    ),
  );

  it.effect("refreshes readiness on demand and marks the cached result stale", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const snapshots = yield* Queue.unbounded<WorkflowsSnapshot>();
        yield* runner.subscribeRuns({}).pipe(
          Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
          Effect.forkScoped,
        );
        yield* Queue.take(snapshots);
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "vercel", kind: "service-login", service: "vercel" }],
            },
            {
              id: "deploy",
              skill: "deploy",
              attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }],
            },
          ]),
          callerThreadId: driver,
        });
        expect((yield* runner.readiness({ projectId, slug })).entries[0]?.status).toBe("unknown");
        expect(h.probes).toEqual([]);

        const probed = yield* runner.probe({ projectId, slug });
        expect(probed.entries[0]).toMatchObject({ status: "available" });
        expect(probed.context).toMatchObject({ workspaceRoot: h.projectRoot });
        expect(probed.context?.threadId).toBeUndefined();
        expect(probed.context?.specification).toBeTruthy();
        const published = yield* Stream.fromQueue(snapshots).pipe(
          Stream.filter(
            (snapshot) =>
              snapshot.workflows[0]?.readiness?.entries.some(
                (entry) => entry.attachmentId === "vercel" && entry.status === "available",
              ) === true,
          ),
          Stream.runHead,
        );
        expect(published._tag).toBe("Some");
        expect((yield* runner.listRuns({ projectId })).workflows[0]?.readiness?.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ attachmentId: "vercel", status: "available" }),
            expect.objectContaining({ attachmentId: "linear", status: "unknown" }),
          ]),
        );
        expect(h.probes).toHaveLength(1);
        expect(h.probes[0]?.args.at(-1)).toBe("vercel whoami");

        const cached = yield* runner.readiness({ projectId, slug });
        expect(cached.entries[0]?.status).toBe("available");
        expect(cached.entries[0]?.stale).toBeUndefined();
        expect(h.probes).toHaveLength(1);

        yield* runner.probe({ projectId, slug, stepIds: ["build" as WorkflowSlug] });
        expect((yield* runner.listRuns({ projectId })).workflows[0]?.readiness?.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ attachmentId: "linear" })]),
        );

        yield* TestClock.adjust("6 minutes");
        expect(
          (yield* runner.readiness({ projectId, slug })).entries.find(
            (entry) => entry.attachmentId === "vercel",
          )?.stale,
        ).toBe(true);
        yield* runner.probe({ projectId, slug });
        expect(h.probes).toHaveLength(3);

        const invalid = yield* Effect.flip(
          runner.probe({ projectId, slug, stepIds: ["missing" as WorkflowSlug] }),
        );
        expect(invalid._tag).toBe("WorkflowInvalidError");
      }),
    ),
  );

  it.effect("retains partial observations in the same explicit workspace and driver context", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "first", kind: "service-login", service: "vercel" }],
            },
            {
              id: "deploy",
              skill: "deploy",
              attachments: [{ id: "second", kind: "service-login", service: "vercel" }],
            },
          ]),
          callerThreadId: driver,
        });
        yield* runner.probe({
          projectId,
          slug,
          contextThreadId: probeContext,
          stepIds: ["build" as WorkflowSlug],
        });
        yield* runner.probe({
          projectId,
          slug,
          contextThreadId: probeContext,
          stepIds: ["deploy" as WorkflowSlug],
        });
        expect((yield* runner.readiness({ projectId, slug })).entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ attachmentId: "first", status: "available" }),
            expect.objectContaining({ attachmentId: "second", status: "available" }),
          ]),
        );
        expect(h.probes).toHaveLength(2);
      }),
    ),
  );

  it.effect("does not merge observations after the driver model changes", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "first", kind: "service-login", service: "vercel" }],
            },
            {
              id: "deploy",
              skill: "deploy",
              attachments: [{ id: "second", kind: "service-login", service: "vercel" }],
            },
          ]),
          callerThreadId: driver,
        });
        yield* runner.probe({
          projectId,
          slug,
          contextThreadId: probeContext,
          stepIds: ["build" as WorkflowSlug],
        });
        yield* runner.probe({
          projectId,
          slug,
          contextThreadId: changedModelContext,
          stepIds: ["deploy" as WorkflowSlug],
        });
        expect((yield* runner.readiness({ projectId, slug })).entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attachmentId: "first",
              status: "unknown",
            }),
            expect.objectContaining({ attachmentId: "second", status: "available" }),
          ]),
        );
        expect(h.probes).toHaveLength(2);
      }),
    ),
  );

  it.effect("uses visible thread workspace for explicit probes and rejects another project", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            {
              id: "build",
              skill: "build",
              attachments: [
                { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
              ],
            },
          ]),
          callerThreadId: driver,
        });
        const contextual = yield* runner.probe({
          projectId,
          slug,
          contextThreadId: probeContext,
        });
        expect(contextual.entries[0]?.workspaceRoot).toBe("/tmp/workflow-probe-worktree");
        expect(contextual.entries[0]?.status).toBe("available");
        expect(contextual.context).toMatchObject({
          threadId: probeContext,
          workspaceRoot: "/tmp/workflow-probe-worktree",
          specification: expect.any(String),
        });
        const before = h.probes.length;
        const invalid = yield* Effect.flip(
          runner.probe({ projectId, slug, contextThreadId: foreignContext }),
        );
        expect(invalid._tag).toBe("WorkflowInvalidError");
        expect(h.probes).toHaveLength(before);
      }),
    ),
  );

  it.effect("does not publish a probe after its saved definition changes", () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    return scenario(
      () =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const original = workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "vercel", kind: "service-login", service: "vercel" }],
            },
          ]);
          yield* runner.save({ projectId, slug, definition: original, callerThreadId: driver });
          const probing = yield* runner.probe({ projectId, slug }).pipe(Effect.forkScoped);
          yield* Deferred.await(started);
          const edited = workflow([{ id: "build", skill: "build" }]);
          yield* runner.save({ projectId, slug, definition: edited, callerThreadId: driver });
          yield* Deferred.succeed(release, undefined);
          const result = yield* Effect.flip(Fiber.join(probing));
          expect(result._tag).toBe("WorkflowInvalidError");
          expect((yield* runner.listRuns({ projectId })).workflows[0]?.readiness).toBeUndefined();
        }),
      (_input) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({
            stdout: "t3-user\n",
            stderr: "",
            code: 0,
            timedOut: false,
          } as never),
        ),
    );
  });

  it.effect("checks a real minimum version and blocks a too-old tool", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const withMinimum = (minVersion: string): WorkflowDefinition =>
          workflow([
            {
              id: "build",
              skill: "build",
              attachments: [{ id: "node", kind: "requirement", requirement: "node", minVersion }],
            },
          ]);
        yield* runner.save({
          projectId,
          slug,
          definition: withMinimum("22"),
          callerThreadId: driver,
        });
        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        expect(run.preflight?.entries[0]).toMatchObject({
          status: "available",
          message: "`node` 22.11.0 is 22 or newer.",
        });
        expect(h.probes[0]?.args.at(-1)).toBe("node --version");

        yield* runner.save({
          projectId,
          slug,
          definition: withMinimum("99"),
          callerThreadId: driver,
        });
        const blocked = yield* Effect.flip(
          runner.start({ projectId, slug, driverThreadId: driver, callerThreadId: driver }),
        );
        expect(blocked._tag).toBe("WorkflowBlockedError");
        if (blocked._tag !== "WorkflowBlockedError") return;
        expect(blocked.problems.join(" ")).toContain("older than 99");
      }),
    ),
  );

  it.effect("retries a failed wakeup with the same command and message ids", () => {
    let attempts = 0;
    return notifyScenario(
      {
        send: () =>
          Effect.sync(() => {
            attempts += 1;
            return attempts > 1;
          }),
      },
      (h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const store = yield* WorkflowStore.WorkflowStore;
          yield* runner.save({
            projectId,
            slug,
            definition: workflow([{ id: "build", skill: "build" }]),
          });
          const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
          expect(h.sends).toHaveLength(1);
          const pending = yield* store.readRun(run.id);
          expect(pending.driverWakeup).toMatchObject({
            revision: 1,
            acknowledgedRevision: 0,
            attempts: 1,
          });
          // A non-driver read is an explicit reconciliation point and retries the outstanding wake.
          yield* runner.status(run.id, stranger);
          expect(h.sends).toHaveLength(2);
          expect(h.sends[1]?.commandId).toBe(h.sends[0]?.commandId);
          expect(h.sends[1]?.messageId).toBe(h.sends[0]?.messageId);
          expect((yield* store.readRun(run.id)).driverWakeup).toMatchObject({
            revision: 1,
            acknowledgedRevision: 1,
          });
          // The acknowledged state is never sent again.
          yield* runner.status(run.id, stranger);
          yield* runner.refresh({ projectId });
          expect(h.sends).toHaveLength(2);
        }),
    );
  });

  it.effect("reconciles one outstanding wakeup and coalesces concurrent retries", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const delivered = yield* Deferred.make<void>();
      let attempts = 0;
      yield* notifyScenario(
        {
          send: () =>
            Effect.gen(function* () {
              attempts += 1;
              if (attempts === 1) return false;
              yield* Deferred.succeed(delivered, undefined);
              yield* Deferred.await(release);
              return true;
            }),
        },
        (h) =>
          Effect.gen(function* () {
            yield* h.writeSkill("build");
            const runner = yield* WorkflowRunner.WorkflowRunner;
            const store = yield* WorkflowStore.WorkflowStore;
            yield* runner.save({
              projectId,
              slug,
              definition: workflow([{ id: "build", skill: "build" }]),
            });
            const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
            expect(h.sends).toHaveLength(1);
            const first = yield* runner.reconcileWakeups({ runId: run.id }).pipe(Effect.forkScoped);
            const second = yield* runner
              .reconcileWakeups({ runId: run.id })
              .pipe(Effect.forkScoped);
            yield* Deferred.await(delivered);
            // The second pass coalesced into the in-flight delivery, so only one retry is sent.
            expect(h.sends).toHaveLength(2);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(first);
            yield* Fiber.join(second);
            expect((yield* store.readRun(run.id)).driverWakeup).toMatchObject({
              revision: 1,
              acknowledgedRevision: 1,
              attempts: 1,
            });
            yield* runner.reconcileWakeups({ runId: run.id });
            expect(h.sends).toHaveLength(2);
          }),
      );
    }),
  );

  it.effect("a client reattaching through the runs stream retries an outstanding wakeup", () =>
    Effect.gen(function* () {
      const delivered = yield* Deferred.make<void>();
      let attempts = 0;
      yield* notifyScenario(
        {
          send: () =>
            Effect.gen(function* () {
              attempts += 1;
              if (attempts > 1) yield* Deferred.succeed(delivered, undefined);
              return attempts > 1;
            }),
        },
        (h) =>
          Effect.gen(function* () {
            yield* h.writeSkill("build");
            const runner = yield* WorkflowRunner.WorkflowRunner;
            yield* runner.save({
              projectId,
              slug,
              definition: workflow([{ id: "build", skill: "build" }]),
            });
            const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
            expect(h.sends).toHaveLength(1);
            yield* runner.subscribeRuns({}).pipe(Stream.take(1), Stream.runDrain);
            yield* Deferred.await(delivered);
            expect(h.sends).toHaveLength(2);
            expect(h.sends[1]?.commandId).toBe(h.sends[0]?.commandId);
            expect(h.sends[1]?.messageId).toBe(h.sends[0]?.messageId);
            yield* runner.reconcileWakeups({ runId: run.id });
            expect(h.sends).toHaveLength(2);
          }),
      );
    }),
  );

  it.effect("delivers a terminal wakeup once and never spams status or refresh", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
        });
        const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
        expect(h.sends).toHaveLength(1);
        yield* runner.stepStart({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
          threadId: child,
        });
        yield* done(run.id, "build", child);
        expect(h.sends).toHaveLength(2);
        expect(h.sends[1]?.text).toContain("Report the final result");
        yield* runner.status(run.id, stranger);
        yield* runner.status(run.id, driver);
        yield* runner.refresh({ projectId });
        expect(h.sends).toHaveLength(2);
      }),
    ),
  );

  it.effect("returns failed checks, notes, resources and gates in status without fake work", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        yield* h.writeSkill("deploy");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: {
            version: 3,
            name: "Launch site",
            notes: [{ id: "remember", text: "Ship Friday.", anchorStepId: "build" }],
            steps: [
              {
                id: "build",
                skill: "build",
                checks: [{ kind: "file", path: "missing.html" }],
                attachments: [
                  { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
                ],
              },
              { id: "deploy", skill: "deploy", gate: true },
            ],
          },
        });
        const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
        yield* runner.stepStart({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
          threadId: child,
        });
        yield* done(run.id, "build", child);
        expect(h.sends).toHaveLength(2);
        expect(h.sends[1]?.text).toContain("needs repair");
        expect(h.sends[1]?.text).toContain("missing.html is missing");
        const status = yield* runner.status(run.id, driver);
        expect(status.context.ready.map((step) => step.stepId)).toEqual(["build"]);
        expect(status.context.needsUser).toEqual([]);
        expect(status.context.next.join(" ")).toContain("needs repair");
        expect(status.context.steps[0]).toMatchObject({
          stepId: "build",
          checks: ["missing.html exists"],
          resources: [{ status: "available" }],
        });
        expect(status.context.steps[1]?.gate).toBe(true);
        expect(status.context.notes[0]?.text).toBe("Ship Friday.");
        const prompt = status.ready[0]?.prompt ?? "";
        expect(prompt).toContain("This is attempt 2");
        expect(prompt).toContain("missing.html is missing");
        expect(prompt).toContain("## Checks the server runs after you report done");
        expect(prompt).toContain("node 22+ (requirement): available");
        expect(prompt).toContain("Ship Friday.");
      }),
    ),
  );

  it.effect("waits on the user for a gate and becomes ready only after approval", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        yield* h.writeSkill("deploy");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([
            { id: "build", skill: "build" },
            { id: "deploy", skill: "deploy", gate: true },
          ]),
        });
        const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
        yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
        yield* runner.stepDone({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
          summary: "Built.",
          outputs: {},
          failed: false,
        });
        const waiting = yield* runner.status(run.id, driver);
        expect(waiting.ready).toEqual([]);
        expect(waiting.context.ready).toEqual([]);
        expect(waiting.context.needsUser).toMatchObject([
          { kind: "approval", audience: "user", stepId: "deploy" },
        ]);
        expect(waiting.context.next.join(" ")).toContain("never approve it yourself");
        // The canvas approves; the driver is woken once and receives only Deploy as work.
        yield* runner.approve({ runId: run.id, stepId: "deploy" });
        expect(h.sends).toHaveLength(2);
        const ready = yield* runner.status(run.id, driver);
        expect(ready.context.ready.map((step) => step.stepId)).toEqual(["deploy"]);
        expect(ready.context.needsUser).toEqual([]);
      }),
    ),
  );

  it.effect("bounds the initial wakeup with many notes and resources", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: {
            version: 3,
            name: "Launch site",
            notes: Array.from({ length: 40 }, (_, index) => ({
              id: `note-${index}`,
              text: `${index}: ${"y".repeat(3_900)}`,
              anchorStepId: "build",
            })),
            steps: [
              {
                id: "build",
                skill: "build",
                checks: [{ kind: "command", command: "pnpm build" }],
                attachments: Array.from({ length: 12 }, (_, index) => ({
                  id: `tool-${index}`,
                  kind: "mcp-connection" as const,
                  server: `tool-${index}`,
                })),
              },
            ],
          },
        });
        const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
        expect(h.sends).toHaveLength(1);
        const message = h.sends[0]?.text ?? "";
        for (const expected of [
          "Launch site",
          "definition v3",
          "Notes (context only",
          "`pnpm build`",
          "MCP tool-0 (mcp-connection): unknown",
          "Call workflow_status",
        ])
          expect(message).toContain(expected);
        expect(message.length).toBeLessThanOrEqual(MAX_WAKE_CHARS + 600);
        expect(run.context.notes).toHaveLength(6);
      }),
    ),
  );

  it.effect("an agent-started run gets the same context without waking itself", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
        });
        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        expect(h.sends).toHaveLength(0);
        expect(run.context.definitionRevision).toMatch(/^sha256:/);
        expect(run.context.ready.map((step) => step.stepId)).toEqual(["build"]);
        expect(run.ready[0]?.attempts).toBe(0);
      }),
    ),
  );

  it.effect(
    "reconciles a persisted run state when the process stops before queuing its next wakeup",
    () =>
      scenario((h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          yield* runner.save({
            projectId,
            slug,
            definition: workflow([{ id: "build", skill: "build" }]),
          });
          const run = yield* runner.start({ projectId, slug, driverThreadId: driver });
          expect(h.sends).toHaveLength(1);
          yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
          // The state write is durable, while this test models a process exit before the usual result path.
          const context = yield* Layer.build(h.makeLayer());
          const restarted = Context.get(context, WorkflowRunner.WorkflowRunner);
          yield* restarted.reconcileWakeups({ runId: run.id });
          expect(h.sends).toHaveLength(2);
          expect(h.sends[1]?.text).toContain("Workflow state changed");
          expect(h.sends[1]?.text).toContain("Call workflow_status");
          const status = yield* runner.status(run.id, driver);
          expect(status.steps[0]?.status).toBe("running");
          yield* restarted.reconcileWakeups({ runId: run.id });
          expect(h.sends).toHaveLength(2);
        }),
      ),
  );
});

it.effect(
  "publishes newer picker evidence, keeps it through edits, and refreshes Run/rerun/dispatch outside the lock",
  () => {
    let queries = 0;
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    return notifyScenario(
      {
        mcpList: () =>
          Effect.gen(function* () {
            queries += 1;
            if (queries === 3) {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }
            return {
              servers: [
                {
                  name: "linear",
                  status: queries === 1 ? "needs-auth" : "connected",
                  toolsStatus: "unavailable",
                  tools: [],
                },
              ],
            };
          }),
      },
      (h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const definition = workflow([
            {
              id: "build",
              skill: "build",
              attachments: [
                {
                  id: "linear",
                  kind: "mcp-connection",
                  server: "linear",
                  providerInstanceId: ProviderInstanceId.make("codex-work"),
                },
              ],
            },
          ]);
          yield* runner.save({ projectId, slug, definition, callerThreadId: driver });
          const probed = yield* runner.probe({ projectId, slug, contextThreadId: driver });
          expect(probed.entries[0]?.status).toBe("missing");
          expect(probed.blocksRun).toBe(false);
          expect(queries).toBe(1);
          yield* runner.refreshMcpInventory({
            projectId,
            workflow: slug,
            stepId: "build",
            contextThreadId: driver,
          });
          expect(queries).toBe(2);
          expect((yield* runner.readiness({ projectId, slug })).entries[0]?.status).toBe(
            "available",
          );
          yield* runner.save({
            projectId,
            slug,
            definition: { ...definition, name: "Edited" },
            callerThreadId: driver,
          });
          expect(
            (yield* runner.listRuns({ projectId })).workflows[0]?.readiness?.entries[0]?.status,
          ).toBe("available");
          expect(queries).toBe(2);
          yield* TestClock.adjust("61 seconds");
          expect((yield* runner.readiness({ projectId, slug })).entries[0]?.stale).toBe(true);
          expect(
            (yield* runner.listRuns({ projectId })).workflows[0]?.readiness?.entries[0]?.stale,
          ).toBe(true);
          expect(queries).toBe(2);
          const pending = yield* runner
            .start({ projectId, slug, driverThreadId: driver, callerThreadId: driver })
            .pipe(Effect.forkChild);
          yield* Deferred.await(entered);
          // This mutation completes while the provider query is held on a Deferred.
          yield* runner.meta({
            projectId,
            slug,
            name: "Edited while probing",
            callerThreadId: driver,
          });
          yield* Deferred.succeed(release, undefined);
          const rejected = yield* Effect.result(Fiber.join(pending));
          expect(rejected._tag).toBe("Failure");
          const run = yield* runner.start({
            projectId,
            slug,
            driverThreadId: driver,
            callerThreadId: driver,
          });
          expect(run.preflight?.entries[0]?.status).toBe("available");
          expect(queries).toBe(4);
          yield* runner.stepStart({ runId: run.id, stepId: "build", callerThreadId: driver });
          expect(queries).toBe(5);
          yield* runner.stepDone({
            runId: run.id,
            stepId: "build",
            callerThreadId: driver,
            summary: "Finished",
            outputs: {},
            failed: false,
          });
          yield* runner.stepRerun({ runId: run.id, stepId: "build", callerThreadId: driver });
          expect(queries).toBe(6);
        }),
    );
  },
);

it.effect(
  "refreshes shared MCP inventory only once for a nested dispatch's child and owner",
  () => {
    let queries = 0;
    return notifyScenario(
      {
        mcpList: () =>
          Effect.sync(() => {
            queries += 1;
            return {
              servers: [
                { name: "linear", status: "connected", toolsStatus: "unavailable", tools: [] },
              ],
            };
          }),
      },
      (h) =>
        Effect.gen(function* () {
          yield* h.writeSkill("build");
          const runner = yield* WorkflowRunner.WorkflowRunner;
          const attachments = [{ id: "linear", kind: "mcp-connection" as const, server: "linear" }];
          yield* runner.save({
            projectId,
            slug: "nested",
            definition: workflow([{ id: "build", skill: "build", attachments }]),
            callerThreadId: driver,
          });
          const run = yield* start(
            workflow([{ id: "nested", kind: "workflow", workflow: "nested", attachments }]),
          );
          expect(queries).toBe(1);
          const dispatched = yield* runner.stepStart({
            runId: run.id,
            stepId: "nested",
            callerThreadId: driver,
          });
          expect(dispatched.parent).toEqual({ runId: run.id, stepId: "nested" });
          expect(dispatched.preflight?.entries[0]?.status).toBe("available");
          expect(queries).toBe(2);
        }),
    );
  },
);

it.effect("scrubs credential values before storing workflow completion and check results", () =>
  Effect.gen(function* () {
    const secret = "credentialPrivateValue123";
    const h = yield* setup(
      undefined,
      () =>
        Effect.succeed({
          stdout: secret.repeat(100),
          stderr: "",
          code: 1,
          timedOut: false,
        } as never),
      { redact: credentialRedactor([secret]), credentialsAvailable: true },
    );
    yield* Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const run = yield* start(
        workflow([
          { id: "build", skill: "build", checks: [{ kind: "command", command: "validate" }] },
        ]),
      );
      expect(run.ready[0]?.prompt).toContain("credential_list and credential_exec");
      const result = yield* runner.stepDone({
        runId: run.id,
        stepId: "build",
        callerThreadId: driver,
        summary: secret,
        outputs: { artifact: secret },
        failed: false,
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      const store = yield* WorkflowStore.WorkflowStore;
      expect(JSON.stringify(yield* store.readRun(run.id))).not.toContain(secret);
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect("keeps a reserved legacy env name out of the step prompt and the card's env vars", () =>
  Effect.gen(function* () {
    const h = yield* setup(undefined, undefined, {
      credentials: [
        {
          ...githubCredential,
          templateId: "custom",
          fields: [
            {
              id: "path",
              label: "Path",
              kind: "text",
              envVar: "PATH",
              required: false,
              highRisk: false,
              value: "/tmp/bin",
            },
            ...githubCredential.fields,
          ],
        },
      ],
    });
    yield* Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const run = yield* start(
        workflow([
          {
            id: "build",
            skill: "build",
            attachments: [{ id: "custom", kind: "credential", templateId: "custom" }],
          },
        ]),
      );
      const prompt = run.ready[0]?.prompt ?? "";
      expect(prompt).toContain("env vars GITHUB_TOKEN");
      expect(prompt).not.toContain("PATH");
      const listing = (yield* runner.list({ projectId })).workflows[0];
      expect(listing?.readiness?.entries[0]?.credential?.envVars).toEqual([
        { name: "GITHUB_TOKEN", file: false },
      ]);
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect(
  "requires an unlocked authenticated session to enable workflow credential pre-approval",
  () =>
    Effect.gen(function* () {
      const h = yield* setup(undefined, undefined, { unlocked: true });
      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const definition = { ...workflow([]), credentialApprovals: "pre-approved" as const };
        expect((yield* runner.save({ projectId, slug, definition }).pipe(Effect.flip))._tag).toBe(
          "WorkflowInvalidError",
        );
        yield* runner
          .save({ projectId, slug, definition })
          .pipe(Effect.provideService(CredentialPolicySession, AuthSessionId.make("user-session")));
        const store = yield* WorkflowStore.WorkflowStore;
        expect((yield* store.readDefinition({ projectId, slug })).credentialApprovals).toBe(
          "pre-approved",
        );
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.provide(nodeLayer)),
);

it.effect(
  "records a pre-approval only for the credentials attached when the user approved it",
  () =>
    notifyScenario({ unlocked: true, credentials: [githubCredential, gitlabCredential] }, (h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
        const approved = () => preapprovals.approved({ projectId, workflow: slug });
        const asUser = <A, E>(effect: Effect.Effect<A, E, never>) =>
          effect.pipe(Effect.provideService(CredentialPolicySession, preapprovalSession));
        yield* runner.save({
          projectId,
          slug,
          callerThreadId: driver,
          definition: workflow([
            { id: "build", skill: "build", attachments: [attachmentOf(githubCredential)] },
          ]),
        });
        expect(yield* approved()).toEqual([]);

        yield* asUser(
          runner.meta({
            projectId,
            slug,
            callerThreadId: driver,
            credentialApprovals: "pre-approved",
          }),
        );
        expect(yield* approved()).toEqual([githubCredential.id]);

        // Attaching another credential afterwards must not widen the grant, even though the file
        // still says pre-approved: the agent tools reach `stepPut` without unlocking anything.
        yield* runner.stepPut({
          projectId,
          slug,
          callerThreadId: driver,
          step: { id: "ship", skill: "build", attachments: [attachmentOf(gitlabCredential)] },
        });
        expect(yield* approved()).toEqual([githubCredential.id]);
        expect((yield* runner.list({ projectId })).workflows[0]?.readiness?.warnings).toContain(
          CREDENTIAL_REAPPROVAL_WARNING,
        );

        // Asking for Pre-approved again is what re-offers the newly attached credential.
        yield* asUser(
          runner.meta({
            projectId,
            slug,
            callerThreadId: driver,
            credentialApprovals: "pre-approved",
          }),
        );
        expect((yield* approved()).toSorted()).toEqual(
          [githubCredential.id, gitlabCredential.id].toSorted(),
        );

        // Leaving pre-approved gives the authority back.
        yield* runner.meta({ projectId, slug, callerThreadId: driver, credentialApprovals: "ask" });
        expect(yield* approved()).toEqual([]);
      }).pipe(Effect.provide(h.layer)),
    ),
);

it.effect("withdrawing a pre-approval republishes readiness so the canvas offers re-approval", () =>
  notifyScenario({ unlocked: true, credentials: [githubCredential] }, (h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
      const asUser = <A, E>(effect: Effect.Effect<A, E, never>) =>
        effect.pipe(Effect.provideService(CredentialPolicySession, preapprovalSession));
      yield* runner.save({
        projectId,
        slug,
        callerThreadId: driver,
        definition: workflow([
          { id: "build", skill: "build", attachments: [attachmentOf(githubCredential)] },
        ]),
      });
      yield* asUser(
        runner.meta({
          projectId,
          slug,
          callerThreadId: driver,
          credentialApprovals: "pre-approved",
        }),
      );
      expect(
        (yield* runner.list({ projectId })).workflows[0]?.readiness?.warnings ?? [],
      ).not.toContain(CREDENTIAL_REAPPROVAL_WARNING);

      // Subscribing first means the snapshot below is a republish, not a re-read.
      const emitted = yield* Queue.unbounded<WorkflowsSnapshot>();
      yield* runner.subscribeRuns({ projectId }).pipe(
        Stream.runForEach((snapshot) => Queue.offer(emitted, snapshot)),
        Effect.forkScoped,
      );
      yield* Queue.take(emitted);

      // The vault withdraws the approval, without touching the workflow's file.
      yield* preapprovals.revokeCredential({
        projectId,
        workflow: slug,
        credentialId: githubCredential.id,
      });
      const republished = yield* Stream.fromQueue(emitted).pipe(
        Stream.filter((snapshot) =>
          (snapshot.workflows[0]?.readiness?.warnings ?? []).includes(
            CREDENTIAL_REAPPROVAL_WARNING,
          ),
        ),
        Stream.take(1),
        Stream.runCollect,
      );
      expect(Array.from(republished)).toHaveLength(1);
    }).pipe(Effect.provide(h.layer)),
  ),
);

it.effect("indexes active workflow runs by owning thread and project", () =>
  scenario((h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const run = yield* start(workflow([{ id: "build", skill: "build" }]));
      expect((yield* runner.activeRunsForThread(driver, projectId)).map((r) => r.id)).toEqual([
        run.id,
      ]);
      expect(yield* runner.activeRunsForThread(driver, ProjectId.make("other"))).toEqual([]);
      expect(yield* runner.activeRunsForThread(ThreadId.make("other"), projectId)).toEqual([]);
      yield* runner.stop(run.id);
      expect(yield* runner.activeRunsForThread(driver, projectId)).toEqual([]);
    }),
  ),
);

it.effect(
  "a workflow file that says pre-approved without this machine's approval grants nothing",
  () =>
    notifyScenario({ unlocked: true, credentials: [githubCredential] }, (h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
        // A hand-edited (or downloaded) file: written straight to disk, never through the unlocked
        // save, so the knob is a claim the server must not honour.
        yield* store.writeDefinition({
          projectId,
          slug: slug as WorkflowSlug,
          definition: {
            ...workflow([
              { id: "build", skill: "build", attachments: [attachmentOf(githubCredential)] },
            ]),
            credentialApprovals: "pre-approved",
          },
        });
        yield* runner.refresh({ projectId, workflow: slug });
        expect(
          yield* preapprovals.covered({
            projectId,
            workflow: slug,
            credentialId: githubCredential.id,
          }),
        ).toBe(false);
        expect((yield* runner.list({ projectId })).workflows[0]?.readiness?.warnings).toContain(
          CREDENTIAL_REAPPROVAL_WARNING,
        );
      }).pipe(Effect.provide(h.layer)),
    ),
);

it.effect("an imported workflow never arrives pre-approved on this machine", () =>
  notifyScenario({ unlocked: true, credentials: [githubCredential] }, (h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const store = yield* WorkflowStore.WorkflowStore;
      const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
      yield* runner.importWorkflow({
        projectId,
        slug,
        skills: [],
        definition: {
          ...workflow([
            { id: "build", skill: "build", attachments: [attachmentOf(githubCredential)] },
          ]),
          credentialApprovals: "pre-approved",
        },
      });
      expect((yield* store.readDefinition({ projectId, slug })).credentialApprovals).toBe(
        "once-per-run",
      );
      expect(yield* preapprovals.approved({ projectId, workflow: slug })).toEqual([]);
    }).pipe(Effect.provide(h.layer)),
  ),
);

it.effect("a claimed step keeps its thread when the driver starts it", () =>
  scenario((h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const run = yield* start(workflow([{ id: "build", skill: "build" }]));
      expect(
        yield* runner.claimStepThread({ runId: run.id, stepId: "build", threadId: child }),
      ).toBe(true);
      expect(
        yield* runner.claimStepThread({ runId: run.id, stepId: "build", threadId: stranger }),
      ).toBe(false);
      const started = yield* runner.stepStart({
        runId: run.id,
        stepId: "build",
        callerThreadId: driver,
      });
      expect(started.steps.find((step) => step.stepId === "build")?.threadId).toBe(child);
    }),
  ),
);

it.effect("checks a claimed step in the claiming thread's workspace", () =>
  scenario((h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const run = yield* start(
        workflow([
          {
            id: "build",
            skill: "build",
            attachments: [
              { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
            ],
          },
        ]),
      );
      expect(
        yield* runner.claimStepThread({
          runId: run.id,
          stepId: "build",
          threadId: claimedChild,
        }),
      ).toBe(true);
      const started = yield* runner.stepStart({
        runId: run.id,
        stepId: "build",
        callerThreadId: driver,
      });
      expect(started.steps.find((step) => step.stepId === "build")?.threadId).toBe(claimedChild);
      // The step's checks ran where the step will run, not where the driver sits.
      expect(h.probes.at(-1)?.cwd).toBe("/tmp/workflow-claimed-child-worktree");
    }),
  ),
);

/**
 * A workflow saved before pre-approval moved to this machine's grant: its file says
 * "pre-approved", but nothing here ever approved it.
 */
const savePreapprovedFile = (attachments: ReadonlyArray<WorkflowCredentialAttachment>) =>
  Effect.gen(function* () {
    const store = yield* WorkflowStore.WorkflowStore;
    yield* store.writeDefinition({
      projectId,
      slug: slug as WorkflowSlug,
      definition: {
        ...workflow([{ id: "build", skill: "build", attachments }]),
        credentialApprovals: "pre-approved",
      },
    });
  });

it.effect("blocks an unattended start whose pre-approval this machine never granted", () =>
  notifyScenario({ credentials: [githubCredential], unlocked: true }, (h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
      yield* savePreapprovedFile([attachmentOf(githubCredential)]);
      const blocked = yield* Effect.flip(
        runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
          unattended: true,
        }),
      );
      expect(blocked._tag).toBe("WorkflowBlockedError");
      if (blocked._tag !== "WorkflowBlockedError") return;
      expect(blocked.problems.join(" ")).toContain("Re-approve credentials for scheduled runs");
      expect(blocked.problems.join(" ")).toContain(githubCredential.name);
      expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(0);
      // A watched run is the user's business, so it starts anyway.
      const watched = yield* runner.start({
        projectId,
        slug,
        driverThreadId: driver,
        callerThreadId: driver,
      });
      expect(watched.status).toBe("running");
      // Once this machine grants it, the unattended start goes through.
      expect(
        yield* preapprovals.grant(
          { projectId, workflow: slug, credentialIds: [githubCredential.id] },
          preapprovalSession,
        ),
      ).toBe(true);
      const unattended = yield* runner.start({
        projectId,
        slug,
        driverThreadId: driver,
        callerThreadId: driver,
        unattended: true,
      });
      expect(unattended.status).toBe("running");
      // An optional credential is the step's business, not the run's.
      yield* savePreapprovedFile([{ ...attachmentOf(githubCredential), optional: true }]);
      const optional = yield* runner.start({
        projectId,
        slug,
        driverThreadId: driver,
        callerThreadId: driver,
        unattended: true,
      });
      expect(optional.status).toBe("running");
    }).pipe(Effect.provide(h.layer)),
  ),
);

it.effect("blocks an unattended start on a credential that always asks", () =>
  notifyScenario({ credentials: [alwaysAskCredential], unlocked: true }, (h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
      yield* savePreapprovedFile([attachmentOf(alwaysAskCredential)]);
      // Even a grant cannot make an always-ask credential usable without the user.
      expect(
        yield* preapprovals.grant(
          { projectId, workflow: slug, credentialIds: [alwaysAskCredential.id] },
          preapprovalSession,
        ),
      ).toBe(true);
      const blocked = yield* Effect.flip(
        runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
          unattended: true,
        }),
      );
      expect(blocked._tag).toBe("WorkflowBlockedError");
      if (blocked._tag !== "WorkflowBlockedError") return;
      expect(blocked.problems.join(" ")).toContain("always asks before use");
      expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(0);
    }).pipe(Effect.provide(h.layer)),
  ),
);

const subagentHint = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
const subagentProvider: ServerProvider = {
  instanceId: subagentHint.instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-23T00:00:00.000Z",
  models: [{ slug: subagentHint.model, name: "Luna", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
};

it.effect("pins usable, partial, fallback and absent subagent snapshots on start and rerun", () =>
  Effect.gen(function* () {
    let available: ReadonlyArray<ServerProvider> = [subagentProvider];
    const h = yield* setup(undefined, undefined, { providers: Effect.sync(() => available) });
    yield* h.writeSkill("build");
    yield* Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      for (const { hints, usable, missing, fallback } of [
        { hints: undefined, usable: undefined, missing: undefined, fallback: undefined },
        { hints: [], usable: 0, missing: 0, fallback: false },
        { hints: [subagentHint], usable: 1, missing: 0, fallback: false },
        {
          hints: [subagentHint, { ...subagentHint, model: "missing" }],
          usable: 1,
          missing: 1,
          fallback: false,
        },
        { hints: [{ ...subagentHint, model: "missing" }], usable: 0, missing: 1, fallback: true },
      ]) {
        available = [subagentProvider];
        const run = yield* start({
          ...workflow([{ id: "build", skill: "build" }]),
          ...(hints === undefined ? {} : { subagentModels: hints }),
        });
        expect(run.subagents?.usable.length).toBe(usable);
        expect(run.subagents?.missing.length).toBe(missing);
        expect(run.subagents?.fallback).toBe(fallback);
        expect(run.context.subagents).toEqual(run.subagents);
        const store = yield* WorkflowStore.WorkflowStore;
        expect((yield* store.readRun(run.id)).subagents).toEqual(run.subagents);
        expect(run.ready[0]).not.toHaveProperty("model");
        available = [];
        expect((yield* runner.status(run.id, driver)).subagents).toEqual(run.subagents);
        yield* runner.stop(run.id, driver);
        const rerun = yield* runner.stepRerun({
          runId: run.id,
          stepId: "build",
          callerThreadId: driver,
        });
        expect(rerun.subagents?.usable).toEqual(hints === undefined ? undefined : []);
        expect(rerun.subagents?.fallback).toBe(hints === undefined ? undefined : hints.length > 0);
        expect(rerun.context.subagents).toEqual(rerun.subagents);
        yield* runner.stop(rerun.id, driver);
      }
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect("refreshes preferred models against current providers for each ready step", () =>
  Effect.gen(function* () {
    let available: ReadonlyArray<ServerProvider> = [subagentProvider];
    const h = yield* setup(undefined, undefined, {
      providers: Effect.sync(() => available),
    });
    yield* h.writeSkill("build");
    yield* Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const run = yield* start({
        ...workflow([
          { id: "first", skill: "build" },
          { id: "second", skill: "build" },
        ]),
        subagentModels: [subagentHint],
      });
      const preferenceLine =
        "Preferred subagent models (the user's choice): Luna (codex / gpt-6-luna). Prefer these when you delegate.";
      expect(run.ready.every((step) => step.prompt.includes(preferenceLine))).toBe(true);

      available = [];
      yield* done(run.id, "first");
      const unavailable = yield* runner.status(run.id, driver);
      expect(unavailable.subagents?.usable).toHaveLength(1);
      expect(unavailable.ready).toHaveLength(1);
      expect(unavailable.ready[0]?.stepId).toBe("second");
      expect(unavailable.ready[0]?.prompt).not.toContain("Preferred subagent models");

      available = [subagentProvider];
      const restored = yield* runner.status(run.id, driver);
      expect(restored.ready[0]?.prompt).toContain(preferenceLine);
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect("replaces and clears subagent metadata, maps legacy models and rejects duplicates", () =>
  scenario((h) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner.save({ projectId, slug, definition: workflow([]) });
      const replaced = yield* runner.meta({ projectId, slug, subagentModels: [subagentHint] });
      expect(replaced.definition?.subagentModels).toEqual([subagentHint]);
      const cleared = yield* runner.meta({ projectId, slug, subagentModels: null });
      expect(cleared.definition).not.toHaveProperty("subagentModels");
      const legacy = yield* runner.meta({ projectId, slug, model: subagentHint });
      expect(legacy.definition?.subagentModels).toEqual([subagentHint]);
      expect(legacy.definition).not.toHaveProperty("model");
      const saved = JSON.parse(
        yield* h.fs.readFileString(h.path.join(h.projectRoot, ".t3", "workflows", `${slug}.json`)),
      );
      expect(saved.subagentModels).toEqual([subagentHint]);
      expect(saved).not.toHaveProperty("model");
      const duplicate = yield* runner
        .meta({
          projectId,
          slug,
          subagentModels: [
            subagentHint,
            { ...subagentHint, driver: ProviderDriverKind.make("codex") },
          ],
        })
        .pipe(Effect.flip);
      expect(duplicate.message).toContain("Duplicate subagent model");
      expect((yield* runner.meta({ projectId, slug, model: null })).definition).not.toHaveProperty(
        "subagentModels",
      );
    }),
  ),
);

it.effect("pins child choices independently and uses the child's snapshot in parent status", () =>
  notifyScenario({ providers: Effect.succeed([subagentProvider]) }, (h) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* h.writeSkill("build");
      yield* runner.save({
        projectId,
        slug: "child-workflow" as WorkflowSlug,
        definition: {
          ...workflow([{ id: "build", skill: "build" }]),
          subagentModels: [subagentHint],
        },
      });
      const parent = yield* start({
        ...workflow([{ id: "child", kind: "workflow", workflow: "child-workflow" }]),
        subagentModels: [{ ...subagentHint, model: "missing" }],
      });
      expect(parent.subagents?.fallback).toBe(true);
      expect(parent.ready[0]).not.toHaveProperty("model");
      const nested = yield* runner.stepStart({
        runId: parent.id,
        stepId: "child",
        callerThreadId: driver,
      });
      expect(nested.subagents?.usable[0]?.model).toBe(subagentHint.model);
      expect(nested.context.subagents).toEqual(nested.subagents);
      const status = yield* runner.status(parent.id, driver);
      expect(status.context.subagents).toEqual(parent.subagents);
      expect(status.ready[0]?.runId).toBe(nested.id);
      expect(status.ready[0]?.prompt).toContain(
        "Preferred subagent models (the user's choice): Luna (codex / gpt-6-luna). Prefer these when you delegate.",
      );
      expect(status.ready[0]?.prompt).not.toContain("none of this workflow's choices");
    }),
  ),
);

it.effect("resolves a step's own portable model without inheriting the workflow choice", () =>
  notifyScenario(
    {
      providers: Effect.succeed([
        { ...subagentProvider, instanceId: ProviderInstanceId.make("codex-work") },
      ]),
    },
    (h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const run = yield* start({
          ...workflow([{ id: "build", skill: "build", model: subagentHint }]),
          subagentModels: [{ ...subagentHint, model: "missing" }],
        });
        expect(run.ready[0]?.model).toEqual({ ...subagentHint, instanceId: "codex-work" });
        expect(run.ready[0]?.prompt).toContain("This step prefers Luna (codex-work / gpt-6-luna).");
        expect(run.ready[0]?.prompt).not.toContain("Subagent models:");
      }),
  ),
);

it.effect("reads provider snapshots for run start outside the mutation lock", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let holdNextRead = false;
    const h = yield* setup(undefined, undefined, {
      providers: Effect.gen(function* () {
        if (holdNextRead) {
          holdNextRead = false;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }
        return [subagentProvider];
      }),
    });
    yield* h.writeSkill("build");
    yield* Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner.save({
        projectId,
        slug,
        definition: {
          ...workflow([{ id: "build", skill: "build" }]),
          subagentModels: [subagentHint],
        },
      });
      holdNextRead = true;
      const pending = yield* runner
        .start({ projectId, slug, driverThreadId: driver, callerThreadId: driver })
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      yield* runner.create({ projectId, slug: "unrelated" as WorkflowSlug, name: "Unrelated" });
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(pending)).subagents?.usable[0]?.model).toBe(subagentHint.model);
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect("uses the active run snapshot for inventory after the live choices disappear", () =>
  Effect.gen(function* () {
    let available: ReadonlyArray<ServerProvider> = [subagentProvider];
    const h = yield* setup(undefined, undefined, { providers: Effect.sync(() => available) });
    yield* h.writeSkill("build");
    yield* Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const input = { projectId, workflow: slug, contextThreadId: driver };
      const inventory = runner.mcpInventory(input);
      const run = yield* start({
        ...workflow([{ id: "build", skill: "build" }]),
        subagentModels: [subagentHint],
      });
      available = [];
      expect((yield* inventory).scope.model).toMatchObject(subagentHint);
      expect((yield* runner.refreshMcpInventory(input)).scope.model).toMatchObject(subagentHint);
      yield* runner.stop(run.id, driver);
      expect((yield* runner.mcpInventory(input)).scope.model).toBeUndefined();
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect("enforces the stored subagent model cap only when setting model hints", () =>
  notifyScenario({ providers: Effect.succeed([subagentProvider]) }, (h) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* h.writeSkill("build");
      const definition = workflow([{ id: "build", skill: "build" }]);
      yield* runner.save({ projectId, slug, definition });
      expect(
        (yield* runner.meta({ projectId, slug, model: subagentHint })).definition?.subagentModels,
      ).toEqual([{ ...subagentHint, driver: "codex" }]);
      const models = Array.from({ length: 3 }, (_, index) => ({
        ...subagentHint,
        model: `model-${index}`,
      }));
      const preferencesPath = h.path.join(
        h.home,
        "server-state",
        "userdata",
        "workflows",
        "preferences.json",
      );
      yield* h.fs.makeDirectory(h.path.dirname(preferencesPath), { recursive: true });
      const setCap = (cap: number) =>
        h.fs.writeFileString(
          preferencesPath,
          JSON.stringify({ pinnedSkills: [], maxSubagentModels: cap }),
        );
      yield* setCap(2);
      expect(
        (yield* runner.meta({ projectId, slug, subagentModels: models.slice(0, 2) })).definition
          ?.subagentModels,
      ).toHaveLength(2);
      const excess = yield* runner
        .meta({ projectId, slug, subagentModels: models })
        .pipe(Effect.flip);
      expect(excess.message).toBe(
        "This workflow can have up to 2 subagent models (Settings → General).",
      );
      yield* setCap(3);
      expect(
        (yield* runner.meta({ projectId, slug, subagentModels: models })).definition
          ?.subagentModels,
      ).toHaveLength(3);
    }),
  ),
);

it.effect("drops an unavailable step target and uses the workflow preference", () =>
  notifyScenario({ providers: Effect.succeed([subagentProvider]) }, (h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const run = yield* start({
        ...workflow([
          { id: "build", skill: "build", model: { ...subagentHint, model: "missing" } },
        ]),
        subagentModels: [subagentHint],
      });
      expect(run.ready[0]).not.toHaveProperty("model");
      expect(run.ready[0]?.prompt).toContain(
        "Preferred subagent models (the user's choice): Luna (codex / gpt-6-luna). Prefer these when you delegate.",
      );
    }),
  ),
);

it.effect.each(["legacy", "snapshotless"] as const)(
  "restores %s run model guidance in memory after a restart",
  (shape) =>
    Effect.gen(function* () {
      const h = yield* setup(undefined, undefined, {
        providers: Effect.succeed([subagentProvider]),
      });
      yield* h.writeSkill("build");
      const run = yield* Effect.gen(function* () {
        const store = yield* WorkflowStore.WorkflowStore;
        const run = yield* start(workflow([{ id: "build", skill: "build" }]));
        yield* store.writeRun({
          ...run,
          definition: {
            ...run.definition,
            ...(shape === "legacy" ? { model: subagentHint } : { subagentModels: [subagentHint] }),
          },
        });
        return run;
      }).pipe(Effect.provide(h.layer));
      const runPath = h.path.join(
        h.home,
        "server-state",
        "userdata",
        "workflow-runs",
        `${run.id}.json`,
      );
      const historical = yield* h.fs.readFileString(runPath);
      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const loaded = yield* runner.status(run.id, driver);
        expect(loaded.ready[0]?.prompt).toContain(
          "Preferred subagent models (the user's choice): Luna (codex / gpt-6-luna). Prefer these when you delegate.",
        );
        expect(loaded.context.subagents?.usable).toEqual([
          {
            driver: "codex",
            instanceId: subagentHint.instanceId,
            model: subagentHint.model,
            label: "Luna",
          },
        ]);
        expect(loaded.subagents).toEqual(loaded.context.subagents);
        expect(loaded.definition.subagentModels).toEqual([subagentHint]);
        expect(loaded.definition).not.toHaveProperty("model");
        expect((yield* runner.listRuns({ projectId })).runs[0]?.definition.subagentModels).toEqual([
          subagentHint,
        ]);
      }).pipe(Effect.provide(h.makeLayer()));
      expect(yield* h.fs.readFileString(runPath)).toBe(historical);
    }).pipe(Effect.provide(nodeLayer)),
);

it.effect("resolves a legacy live run's missing snapshot from current providers", () =>
  Effect.gen(function* () {
    let available: ReadonlyArray<ServerProvider> = [{ ...subagentProvider, installed: false }];
    const h = yield* setup(undefined, undefined, {
      providers: Effect.sync(() => available),
    });
    yield* h.writeSkill("build");
    const run = yield* Effect.gen(function* () {
      const store = yield* WorkflowStore.WorkflowStore;
      const run = yield* start({
        ...workflow([{ id: "build", skill: "build" }]),
        subagentModels: [subagentHint],
      });
      yield* store.writeRun({ ...run, subagents: undefined });
      return run;
    }).pipe(Effect.provide(h.layer));
    yield* Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const unavailable = yield* runner.status(run.id, driver);
      expect(unavailable.subagents?.fallback).toBe(true);
      expect(unavailable.context.subagents?.missing[0]?.reason).toBe("not-installed");

      available = [subagentProvider];
      const refreshed = yield* runner.status(run.id, driver);
      expect(refreshed.subagents?.missing[0]?.reason).toBeUndefined();
      expect(refreshed.subagents?.fallback).toBe(false);
      expect(refreshed.subagents?.usable[0]?.model).toBe(subagentHint.model);
      expect(refreshed.context.subagents).toEqual(refreshed.subagents);
    }).pipe(Effect.provide(h.makeLayer()));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect("enforces the model cap on full saves, including new drafts and changed lists", () =>
  scenario(() =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const models = Array.from({ length: 5 }, (_, index) => ({
        ...subagentHint,
        model: `model-${index}`,
      }));
      const definition = { ...workflow([]), subagentModels: models };
      const rejectedDraft = yield* runner.save({ projectId, slug, definition }).pipe(Effect.flip);
      expect(rejectedDraft._tag).toBe("WorkflowSubagentModelCapError");
      expect(rejectedDraft.message).toBe(
        "This workflow can have up to 4 subagent models (Settings → General).",
      );
      yield* runner.save({
        projectId,
        slug,
        definition: { ...definition, subagentModels: models.slice(0, 3) },
      });
      yield* runner.save({
        projectId,
        slug,
        definition: { ...definition, subagentModels: models.slice(0, 4) },
      });
      const rejectedEdit = yield* runner.save({ projectId, slug, definition }).pipe(Effect.flip);
      expect(rejectedEdit._tag).toBe("WorkflowSubagentModelCapError");
      expect(
        (yield* runner.listRuns({ projectId })).workflows[0]?.definition?.subagentModels,
      ).toHaveLength(4);
    }),
  ),
);

it.effect.each(["meta", "save"] as const)(
  "allows imported over-cap lists to shrink through %s without allowing additions",
  (method) =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const models = Array.from({ length: 7 }, (_, index) => ({
          ...subagentHint,
          model: `model-${index}`,
        }));
        const definition = { ...workflow([]), subagentModels: models.slice(0, 6) };
        yield* runner.importWorkflow({ projectId, slug, definition, skills: [] });
        const edit = (subagentModels: typeof models) =>
          method === "meta"
            ? runner.meta({ projectId, slug, subagentModels }).pipe(Effect.asVoid)
            : runner
                .save({ projectId, slug, definition: { ...definition, subagentModels } })
                .pipe(Effect.asVoid);
        expect((yield* edit(models).pipe(Effect.flip))._tag).toBe("WorkflowSubagentModelCapError");
        yield* runner.stepPut({ projectId, slug, step: { id: "build", skill: "build" } });
        yield* edit(models.slice(0, 5));
        yield* edit(models.slice(0, 5));
        expect(
          (yield* runner.listRuns({ projectId })).workflows[0]?.definition?.subagentModels,
        ).toHaveLength(5);
        expect((yield* edit(models.slice(0, 6)).pipe(Effect.flip))._tag).toBe(
          "WorkflowSubagentModelCapError",
        );
        expect((yield* edit([...models.slice(0, 4), models[6]!]).pipe(Effect.flip))._tag).toBe(
          "WorkflowSubagentModelCapError",
        );
        yield* edit(models.slice(0, 4));
        yield* edit(models.slice(0, 3));
        yield* edit(models.slice(0, 4));
        expect(
          (yield* runner.listRuns({ projectId })).workflows[0]?.definition?.subagentModels,
        ).toHaveLength(4);
      }),
    ),
);

it.effect("preserves an imported over-cap hint when adding its portable driver", () =>
  scenario((h) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const instanceId = ProviderInstanceId.make("codex-work");
      const models = ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"].map((model) => ({
        instanceId,
        model,
      }));
      yield* runner.importWorkflow({
        projectId,
        slug,
        definition: { ...workflow([]), subagentModels: models },
        skills: [],
      });
      const preferencesPath = h.path.join(
        h.home,
        "server-state",
        "userdata",
        "workflows",
        "preferences.json",
      );
      yield* h.fs.makeDirectory(h.path.dirname(preferencesPath), { recursive: true });
      yield* h.fs.writeFileString(
        preferencesPath,
        JSON.stringify({ pinnedSkills: [], maxSubagentModels: 1 }),
      );

      const reduced = yield* runner.meta({
        projectId,
        slug,
        subagentModels: [{ ...models[0]!, driver: ProviderDriverKind.make("codex") }, models[1]!],
      });
      expect(reduced.definition?.subagentModels).toHaveLength(2);
      const newModel = yield* runner
        .meta({
          projectId,
          slug,
          subagentModels: [
            { ...models[0]!, driver: ProviderDriverKind.make("codex") },
            { ...models[1]!, model: "new-model" },
          ],
        })
        .pipe(Effect.flip);
      expect(newModel._tag).toBe("WorkflowSubagentModelCapError");
    }),
  ),
);

describe("scratch workflows from Workflow-first", () => {
  const originOf = (threadId: ThreadId) => ({ kind: "workflow-first" as const, threadId });

  it.effect("round trips an automatic origin through save, listing and reload", () =>
    scenario((h) =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const definition = { ...workflow([]), origin: originOf(driver) };
        yield* runner.save({ projectId, slug, definition, callerThreadId: driver });

        const listed = yield* runner.list({ projectId });
        expect(listed.workflows).toHaveLength(1);
        expect(listed.workflows[0]?.scratch).toBe(true);
        expect(listed.workflows[0]?.definition?.origin).toEqual(originOf(driver));
        expect((yield* store.readDefinition({ projectId, slug })).origin).toEqual(originOf(driver));
        expect(h.sends).toEqual([]);
      }),
    ),
  );

  it.effect("leaves a workflow the user saves themselves ordinary", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({ projectId, slug, definition: workflow([]), callerThreadId: driver });
        const listed = yield* runner.list({ projectId });
        expect(listed.workflows[0]?.scratch).toBe(false);
        expect(listed.workflows[0]?.definition).not.toHaveProperty("origin");
      }),
    ),
  );

  it.effect("keeps an origin that a whole-definition save omits", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([]), origin: originOf(driver) },
        });
        // The agent's own workflow_save replaces the definition; provenance outlives the content.
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([{ id: "build", skill: "build" }]), name: "Renamed" },
        });
        const listed = (yield* runner.list({ projectId })).workflows[0];
        expect(listed?.scratch).toBe(true);
        expect(listed?.definition?.name).toBe("Renamed");
        expect(listed?.definition?.origin).toEqual(originOf(driver));
      }),
    ),
  );

  it.effect("keeps provenance through metadata and step edits", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([]), origin: originOf(driver) },
          callerThreadId: driver,
        });
        // The incremental edit paths spread the stored definition, so none of them drops it.
        const meta = yield* runner.meta({ projectId, slug, name: "Renamed" });
        expect(meta.definition?.origin).toEqual(originOf(driver));
        const step = yield* runner.stepPut({
          projectId,
          slug,
          step: { id: "build", skill: "build" },
        });
        expect(step.definition?.origin).toEqual(originOf(driver));
        expect(step.scratch).toBe(true);
      }),
    ),
  );

  it.effect("filters scratch workflows out only when includeScratch is false", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([]), origin: originOf(driver) },
        });
        yield* runner.save({ projectId, slug: "kept", definition: workflow([]) });

        const byDefault = yield* runner.list({ projectId });
        expect(byDefault.workflows.map((item) => item.workflow)).toEqual(["kept", "launch-site"]);
        expect(byDefault.workflows.filter((item) => item.scratch)).toHaveLength(1);

        const matched = yield* runner.list({ projectId, includeScratch: false });
        expect(matched.workflows.map((item) => item.workflow)).toEqual(["kept"]);

        // The same filter applies once every project's listings are resolved.
        const across = yield* runner.list({ includeScratch: false });
        expect(across.workflows.map((item) => item.workflow)).toEqual(["kept"]);
      }),
    ),
  );

  it.effect("keeps a scratch workflow by clearing only its origin, and twice is the same", () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("build");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const definition = {
          version: 3 as const,
          name: "From the thread",
          brief: "What the thread did.",
          notes: [{ id: "remember", text: "Keep the copy short.", x: 12, y: 8 }],
          origin: originOf(driver),
          steps: [{ id: "build", skill: "build" }],
        };
        yield* runner.save({ projectId, slug, definition, callerThreadId: driver });
        const run = yield* runner.start({ projectId, slug, driverThreadId: driver });

        const kept = yield* runner.keep({ projectId, slug });
        expect(kept.scratch).toBe(false);
        expect(kept.definition).not.toHaveProperty("origin");
        const { origin: _origin, ...withoutOrigin } = definition;
        expect(kept.definition).toEqual(withoutOrigin);
        expect(yield* store.readDefinition({ projectId, slug })).toEqual(withoutOrigin);

        const again = yield* runner.keep({ projectId, slug });
        expect(again.scratch).toBe(false);
        expect(yield* store.readDefinition({ projectId, slug })).toEqual(withoutOrigin);

        // A run keeps the definition it started with, so diffing and history never change under it.
        expect((yield* store.readRun(run.id)).definition.origin).toEqual(originOf(driver));
      }),
    ),
  );

  it.effect("accepts a new origin from the saving thread and refuses another thread's", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const error = yield* runner
          .save({
            projectId,
            slug,
            definition: { ...workflow([]), origin: originOf(child) },
            callerThreadId: driver,
          })
          .pipe(Effect.flip);
        expect(error._tag).toBe("WorkflowInvalidError");
        expect(error.message).toContain("the thread that saved it");

        // The canvas has no caller thread, so a draft it imports may name the thread it came from.
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([]), origin: originOf(child) },
        });
        expect((yield* runner.list({ projectId })).workflows[0]?.scratch).toBe(true);
      }),
    ),
  );

  it.effect("keeps stored provenance when another thread edits a scratch workflow", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([]), origin: originOf(driver) },
          callerThreadId: driver,
        });
        // A later thread saves content, without an origin and then with a different one. Neither
        // edit can move or clear the original provenance; only workflow_keep can.
        yield* runner.save({
          projectId,
          slug,
          definition: workflow([{ id: "build", skill: "build" }]),
          callerThreadId: child,
        });
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([]), name: "Elsewhere", origin: originOf(child) },
          callerThreadId: child,
        });
        const listed = (yield* runner.list({ projectId })).workflows[0];
        expect(listed?.definition?.origin).toEqual(originOf(driver));
        expect(listed?.definition?.name).toBe("Elsewhere");
        expect(listed?.scratch).toBe(true);
      }),
    ),
  );

  it.effect("keeps a kept workflow ordinary when an old automatic definition is saved again", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const autoSaved = {
          version: 3 as const,
          name: "From the thread",
          brief: "What the thread did.",
          origin: originOf(driver),
          steps: [{ id: "build", skill: "build" }],
        };
        yield* runner.save({ projectId, slug, definition: autoSaved, callerThreadId: driver });
        yield* runner.keep({ projectId, slug });

        // A retried or replayed save still carries the definition the agent created before the
        // user kept it. Origin is fixed at birth, so the replay cannot turn the kept workflow
        // back into scratch.
        yield* runner.save({
          projectId,
          slug,
          definition: autoSaved,
          callerThreadId: driver,
        });
        const replayed = (yield* runner.list({ projectId })).workflows[0];
        expect(replayed?.scratch).toBe(false);
        expect(replayed?.definition?.name).toBe("From the thread");
        expect(yield* store.readDefinition({ projectId, slug })).not.toHaveProperty("origin");
      }),
    ),
  );

  it.effect("never marks an existing ordinary workflow as scratch on a later save", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({ projectId, slug, definition: workflow([]), callerThreadId: driver });
        yield* runner.save({
          projectId,
          slug,
          definition: { ...workflow([]), name: "Saved again", origin: originOf(driver) },
          callerThreadId: driver,
        });
        const revisited = (yield* runner.list({ projectId })).workflows[0];
        expect(revisited?.scratch).toBe(false);
        expect(revisited?.definition?.name).toBe("Saved again");
        expect(revisited?.definition).not.toHaveProperty("origin");
        const listed = (yield* runner.list({ projectId, includeScratch: false })).workflows;
        expect(listed.map((item) => item.workflow)).toEqual([slug]);
      }),
    ),
  );

  it.effect("refuses an origin naming another project's thread", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        const store = yield* WorkflowStore.WorkflowStore;
        const error = yield* runner
          .save({
            projectId,
            slug,
            definition: {
              ...workflow([]),
              origin: { kind: "workflow-first", threadId: foreignContext },
            },
          })
          .pipe(Effect.flip);
        expect(error._tag).toBe("WorkflowInvalidError");
        expect(yield* store.readDefinition({ projectId, slug }).pipe(Effect.flip)).toMatchObject({
          _tag: "WorkflowNotFoundError",
        });
      }),
    ),
  );

  it.effect("reads and sets Workflow-first through the runner's captured instance", () =>
    scenario(() =>
      Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        expect((yield* runner.workflowFirstRead({ threadId: driver })).enabled).toBe(false);
        yield* runner.workflowFirstSet({ threadId: driver, enabled: true });
        expect((yield* runner.workflowFirstRead({ threadId: driver })).enabled).toBe(true);
        yield* runner.workflowFirstSet({ threadId: driver, enabled: false });
        expect((yield* runner.workflowFirstRead({ threadId: driver })).enabled).toBe(false);

        const missing = yield* runner
          .workflowFirstRead({ threadId: missingThread })
          .pipe(Effect.flip);
        expect(missing._tag).toBe("WorkflowFirstThreadNotFoundError");
        expect(missing.message).toBe("Thread not found.");
      }),
    ),
  );
});

it.effect("re-arms persisted timed waits after restart and supports Start now", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    yield* h.writeSkill("build");
    const runId = yield* Effect.gen(function* () {
      const run = yield* start(
        workflow([{ id: "build", skill: "build", waitBefore: { kind: "delay", minutes: 5 } }]),
      );
      expect(run.steps[0]).toMatchObject({
        status: "waiting",
        waitingFor: "timer",
        resumeAt: "1970-01-01T00:05:00.000Z",
      });
      return run.id;
    }).pipe(Effect.provide(h.layer));
    yield* Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* TestClock.adjust("5 minutes");
      expect((yield* runner.status(runId)).steps[0]).toMatchObject({ status: "ready" });
      const next = yield* start(
        workflow([{ id: "build", skill: "build", waitBefore: { kind: "delay", minutes: 60 } }]),
      );
      const resumed = yield* runner.resume({ runId: next.id, stepId: "build" });
      expect(resumed.steps[0]).toMatchObject({ status: "ready" });
      expect(resumed.steps[0]?.resumeAt).toBeUndefined();
      yield* runner.stop(next.id);
      yield* TestClock.adjust("60 minutes");
      expect((yield* runner.status(next.id)).status).toBe("stopped");
    }).pipe(Effect.provide(h.makeLayer()));
  }).pipe(Effect.provide(nodeLayer)),
);

it.effect("rejects after-workflow cycles and chains longer than two edges", () =>
  scenario(() =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner.save({ projectId, slug: "one", definition: workflow([]) });
      yield* runner.save({
        projectId,
        slug: "two",
        definition: { ...workflow([]), startAfter: [{ workflow: "one", when: "succeeded" }] },
      });
      yield* runner.save({
        projectId,
        slug: "three",
        definition: { ...workflow([]), startAfter: [{ workflow: "two", when: "finished" }] },
      });
      expect(
        (yield* runner
          .triggerSet({ projectId, slug: "one", afterWorkflow: "three", when: "finished" })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(
        (yield* runner
          .save({
            projectId,
            slug: "four",
            definition: { ...workflow([]), startAfter: [{ workflow: "three", when: "finished" }] },
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
    }),
  ),
);

it.effect.each([false, true])(
  "fires after-workflow once and does not replay on restart (failed=%s)",
  (failed) =>
    Effect.gen(function* () {
      const h = yield* setup();
      yield* h.writeSkill("build");
      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug: "source",
          definition: workflow([{ id: "build", skill: "build" }]),
        });
        yield* runner.save({
          projectId,
          slug: "target",
          definition: {
            ...workflow([{ id: "build", skill: "build" }]),
            startAfter: [{ workflow: "source", when: failed ? "finished" : "succeeded" }],
          },
        });
        const targetStarted = yield* runner.subscribeRuns({ projectId }).pipe(
          Stream.filter((snapshot) => snapshot.runs.some((run) => run.workflow === "target")),
          Stream.take(1),
          Stream.runHead,
          Effect.forkChild,
        );
        const source = yield* runner.start({ projectId, slug: "source", driverThreadId: driver });
        yield* runner.stepDone({
          runId: source.id,
          stepId: "build",
          callerThreadId: driver,
          summary: "Built",
          outputs: {},
          failed,
        });
        yield* Fiber.join(targetStarted);
        const targets = (yield* runner.listRuns({ projectId })).runs.filter(
          (run) => run.workflow === "target",
        );
        expect(targets).toHaveLength(1);
        expect(targets[0]?.triggerSourceRunId).toBe(source.id);
      }).pipe(Effect.provide(h.layer));
      yield* Effect.gen(function* () {
        const runner = yield* WorkflowRunner.WorkflowRunner;
        expect(
          (yield* runner.listRuns({ projectId })).runs.filter((run) => run.workflow === "target"),
        ).toHaveLength(1);
      }).pipe(Effect.provide(h.makeLayer()));
    }).pipe(Effect.provide(nodeLayer)),
);

it.effect("enforces schedule overlap in the runner instead of creating a second run", () =>
  notifyScenario({ scheduledWorkflows: [slug] }, (h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("build");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner.save({
        projectId,
        slug,
        definition: workflow([{ id: "build", skill: "build" }]),
      });
      const input = {
        projectId,
        slug,
        driverThreadId: driver,
        scheduleTaskId: ScheduledTaskId.make(`scheduled-${slug}`),
        unattended: true,
      };
      yield* runner.start(input);
      const outcome = yield* runner.start(input).pipe(Effect.result);
      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "WorkflowBlockedError", problems: ["Schedule fire skipped: skip."] },
      });
      expect((yield* runner.listRuns({ projectId })).runs).toHaveLength(1);
    }),
  ),
);

it.effect(
  "repeats a loop range on revise, feeds feedback into the target step, re-prompts gates each round, and continues with a warning when exhausted",
  () =>
    scenario((h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("draft", "Write the copy.");
        yield* h.writeSkill("review", "Review the copy.");
        yield* h.writeSkill("publish", "Publish the copy.");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: {
            version: 3,
            name: "Polish loop",
            steps: [
              { id: "draft", skill: "draft", gate: true },
              { id: "review", skill: "review" },
              { id: "publish", skill: "publish" },
            ],
          },
          callerThreadId: driver,
        });
        yield* runner.loopPut({
          projectId,
          slug,
          callerThreadId: driver,
          loop: {
            id: "temp-loop",
            from: "review",
            to: "draft",
            maxRounds: 3,
            until: { kind: "checks-pass" },
          },
        });
        const afterDelete = yield* runner.loopRemove({
          projectId,
          slug,
          callerThreadId: driver,
          loopId: "temp-loop",
        });
        expect(afterDelete.definition?.loops).toBeUndefined();
        yield* runner.loopPut({
          projectId,
          slug,
          callerThreadId: driver,
          loop: {
            id: "review-to-draft",
            from: "review",
            to: "draft",
            maxRounds: 2,
            until: { kind: "step-says-pass" },
            feedback: true,
          },
        });
        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        expect(run.steps.find((s) => s.stepId === "draft")).toMatchObject({
          status: "waiting",
          waitingFor: "approval",
          round: 1,
        });

        // Round 1: approve draft, complete draft, complete review with VERDICT: revise
        yield* runner.approve({ runId: run.id, stepId: "draft" });
        yield* runner.stepStart({ runId: run.id, stepId: "draft", callerThreadId: driver });
        yield* runner.stepDone({
          runId: run.id,
          stepId: "draft",
          callerThreadId: driver,
          summary: "Draft v1",
          outputs: { copy: "v1.md" },
          failed: false,
        });
        yield* runner.stepStart({ runId: run.id, stepId: "review", callerThreadId: driver });
        const afterRound1 = yield* runner.stepDone({
          runId: run.id,
          stepId: "review",
          callerThreadId: driver,
          summary: "Needs shorter headline.\nVERDICT: revise — shorten headline",
          outputs: { notes: "rev1.md" },
          failed: false,
        });

        // Range reset to round 2; gate on draft asks for approval again; previousRounds recorded
        const draftRound2 = afterRound1.steps.find((s) => s.stepId === "draft")!;
        const reviewRound2 = afterRound1.steps.find((s) => s.stepId === "review")!;
        expect(draftRound2).toMatchObject({
          status: "waiting",
          waitingFor: "approval",
          round: 2,
          previousRounds: [{ round: 1, status: "done", summary: "Draft v1" }],
        });
        expect(reviewRound2).toMatchObject({
          status: "queued",
          round: 2,
          previousRounds: [
            {
              round: 1,
              status: "done",
              verdict: "revise",
            },
          ],
        });

        // Round 2: approve draft, verify feedback in prompt, then exhaust the loop on round 2
        const approvedDraftRound2 = yield* runner.approve({ runId: run.id, stepId: "draft" });
        const draftRound2Prompt = approvedDraftRound2.ready.find(
          (s) => s.stepId === "draft",
        )?.prompt;
        expect(draftRound2Prompt).toContain("## Feedback from review, round 1");
        expect(draftRound2Prompt).toContain("VERDICT: revise — shorten headline");
        expect(draftRound2Prompt).toContain("notes: rev1.md");
        yield* runner.stepStart({
          runId: run.id,
          stepId: "draft",
          callerThreadId: driver,
        });

        const oldRoundRetry = yield* runner
          .stepDone({
            runId: run.id,
            stepId: "draft",
            callerThreadId: driver,
            summary: "Draft v1",
            outputs: { copy: "v1.md" },
            failed: false,
          })
          .pipe(Effect.flip);
        expect(oldRoundRetry._tag).toBe("WorkflowStepStateError");
        yield* runner.stepDone({
          runId: run.id,
          stepId: "draft",
          callerThreadId: driver,
          executionToken: draftRound2.executionToken,
          summary: "Draft v2",
          outputs: { copy: "v2.md" },
          failed: false,
        });
        yield* runner.stepStart({ runId: run.id, stepId: "review", callerThreadId: driver });
        const afterExhausted = yield* runner.stepDone({
          runId: run.id,
          stepId: "review",
          callerThreadId: driver,
          executionToken: reviewRound2.executionToken,
          summary: "Still nitpicking.\nVERDICT: revise — one more tweak",
          outputs: { notes: "rev2.md" },
          failed: false,
        });

        // Exhausted loop marks loopExhausted and continues to publish instead of failing
        expect(afterExhausted.status).toBe("running");
        expect(afterExhausted.exhaustedLoops).toEqual(["review-to-draft"]);
        expect(afterExhausted.steps.find((s) => s.stepId === "review")?.loopExhausted).toBe(true);
        expect(afterExhausted.steps.find((s) => s.stepId === "publish")?.status).toBe("ready");
      }),
    ),
);

it.effect(
  "carries over the previous finished run result and rotates inputs on scheduled starts",
  () =>
    notifyScenario(
      {
        scheduledWorkflows: [slug],
        scheduleKnobs: {
          carryOver: true,
          rotate: { inputId: "area", values: ["Billing", "Onboarding"], next: 0 },
        },
      },
      (h) =>
        Effect.gen(function* () {
          const runner = yield* WorkflowRunner.WorkflowRunner;
          yield* runner.save({
            projectId,
            slug,
            definition: {
              version: 3,
              name: "Continuous audit",
              inputs: [{ id: "area", label: "Area", kind: "text", required: true }],
              steps: [{ id: "audit", skill: "audit" }],
            },
            callerThreadId: driver,
          });

          // A failed start (missing skill) must not advance the rotation pointer
          yield* runner
            .start({
              projectId,
              slug,
              driverThreadId: driver,
              scheduleTaskId: ScheduledTaskId.make(`scheduled-${slug}`),
              unattended: true,
            })
            .pipe(Effect.flip);
          expect(h.schedules.updatedBindings).toEqual([]);

          yield* h.writeSkill("audit", "Audit {{input.area}}. Prior: {{last.result}}");

          // A failed updateBinding must not leave a stranded active run that blocks subsequent starts
          h.schedules.failUpdateBinding = true;
          const bindingFailure = yield* runner
            .start({
              projectId,
              slug,
              driverThreadId: driver,
              scheduleTaskId: ScheduledTaskId.make(`scheduled-${slug}`),
              unattended: true,
            })
            .pipe(Effect.flip);
          expect(bindingFailure._tag).toBe("ScheduledTaskError");
          expect(h.schedules.updatedBindings).toEqual([]);
          expect((yield* runner.listRuns({ projectId })).runs).toEqual([]);
          h.schedules.failUpdateBinding = false;

          // First scheduled run: rotates area -> Billing, completes with summary
          const run1 = yield* runner.start({
            projectId,
            slug,
            driverThreadId: driver,
            scheduleTaskId: ScheduledTaskId.make(`scheduled-${slug}`),
            unattended: true,
          });
          expect(run1.inputs).toEqual({ area: "Billing" });
          expect(h.schedules.updatedBindings.at(-1)?.binding.rotate?.next).toBe(1);
          yield* runner.stepStart({ runId: run1.id, stepId: "audit", callerThreadId: driver });
          yield* runner.stepDone({
            runId: run1.id,
            stepId: "audit",
            callerThreadId: driver,
            summary: "Fixed 2 billing edge cases",
            outputs: { report: "billing.md" },
            failed: false,
          });

          // Second scheduled run: carries over run1's result into lastRunResult and prompt
          const run2 = yield* runner.start({
            projectId,
            slug,
            driverThreadId: driver,
            scheduleTaskId: ScheduledTaskId.make(`scheduled-${slug}`),
            unattended: true,
          });
          expect(run2.lastRunResult).toMatchObject({
            runId: run1.id,
            summary: "Fixed 2 billing edge cases",
            outputs: { report: "billing.md" },
          });
          expect(run2.inputs).toEqual({ area: "Onboarding" });
          const audit2Prompt = run2.ready.find((s) => s.stepId === "audit")?.prompt;
          expect(audit2Prompt).toContain("Last run (");
          expect(audit2Prompt).toContain("Prior: Fixed 2 billing edge cases");
        }),
    ),
);

it.effect(
  "interrupts running subagents and rejects stale completions when a loop resets in-flight steps",
  () =>
    notifyScenario({}, (h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("draft");
        yield* h.writeSkill("review");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: {
            version: 3,
            name: "Parallel loop reset",
            loops: [
              {
                id: "review-to-draft",
                from: "review",
                to: "draft",
                maxRounds: 2,
                until: { kind: "step-says-pass" },
              },
            ],
            steps: [
              { id: "draft", skill: "draft", readsFrom: [] },
              { id: "review", skill: "review", readsFrom: [] },
            ],
          },
          callerThreadId: driver,
        });

        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });
        const round1Token = run.steps.find((s) => s.stepId === "draft")?.executionToken;
        expect(round1Token).toBeDefined();
        yield* runner.stepStart({
          runId: run.id,
          stepId: "draft",
          threadId: child,
          callerThreadId: driver,
        });
        yield* runner.stepStart({
          runId: run.id,
          stepId: "review",
          callerThreadId: driver,
        });

        // Review triggers a loop reset while draft is still running on `child`
        const reset = yield* runner.stepDone({
          runId: run.id,
          stepId: "review",
          callerThreadId: driver,
          summary: "Restart draft.\nVERDICT: revise: start over",
          outputs: {},
          failed: false,
        });
        const round2Token = reset.steps.find((s) => s.stepId === "draft")?.executionToken;
        expect(round2Token).toBeDefined();
        expect(round2Token).not.toBe(round1Token);
        expect(h.interrupts).toContain(child);
        expect(reset.steps.find((s) => s.stepId === "draft")).toMatchObject({
          status: "ready",
          round: 2,
          threadId: null,
        });

        // Stale completion before round 2 starts is rejected
        const staleBeforeStart = yield* runner
          .stepDone({
            runId: run.id,
            stepId: "draft",
            callerThreadId: driver,
            summary: "Stale round 1 driver result",
            outputs: {},
            failed: false,
          })
          .pipe(Effect.flip);
        expect(staleBeforeStart._tag).toBe("WorkflowStepStateError");

        // Stale subagent cannot reclaim or complete even after round 2 starts
        expect(
          yield* runner.claimStepThread({ runId: run.id, stepId: "draft", threadId: child }),
        ).toBe(false);
        yield* runner.stepStart({
          runId: run.id,
          stepId: "draft",
          callerThreadId: driver,
        });
        const staleSubagentAfterStart = yield* runner
          .stepDone({
            runId: run.id,
            stepId: "draft",
            callerThreadId: child,
            summary: "Stale round 1 subagent result",
            outputs: {},
            failed: false,
          })
          .pipe(Effect.flip);
        expect(staleSubagentAfterStart._tag).toBe("WorkflowStepCallerError");

        // Late driver completion from round 1 (missing token or stale token/round) is rejected after round 2 starts
        const lateDriverUntagged = yield* runner
          .stepDone({
            runId: run.id,
            stepId: "draft",
            callerThreadId: driver,
            summary: "Delayed round 1 driver result without token",
            outputs: {},
            failed: false,
          })
          .pipe(Effect.flip);
        expect(lateDriverUntagged._tag).toBe("WorkflowStepStateError");

        const lateDriverStaleToken = yield* runner
          .stepDone({
            runId: run.id,
            stepId: "draft",
            callerThreadId: driver,
            executionToken: round1Token!,
            summary: "Delayed round 1 driver result with round 1 token",
            outputs: {},
            failed: false,
          })
          .pipe(Effect.flip);
        expect(lateDriverStaleToken._tag).toBe("WorkflowStepStateError");

        const lateDriverStaleRound = yield* runner
          .stepDone({
            runId: run.id,
            stepId: "draft",
            callerThreadId: driver,
            round: 1,
            summary: "Delayed round 1 driver result with round 1",
            outputs: {},
            failed: false,
          })
          .pipe(Effect.flip);
        expect(lateDriverStaleRound._tag).toBe("WorkflowStepStateError");

        // Current-round driver completion with round 2 executionToken succeeds
        const round2Done = yield* runner.stepDone({
          runId: run.id,
          stepId: "draft",
          callerThreadId: driver,
          executionToken: round2Token!,
          summary: "Round 2 driver result",
          outputs: {},
          failed: false,
        });
        expect(round2Done.steps.find((s) => s.stepId === "draft")).toMatchObject({
          status: "done",
          round: 2,
          summary: "Round 2 driver result",
        });
      }),
    ),
);

it.effect.each(["serial", "parallel"] as const)(
  "resets enclosed inner loop round budgets (%s)",
  (branch) =>
    notifyScenario({}, (h) =>
      Effect.gen(function* () {
        yield* h.writeSkill("draft");
        yield* h.writeSkill("review");
        yield* h.writeSkill("qa");
        const runner = yield* WorkflowRunner.WorkflowRunner;
        yield* runner.save({
          projectId,
          slug,
          definition: {
            version: 3,
            name: "Nested loops",
            loops: [
              {
                id: "inner",
                from: "review",
                to: "draft",
                maxRounds: 2,
                until: { kind: "step-says-pass" },
              },
              {
                id: "outer",
                from: "qa",
                to: "draft",
                maxRounds: 2,
                until: { kind: "step-says-pass" },
              },
            ],
            steps: [
              { id: "draft", skill: "draft" },
              { id: "review", skill: "review" },
              { id: "qa", skill: "qa", ...(branch === "parallel" ? { readsFrom: ["draft"] } : {}) },
            ],
          },
          callerThreadId: driver,
        });

        const run = yield* runner.start({
          projectId,
          slug,
          driverThreadId: driver,
          callerThreadId: driver,
        });

        const finish = Effect.fnUntraced(function* (stepId: string, summary: string) {
          const running = yield* runner.stepStart({
            runId: run.id,
            stepId,
            callerThreadId: driver,
          });
          return yield* runner.stepDone({
            runId: run.id,
            stepId,
            callerThreadId: driver,
            executionToken: running.steps.find((step) => step.stepId === stepId)?.executionToken,
            summary,
            outputs: {},
            failed: false,
          });
        });

        // Outer round 1, inner round 1 -> inner revises to round 2
        yield* finish("draft", "Draft r1.1");
        yield* finish("review", "VERDICT: revise: inner fix 1");

        // Outer round 1, inner round 2 -> inner passes, then outer revises to outer round 2
        yield* finish("draft", "Draft r1.2");
        yield* finish("review", "VERDICT: pass");
        const afterOuterReset = yield* finish("qa", "VERDICT: revise: outer fix 1");
        expect(afterOuterReset.loopRounds).toEqual({ inner: 1, outer: 2 });
        expect(afterOuterReset.steps.find((s) => s.stepId === "review")?.round).toBe(1);
        const outerPrompt = afterOuterReset.ready.find((s) => s.stepId === "draft")?.prompt ?? "";
        expect(outerPrompt).toContain("## Feedback from qa, round 1");
        expect(outerPrompt).not.toContain("## Feedback from review");

        // Outer round 2, inner round 1 -> inner must still have its retry budget and loop to round 2
        yield* finish("draft", "Draft r2.1");
        const afterInnerRetryInOuter2 = yield* finish(
          "review",
          "VERDICT: revise: inner fix in outer round 2",
        );
        expect(afterInnerRetryInOuter2.loopRounds).toEqual({ inner: 2, outer: 2 });
        expect(afterInnerRetryInOuter2.steps.find((s) => s.stepId === "draft")?.status).toBe(
          "ready",
        );
        expect(afterInnerRetryInOuter2.steps.find((s) => s.stepId === "review")?.status).toBe(
          "queued",
        );
        expect(
          afterInnerRetryInOuter2.steps.find((s) => s.stepId === "review")?.loopExhausted,
        ).toBeUndefined();
        yield* finish("draft", "Draft final");
        yield* finish("review", "VERDICT: pass");
        const exhausted = yield* finish("qa", "VERDICT: revise: still not ready");
        expect(exhausted.loopRounds?.outer).toBe(2);
        expect(exhausted.exhaustedLoops).toContain("outer");
        expect(exhausted.status).toBe("done");
      }),
    ),
);

it.effect("evaluates loops ending at a child-workflow step when the child finishes", () =>
  notifyScenario({}, (h) =>
    Effect.gen(function* () {
      yield* h.writeSkill("draft");
      yield* h.writeSkill("verify");
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner.save({
        projectId,
        slug: "child-qa",
        definition: {
          version: 3,
          name: "Child QA",
          steps: [{ id: "verify", skill: "verify" }],
        },
        callerThreadId: driver,
      });
      yield* runner.save({
        projectId,
        slug,
        definition: {
          version: 3,
          name: "Parent with child loop",
          loops: [
            {
              id: "qa-to-draft",
              from: "qa",
              to: "draft",
              maxRounds: 2,
              until: { kind: "step-says-pass" },
            },
          ],
          steps: [
            { id: "draft", skill: "draft" },
            { id: "qa", kind: "workflow", workflow: "child-qa" },
          ],
        },
        callerThreadId: driver,
      });

      const parentRun = yield* runner.start({
        projectId,
        slug,
        driverThreadId: driver,
        callerThreadId: driver,
      });
      yield* runner.stepStart({ runId: parentRun.id, stepId: "draft", callerThreadId: driver });
      yield* runner.stepDone({
        runId: parentRun.id,
        stepId: "draft",
        callerThreadId: driver,
        summary: "Draft v1",
        outputs: {},
        failed: false,
      });
      const childRun1 = yield* runner.stepStart({
        runId: parentRun.id,
        stepId: "qa",
        callerThreadId: driver,
      });
      yield* runner.stepStart({ runId: childRun1.id, stepId: "verify", callerThreadId: driver });
      yield* runner.stepDone({
        runId: childRun1.id,
        stepId: "verify",
        callerThreadId: driver,
        summary: "VERDICT: revise: child found an issue",
        outputs: { report: "child-r1.md" },
        failed: false,
      });

      const parentAfterRound1 = yield* runner.status(parentRun.id, driver);
      expect(parentAfterRound1.status).toBe("running");
      expect(parentAfterRound1.steps.find((s) => s.stepId === "draft")).toMatchObject({
        status: "ready",
        round: 2,
      });
      expect(parentAfterRound1.ready.find((s) => s.stepId === "draft")?.prompt).toContain(
        "## Feedback from qa, round 1",
      );
      expect(parentAfterRound1.ready.find((s) => s.stepId === "draft")?.prompt).toContain(
        "VERDICT: revise: child found an issue",
      );
    }),
  ),
);

it.effect("sets and clears workflow tags without changing its steps", () =>
  notifyScenario({}, (h) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* h.writeSkill("build");
      const definition = workflow([{ id: "build", skill: "build" }]);
      yield* runner.save({ projectId, slug, definition });
      const tagged = yield* runner.tagsSet({ projectId, slug, tags: ["web", "design"] });
      expect(tagged.definition?.tags).toEqual(["web", "design"]);
      expect(tagged.definition?.steps).toEqual(definition.steps);
      const cleared = yield* runner.tagsSet({ projectId, slug, tags: [] });
      expect(cleared.definition?.tags).toEqual([]);
    }).pipe(Effect.provide(h.layer)),
  ).pipe(Effect.provide(nodeLayer)),
);
