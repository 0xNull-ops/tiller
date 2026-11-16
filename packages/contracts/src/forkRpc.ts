export * from "./workflowTemplates.ts";
import {
  WorkflowTemplateUse,
  WorkflowTemplateUseResult,
  WorkflowTemplateSummary,
} from "./workflowTemplates.ts";
import {
  SkillsShLocation,
  SkillsShSearch,
  SkillsShPreview,
  SkillsShInstall,
  SkillsShEntry,
  SkillsShError,
} from "./skillsSh.ts";
export * from "./skillsSh.ts";
export * from "./workflow.ts";
export * from "./workflowSchedule.ts";
export * from "./credential.ts";

/**
 * The fork's workspace RPCs: saved workflows and the credential vault.
 *
 * `rpc.ts` is upstream's file, so the method names and the `Rpc.make` definitions live here
 * and upstream's file only spreads them in. This module must not import from `rpc.ts`: these
 * tags are read while the modules evaluate, and `rpc.ts` imports this file first.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  CredentialLiveState,
  CredentialApproveInput,
  CredentialGrant,
  CredentialRevokeGrantInput,
  CredentialUseError,
  CredentialAccessError,
  CredentialCreateInput,
  CredentialDeleteInput,
  CredentialError,
  CredentialGetInput,
  CredentialHistoryInput,
  CredentialHistoryPage,
  CredentialListResult,
  CredentialPinRequiredError,
  CredentialPinSetInput,
  CredentialRemoveSecretInput,
  CredentialSetSecretInput,
  CredentialsStatus,
  CredentialUnlockInput,
  CredentialUpdateInput,
  Credential,
} from "./credential.ts";
import {
  WorkflowRun,
  WorkflowsSnapshot,
  WorkflowListRunsInput,
  WorkflowStopInput,
  WorkflowStepActionInput,
  WorkflowRpcError,
  WorkflowEdit,
  WorkflowEditResult,
  WorkflowRead,
  WorkflowReadResult,
} from "./workflow.ts";
import {
  AuthCredentialsManageScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
} from "./auth.ts";

const FORK_WS_METHODS = {
  workflows: {
    workflowsListRuns: "workflows.listRuns",
    workflowTemplatesList: "workflows.templatesList",
    workflowTemplateUse: "workflows.templateUse",
    workflowsSubscribeRuns: "workflows.subscribeRuns",
    workflowsStop: "workflows.stop",
    workflowsApprove: "workflows.approve",
    workflowsResume: "workflows.resume",
    workflowsEdit: "workflows.edit",
    workflowsRead: "workflows.read",
  },
  credentials: {
    credentialsStatus: "credentials.status",
    credentialsList: "credentials.list",
    credentialsGet: "credentials.get",
    credentialsCreate: "credentials.create",
    credentialsUpdate: "credentials.update",
    credentialsSetSecret: "credentials.setSecret",
    credentialsRemoveSecret: "credentials.removeSecret",
    credentialsDelete: "credentials.delete",
    credentialsHistory: "credentials.history",
    credentialsPinSet: "credentials.pinSet",
    credentialsUnlock: "credentials.unlock",
    credentialsLock: "credentials.lock",
    credentialsSubscribe: "credentials.subscribe",
    credentialsApprove: "credentials.approve",
    credentialsDeny: "credentials.deny",
    credentialsGrants: "credentials.grants",
    credentialsRevokeGrant: "credentials.revokeGrant",
  },
  skillsSh: {
    skillsShPending: "skillsSh.pending",
    skillsShDismiss: "skillsSh.dismiss",
    skillsShSearch: "skillsSh.search",
    skillsShPreview: "skillsSh.preview",
    skillsShAudit: "skillsSh.audit",
    skillsShInstall: "skillsSh.install",
    skillsShUninstall: "skillsSh.uninstall",
    skillsShListInstalled: "skillsSh.listInstalled",
    skillsShCheckUpdates: "skillsSh.checkUpdates",
  },
} as const;

export const FORK_WS_METHODS_ALL = {
  ...FORK_WS_METHODS.workflows,
  ...FORK_WS_METHODS.credentials,
  ...FORK_WS_METHODS.skillsSh,
} as const;

export const FORK_WS_METHOD_TAGS_ALL = {
  workflows: [
    FORK_WS_METHODS_ALL.workflowTemplatesList,
    FORK_WS_METHODS_ALL.workflowTemplateUse,
    FORK_WS_METHODS_ALL.workflowsListRuns,
    FORK_WS_METHODS_ALL.workflowsSubscribeRuns,
    FORK_WS_METHODS_ALL.workflowsStop,
    FORK_WS_METHODS_ALL.workflowsApprove,
    FORK_WS_METHODS_ALL.workflowsResume,
    FORK_WS_METHODS_ALL.workflowsEdit,
    FORK_WS_METHODS_ALL.workflowsRead,
  ],
  credentials: [
    FORK_WS_METHODS_ALL.credentialsStatus,
    FORK_WS_METHODS_ALL.credentialsList,
    FORK_WS_METHODS_ALL.credentialsGet,
    FORK_WS_METHODS_ALL.credentialsCreate,
    FORK_WS_METHODS_ALL.credentialsUpdate,
    FORK_WS_METHODS_ALL.credentialsSetSecret,
    FORK_WS_METHODS_ALL.credentialsRemoveSecret,
    FORK_WS_METHODS_ALL.credentialsDelete,
    FORK_WS_METHODS_ALL.credentialsHistory,
    FORK_WS_METHODS_ALL.credentialsPinSet,
    FORK_WS_METHODS_ALL.credentialsUnlock,
    FORK_WS_METHODS_ALL.credentialsLock,
    FORK_WS_METHODS_ALL.credentialsSubscribe,
    FORK_WS_METHODS_ALL.credentialsApprove,
    FORK_WS_METHODS_ALL.credentialsDeny,
    FORK_WS_METHODS_ALL.credentialsGrants,
    FORK_WS_METHODS_ALL.credentialsRevokeGrant,
  ],
  skillsSh: Object.values(FORK_WS_METHODS.skillsSh),
} as const;

export const FORK_CLIENT_GUARDED_RPC_SCOPES = {
  [FORK_WS_METHODS_ALL.workflowTemplatesList]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS_ALL.workflowTemplateUse]: AuthSettingsWriteScope,
  [FORK_WS_METHODS_ALL.skillsShAudit]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS_ALL.skillsShDismiss]: AuthSettingsWriteScope,
  [FORK_WS_METHODS_ALL.skillsShPending]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS_ALL.skillsShCheckUpdates]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS_ALL.skillsShListInstalled]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS_ALL.skillsShUninstall]: AuthSettingsWriteScope,
  [FORK_WS_METHODS_ALL.skillsShInstall]: AuthSettingsWriteScope,
  [FORK_WS_METHODS_ALL.skillsShPreview]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS_ALL.skillsShSearch]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS_ALL.workflowsStop]: AuthOrchestrationOperateScope,
  [FORK_WS_METHODS_ALL.workflowsApprove]: AuthOrchestrationOperateScope,
  [FORK_WS_METHODS_ALL.workflowsResume]: AuthOrchestrationOperateScope,
  [FORK_WS_METHODS_ALL.workflowsEdit]: AuthOrchestrationOperateScope,
  [FORK_WS_METHODS_ALL.credentialsStatus]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsList]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsGet]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsCreate]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsUpdate]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsSetSecret]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsRemoveSecret]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsDelete]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsHistory]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsPinSet]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsUnlock]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsLock]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsSubscribe]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsApprove]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsDeny]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsGrants]: AuthCredentialsManageScope,
  [FORK_WS_METHODS_ALL.credentialsRevokeGrant]: AuthCredentialsManageScope,
} as const;

const workflowRpcErrors = Schema.Union([WorkflowRpcError, EnvironmentAuthorizationError]);

const WsWorkflowsListRunsRpc = Rpc.make(FORK_WS_METHODS.workflows.workflowsListRuns, {
  payload: WorkflowListRunsInput,
  success: WorkflowsSnapshot,
  error: workflowRpcErrors,
});
const WsWorkflowsSubscribeRunsRpc = Rpc.make(FORK_WS_METHODS.workflows.workflowsSubscribeRuns, {
  payload: WorkflowListRunsInput,
  success: WorkflowsSnapshot,
  error: workflowRpcErrors,
  stream: true,
});
const WsWorkflowsStopRpc = Rpc.make(FORK_WS_METHODS.workflows.workflowsStop, {
  payload: WorkflowStopInput,
  success: WorkflowRun,
  error: workflowRpcErrors,
});
const WsWorkflowsApproveRpc = Rpc.make(FORK_WS_METHODS.workflows.workflowsApprove, {
  payload: WorkflowStepActionInput,
  success: WorkflowRun,
  error: workflowRpcErrors,
});
const WsWorkflowsResumeRpc = Rpc.make(FORK_WS_METHODS.workflows.workflowsResume, {
  payload: WorkflowStepActionInput,
  success: WorkflowRun,
  error: workflowRpcErrors,
});
const WsWorkflowsEditRpc = Rpc.make(FORK_WS_METHODS.workflows.workflowsEdit, {
  payload: WorkflowEdit,
  success: WorkflowEditResult,
  error: workflowRpcErrors,
});
const WsWorkflowsReadRpc = Rpc.make(FORK_WS_METHODS.workflows.workflowsRead, {
  payload: WorkflowRead,
  success: WorkflowReadResult,
  error: workflowRpcErrors,
});

// These handlers live in their own layer for the same tsc-rs RPC-count reason as the workflow
// ones. Every error can carry an authorization failure from the group middleware.
const credentialRpcErrors = Schema.Union([
  CredentialUseError,
  CredentialError,
  CredentialAccessError,
  CredentialPinRequiredError,
  EnvironmentAuthorizationError,
]);

const WsCredentialsStatusRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsStatus, {
  payload: Schema.Struct({}),
  success: CredentialsStatus,
  error: credentialRpcErrors,
});
const WsCredentialsListRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsList, {
  payload: Schema.Struct({}),
  success: CredentialListResult,
  error: credentialRpcErrors,
});
const WsCredentialsGetRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsGet, {
  payload: CredentialGetInput,
  success: Credential,
  error: credentialRpcErrors,
});
const WsCredentialsCreateRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsCreate, {
  payload: CredentialCreateInput,
  success: Credential,
  error: credentialRpcErrors,
});
const WsCredentialsUpdateRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsUpdate, {
  payload: CredentialUpdateInput,
  success: Credential,
  error: credentialRpcErrors,
});
const WsCredentialsSetSecretRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsSetSecret, {
  payload: CredentialSetSecretInput,
  success: Credential,
  error: credentialRpcErrors,
});
const WsCredentialsRemoveSecretRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsRemoveSecret, {
  payload: CredentialRemoveSecretInput,
  success: Credential,
  error: credentialRpcErrors,
});
const WsCredentialsDeleteRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsDelete, {
  payload: CredentialDeleteInput,
  success: Schema.Void,
  error: credentialRpcErrors,
});
const WsCredentialsHistoryRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsHistory, {
  payload: CredentialHistoryInput,
  success: CredentialHistoryPage,
  error: credentialRpcErrors,
});
const WsCredentialsPinSetRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsPinSet, {
  payload: CredentialPinSetInput,
  success: CredentialsStatus,
  error: credentialRpcErrors,
});
const WsCredentialsUnlockRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsUnlock, {
  payload: CredentialUnlockInput,
  success: CredentialsStatus,
  error: credentialRpcErrors,
});
const WsCredentialsSubscribeRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsSubscribe, {
  payload: Schema.Struct({}),
  success: CredentialLiveState,
  error: credentialRpcErrors,
  stream: true,
});
const WsCredentialsApproveRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsApprove, {
  payload: CredentialApproveInput,
  success: Schema.Void,
  error: credentialRpcErrors,
});
const WsCredentialsDenyRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsDeny, {
  payload: Schema.Struct({ requestId: Schema.String }),
  success: Schema.Void,
  error: credentialRpcErrors,
});
const WsCredentialsGrantsRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsGrants, {
  payload: Schema.Struct({}),
  success: Schema.Array(CredentialGrant),
  error: credentialRpcErrors,
});
const WsCredentialsRevokeGrantRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsRevokeGrant, {
  payload: CredentialRevokeGrantInput,
  success: Schema.Void,
  error: credentialRpcErrors,
});
const WsCredentialsLockRpc = Rpc.make(FORK_WS_METHODS.credentials.credentialsLock, {
  payload: Schema.Struct({}),
  success: CredentialsStatus,
  error: credentialRpcErrors,
});

const FORK_WS_RPCS = {
  skillsSh: [
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShAudit, {
      payload: Schema.Struct({ id: Schema.String }),
      success: Schema.Unknown,
      error: Schema.Union([SkillsShError, EnvironmentAuthorizationError]),
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShDismiss, {
      payload: Schema.Struct({ requestId: Schema.String }),
      success: Schema.Void,
      error: EnvironmentAuthorizationError,
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShPending, {
      payload: Schema.Struct({}),
      success: Schema.Array(Schema.Struct({ requestId: Schema.String, preview: SkillsShPreview })),
      error: EnvironmentAuthorizationError,
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShSearch, {
      payload: Schema.Struct({ query: Schema.String, limit: Schema.optional(Schema.Number) }),
      success: SkillsShSearch,
      error: Schema.Union([SkillsShError, EnvironmentAuthorizationError]),
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShPreview, {
      payload: Schema.Struct({ id: Schema.String }),
      success: SkillsShPreview,
      error: Schema.Union([SkillsShError, EnvironmentAuthorizationError]),
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShInstall, {
      payload: SkillsShInstall,
      success: SkillsShEntry,
      error: Schema.Union([SkillsShError, EnvironmentAuthorizationError]),
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShUninstall, {
      payload: Schema.Struct({ ...SkillsShLocation.fields, name: Schema.String }),
      success: Schema.Void,
      error: Schema.Union([SkillsShError, EnvironmentAuthorizationError]),
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShListInstalled, {
      payload: SkillsShLocation,
      success: Schema.Array(SkillsShEntry),
      error: Schema.Union([SkillsShError, EnvironmentAuthorizationError]),
    }),
    Rpc.make(FORK_WS_METHODS.skillsSh.skillsShCheckUpdates, {
      payload: SkillsShLocation,
      success: Schema.Array(
        Schema.Struct({ entry: SkillsShEntry, preview: SkillsShPreview, summary: Schema.String }),
      ),
      error: Schema.Union([SkillsShError, EnvironmentAuthorizationError]),
    }),
  ],
  workflows: [
    Rpc.make(FORK_WS_METHODS_ALL.workflowTemplatesList, {
      payload: Schema.Struct({}),
      success: Schema.Array(WorkflowTemplateSummary),
      error: workflowRpcErrors,
    }),
    Rpc.make(FORK_WS_METHODS_ALL.workflowTemplateUse, {
      payload: WorkflowTemplateUse,
      success: WorkflowTemplateUseResult,
      error: workflowRpcErrors,
    }),
    WsWorkflowsListRunsRpc,
    WsWorkflowsSubscribeRunsRpc,
    WsWorkflowsStopRpc,
    WsWorkflowsApproveRpc,
    WsWorkflowsResumeRpc,
    WsWorkflowsEditRpc,
    WsWorkflowsReadRpc,
  ],
  credentials: [
    WsCredentialsStatusRpc,
    WsCredentialsListRpc,
    WsCredentialsGetRpc,
    WsCredentialsCreateRpc,
    WsCredentialsUpdateRpc,
    WsCredentialsSetSecretRpc,
    WsCredentialsRemoveSecretRpc,
    WsCredentialsDeleteRpc,
    WsCredentialsHistoryRpc,
    WsCredentialsPinSetRpc,
    WsCredentialsUnlockRpc,
    WsCredentialsLockRpc,
    WsCredentialsSubscribeRpc,
    WsCredentialsApproveRpc,
    WsCredentialsDenyRpc,
    WsCredentialsGrantsRpc,
    WsCredentialsRevokeGrantRpc,
  ],
} as const;

export const FORK_WS_RPCS_ALL = [
  ...FORK_WS_RPCS.workflows,
  ...FORK_WS_RPCS.credentials,
  ...FORK_WS_RPCS.skillsSh,
] as const;
