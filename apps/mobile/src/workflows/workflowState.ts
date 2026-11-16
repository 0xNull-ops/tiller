import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const workflowRunsSubscription = createEnvironmentRpcSubscriptionAtomFamily(
  connectionAtomRuntime,
  {
    label: "mobile:workflows:runs",
    tag: WS_METHODS.workflowsSubscribeRuns,
    idleTtlMs: 0,
  },
);

export const workflowRunsForProject = (environmentId: EnvironmentId, projectId: ProjectId) =>
  workflowRunsSubscription({ environmentId, input: { projectId } });

export const workflowFirstRead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:workflow-first:read",
  tag: WS_METHODS.workflowsRead,
  staleTimeMs: 0,
  idleTtlMs: 60_000,
});
export const workflowFirstReadForThread = (environmentId: EnvironmentId, threadId: ThreadId) =>
  workflowFirstRead({ environmentId, input: { _tag: "workflowFirst", threadId } });

export const stopWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:workflows:stop",
  tag: WS_METHODS.workflowsStop,
});

export const approveWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:workflows:approve",
  tag: WS_METHODS.workflowsApprove,
});

export const resumeWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:workflows:resume",
  tag: WS_METHODS.workflowsResume,
});

export const editWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "mobile:workflows:edit",
  tag: WS_METHODS.workflowsEdit,
});
