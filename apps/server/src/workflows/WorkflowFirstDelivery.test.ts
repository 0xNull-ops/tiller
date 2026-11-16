import { expect, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderDriverKind,
  RunId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import type {
  ProviderAdapterV2Event,
  ProviderAdapterV2SessionRuntime,
  ProviderAdapterV2ThreadSnapshot,
  ProviderAdapterV2TurnInput,
} from "@t3tools/provider-core/server/ProviderAdapter";
import {
  t3AcpPromptWithInstructions,
  t3OrchestrationPrompt,
} from "@t3tools/provider-core/server/orchestrationInstructions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts";
import * as WorkflowFirstDelivery from "./WorkflowFirstDelivery.ts";
import * as WorkflowPreferences from "./WorkflowPreferences.ts";
import * as WorkflowFirstSessionDecorator from "./WorkflowFirstSessionDecorator.ts";
import { workflowFirstPolicy, workflowFirstTransition } from "./workflowFirstInstructions.ts";

const threadId = ThreadId.make("thread:workflow-first-delivery");
const projectId = ProjectId.make("project:workflow-first-delivery");
const runId = RunId.make("run:workflow-first-delivery");
const messageId = MessageId.make("message:workflow-first-delivery");

const makeFirst = (input: {
  readonly entry?: WorkflowFirst.WorkflowFirstEntry;
  readonly acknowledged?: Array<number>;
  readonly acknowledgeFails?: boolean;
}): WorkflowFirst.WorkflowFirst["Service"] =>
  WorkflowFirst.WorkflowFirst.of({
    read: () =>
      Effect.succeed(
        input.entry ?? { projectId, enabled: false, revision: 0, pendingTransition: null },
      ),
    initialize: () => Effect.void,
    set: () => Effect.die("unused"),
    acknowledge: ({ revision }) => {
      if (input.acknowledgeFails === true) return Effect.die("acknowledge storage failed");
      input.acknowledged?.push(revision);
      return Effect.void;
    },
    snapshot: () => Effect.succeed({ initial: false, transition: null, revision: 0 }),
  });

const makeTurnInput = (input: {
  readonly text: string;
  readonly createdBy?: OrchestrationV2ConversationMessage["createdBy"];
  readonly senderThreadId?: ThreadId;
  readonly relationshipToParent?: "fork" | "subagent" | null;
}): ProviderAdapterV2TurnInput =>
  ({
    threadId,
    runId,
    message: {
      messageId,
      text: input.text,
      attachments: [],
      createdBy: input.createdBy ?? "user",
      creationSource: "web",
      ...(input.senderThreadId === undefined ? {} : { senderThreadId: input.senderThreadId }),
    },
    appThread: {
      projectId,
      lineage: {
        parentThreadId: null,
        relationshipToParent: input.relationshipToParent ?? null,
        rootThreadId: threadId,
      },
    },
  }) as unknown as ProviderAdapterV2TurnInput;

const makeSession = (
  input: {
    readonly driver?: ProviderDriverKind;
    readonly startTurn?: ProviderAdapterV2SessionRuntime["startTurn"];
    readonly events?: Stream.Stream<ProviderAdapterV2Event, never>;
    readonly snapshot?: ProviderAdapterV2ThreadSnapshot;
    readonly subscribeEvents?: ProviderAdapterV2SessionRuntime["subscribeEvents"];
  } = {},
): ProviderAdapterV2SessionRuntime =>
  ({
    driver: input.driver ?? ProviderDriverKind.make("codex"),
    startTurn: input.startTurn ?? (() => Effect.void),
    events: input.events ?? Stream.empty,
    ...(input.subscribeEvents === undefined ? {} : { subscribeEvents: input.subscribeEvents }),
    readThreadSnapshot: () => Effect.succeed(input.snapshot ?? emptySnapshot()),
  }) as unknown as ProviderAdapterV2SessionRuntime;

const emptySnapshot = (): ProviderAdapterV2ThreadSnapshot =>
  ({ providerThread: {}, providerTurns: [], messages: [], runtimeRequests: [] }) as never;

it.effect("prepends the policy once and leaves a decorated retry unchanged", () => {
  const acknowledged: Array<number> = [];
  const first = makeFirst({
    entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
    acknowledged,
  });
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        Effect.sync(() => {
          prompts.push(input.message.text);
        }),
    }),
    first,
  });
  return Effect.gen(function* () {
    const input = makeTurnInput({ text: "refactor the parser" });
    yield* decorated.startTurn(input);

    expect(prompts[0]).toContain("<t3_code_workflow_first>");
    expect(prompts[0]!.endsWith("\n\nrefactor the parser")).toBe(true);
    expect(acknowledged).toEqual([]);
    // The stored projection message must never be rewritten.
    expect(input.message.text).toBe("refactor the parser");

    yield* decorated.startTurn(makeTurnInput({ text: prompts[0]! }));
    expect(prompts[1]).toBe(prompts[0]);
  });
});

