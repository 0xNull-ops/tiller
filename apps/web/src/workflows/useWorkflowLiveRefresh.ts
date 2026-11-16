import { useEffect } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../state/query";
import { workflowRunsLive } from "./workflowState";

export function useWorkflowLiveRefresh(environmentId: EnvironmentId, refresh: () => unknown) {
  const live = useEnvironmentQuery(workflowRunsLive(environmentId));
  // oxlint-disable-next-line t3code/react-effect-budget -- Refresh the workflow read when its external live-query timestamp advances.
  useEffect(() => {
    if (live.dataUpdatedAt > 0) refresh();
  }, [live.dataUpdatedAt, refresh]);
}
