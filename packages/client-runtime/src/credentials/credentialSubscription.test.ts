import { expect, it } from "@effect/vitest";
import {
  AuthCredentialsManageScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  WS_METHODS,
  authScopeRequiredResponse,
  type CredentialLiveState,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import {
  PrimaryConnectionTarget,
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import type * as RpcSession from "../rpc/session.ts";
import { createCredentialLiveAtoms, EMPTY_CREDENTIAL_LIVE_STATE } from "./credentialLiveState.ts";

const environmentId = EnvironmentId.make("remote");
const target = new PrimaryConnectionTarget({
  environmentId,
  label: "Remote",
  httpBaseUrl: "https://example.test",
  wsBaseUrl: "wss://example.test",
});
const connectedState = (): SupervisorConnectionState => ({
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  attempt: 1,
  generation: 1,
  phase: "connected",
});
const authorizationError = () =>
  new EnvironmentAuthorizationError({
    message: "The authenticated token is missing required scope: credentials:manage.",
    ...authScopeRequiredResponse(AuthCredentialsManageScope),
  });
const snapshotAt = (revision: number): CredentialLiveState => ({
  ...EMPTY_CREDENTIAL_LIVE_STATE,
  historyRevision: revision,
});
const isRevision =
  (revision: number) =>
  (result: AsyncResult.AsyncResult<CredentialLiveState, unknown>): boolean =>
    AsyncResult.isSuccess(result) && result.value.historyRevision === revision;

type CredentialClient = RpcSession.RpcSession["client"];

const makeHarness = Effect.fn("TestCredentialSubscription.makeHarness")(function* (
  client: CredentialClient,
) {
  const state = yield* SubscriptionRef.make<SupervisorConnectionState>(connectedState());
  const session = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
    Option.some({ client } as unknown as RpcSession.RpcSession),
  );
  const supervisor = {
    target,
    state,
    session,
  } as unknown as EnvironmentSupervisor.EnvironmentSupervisor["Service"];
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_id, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
    _id,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const environmentRegistry = {
    run,
    followStream,
    stateChanges: () => SubscriptionRef.changes(state),
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"];
  // The atom's stream runs outside the test fiber, so give it this test's clock for backoff.
  const clock = yield* Clock.Clock;
  const runtime = Atom.runtime(
    Layer.merge(
      Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry),
      Layer.succeed(Clock.Clock, clock),
    ),
  );
  const permission = Atom.make(false);
  const atoms = createCredentialLiveAtoms(runtime, () => permission);
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return { atoms, permission, registry, session };
});

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

/** Mounts the live atom and resolves when it holds the snapshot at `revision`. */
const mountUntil = Effect.fn("TestCredentialSubscription.mountUntil")(function* (
  harness: Harness,
  revision: number,
) {
  const atom = harness.atoms.liveStateAtom(environmentId);
  const arrived = yield* Deferred.make<void>();
  const unsubscribe = harness.registry.subscribe(
    atom,
    (result) => {
      if (isRevision(revision)(result)) Deferred.doneUnsafe(arrived, Exit.void);
    },
    { immediate: true },
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  const mounted = harness.registry.mount(atom);
  yield* Effect.addFinalizer(() => Effect.sync(mounted));
  harness.registry.set(harness.permission, true);
  yield* Deferred.await(arrived);
  return atom;
});

it.effect("shares one environment stream and detaches it when credential access is lost", () =>
  Effect.gen(function* () {
    const updates = yield* SubscriptionRef.make<CredentialLiveState>(EMPTY_CREDENTIAL_LIVE_STATE);
    const received = yield* Deferred.make<void>();
    const revised = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();
    let subscriptions = 0;
    const client = {
      [WS_METHODS.credentialsSubscribe]: () =>
        Stream.fromEffect(
          Effect.sync(() => {
            subscriptions += 1;
          }),
        ).pipe(
          Stream.drain,
          Stream.concat(SubscriptionRef.changes(updates)),
          Stream.ensuring(Deferred.succeed(stopped, undefined)),
        ),
    } as unknown as CredentialClient;
    const harness = yield* makeHarness(client);
    const atom = harness.atoms.liveStateAtom(environmentId);
    const first = harness.registry.subscribe(
      atom,
      (result) => {
        if (AsyncResult.isSuccess(result) && result.value.historyRevision === 1)
          Deferred.doneUnsafe(received, Exit.void);
        if (AsyncResult.isSuccess(result) && result.value.historyRevision === 2)
          Deferred.doneUnsafe(revised, Exit.void);
      },
      { immediate: true },
    );
    yield* Effect.addFinalizer(() => Effect.sync(first));
    expect(subscriptions).toBe(0);
    expect(yield* AtomRegistry.getResult(harness.registry, atom)).toEqual(
      EMPTY_CREDENTIAL_LIVE_STATE,
    );
    const second = harness.registry.mount(atom);
    yield* Effect.addFinalizer(() => Effect.sync(second));
    harness.registry.set(harness.permission, true);
    yield* SubscriptionRef.set(updates, snapshotAt(1));
    yield* Deferred.await(received);
    expect(subscriptions).toBe(1);
    yield* SubscriptionRef.set(updates, snapshotAt(2));
    yield* Deferred.await(revised);
    expect(harness.registry.get(harness.atoms.historyRevisionAtom(environmentId))).toBe(2);
    harness.registry.set(harness.permission, false);
    yield* Deferred.await(stopped);
    expect(yield* AtomRegistry.getResult(harness.registry, atom)).toEqual(
      EMPTY_CREDENTIAL_LIVE_STATE,
    );
    expect(subscriptions).toBe(1);
  }),
);

it.effect("recovers from an authorization error once a snapshot arrives", () =>
  Effect.gen(function* () {
    const updates = yield* SubscriptionRef.make<CredentialLiveState>(snapshotAt(1));
    const rejected = yield* Deferred.make<void>();
    let subscriptions = 0;
    const rejectedClient = {
      [WS_METHODS.credentialsSubscribe]: () =>
        Stream.fromEffect(
          Effect.sync(() => {
            subscriptions += 1;
          }),
        ).pipe(
          Stream.drain,
          Stream.concat(
            Stream.fromEffect(Deferred.succeed(rejected, undefined)).pipe(Stream.drain),
          ),
          Stream.concat(Stream.fail(authorizationError())),
        ),
    } as unknown as CredentialClient;
    const workingClient = {
      [WS_METHODS.credentialsSubscribe]: () =>
        Stream.fromEffect(
          Effect.sync(() => {
            subscriptions += 1;
          }),
        ).pipe(
          Stream.drain,
          Stream.concat(Stream.fromEffect(SubscriptionRef.get(updates))),
          Stream.concat(SubscriptionRef.changes(updates)),
        ),
    } as unknown as CredentialClient;
    const harness = yield* makeHarness(rejectedClient);
    const atom = harness.atoms.liveStateAtom(environmentId);
    const mountImmediately = harness.registry.subscribe(atom, () => {}, { immediate: true });
    yield* Effect.addFinalizer(() => Effect.sync(mountImmediately));
    const mounted = harness.registry.mount(atom);
    yield* Effect.addFinalizer(() => Effect.sync(mounted));
    harness.registry.set(harness.permission, true);
    yield* Deferred.await(rejected);
    expect(subscriptions).toBe(1);

    // The transport reconnects to the fixed server and the supervisor replaces the session.
    yield* SubscriptionRef.set(harness.session, Option.some({ client: workingClient } as never));
    const live = yield* mountUntil(harness, 1);
    const result = harness.registry.get(live);
    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(Option.getOrNull(AsyncResult.value(result))).toEqual(snapshotAt(1));
    expect(subscriptions).toBe(2);
  }),
);

it.effect("resubscribes after a failure even when the session stays healthy", () =>
  Effect.gen(function* () {
    const updates = yield* SubscriptionRef.make<CredentialLiveState>(snapshotAt(1));
    const failed = yield* Deferred.make<void>();
    let subscriptions = 0;
    const flakyClient = {
      [WS_METHODS.credentialsSubscribe]: () => {
        subscriptions += 1;
        return subscriptions === 1
          ? Stream.fromEffect(Deferred.succeed(failed, undefined)).pipe(
              Stream.drain,
              Stream.concat(Stream.fail(authorizationError())),
            )
          : Stream.fromEffect(SubscriptionRef.get(updates)).pipe(
              Stream.concat(SubscriptionRef.changes(updates)),
            );
      },
    } as unknown as CredentialClient;
    const harness = yield* makeHarness(flakyClient);
    const atom = harness.atoms.liveStateAtom(environmentId);
    const subscribed = harness.registry.subscribe(atom, () => {}, { immediate: true });
    yield* Effect.addFinalizer(() => Effect.sync(subscribed));
    const mounted = harness.registry.mount(atom);
    yield* Effect.addFinalizer(() => Effect.sync(mounted));
    harness.registry.set(harness.permission, true);
    yield* Deferred.await(failed);
    expect(subscriptions).toBe(1);

    // The first retry waits out the backoff (500ms), then the snapshot replaces the failure.
    yield* TestClock.adjust("500 millis");
    yield* mountUntil(harness, 1);
    expect(subscriptions).toBe(2);
    expect(AsyncResult.isSuccess(harness.registry.get(atom))).toBe(true);
  }),
);