it.effect("replaces an older app block instead of stacking a second one", () => {
  const first = makeFirst({
    entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
  });
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        Effect.sync(() => {
          prompts.push(input.message.text);
        }),
    }),
    first,
  });
  // The replay carries the payload T3 generated for an earlier revision.
  const stale = workflowFirstPolicy(ThreadId.make("thread:old-revision"));
  const input = makeTurnInput({ text: `${stale}\n\nrefactor the parser` });
  return Effect.gen(function* () {
    yield* decorated.startTurn(input);
    expect(prompts[0]).toBe(`${workflowFirstPolicy(threadId)}\n\nrefactor the parser`);
    expect(prompts[0]!.split("<t3_code_workflow_first_provenance").length - 1).toBe(1);
    expect(prompts[0]!.split("<t3_code_workflow_first>").length - 1).toBe(1);

    // A second decoration of the same input is byte-identical, not a second block.
    yield* decorated.startTurn(input);
    expect(prompts[1]).toBe(prompts[0]);
  });
});

it.effect("delivers the newest pending OFF note over a replayed ON block", () => {
  const acknowledged: Array<number> = [];
  const first = makeFirst({
    entry: {
      projectId,
      enabled: false,
      revision: 7,
      pendingTransition: { enabled: false, revision: 7 },
    },
    acknowledged,
  });
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        Effect.sync(() => {
          prompts.push(input.message.text);
        }),
    }),
    first,
  });
  const stale = workflowFirstPolicy(threadId);
  return Effect.gen(function* () {
    yield* decorated.startTurn(makeTurnInput({ text: `${stale}\n\ncontinue` }));
    expect(prompts[0]).toBe(`${workflowFirstTransition(false, threadId)}\n\ncontinue`);
    expect(prompts[0]!.split("<t3_code_workflow_first_provenance").length - 1).toBe(1);
    expect(prompts[0]).not.toContain("Workflow-first is ON for this thread.");
    expect(acknowledged).toEqual([7]);
  });
});

it.effect("keeps a user's quoted policy block and their own leading newlines", () => {
  const off = makeFirst({
    entry: { projectId, enabled: false, revision: 0, pendingTransition: null },
  });
  const on = makeFirst({
    entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
  });
  const prompts: Array<string> = [];
  const decorate = (first: WorkflowFirst.WorkflowFirst["Service"]) =>
    WorkflowFirstSessionDecorator.decorateSessionRuntime({
      session: makeSession({
        startTurn: (input) =>
          Effect.sync(() => {
            prompts.push(input.message.text);
          }),
      }),
      first,
    });
  const quote = "\n\nWhy does <t3_code_workflow_first> appear in my prompt?";
  return Effect.gen(function* () {
    // OFF: no app block to add, and the user's words are byte-identical.
    yield* decorate(off).startTurn(makeTurnInput({ text: quote }));
    expect(prompts[0]).toBe(quote);

    // ON: the policy is added above the quoted tags, which stay exactly as typed.
    yield* decorate(on).startTurn(makeTurnInput({ text: quote }));
    expect(prompts[1]).toBe(`${workflowFirstPolicy(threadId)}\n\n${quote}`);
    expect(prompts[1]!.endsWith(quote)).toBe(true);
  });
});

