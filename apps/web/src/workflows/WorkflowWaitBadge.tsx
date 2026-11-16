import { minuteTick } from "@t3tools/client-runtime/clock";
import type { WorkflowWaitBefore } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export function WorkflowWaitBadge(props: {
  wait: WorkflowWaitBefore;
  resumeAt?: string | undefined;
}) {
  const now = useSyncExternalStore(
    minuteTick.subscribe,
    minuteTick.getSnapshot,
    minuteTick.getSnapshot,
  );
  const minutes = props.resumeAt
    ? Math.max(0, Math.ceil((Date.parse(props.resumeAt) - Date.parse(`${now}:00Z`)) / 60000))
    : null;
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">
      ⏳{" "}
      {minutes !== null
        ? `Starts in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : props.wait.kind === "delay"
          ? `${props.wait.minutes}m`
          : props.wait.timeOfDay}
    </span>
  );
}
