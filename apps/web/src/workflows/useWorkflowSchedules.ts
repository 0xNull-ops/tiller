import { workflowScheduleBinding, type EnvironmentId, type ProjectId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

export function useWorkflowSchedules(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
  workflow: string | null,
) {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const tasks = (query.data?.tasks ?? []).filter((task) => {
    const binding = workflowScheduleBinding(task);
    return binding !== null && binding.projectId === projectId && binding.workflow === workflow;
  });
  const nextRunAt =
    tasks
      .filter((task) => task.enabled && task.nextRunAt !== null)
      .map((task) => task.nextRunAt!)
      .toSorted()[0] ?? null;
  return {
    tasks,
    nextRunAt,
    // Live stream atoms stay waiting after every chunk, so only the first result is a load.
    isPending: query.isPending && query.data === null,
    error: query.error,
  };
}