it.effect("keeps user-role text byte-identical when it quotes the tags", () => {
  const block = workflowFirstPolicy(threadId);
  const quoted = `why does ${block} show up?\n\nand what about <t3_code_workflow_first_transition enabled="false">?`;
  const message = {
    id: MessageId.make("message:quoted"),
    threadId,
    runId,
    nodeId: null,
    role: "user" as const,
    text: quoted,
    attachments: [],
    createdBy: "user" as const,
    creationSource: "provider" as const,
    streaming: false,
    createdAt: 0,
    updatedAt: 0,
  };
  const snapshot = {
    providerThread: {},
    providerTurns: [],
    messages: [message],
    runtimeRequests: [],
  } as unknown as ProviderAdapterV2ThreadSnapshot;
  const session = makeSession({
    events: Stream.make({
      type: "message.updated",
      driver: ProviderDriverKind.make("codex"),
      message,
    } as never),
    snapshot,
  });
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session,
    first: makeFirst({}),
  });
  return Effect.gen(function* () {
    const events = Array.from(yield* decorated.events.pipe(Stream.runCollect)) as Array<
      Extract<ProviderAdapterV2Event, { type: "message.updated" }>
    >;
    expect(events[0]!.message.text).toBe(quoted);
    const read = yield* decorated.readThreadSnapshot({} as never);
    expect(read.messages[0]!.text).toBe(quoted);
  });
});

it.effect("hides its own prefix but keeps the user's leading newlines", () => {
  const block = workflowFirstPolicy(threadId);
  const message = (text: string) => ({
    id: MessageId.make("message:leading"),
    threadId,
    runId,
    nodeId: null,
    role: "user" as const,
    text,
    attachments: [],
    createdBy: "user" as const,
    creationSource: "provider" as const,
    streaming: false,
    createdAt: 0,
    updatedAt: 0,
  });
  const snapshot = {
    providerThread: {},
    providerTurns: [],
    messages: [message(`${block}\n\n\n\nkeep my spacing`)],
    runtimeRequests: [],
  } as unknown as ProviderAdapterV2ThreadSnapshot;
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({ snapshot }),
    first: makeFirst({}),
  });
  return Effect.gen(function* () {
    const read = yield* decorated.readThreadSnapshot({} as never);
    expect(read.messages[0]!.text).toBe("\n\nkeep my spacing");
  });
});

it.effect("acknowledges a pending transition only after the provider accepts it", () => {
  const acknowledged: Array<number> = [];
  const first = makeFirst({
    entry: {
      projectId,
      enabled: true,
      revision: 4,
      pendingTransition: { enabled: true, revision: 4 },
    },
    acknowledged,
  });
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({ startTurn: () => Effect.fail("refused" as never) }),
    first,
  });
  const accepted = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession(),
    first,
  });
  return Effect.gen(function* () {
    const refused = yield* decorated
      .startTurn(makeTurnInput({ text: "build the release" }))
      .pipe(Effect.exit);
    expect(refused._tag).toBe("Failure");
    expect(acknowledged).toEqual([]);

    yield* accepted.startTurn(makeTurnInput({ text: "build the release" }));
    expect(acknowledged).toEqual([4]);
  });
});

it.effect("keeps a failed OFF note pending and clears it on the next accepted turn", () => {
  const acknowledged: Array<number> = [];
  const first = makeFirst({
    entry: {
      projectId,
      enabled: false,
      revision: 2,
      pendingTransition: { enabled: false, revision: 2 },
    },
    acknowledged,
  });
  let failing = true;
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        failing
          ? Effect.fail("refused" as never)
          : Effect.sync(() => {
              prompts.push(input.message.text);
            }),
    }),
    first,
  });
  return Effect.gen(function* () {
    yield* decorated.startTurn(makeTurnInput({ text: "continue" })).pipe(Effect.exit);
    expect(acknowledged).toEqual([]);

    failing = false;
    yield* decorated.startTurn(makeTurnInput({ text: "continue" }));
    expect(prompts[0]!.startsWith(workflowFirstTransition(false, threadId))).toBe(true);
    expect(acknowledged).toEqual([2]);
  });
});

