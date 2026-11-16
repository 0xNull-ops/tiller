import { readCredentialHistoryWindow } from "./credentialHistoryWindow";
import { createCredentialLiveAtoms } from "@t3tools/client-runtime/state/runtime";
import {
  AuthCredentialsManageScope,
  EnvironmentAuthorizationError,
  WS_METHODS,
  authScopeRequiredResponse,
  type EnvironmentId,
} from "@t3tools/contracts";
import { RpcPermissionGuard, requestGuarded } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { readEnvironmentScope } from "../state/session";

type EmptyCredentialInput = Readonly<Record<string, never>>;
const EMPTY_INPUT: EmptyCredentialInput = {};

/**
 * Credential reads are guarded RPCs, but only the command boundary installs a permission
 * guard. Queries have no boundary of their own, so they check the same grant here; the
 * page also refuses to mount them without it, and the server authorizes every request.
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

export const credentialsStatusQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "credentials:status",
  staleTimeMs: 5_000,
  execute: (input: EmptyCredentialInput) =>
    readCredential(requestGuarded(WS_METHODS.credentialsStatus, input)),
});

export const credentialListQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "credentials:list",
  staleTimeMs: 5_000,
  refreshTrigger: ({ environmentId }) => credentialLive.historyRevisionAtom(environmentId),
  execute: (input: EmptyCredentialInput) =>
    readCredential(requestGuarded(WS_METHODS.credentialsList, input)),
});

const refreshListAndStatus = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => {
    registry.refresh(credentialsStatusQuery({ environmentId, input: EMPTY_INPUT }));
    registry.refresh(credentialListQuery({ environmentId, input: EMPTY_INPUT }));
  });

export const createCredential = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:create",
  tag: WS_METHODS.credentialsCreate,
  onSuccess: ({ environmentId }, registry) => refreshListAndStatus(environmentId, registry),
});

export const updateCredential = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:update",
  tag: WS_METHODS.credentialsUpdate,
  onSuccess: ({ environmentId }, registry) => refreshListAndStatus(environmentId, registry),
});

export const setCredentialSecret = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:set-secret",
  tag: WS_METHODS.credentialsSetSecret,
  onSuccess: ({ environmentId }, registry) => refreshListAndStatus(environmentId, registry),
});

export const removeCredentialSecret = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:remove-secret",
  tag: WS_METHODS.credentialsRemoveSecret,
  onSuccess: ({ environmentId }, registry) => refreshListAndStatus(environmentId, registry),
});

export const deleteCredential = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:delete",
  tag: WS_METHODS.credentialsDelete,
  onSuccess: ({ environmentId }, registry) => refreshListAndStatus(environmentId, registry),
});

export const setCredentialPin = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:set-pin",
  tag: WS_METHODS.credentialsPinSet,
  onSuccess: ({ environmentId }, registry) =>
    Effect.sync(() => {
      registry.refresh(credentialsStatusQuery({ environmentId, input: EMPTY_INPUT }));
    }),
});

export const unlockCredentials = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:unlock",
  tag: WS_METHODS.credentialsUnlock,
  onSuccess: ({ environmentId }, registry) =>
    Effect.sync(() => {
      registry.refresh(credentialsStatusQuery({ environmentId, input: EMPTY_INPUT }));
    }),
});

export const lockCredentials = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:lock",
  tag: WS_METHODS.credentialsLock,
  onSuccess: ({ environmentId }, registry) =>
    Effect.sync(() => {
      registry.refresh(credentialsStatusQuery({ environmentId, input: EMPTY_INPUT }));
    }),
});

export const readCredentialHistory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:read-history",
  tag: WS_METHODS.credentialsHistory,
});

export const credentialLive = createCredentialLiveAtoms(
  connectionAtomRuntime,
  createCredential.permissionAtom,
);
export const credentialHistoryQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "credentials:history-live",
  refreshTrigger: ({ environmentId }) => credentialLive.historyRevisionAtom(environmentId),
  execute: (input: {
    readonly limit: number;
    readonly credentialId?: import("@t3tools/contracts").CredentialId;
    readonly cursor?: string;
  }) => readCredential(requestGuarded(WS_METHODS.credentialsHistory, input)),
});
export const credentialGrantsQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "credentials:grants",
  refreshTrigger: ({ environmentId }) => credentialLive.historyRevisionAtom(environmentId),
  execute: (input: EmptyCredentialInput) =>
    readCredential(requestGuarded(WS_METHODS.credentialsGrants, input)),
});
export const approveCredential = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:approve",
  tag: WS_METHODS.credentialsApprove,
});
export const denyCredential = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:deny",
  tag: WS_METHODS.credentialsDeny,
});
export const revokeCredentialGrant = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "credentials:revoke-grant",
  tag: WS_METHODS.credentialsRevokeGrant,
  onSuccess: ({ environmentId }, registry) =>
    Effect.sync(() => registry.refresh(credentialGrantsQuery({ environmentId, input: {} }))),
});

export const credentialHistoryWindowQuery = createEnvironmentQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "credentials:history-window",
    refreshTrigger: ({ environmentId }) => credentialLive.historyRevisionAtom(environmentId),
    execute: (input: {
      readonly since: string;
      readonly credentialId?: import("@t3tools/contracts").CredentialId;
    }) =>
      readCredentialHistoryWindow(
        (page) => readCredential(requestGuarded(WS_METHODS.credentialsHistory, page)),
        input,
      ),
  },
);
