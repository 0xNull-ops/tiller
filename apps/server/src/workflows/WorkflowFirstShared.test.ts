import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { MessageId, ProjectId, ProviderDriverKind, RunId, ThreadId } from "@t3tools/contracts";
import type {
  ProviderAdapterV2SessionRuntime,
  ProviderAdapterV2TurnInput,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts";
import * as WorkflowFirstSessionDecorator from "./WorkflowFirstSessionDecorator.ts";

const threadId = ThreadId.make("thread:workflow-first-shared");
const projectId = ProjectId.make("project:workflow-first-shared");

/** Stands in for ThreadLaunchService and WorkflowRunner, which capture the service while built. */
class LaunchCapture extends Context.Service<
  LaunchCapture,
  WorkflowFirst.WorkflowFirst["Service"]
>()("t3/workflows/WorkflowFirstShared.test/LaunchCapture") {}
class RunnerCapture extends Context.Service<
  RunnerCapture,
  WorkflowFirst.WorkflowFirst["Service"]
>()("t3/workflows/WorkflowFirstShared.test/RunnerCapture") {}

const turnInput = (text: string): ProviderAdapterV2TurnInput =>
  ({
    threadId,
    runId: RunId.make("run:workflow-first-shared"),
    message: {
      messageId: MessageId.make("message:workflow-first-shared"),
      text,
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    },
    appThread: {
      projectId,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: threadId,
      },
    },
  }) as unknown as ProviderAdapterV2TurnInput;

const sessionWith = (
  startTurn: ProviderAdapterV2SessionRuntime["startTurn"],
): ProviderAdapterV2SessionRuntime =>
  ({
    driver: ProviderDriverKind.make("codex"),
    startTurn,
    events: Stream.empty,
    readThreadSnapshot: () => Effect.die("unused"),
  }) as unknown as ProviderAdapterV2SessionRuntime;

const sessionsLayer = (startTurn: ProviderAdapterV2SessionRuntime["startTurn"]) =>
  Layer.succeed(
    ProviderSessionManager.ProviderSessionManagerV2,
    ProviderSessionManager.ProviderSessionManagerV2.of({
      open: () => Effect.succeed(sessionWith(startTurn)),
    } as never),
  );

/** Model the shared production layer so the test exercises one service and file lock. */
const makeGraph = (options: {
  readonly sessions: Layer.Layer<ProviderSessionManager.ProviderSessionManagerV2, never, never>;
  readonly decoratedFirst?: (service: WorkflowFirst.WorkflowFirst["Service"]) => void;
}) => {
  const launchSide = Layer.effect(
    LaunchCapture,
    Effect.map(WorkflowFirst.WorkflowFirst, (service) => service),
  ).pipe(Layer.provide(WorkflowFirst.layer));
  const runnerSide = Layer.effect(
    RunnerCapture,
    Effect.map(WorkflowFirst.WorkflowFirst, (service) => service),
  ).pipe(Layer.provide(WorkflowFirst.layer));
  const decoratorSide = WorkflowFirstSessionDecorator.forProviderTurnStart(
    options.sessions,
    Layer.effect(
      WorkflowFirst.WorkflowFirst,
      Effect.gen(function* () {
        const service = yield* WorkflowFirst.WorkflowFirst;
        options.decoratedFirst?.(service);
        return service;
      }),
    ),
  );
  // The RPC/launch reader resolves the service from the root context, like the server.
  return Layer.mergeAll(launchSide, runnerSide, decoratorSide).pipe(
    Layer.provideMerge(WorkflowFirst.layer),
  );
};

const provideHarness = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-workflow-first-shared-" })),
    Layer.provide(NodeServices.layer),
  );

it.effect(
  "builds one Workflow-first instance for launch, runner, decorator and the RPC read",
  () => {
    const seen = new Map<string, WorkflowFirst.WorkflowFirst["Service"]>();
    const graph = makeGraph({
      sessions: sessionsLayer(() => Effect.void),
      decoratedFirst: (service) => seen.set("decorator", service),
    });
    return Effect.gen(function* () {
      const launch = yield* LaunchCapture;
      const runner = yield* RunnerCapture;
      const root = yield* WorkflowFirst.WorkflowFirst;
      yield* root.set({ threadId, projectId, enabled: true });

      expect(launch).toBe(root);
      expect(runner).toBe(root);
      expect(seen.get("decorator")).toBe(root);
    }).pipe(Effect.scoped, Effect.provide(provideHarness(graph)));
  },
);

it.effect("lets an accepted OFF ack race an RPC toggle without losing the newer state", () => {
  const gate = Deferred.makeUnsafe<void>();
  const started = Deferred.makeUnsafe<void>();
  const graph = makeGraph({
    sessions: sessionsLayer(() =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(gate);
      }),
    ),
  });
  return Effect.gen(function* () {
    const runner = yield* RunnerCapture;
    const launch = yield* LaunchCapture;
    const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
    const session = (yield* manager.open({} as never)) as ProviderAdapterV2SessionRuntime;

    // The provider is about to accept an OFF turn whose transition is revision 1.
    const pending = yield* runner.set({ threadId, projectId, enabled: false });
    expect(pending.pendingTransition).toEqual({ enabled: false, revision: 1 });

    const turn = yield* session.startTurn(turnInput("continue")).pipe(Effect.forkChild);
    yield* Deferred.await(started);

    // The user's toggle lands while the provider has not yet acknowledged the OFF note.
    const toggled = yield* launch.set({ threadId, projectId, enabled: true });
    expect(toggled.enabled).toBe(true);
    expect(toggled.revision).toBe(2);
    expect(toggled.pendingTransition).toEqual({ enabled: true, revision: 2 });

    yield* Deferred.succeed(gate, undefined);
    expect(Exit.isSuccess(yield* Fiber.join(turn).pipe(Effect.exit))).toBe(true);

    // The stale revision-1 acknowledgement cannot clear revision 2 or flip enabled.
    const final = yield* launch.read({ threadId, projectId });
    expect(final.enabled).toBe(true);
    expect(final.revision).toBe(2);
    expect(final.pendingTransition).toEqual({ enabled: true, revision: 2 });
  }).pipe(Effect.scoped, Effect.provide(provideHarness(graph)));
});