it.effect("does not fail an accepted turn when ack storage fails", () => {
  const first = makeFirst({
    entry: {
      projectId,
      enabled: false,
      revision: 1,
      pendingTransition: { enabled: false, revision: 1 },
    },
    acknowledgeFails: true,
  });
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession(),
    first,
  });
  return Effect.gen(function* () {
    const result = yield* decorated
      .startTurn(makeTurnInput({ text: "continue" }))
      .pipe(Effect.exit);
    expect(result._tag).toBe("Success");
  });
});

it.effect("leaves non-ordinary turns untouched", () => {
  const first = makeFirst({
    entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
  });
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        Effect.sync(() => {
          prompts.push(input.message.text);
        }),
    }),
    first,
  });
  return Effect.gen(function* () {
    const cases = [
      makeTurnInput({ text: "/compact" }),
      makeTurnInput({ text: "  /workflows" }),
      makeTurnInput({ text: "delegated", createdBy: "agent" }),
      makeTurnInput({ text: "from a thread", senderThreadId: ThreadId.make("thread:parent") }),
      makeTurnInput({ text: "child work", relationshipToParent: "subagent" }),
    ];
    yield* Effect.forEach(cases, (input) => decorated.startTurn(input));
    expect(prompts).toEqual(cases.map((input) => input.message.text));
  });
});

it.effect("sees the final handoff prompt and keeps the wrapper", () => {
  const first = makeFirst({
    entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
  });
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        Effect.sync(() => {
          prompts.push(input.message.text);
        }),
    }),
    first,
  });
  const handoff = "Previous context\n\nUser message:\nadd a retry";
  return Effect.gen(function* () {
    yield* decorated.startTurn(makeTurnInput({ text: handoff }));
    expect(prompts[0]).toBe(`${workflowFirstPolicy(threadId)}\n\n${handoff}`);

    yield* decorated.startTurn(
      makeTurnInput({ text: "Previous context\n\nUser message:\n/compact" }),
    );
    expect(prompts[1]).toBe("Previous context\n\nUser message:\n/compact");
  });
});

it.effect("resolves its services when the layer is built, not when a turn starts", () => {
  const prompts: Array<string> = [];
  const session = makeSession({
    startTurn: (input) =>
      Effect.sync(() => {
        prompts.push(input.message.text);
      }),
  });
  const raw = ProviderSessionManager.ProviderSessionManagerV2.of({
    open: () => Effect.succeed(session),
  } as never);
  const decoratedLayer = WorkflowFirstSessionDecorator.forProviderTurnStart(
    Layer.succeed(ProviderSessionManager.ProviderSessionManagerV2, raw),
    Layer.succeed(
      WorkflowFirst.WorkflowFirst,
      makeFirst({
        entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
      }),
    ),
  );
  const program = Effect.gen(function* () {
    const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
    const opened = yield* manager.open({} as never);
    yield* (opened as ProviderAdapterV2SessionRuntime).startTurn(
      makeTurnInput({ text: "ship it" }),
    );
  });
  return Effect.gen(function* () {
    yield* Effect.scoped(program).pipe(Effect.provide(decoratedLayer));
    expect(prompts[0]).toContain("<t3_code_workflow_first>");
  });
});

const echoAttachment = {
  id: "attachment-1",
  type: "image" as const,
  mimeType: "image/png",
  name: "diagram.png",
  sizeBytes: 12,
};

const userEcho = (input: {
  readonly id: string;
  readonly text: string;
  readonly attachments?: ReadonlyArray<typeof echoAttachment>;
}) => ({
  id: MessageId.make(input.id),
  threadId,
  runId,
  nodeId: null,
  role: "user" as const,
  text: input.text,
  attachments: input.attachments ?? [],
  createdBy: "user" as const,
  creationSource: "provider" as const,
  streaming: false,
  createdAt: 0,
  updatedAt: 0,
});

