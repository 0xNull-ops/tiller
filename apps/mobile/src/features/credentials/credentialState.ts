import {
  AuthCredentialsManageScope,
  EnvironmentAuthorizationError,
  WS_METHODS,
  authScopeRequiredResponse,
  type CredentialHistoryInput,
  type EnvironmentId,
} from "@t3tools/contracts";
import { RpcPermissionGuard, requestGuarded } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentRpcCommand,
  createCredentialLiveAtoms,
  createEnvironmentQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "../../connection/runtime";
import { readEnvironmentScope } from "../../state/session";

type EmptyCredentialInput = Readonly<Record<string, never>>;

/**
 * Credential reads are guarded RPCs, and only the command boundary installs a
 * permission guard. Queries have no boundary, so they check the same grant here;
 * the screens also refuse to mount them without it, and the server authorizes
 * every request regardless.
 */
const credentialReadGuard: {
  readonly authorize: (
    environmentId: EnvironmentId,
    method: string,
    input: unknown,
  ) => Effect.Effect<void, EnvironmentAuthorizationError>;
} = {
  authorize: (environmentId) =>
    readEnvironmentScope(environmentId, AuthCredentialsManageScope)
      ? Effect.void
      : Effect.fail(
          new EnvironmentAuthorizationError({
            ...authScopeRequiredResponse(AuthCredentialsManageScope),
            message: `This connection requires ${AuthCredentialsManageScope}.`,
          }),
        ),
};

const readCredential = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(RpcPermissionGuard, credentialReadGuard));

export const credentialListQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:credentials:list",
  staleTimeMs: 5_000,
  refreshTrigger: ({ environmentId }) => credentialLive.historyRevisionAtom(environmentId),
  execute: (input: EmptyCredentialInput) =>
    readCredential(requestGuarded(WS_METHODS.credentialsList, input)),
});

/** One recent page per credential, refreshed when the environment records activity. */
export const credentialHistoryQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:credentials:history",
  staleTimeMs: 5_000,
  refreshTrigger: ({ environmentId }) => credentialLive.historyRevisionAtom(environmentId),
  execute: (input: CredentialHistoryInput) =>
    readCredential(requestGuarded(WS_METHODS.credentialsHistory, input)),
});

export const approveCredential = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:credentials:approve",
  tag: WS_METHODS.credentialsApprove,
});
export const denyCredential = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:credentials:deny",
  tag: WS_METHODS.credentialsDeny,
});
export const unlockCredentials = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:credentials:unlock",
  tag: WS_METHODS.credentialsUnlock,
});
export const credentialLive = createCredentialLiveAtoms(
  connectionAtomRuntime,
  approveCredential.permissionAtom,
);
