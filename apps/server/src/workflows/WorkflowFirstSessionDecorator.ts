import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import type {
  ProviderAdapterV2Event,
  ProviderAdapterV2EventSubscription,
  ProviderAdapterV2SessionRuntime,
  ProviderAdapterV2ThreadSnapshot,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import { stripWorkflowFirstContext } from "./workflowFirstInstructions.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts";
import * as WorkflowFirstDelivery from "./WorkflowFirstDelivery.ts";

type UserMessageTurnItem = Extract<OrchestrationV2TurnItem, { readonly type: "user_message" }>;

const stripUserText = <A extends { readonly text: string }>(message: A): A => {
  const text = stripWorkflowFirstContext(message.text);
  return text === message.text ? message : { ...message, text };
};

const stripConversationMessage = (message: OrchestrationV2ConversationMessage) =>
  message.role === "user" ? stripUserText(message) : message;

const stripTurnItem = (item: UserMessageTurnItem) => stripUserText(item);

/**
 * The provider may replay the prompt it received (transcript replay, snapshot
 * import, a resumed native thread). Only the app-generated Workflow-first
 * blocks are removed; the user's own text and attachments are left alone.
 */
const stripEchoedUserText = (event: ProviderAdapterV2Event): ProviderAdapterV2Event => {
  switch (event.type) {
    case "message.updated":
      return event.message.role === "user"
        ? { ...event, message: stripConversationMessage(event.message) }
        : event;
    case "turn_item.updated":
      return event.turnItem.type === "user_message"
        ? { ...event, turnItem: stripTurnItem(event.turnItem) }
        : event;
    default:
      return event;
  }
};

const stripSnapshotUserText = (
  snapshot: ProviderAdapterV2ThreadSnapshot,
): ProviderAdapterV2ThreadSnapshot =>
  snapshot.messages.some((message) => message.role === "user")
    ? { ...snapshot, messages: snapshot.messages.map(stripConversationMessage) }
    : snapshot;

const stripEvents = <E>(events: Stream.Stream<ProviderAdapterV2Event, E>) =>
  events.pipe(Stream.map(stripEchoedUserText));

const stripSubscription = (
  subscription: ProviderAdapterV2EventSubscription,
): ProviderAdapterV2EventSubscription => ({
  events: stripEvents(subscription.events),
  close: subscription.close,
});

/**
 * Wraps a provider session runtime so every ordinary outbound user turn gets
 * the Workflow-first block. Applied around `ProviderSessionManagerV2.open`, so
 * it sits below `ProviderTurnStartService`'s handoff wrapper and sees the
 * final prompt text, and above the adapter, so no adapter owns the policy.
 */
export const decorateSessionRuntime = (input: {
  readonly session: ProviderAdapterV2SessionRuntime;
  readonly first: WorkflowFirst.WorkflowFirst["Service"];
}): ProviderAdapterV2SessionRuntime => {
  const { session, first } = input;
  const startTurn: ProviderAdapterV2SessionRuntime["startTurn"] = Effect.fn(
    "WorkflowFirstSessionDecorator.startTurn",
  )(function* (turnInput) {
    const decision = yield* WorkflowFirstDelivery.decideTurnDelivery({
      first,
      threadId: turnInput.threadId,
      projectId: turnInput.appThread.projectId,
      text: turnInput.message.text,
      createdBy: turnInput.message.createdBy,
      senderThreadId: turnInput.message.senderThreadId,
      relationshipToParent: turnInput.appThread.lineage?.relationshipToParent,
    });
    yield* session.startTurn({
      ...turnInput,
      message: { ...turnInput.message, text: decision.text },
    });
    if (decision.acknowledgeRevision !== undefined) {
      yield* WorkflowFirstDelivery.acknowledgeDelivery({
        first,
        threadId: turnInput.threadId,
        revision: decision.acknowledgeRevision,
        runId: turnInput.runId,
      });
    }
  });
  return {
    ...session,
    startTurn,
    events: stripEvents(session.events),
    ...(session.subscribeEvents === undefined
      ? {}
      : {
          subscribeEvents: session.subscribeEvents.pipe(
            Effect.map((subscription) => stripSubscription(subscription)),
          ),
        }),
    readThreadSnapshot: (snapshotInput) =>
      session.readThreadSnapshot(snapshotInput).pipe(Effect.map(stripSnapshotUserText)),
  };
};

/**
 * Same manager, with only `open` decorated. Every other lifecycle call is the
 * native one: close, release, detach, instance shutdown and lookups are
 * untouched.
 */
const decorateManager = (input: {
  readonly raw: ProviderSessionManager.ProviderSessionManagerV2Shape;
  readonly first: WorkflowFirst.WorkflowFirst["Service"];
}): ProviderSessionManager.ProviderSessionManagerV2Shape => ({
  ...input.raw,
  open: (openInput) =>
    input.raw
      .open(openInput)
      .pipe(Effect.map((session) => decorateSessionRuntime({ session, first: input.first }))),
});

/**
 * The services are resolved while the layer is built. Service methods run in
 * caller contexts that do not carry the layer's construction environment.
 */
const layer: Layer.Layer<
  ProviderSessionManager.ProviderSessionManagerV2,
  never,
  ProviderSessionManager.ProviderSessionManagerV2 | WorkflowFirst.WorkflowFirst
> = Layer.effect(
  ProviderSessionManager.ProviderSessionManagerV2,
  Effect.gen(function* () {
    const raw = yield* ProviderSessionManager.ProviderSessionManagerV2;
    const first = yield* WorkflowFirst.WorkflowFirst;
    return ProviderSessionManager.ProviderSessionManagerV2.of(decorateManager({ raw, first }));
  }),
);

/**
 * Assembles the decorated manager so the owning layer wires it in one call: the
 * production session manager plus the shared Workflow-first instance the caller
 * already provides to the other consumers.
 */
export const forProviderTurnStart = <E1, R1, E2, R2>(
  sessions: Layer.Layer<ProviderSessionManager.ProviderSessionManagerV2, E1, R1>,
  first: Layer.Layer<WorkflowFirst.WorkflowFirst, E2, R2>,
) => layer.pipe(Layer.provide(Layer.merge(sessions, first)));
