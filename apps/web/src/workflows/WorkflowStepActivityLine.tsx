import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useWorkflowStepActivity } from "./useWorkflowStepActivity";

/**
 * The live activity of a running step, shown under the card's title. It is one short
 * line, it is throttled, and it disappears as soon as the step is done, waiting or idle.
 */
export function WorkflowStepActivityLine(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly startedAt: string | null;
  readonly running: boolean;
}) {
  const label = useWorkflowStepActivity(props);
  if (label === null) return null;
  return (
    <span
      data-workflow-step-activity
      className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground"
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
