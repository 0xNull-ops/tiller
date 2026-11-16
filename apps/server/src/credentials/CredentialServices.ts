import * as Layer from "effect/Layer";

import * as CredentialApprovals from "./CredentialApprovals.ts";
import * as CredentialRedaction from "./CredentialRedaction.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";
import * as WorkflowCredentialPreapprovals from "./WorkflowCredentialPreapprovals.ts";

/**
 * One vault per server: the store, the unlock state and the history share a single instance, and
 * the RPC layer and the agent tools must consume this same value.
 */
const vault = CredentialUnlock.layer.pipe(
  Layer.provideMerge(CredentialStore.layer.pipe(Layer.provideMerge(CredentialHistory.layer))),
  Layer.provide(CredentialVaultKey.layer),
);

/** Pre-approvals are recorded by the unlocked action, so they share the vault's unlock state. */
const preapprovals = WorkflowCredentialPreapprovals.layer.pipe(Layer.provideMerge(vault));

export const layer = Layer.mergeAll(CredentialApprovals.layer, CredentialRedaction.layer).pipe(
  Layer.provideMerge(preapprovals),
);