const echoSession = (input: {
  readonly driver: ProviderDriverKind;
  readonly message: ReturnType<typeof userEcho>;
  readonly assistantText?: string;
}) => {
  const messageEvent = {
    type: "message.updated",
    driver: input.driver,
    message: input.message,
  } as unknown as ProviderAdapterV2Event;
  return makeSession({
    driver: input.driver,
    events: Stream.make(messageEvent),
    subscribeEvents: Effect.succeed({ events: Stream.make(messageEvent), close: Effect.void }),
    snapshot: {
      providerThread: {},
      providerTurns: [],
      messages: [
        input.message,
        ...(input.assistantText === undefined
          ? []
          : [
              {
                ...input.message,
                id: MessageId.make(`${input.message.id}:assistant`),
                role: "assistant" as const,
                text: input.assistantText,
              },
            ]),
      ],
      runtimeRequests: [],
    } as unknown as ProviderAdapterV2ThreadSnapshot,
  });
};

it.effect("hides only the generated block from a plain provider echo", () => {
  const driver = ProviderDriverKind.make("opencode");
  const block = workflowFirstPolicy(threadId);
  const original = "rewrite the billing adapter";
  const message = userEcho({
    id: "message:plain-echo",
    text: `${block}\n\n${original}`,
    attachments: [echoAttachment],
  });
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: echoSession({ driver, message, assistantText: `${block} mentioned by the agent` }),
    first: makeFirst({
      entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
    }),
  });
  return Effect.gen(function* () {
    const fromStream = Array.from(yield* decorated.events.pipe(Stream.runCollect));
    const streamed = fromStream[0] as Extract<ProviderAdapterV2Event, { type: "message.updated" }>;
    expect(streamed.message.text).toBe(original);
    expect(streamed.message.attachments).toEqual([echoAttachment]);

    const subscription = yield* decorated.subscribeEvents!;
    const subscribed = Array.from(yield* subscription.events.pipe(Stream.runCollect))[0] as Extract<
      ProviderAdapterV2Event,
      { type: "message.updated" }
    >;
    expect(subscribed.message.text).toBe(original);

    const read = yield* decorated.readThreadSnapshot({} as never);
    expect(read.messages[0]!.text).toBe(original);
    expect(read.messages[0]!.attachments).toEqual([echoAttachment]);
    // Non-user text is left exactly as the provider reported it.
    expect(read.messages[1]!.text).toBe(`${block} mentioned by the agent`);
  });
});

it.effect("strips its block inside the ACP first-run wrapper and keeps the wrapper", () => {
  const driver = ProviderDriverKind.make("grok");
  const original = "  rewrite the billing adapter\n\nkeep my paragraphs";
  // The adapter appends attachment paths to the prompt before wrapping it.
  const attachmentText = "\n\n[Attachment saved at /tmp/diagram.png]";
  const decoratedPrompt = `${workflowFirstPolicy(threadId)}\n\n${original}${attachmentText}`;
  const state = {
    interactionMode: "default" as const,
    hasT3Mcp: true,
    hasDeviceTools: false,
  };
  const message = userEcho({
    id: "message:acp-native-echo",
    text: t3AcpPromptWithInstructions({ prompt: decoratedPrompt, state }),
    attachments: [echoAttachment],
  });
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: echoSession({ driver, message }),
    first: makeFirst({
      entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
    }),
  });
  // The ACP adapter sends the decorated text as the user request inside its own
  // instruction wrapper. Only our block goes; the wrapper is upstream text.
  const expected = t3AcpPromptWithInstructions({
    prompt: `${original}${attachmentText}`,
    state,
  });
  return Effect.gen(function* () {
    const fromStream = Array.from(yield* decorated.events.pipe(Stream.runCollect));
    const streamed = fromStream[0] as Extract<ProviderAdapterV2Event, { type: "message.updated" }>;
    expect(streamed.message.text).toBe(expected);
    expect(streamed.message.text).not.toContain("<t3_code_workflow_first_provenance");
    expect(streamed.message.text).toContain(attachmentText);
    expect(streamed.message.attachments).toEqual([echoAttachment]);

    const read = yield* decorated.readThreadSnapshot({} as never);
    expect(read.messages[0]!.text).toBe(expected);
  });
});

