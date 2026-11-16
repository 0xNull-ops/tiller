import {
  CommandId,
  EnvironmentId,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  WS_METHODS,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadLaunchInput,
  type ProjectMutation,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import * as RpcSession from "../rpc/session.ts";
import { v2Projection, v2ThreadId } from "../state/orchestrationV2TestFixtures.ts";
import { startThreadTurn } from "../operations/commands.ts";

const layerTestCrypto = Layer.succeed(
  SecureRandom.SecureRandom,
  SecureRandom.make((size) => new Uint8Array(size)),
);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

/**
 * The draft composer's Workflow-first choice crosses the launch boundary only through the
 * typed field, before the server creates the thread. This keeps that forwarding honest
 * without editing the upstream command tests.
 */
const supervisorWith = (launches: Array<OrchestrationV2ThreadLaunchInput>) =>
  Effect.gen(function* () {
    const client = {
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (_command: OrchestrationV2Command) =>
        Effect.succeed({ sequence: 1 }),
      [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: () => Effect.succeed(v2Projection),
      [ORCHESTRATION_V2_WS_METHODS.launchThread]: (input: OrchestrationV2ThreadLaunchInput) =>
        Effect.sync(() => {
          launches.push(input);
          return {
            threadId: input.threadId ?? v2ThreadId,
            projection: v2Projection,
            resumed: false,
          };
        }),
      [WS_METHODS.projectsMutate]: (_mutation: ProjectMutation) => Effect.die("unused"),
    } as unknown as WsRpcProtocolClient;
    const session: RpcSession.RpcSession = {
      client,
      initialConfig: Effect.succeed({
        environment: {
          capabilities: { repositoryIdentity: true, serverResolvedCommandContext: true },
        },
      } as never),
      subscribeServerConfig: (input = {}) => client.subscribeServerConfig(input),
      ready: Effect.void,
      probe: Effect.void,
      inboundFrames: Effect.succeed(0),
      closed: Effect.never,
    };
    return EnvironmentSupervisor.EnvironmentSupervisor.of({
      target: TARGET,
      state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
      session: yield* SubscriptionRef.make(Option.some(session)),
      prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  });

const bootstrap = (workflowFirstEnabled?: boolean) => ({
  createThread: {
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: v2Projection.thread.modelSelection,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: "feature",
    worktreePath: "/workspace/project-worktrees/feature",
    createdAt: "2026-06-20T00:00:00.000Z",
    ...(workflowFirstEnabled === undefined ? {} : { workflowFirstEnabled }),
  },
});

it.effect.each([
  { name: "on", workflowFirstEnabled: true },
  { name: "off", workflowFirstEnabled: false },
  { name: "absent", workflowFirstEnabled: undefined },
])(
  "forwards the draft Workflow-first choice ($name) with the launch",
  ({ workflowFirstEnabled }) => {
    const launches: Array<OrchestrationV2ThreadLaunchInput> = [];
    return Effect.gen(function* () {
      const supervisor = yield* supervisorWith(launches);
      yield* startThreadTurn({
        commandId: CommandId.make("launch-workflow-first"),
        threadId: v2ThreadId,
        message: {
          messageId: MessageId.make("message-workflow-first"),
          role: "user",
          text: "Build the launch page",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        titleSeed: "Build the launch page",
        bootstrap: bootstrap(workflowFirstEnabled),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(launches).toHaveLength(1);
      expect(launches[0]?.workflowFirstEnabled).toBe(workflowFirstEnabled);
      expect(launches[0]?.workspaceStrategy).toEqual({
        type: "existing_worktree",
        worktreePath: "/workspace/project-worktrees/feature",
        branch: "feature",
      });
    }).pipe(Effect.provide(layerTestCrypto));
  },
);
