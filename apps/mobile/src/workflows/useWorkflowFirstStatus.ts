import { useEffect } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../state/query";
import { workflowFirstReadForThread, workflowRunsSubscription } from "./workflowState";

export function useWorkflowFirstStatus(
  environmentId: EnvironmentId | undefined,
  threadId: ThreadId | undefined,
) {
  const status = useEnvironmentQuery(
    environmentId && threadId ? workflowFirstReadForThread(environmentId, threadId) : null,
  );
  const changes = useEnvironmentQuery(
    environmentId ? workflowRunsSubscription({ environmentId, input: {} }) : null,
  );
  const refreshStatus = status.refresh;
  // oxlint-disable-next-line t3code/react-effect-budget -- Refresh the thread setting after its live subscription publishes a change.
  useEffect(() => {
    if (changes.data !== null) refreshStatus();
  }, [changes.data, refreshStatus]);
  return status.data?._tag === "workflowFirst" && status.data.enabled;
}