it.effect("strips its block inside the Cursor first-run wrapper and keeps the suffix", () => {
  const driver = ProviderDriverKind.make("cursor");
  const original = "rewrite the billing adapter";
  const runtimeSuffix = "\n\n## Runtime\nkeep this provider suffix";
  const decoratedPrompt = `${workflowFirstPolicy(threadId)}\n\n${original}`;
  const message = userEcho({
    id: "message:cursor-native-echo",
    text: `${t3OrchestrationPrompt({
      prompt: decoratedPrompt,
      hasT3Mcp: true,
      hasDeviceTools: false,
      orchestrationDelivered: false,
      deviceInstructionsDelivered: false,
    })}${runtimeSuffix}`,
  });
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: echoSession({ driver, message }),
    first: makeFirst({
      entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
    }),
  });
  const expected = `${t3OrchestrationPrompt({
    prompt: original,
    hasT3Mcp: true,
    hasDeviceTools: false,
    orchestrationDelivered: false,
    deviceInstructionsDelivered: false,
  })}${runtimeSuffix}`;
  return Effect.gen(function* () {
    const fromStream = Array.from(yield* decorated.events.pipe(Stream.runCollect));
    const streamed = fromStream[0] as Extract<ProviderAdapterV2Event, { type: "message.updated" }>;
    expect(streamed.message.text).toBe(expected);
    expect(streamed.message.text).not.toContain("<t3_code_workflow_first_provenance");

    const read = yield* decorated.readThreadSnapshot({} as never);
    expect(read.messages[0]!.text).toBe(expected);
  });
});

it.effect("does not treat a quoted wrapper or tags as an app envelope", () => {
  const driver = ProviderDriverKind.make("grok");
  const quote = "why does <t3_code_workflow_first> show up in this wrapper?";
  const state = {
    interactionMode: "default" as const,
    hasT3Mcp: true,
    hasDeviceTools: false,
  };
  const wrapped = t3AcpPromptWithInstructions({
    prompt: `${quote}\n\n<user_request>\nnot our block\n</user_request>`,
    state,
  });
  const message = userEcho({ id: "message:acp-quote", text: wrapped });
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: echoSession({ driver, message }),
    first: makeFirst({
      entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
    }),
  });
  return Effect.gen(function* () {
    const fromStream = Array.from(yield* decorated.events.pipe(Stream.runCollect));
    const streamed = fromStream[0] as Extract<ProviderAdapterV2Event, { type: "message.updated" }>;
    expect(streamed.message.text).toBe(wrapped);
    const read = yield* decorated.readThreadSnapshot({} as never);
    expect(read.messages[0]!.text).toBe(wrapped);
  });
});

const handoffWith = (tail: string) => `Previous context\n\nUser message:\n${tail}`;

it.effect("handles a handoff delimiter at the start of the prompt", () =>
  Effect.gen(function* () {
    const original = "\n\nUser message:\ncontinue the handoff";
    const delivered = yield* WorkflowFirstDelivery.decideTurnDelivery({
      first: makeFirst({
        entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
      }),
      threadId,
      projectId,
      text: `\n\nUser message:\n${workflowFirstPolicy(threadId)}\n\ncontinue the handoff`,
      createdBy: "user",
      senderThreadId: undefined,
      relationshipToParent: null,
    });
    expect(delivered.text).toBe(`${workflowFirstPolicy(threadId)}\n\n${original}`);
  }),
);

it.effect("replaces a stale block in a handoff tail and keeps the handoff and user text", () => {
  const first = makeFirst({
    entry: { projectId, enabled: true, revision: 0, pendingTransition: null },
  });
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        Effect.sync(() => {
          prompts.push(input.message.text);
        }),
    }),
    first,
  });
  const input = makeTurnInput({
    text: handoffWith(`${workflowFirstPolicy(ThreadId.make("thread:stale"))}\n\nadd a retry`),
  });
  const expected = `${workflowFirstPolicy(threadId)}\n\nPrevious context\n\nUser message:\nadd a retry`;
  return Effect.gen(function* () {
    yield* decorated.startTurn(input);
    expect(prompts[0]).toBe(expected);
    expect(prompts[0]!.split("<t3_code_workflow_first_provenance").length - 1).toBe(1);
    expect(prompts[0]).not.toContain("thread:stale");
    // The stored message is never rewritten.
    expect(input.message.text).toBe(
      handoffWith(`${workflowFirstPolicy(ThreadId.make("thread:stale"))}\n\nadd a retry`),
    );

    // The same input twice, and the decorated output replayed through the same
    // handoff shape, are both byte-identical.
    yield* decorated.startTurn(input);
    expect(prompts[1]).toBe(expected);
    yield* decorated.startTurn(makeTurnInput({ text: prompts[0]! }));
    expect(prompts[2]).toBe(expected);
  });
});

