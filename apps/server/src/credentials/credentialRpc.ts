import { WS_METHODS, WsRpcGroup, type AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import * as CredentialApprovals from "./CredentialApprovals.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";

const credentialMethods = [
  WS_METHODS.credentialsStatus,
  WS_METHODS.credentialsList,
  WS_METHODS.credentialsGet,
  WS_METHODS.credentialsCreate,
  WS_METHODS.credentialsUpdate,
  WS_METHODS.credentialsSetSecret,
  WS_METHODS.credentialsRemoveSecret,
  WS_METHODS.credentialsDelete,
  WS_METHODS.credentialsHistory,
  WS_METHODS.credentialsPinSet,
  WS_METHODS.credentialsUnlock,
  WS_METHODS.credentialsLock,
  WS_METHODS.credentialsSubscribe,
  WS_METHODS.credentialsApprove,
  WS_METHODS.credentialsDeny,
  WS_METHODS.credentialsGrants,
  WS_METHODS.credentialsRevokeGrant,
] as const;
export { credentialMethods };
const credentialMethodSet = new Set<string>(credentialMethods);
type WsMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

// tsc-rs loses the handler layer's requirements type once one group handles too many RPCs, which
// is why the workflow handlers already live in their own layer. Credentials follow the same split.
export const credentialGroup = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (tag): tag is Exclude<WsMethod, (typeof credentialMethods)[number]> =>
      !credentialMethodSet.has(tag),
  ),
).middleware(RpcInstrumentation);

/**
 * The caller's auth session is the unlock key, so the layer is built per connection: one client
 * unlocking the vault never unlocks another client's session.
 */
export const layer = (sessionId: AuthSessionId) =>
  credentialGroup.toLayer(
    Effect.gen(function* () {
      const approvals = yield* CredentialApprovals.CredentialApprovals;
      const store = yield* CredentialStore.CredentialStore;
      const unlock = yield* CredentialUnlock.CredentialUnlock;
      const history = yield* CredentialHistory.CredentialHistory;

      // Every write needs an unlock: even a plain field such as a URL decides where a secret is
      // sent. Reading metadata and history needs the scope alone.
      const guarded = <A, E>(effect: Effect.Effect<A, E>) =>
        unlock.requireUnlocked(sessionId).pipe(Effect.andThen(effect));

      return credentialGroup.of({
        [WS_METHODS.credentialsStatus]: () => unlock.status(sessionId),
        [WS_METHODS.credentialsList]: () =>
          store.list().pipe(Effect.map((credentials) => ({ credentials }))),
        [WS_METHODS.credentialsGet]: (input) => store.get(input.id),
        [WS_METHODS.credentialsCreate]: (input) =>
          guarded(
            store
              .create(input)
              .pipe(
                Effect.tap((credential) =>
                  input.requestId === undefined
                    ? Effect.void
                    : approvals.saved(input.requestId, credential),
                ),
              ),
          ),
        [WS_METHODS.credentialsUpdate]: (input) =>
          guarded(
            store
              .update(input)
              .pipe(
                Effect.tap((credential) =>
                  input.requestId === undefined
                    ? Effect.void
                    : approvals.saved(input.requestId, credential),
                ),
              ),
          ),
        [WS_METHODS.credentialsSetSecret]: (input) =>
          guarded(
            store
              .setSecret(input)
              .pipe(
                Effect.tap((credential) =>
                  input.requestId === undefined
                    ? Effect.void
                    : approvals.saved(input.requestId, credential),
                ),
              ),
          ),
        [WS_METHODS.credentialsRemoveSecret]: (input) => guarded(store.removeSecret(input)),
        // A deleted credential cannot be used, so the pre-approvals that named it go with it.
        [WS_METHODS.credentialsDelete]: (input) =>
          guarded(
            store
              .delete(input.id)
              .pipe(Effect.andThen(() => approvals.revokePreapprovalsForCredential(input.id))),
          ),
        [WS_METHODS.credentialsHistory]: (input) => history.read(input),
        [WS_METHODS.credentialsPinSet]: (input) => unlock.setPin({ sessionId, ...input }),
        [WS_METHODS.credentialsUnlock]: (input) => unlock.unlock({ sessionId, ...input }),
        [WS_METHODS.credentialsLock]: () => unlock.lock(sessionId),
        [WS_METHODS.credentialsSubscribe]: () => approvals.subscribe,
        [WS_METHODS.credentialsApprove]: (input) =>
          approvals.approve(input.requestId, input.scope, sessionId),
        [WS_METHODS.credentialsDeny]: (input) => approvals.deny(input.requestId, sessionId),
        [WS_METHODS.credentialsGrants]: () => approvals.grants,
        [WS_METHODS.credentialsRevokeGrant]: (input) =>
          input.kind === "approval"
            ? approvals.revoke(input.grantId, sessionId)
            : approvals.revokePreapproval(input, sessionId),
      });
    }),
  );

/**
 * Credential handlers are merged next to the workflow ones. `base` must already omit the
 * credential methods, which `WorkflowRpc.baseGroup` does. The return type stays inferred so the
 * handler services reach `Ws.layer`'s requirement.
 */
export const mergeInto = <A, E, R>(base: Layer.Layer<A, E, R>, sessionId: AuthSessionId) =>
  Layer.merge(base, layer(sessionId));
