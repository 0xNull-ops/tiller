import type {
  OrchestrationV2ConversationMessage,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as WorkflowFirst from "./WorkflowFirst.ts";
import * as WorkflowPreferences from "./WorkflowPreferences.ts";
import {
  takeLeadingWorkflowFirstContext,
  withWorkflowFirstContext,
  workflowFirstPolicy,
  workflowFirstTransition,
} from "./workflowFirstInstructions.ts";

/**
 * Captured while the layer is built. Service methods run later in caller
 * contexts that do not carry the layer's construction environment.
 */
export const captureServices = Effect.fn("WorkflowFirstDelivery.captureServices")(function* () {
  const context = yield* Effect.context();
  return {
    workflowFirst: Context.getOption(context, WorkflowFirst.WorkflowFirst),
    preferences: Context.getOption(context, WorkflowPreferences.WorkflowPreferences),
  };
});

/**
 * Thread creation captures the environment default once. A reused thread keeps
 * whatever it captured, and an explicit launch choice wins over the default.
 */
export interface WorkflowFirstLaunchInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly reuseExistingThread?: boolean | undefined;
  readonly workflowFirstEnabled?: boolean | undefined;
}

export const captureNewThreadDefault = Effect.fn("WorkflowFirstDelivery.captureNewThreadDefault")(
  function* (
    input: {
      readonly workflowFirst: Option.Option<WorkflowFirst.WorkflowFirst["Service"]>;
      readonly preferences: Option.Option<WorkflowPreferences.WorkflowPreferences["Service"]>;
    } & WorkflowFirstLaunchInput,
  ) {
    if (input.reuseExistingThread === true) return;
    if (Option.isNone(input.workflowFirst) || Option.isNone(input.preferences)) return;
    const captured = yield* input.workflowFirst.value.read({
      threadId: input.threadId,
      projectId: input.projectId,
    });
    if (captured.revision !== 0) return;
    const enabled =
      input.workflowFirstEnabled ??
      (yield* input.preferences.value.read).workflowFirstForNewThreads;
    yield* input.workflowFirst.value.initialize({
      threadId: input.threadId,
      projectId: input.projectId,
      enabled,
    });
  },
);

/**
 * The launch seam's whole call: resolve the optional services once here, while
 * the layer is built, and hand the caller a closure so thread launch keeps one
 * marked call and no policy detail of its own.
 */
export const captureForLaunch = Effect.fn("WorkflowFirstDelivery.captureForLaunch")(function* () {
  const captured = yield* captureServices();
  return (input: WorkflowFirstLaunchInput) => captureNewThreadDefault({ ...captured, ...input });
});

/**
 * `ProviderTurnStartService.startWithHandoffs` rewrites the outbound text as
 * `${handoffContext}\n\nUser message:\n${userText}`, so a slash command has to
 * be detected on the tail rather than the whole prompt.
 */
const HANDOFF_USER_MESSAGE_DELIMITER = "\n\nUser message:\n";

const userAuthoredText = (text: string): string => {
  const index = text.lastIndexOf(HANDOFF_USER_MESSAGE_DELIMITER);
  return index === -1 ? text : text.slice(index + HANDOFF_USER_MESSAGE_DELIMITER.length);
};

/** Find app-owned prompt context at supported prompt and handoff boundaries. */
const takeDeliveredWorkflowFirstContext = (text: string): { readonly rest: string } | null => {
  let rest = takeLeadingWorkflowFirstContext(text)?.rest ?? text;
  let taken = rest !== text;
  let searchFrom = rest.length;
  let index = rest.lastIndexOf(HANDOFF_USER_MESSAGE_DELIMITER, searchFrom);
  while (index !== -1) {
    const bodyStart = index + HANDOFF_USER_MESSAGE_DELIMITER.length;
    const tail = takeLeadingWorkflowFirstContext(rest.slice(bodyStart));
    if (tail !== null) {
      rest = rest.slice(0, bodyStart) + tail.rest;
      taken = true;
    }
    if (index === 0) break;
    searchFrom = index - 1;
    index = rest.lastIndexOf(HANDOFF_USER_MESSAGE_DELIMITER, searchFrom);
  }
  return taken ? { rest } : null;
};

const isOrdinaryUserTurn = (input: {
  readonly text: string;
  readonly createdBy: OrchestrationV2ConversationMessage["createdBy"];
  readonly senderThreadId: OrchestrationV2ConversationMessage["senderThreadId"];
  readonly relationshipToParent: "fork" | "subagent" | null | undefined;
}): boolean =>
  input.createdBy === "user" &&
  input.senderThreadId == null &&
  input.relationshipToParent !== "subagent" &&
  !userAuthoredText(input.text).trimStart().startsWith("/");

const transitionBlock = (state: WorkflowFirst.WorkflowFirstEntry, threadId: ThreadId) =>
  state.pendingTransition === null
    ? undefined
    : workflowFirstTransition(state.pendingTransition.enabled, threadId);

/** Replace recognized stale app context so retries carry one current policy block. */
export const decideTurnDelivery = Effect.fn("WorkflowFirstDelivery.decideTurnDelivery")(
  function* (input: {
    readonly first: WorkflowFirst.WorkflowFirst["Service"];
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly text: string;
    readonly createdBy: OrchestrationV2ConversationMessage["createdBy"];
    readonly senderThreadId: OrchestrationV2ConversationMessage["senderThreadId"];
    readonly relationshipToParent: "fork" | "subagent" | null | undefined;
  }): Effect.fn.Return<{
    readonly text: string;
    /** Present when the turn carried a pending transition that acceptance may clear. */
    readonly acknowledgeRevision?: number;
  }> {
    if (
      !isOrdinaryUserTurn({
        text: input.text,
        createdBy: input.createdBy,
        senderThreadId: input.senderThreadId,
        relationshipToParent: input.relationshipToParent,
      })
    ) {
      return { text: input.text };
    }
    const state = yield* input.first.read({ threadId: input.threadId, projectId: input.projectId });
    const block =
      transitionBlock(state, input.threadId) ??
      (state.enabled ? workflowFirstPolicy(input.threadId) : undefined);
    const revision = state.pendingTransition?.revision;
    const carried = takeDeliveredWorkflowFirstContext(input.text);
    // OFF with nothing pending: a carried block is stale, so removing it is how this turn
    // delivers the current state. The user's own text underneath is untouched.
    const base = carried?.rest ?? input.text;
    return {
      text: block === undefined ? base : withWorkflowFirstContext(block, base),
      ...(revision === undefined ? {} : { acknowledgeRevision: revision }),
    };
  },
);

/**
 * The common acceptance boundary: the provider took the turn, so a pending
 * transition is cleared. `WorkflowFirst.acknowledge` compare-and-clears by
 * revision, which keeps an older ack from dropping a newer transition. A
 * storage failure must not fail a live turn, and the text is never logged.
 */
export const acknowledgeDelivery = Effect.fn("WorkflowFirstDelivery.acknowledgeDelivery")(
  function* (input: {
    readonly first: WorkflowFirst.WorkflowFirst["Service"];
    readonly threadId: ThreadId;
    readonly revision: number;
    readonly runId?: RunId;
  }) {
    yield* input.first.acknowledge({ threadId: input.threadId, revision: input.revision }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Could not acknowledge delivered Workflow-first transition", {
          threadId: input.threadId,
          revision: input.revision,
          ...(input.runId === undefined ? {} : { runId: input.runId }),
          cause,
        }),
      ),
    );
  },
);