it.effect("delivers the newest pending OFF note over a replayed block in a handoff tail", () => {
  const acknowledged: Array<number> = [];
  const first = makeFirst({
    entry: {
      projectId,
      enabled: false,
      revision: 7,
      pendingTransition: { enabled: false, revision: 7 },
    },
    acknowledged,
  });
  const prompts: Array<string> = [];
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        Effect.sync(() => {
          prompts.push(input.message.text);
        }),
    }),
    first,
  });
  const stale = workflowFirstPolicy(threadId);
  return Effect.gen(function* () {
    yield* decorated.startTurn(
      makeTurnInput({ text: handoffWith(`${stale}\n\ncontinue the handoff`) }),
    );
    expect(prompts[0]).toBe(
      `${workflowFirstTransition(false, threadId)}\n\nPrevious context\n\nUser message:\ncontinue the handoff`,
    );
    expect(prompts[0]!.split("<t3_code_workflow_first_provenance").length - 1).toBe(1);
    expect(prompts[0]).not.toContain("Workflow-first is ON for this thread.");
    expect(acknowledged).toEqual([7]);
  });
});

it.effect("keeps a failed handoff OFF pending and never resurrects the replayed ON block", () => {
  const entry: WorkflowFirst.WorkflowFirstEntry = {
    projectId,
    enabled: true,
    revision: 3,
    pendingTransition: { enabled: false, revision: 3 },
  };
  const acknowledged: Array<number> = [];
  const state: { current: WorkflowFirst.WorkflowFirstEntry } = { current: entry };
  const first = WorkflowFirst.WorkflowFirst.of({
    read: () => Effect.succeed(state.current),
    initialize: () => Effect.void,
    set: () => Effect.die("unused"),
    acknowledge: ({ revision }) => {
      acknowledged.push(revision);
      state.current = { ...state.current, enabled: false, pendingTransition: null, revision: 4 };
      return Effect.void;
    },
    snapshot: () => Effect.succeed({ initial: false, transition: null, revision: 0 }),
  });
  const prompts: Array<string> = [];
  let failing = true;
  const decorated = WorkflowFirstSessionDecorator.decorateSessionRuntime({
    session: makeSession({
      startTurn: (input) =>
        failing
          ? Effect.fail("refused" as never)
          : Effect.sync(() => {
              prompts.push(input.message.text);
            }),
    }),
    first,
  });
  const replay = handoffWith(`${workflowFirstPolicy(threadId)}\n\ncontinue the handoff`);
  return Effect.gen(function* () {
    yield* decorated.startTurn(makeTurnInput({ text: replay })).pipe(Effect.exit);
    expect(acknowledged).toEqual([]);
    expect(state.current.pendingTransition).toEqual({ enabled: false, revision: 3 });

    failing = false;
    yield* decorated.startTurn(makeTurnInput({ text: replay }));
    expect(prompts[0]).toBe(
      `${workflowFirstTransition(false, threadId)}\n\nPrevious context\n\nUser message:\ncontinue the handoff`,
    );
    expect(acknowledged).toEqual([3]);

    // After the OFF turn is accepted, replaying the same stale ON payload must
    // not bring the block back.
    yield* decorated.startTurn(makeTurnInput({ text: replay }));
    expect(prompts[1]).toBe("Previous context\n\nUser message:\ncontinue the handoff");
    expect(prompts[1]).not.toContain("t3_code_workflow_first");
    expect(acknowledged).toEqual([3]);
  });
});

