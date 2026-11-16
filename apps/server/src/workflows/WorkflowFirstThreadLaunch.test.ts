import { expect, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts";
import * as WorkflowPreferences from "./WorkflowPreferences.ts";

const projectId = ProjectId.make("project:workflow-first-launch");
const reused = ThreadId.make("thread:workflow-first-reused");
const runnerThread = ThreadId.make("thread:workflow-first-default");
const capturedThread = ThreadId.make("thread:workflow-first-typed");

/** Every observed step, so the test can prove capture happens before the create dispatch. */
type Step = "read-default" | "initialize" | `dispatch:${string}`;
const steps: Array<Step> = [];
const entries = new Map<ThreadId, WorkflowFirst.WorkflowFirstEntry>();
let defaultEnabled = true;

const workflowFirst = WorkflowFirst.WorkflowFirst.of({
  read: ({ threadId, projectId: requestedProject }) =>
    Effect.sync(() => {
      return (
        entries.get(threadId) ?? {
          projectId: requestedProject,
          enabled: false,
          revision: 0,
          pendingTransition: null,
        }
      );
    }),
  initialize: (input) =>
    Effect.sync(() => {
      steps.push("initialize");
      if (entries.has(input.threadId)) return;
      entries.set(input.threadId, {
        projectId: input.projectId,
        enabled: input.enabled,
        revision: 0,
        pendingTransition: null,
      });
    }),
  set: () => Effect.die("unused"),
  acknowledge: () => Effect.void,
  snapshot: () => Effect.succeed({ initial: false, transition: null, revision: 0 }),
});

const preferences = WorkflowPreferences.WorkflowPreferences.of({
  read: Effect.sync(() => {
    steps.push("read-default");
    return { workflowFirstForNewThreads: defaultEnabled } as never;
  }),
} as never);

const projection = (threadId: ThreadId): OrchestrationV2ThreadProjection =>
  ({
    thread: { id: threadId, projectId, worktreePath: null },
    runs: [],
    nodes: [],
    messages: [],
    subagents: [],
    participants: [],
  }) as never;

const dispatch = (command: { readonly type: string; readonly threadId: ThreadId }) =>
  Effect.sync(() => {
    steps.push(`dispatch:${command.type}`);
    return {
      storedEvents:
        command.type === "message.dispatch"
          ? [
              {
                event: {
                  type: "run.created",
                  payload: { id: RunId.make("run:workflow-first-launch") },
                },
              },
            ]
          : [],
    } as never;
  });

const makeLayer = () =>
  ThreadLaunch.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProjectService.ProjectService, {
          getById: () =>
            Effect.succeedSome({
              id: projectId,
              title: "Project",
              workspaceRoot: "/repo",
              repositoryIdentity: null,
              faviconPath: null,
              defaultModelSelection: null,
              defaultThreadEnvMode: null,
              scripts: [],
              createdAt: "2026-10-26T00:00:00.000Z",
              updatedAt: "2026-10-26T00:00:00.000Z",
              deletedAt: null,
            } as never),
        } as never),
        Layer.mock(WorktreeSetupTracker.WorktreeSetupTracker)({}),
        Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({
          get: () => Effect.succeed(null),
        }),
        Layer.mock(CheckpointStore.CheckpointStore)({
          isGitRepository: () => Effect.succeed(true),
        }),
        Layer.mock(TerminalManager.TerminalManager)({}),
        Layer.mock(GitWorkflow.GitWorkflowService)({
          currentBranch: () => Effect.succeed(null),
        }),
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
        Layer.mock(ProviderRegistry.ProviderRegistry)({}),
        Layer.mock(ServerSettings.ServerSettingsService)({}),
        Layer.mock(TextGeneration.TextGeneration)({}),
        Layer.succeed(CommandReceiptStore.CommandReceiptStoreV2, {
          getByCommandId: (commandId: CommandId) =>
            Effect.succeed(
              commandId === CommandId.make("command:reused")
                ? Effect.succeedSome({
                    status: "accepted",
                    commandType: "thread.create",
                    threadId: reused,
                  })
                : Effect.succeedNone,
            ),
        } as never),
        IdAllocator.layer,
        Layer.mock(EventSink.EventSinkV2)({}),
        Layer.succeed(ThreadManagement.ThreadManagementService, {
          assertProviderInstanceEnabled: () => Effect.void,
          dispatch,
          getThreadProjection: (threadId: ThreadId) => Effect.succeed(projection(threadId)),
          getThreadRecords: () => Effect.succeed({ runs: [] }),
        } as never),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
          folderForThread: () => Effect.succeedNone,
        }),
        Layer.succeed(WorkflowFirst.WorkflowFirst, workflowFirst),
        Layer.succeed(WorkflowPreferences.WorkflowPreferences, preferences),
      ),
    ),
  );

const launch = (input: {
  readonly command: string;
  readonly threadId: ThreadId;
  readonly message?: string;
  readonly reuseExistingThread?: boolean;
  readonly workflowFirstEnabled?: boolean;
}) => {
  const launches = Effect.flatMap(ThreadLaunch.ThreadLaunchService, (service) =>
    service.launch({
      commandId: CommandId.make(input.command),
      threadId: input.threadId,
      ...(input.reuseExistingThread === undefined
        ? {}
        : { reuseExistingThread: input.reuseExistingThread }),
      projectId,
      title: "New thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.1-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
      ...(input.workflowFirstEnabled === undefined
        ? {}
        : { workflowFirstEnabled: input.workflowFirstEnabled }),
      ...(input.message === undefined
        ? {}
        : {
            initialMessage: {
              messageId: MessageId.make(`${input.message}:id`),
              text: input.message,
              attachments: [],
            },
          }),
      createdBy: "user",
      creationSource: "web",
    }),
  );
  return Effect.scoped(launches.pipe(Effect.provide(makeLayer())));
};

it.effect("captures the launch-time Workflow-first choice before the initial turn", () => {
  steps.length = 0;
  entries.clear();
  defaultEnabled = true;
  return Effect.gen(function* () {
    // The composer's explicit draft choice wins over the environment default.
    yield* launch({
      command: "command:typed",
      threadId: capturedThread,
      message: "build it",
      workflowFirstEnabled: false,
    });
    expect(entries.get(capturedThread)?.enabled).toBe(false);
    expect(steps.indexOf("initialize")).toBeGreaterThan(steps.indexOf("read-default"));
    expect(steps.indexOf("initialize")).toBeLessThan(steps.indexOf("dispatch:thread.create"));
    expect(steps.indexOf("initialize")).toBeLessThan(steps.indexOf("dispatch:message.dispatch"));

    // No override means the default at creation time, captured once.
    yield* launch({
      command: "command:default",
      threadId: runnerThread,
      message: "ship it",
    });
    expect(entries.get(runnerThread)?.enabled).toBe(true);

    // A later default edit cannot reach a thread that already captured its value.
    defaultEnabled = false;
    expect(entries.get(runnerThread)?.enabled).toBe(true);
  });
});

it.effect("captures nothing again for a reused thread", () => {
  steps.length = 0;
  entries.clear();
  defaultEnabled = true;
  entries.set(reused, {
    projectId,
    enabled: false,
    revision: 3,
    pendingTransition: null,
  });
  return Effect.gen(function* () {
    yield* launch({
      command: "command:reused",
      threadId: reused,
      reuseExistingThread: true,
      workflowFirstEnabled: true,
    });
    expect(entries.get(reused)).toMatchObject({ enabled: false, revision: 3 });
    expect(steps).not.toContain("initialize");
  });
});
