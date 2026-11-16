import {
  PROVIDER_DISPLAY_NAMES,
  WS_METHODS,
  type CredentialCaller,
  type CredentialHistoryEvent,
  type CredentialLiveState,
  type CredentialPendingRequest,
  type EnvironmentId,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import { createEnvironmentSubscriptionAtomFamily } from "../state/runtime.ts";

export const EMPTY_CREDENTIAL_LIVE_STATE: CredentialLiveState = {
  historyRevision: 0,
  pending: [],
  active: [],
};

/**
 * A live approval feed must outlive a server-side failure. A server briefly running older code
 * rejected `credentials.subscribe` with an authorization error once, and the atom held that
 * failure after the socket came back, so approvals stayed invisible until a reload. Retrying the
 * subscription (the schedule resets on the next snapshot) keeps the feed alive across a reconnect
 * and across a failure that never drops the transport; while the stream is healthy no timer runs.
 */
const credentialRetrySchedule = Schedule.exponential("500 millis").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(30))),
  ),
);

const subscribeCredentials = (input: EnvironmentRpcInput<typeof WS_METHODS.credentialsSubscribe>) =>
  subscribe(WS_METHODS.credentialsSubscribe, input).pipe(
    Stream.tapError((error) =>
      Effect.logWarning("Credential approvals subscription failed; retrying.", { error }),
    ),
    Stream.retry(credentialRetrySchedule),
  );

/** Mount only for environments in use. All consumers share one stream, and losing the grant detaches it. */
export function createCredentialLiveAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
  permissionAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean>,
) {
  const subscription = createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "credentials:subscribe",
    idleTtlMs: 0,
    subscribe: subscribeCredentials,
  });
  const liveStateAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      get(permissionAtom(environmentId))
        ? get(subscription({ environmentId, input: {} }))
        : AsyncResult.success(EMPTY_CREDENTIAL_LIVE_STATE),
    ),
  );
  const historyRevisionAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get) =>
        Option.getOrNull(AsyncResult.value(get(liveStateAtom(environmentId))))?.historyRevision ??
        0,
    ),
  );
  return { liveStateAtom, historyRevisionAtom };
}

export interface StepCredentialActivity {
  readonly credentialId: string;
  readonly name: string;
  readonly templateId?: string;
  readonly icon?: string;
  readonly state: "asking" | "in-use" | "used";
  readonly count: number;
  readonly requests: ReadonlyArray<CredentialPendingRequest>;
  /** Who is asking or using it. Absent for a completed use, which only the history records. */
  readonly caller?: CredentialCaller | undefined;
  /** The redacted command, when the use had one. */
  readonly commandPreview?: string | undefined;
}

export function stepCredentialActivity(
  live: CredentialLiveState,
  history: ReadonlyArray<CredentialHistoryEvent>,
  runId: string,
  stepId: string,
): ReadonlyArray<StepCredentialActivity> {
  const entries = new Map<string, StepCredentialActivity>();
  for (const event of history) {
    if (
      event.type !== "used" ||
      !event.credentialId ||
      event.use?.runId !== runId ||
      event.use.stepId !== stepId
    )
      continue;
    const previous = entries.get(event.credentialId);
    entries.set(event.credentialId, {
      credentialId: event.credentialId,
      name: event.credentialName ?? event.credentialId,
      state: "used",
      count: (previous?.count ?? 0) + (event.use.result !== "denied" ? 1 : 0),
      requests: [],
    });
  }
  for (const active of live.active) {
    if (active.caller.runId !== runId || active.caller.stepId !== stepId) continue;
    entries.set(active.credentialId, {
      ...entries.get(active.credentialId),
      credentialId: active.credentialId,
      name: active.credentialName,
      templateId: active.templateId,
      ...(active.icon ? { icon: active.icon } : {}),
      state: "in-use",
      count: entries.get(active.credentialId)?.count ?? 0,
      requests: [],
      caller: active.caller,
      commandPreview: active.commandPreview,
    });
  }
  for (const request of live.pending) {
    if (
      request.kind === "add" &&
      request.caller.runId === runId &&
      request.caller.stepId === stepId
    ) {
      // A missing credential has no vault id yet; this key lasts only as long as its add request.
      const key = `request:${request.id}`;
      entries.set(key, {
        credentialId: key,
        name: request.name ?? request.templateId ?? "New credentials",
        ...(request.templateId ? { templateId: request.templateId } : {}),
        state: "asking",
        count: 0,
        requests: [request],
        caller: request.caller,
      });
      continue;
    }
    if (
      request.kind !== "use" ||
      request.caller.runId !== runId ||
      request.caller.stepId !== stepId
    )
      continue;
    const previous = entries.get(request.credentialId);
    entries.set(request.credentialId, {
      ...previous,
      credentialId: request.credentialId,
      name: request.credentialName,
      templateId: request.templateId,
      ...(request.icon ? { icon: request.icon } : {}),
      state: "asking",
      count: previous?.count ?? 0,
      requests: [...(previous?.requests ?? []), request],
      caller: request.caller,
      commandPreview: request.commandPreview,
    });
  }
  return [...entries.values()];
}

/** "Codex subagent" or "Claude main agent". Unknown providers show their raw id, never a blank. */
export const credentialCallerLabel = (
  caller: Pick<CredentialCaller, "provider" | "agentRole">,
): string =>
  `${PROVIDER_DISPLAY_NAMES[caller.provider as ProviderDriverKind] ?? caller.provider} ${
    caller.agentRole === "subagent" ? "subagent" : "main agent"
  }`;

export const credentialActivityLabel = (activity: StepCredentialActivity): string =>
  activity.state === "asking"
    ? "Needs approval"
    : activity.state === "in-use"
      ? "In use"
      : `Used ${activity.count}×`;

/** A workflow's driver can answer requests made by its delegated asking thread. */
export function credentialRequestsForThread(
  pending: ReadonlyArray<CredentialPendingRequest>,
  threadId: string,
  runs: ReadonlyArray<{ readonly id: string; readonly driverThreadId: string | null }>,
): ReadonlyArray<CredentialPendingRequest> {
  return pending.filter(
    (request) =>
      request.caller.threadId === threadId ||
      runs.some((run) => run.id === request.caller.runId && run.driverThreadId === threadId),
  );
}