it.effect("keeps an app-shaped quote outside the known boundaries", () => {
  const quote = workflowFirstPolicy(ThreadId.make("thread:quoted-in-context"));
  const text = `Compare these notes:\n${quote}\n\nUser message:\nwhat does it mean?`;
  const prompts: Array<string> = [];
  const decorate = (first: WorkflowFirst.WorkflowFirst["Service"]) =>
    WorkflowFirstSessionDecorator.decorateSessionRuntime({
      session: makeSession({
        startTurn: (input) =>
          Effect.sync(() => {
            prompts.push(input.message.text);
          }),
      }),
      first,
    });
  return Effect.gen(function* () {
    yield* decorate(
      makeFirst({ entry: { projectId, enabled: false, revision: 0, pendingTransition: null } }),
    ).startTurn(makeTurnInput({ text }));
    expect(prompts[0]).toBe(text);

    yield* decorate(
      makeFirst({ entry: { projectId, enabled: true, revision: 0, pendingTransition: null } }),
    ).startTurn(makeTurnInput({ text }));
    expect(prompts[1]).toBe(`${workflowFirstPolicy(threadId)}\n\n${text}`);
  });
});

it.effect("captures optional services where they exist and degrades without them", () => {
  const first = makeFirst({});
  const preferences = WorkflowPreferences.WorkflowPreferences.of({
    read: Effect.succeed({ workflowFirstForNewThreads: true } as never),
  } as never);
  return Effect.gen(function* () {
    const captured = yield* WorkflowFirstDelivery.captureServices().pipe(
      Effect.provideService(WorkflowFirst.WorkflowFirst, first),
      Effect.provideService(WorkflowPreferences.WorkflowPreferences, preferences),
    );
    expect(Option.isSome(captured.workflowFirst)).toBe(true);
    expect(Option.isSome(captured.preferences)).toBe(true);

    const missing = yield* WorkflowFirstDelivery.captureServices();
    expect(Option.isNone(missing.workflowFirst)).toBe(true);
    expect(Option.isNone(missing.preferences)).toBe(true);
  });
});

it.effect(
  "captures a new-thread default once, honours the override, and skips reused threads",
  () => {
    const entries = new Map<ThreadId, WorkflowFirst.WorkflowFirstEntry>();
    const initialized: Array<{ threadId: ThreadId; enabled: boolean }> = [];
    const first = WorkflowFirst.WorkflowFirst.of({
      read: ({ threadId, projectId }) =>
        Effect.succeed(
          entries.get(threadId) ?? {
            projectId,
            enabled: false,
            revision: 0,
            pendingTransition: null,
          },
        ),
      initialize: ({ threadId, projectId, enabled }) =>
        Effect.sync(() => {
          if (entries.has(threadId)) return;
          entries.set(threadId, { projectId, enabled, revision: 0, pendingTransition: null });
          initialized.push({ threadId, enabled });
        }),
      set: () => Effect.die("unused"),
      acknowledge: () => Effect.void,
      snapshot: () => Effect.succeed({ initial: false, transition: null, revision: 0 }),
    });
    const preferences = WorkflowPreferences.WorkflowPreferences.of({
      read: Effect.succeed({ workflowFirstForNewThreads: true } as never),
    } as never);
    const capture = (input: {
      readonly threadId: ThreadId;
      readonly reuseExistingThread?: boolean;
      readonly workflowFirstEnabled?: boolean;
    }) =>
      WorkflowFirstDelivery.captureNewThreadDefault({
        workflowFirst: Option.some(first),
        preferences: Option.some(preferences),
        projectId,
        ...input,
      });
    return Effect.gen(function* () {
      const fresh = ThreadId.make("thread:fresh");
      yield* capture({ threadId: fresh });
      yield* capture({ threadId: fresh });
      const overridden = ThreadId.make("thread:overridden");
      yield* capture({ threadId: overridden, workflowFirstEnabled: false });
      const reused = ThreadId.make("thread:reused");
      yield* capture({ threadId: reused, reuseExistingThread: true, workflowFirstEnabled: true });

      expect(initialized).toEqual([
        { threadId: fresh, enabled: true },
        { threadId: overridden, enabled: false },
      ]);
      expect(entries.has(reused)).toBe(false);
    });
  },
);
