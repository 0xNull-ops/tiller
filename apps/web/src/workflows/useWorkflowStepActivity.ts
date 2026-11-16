import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

import { STEP_ACTIVITY_THROTTLE_MS } from "./workflowStepActivity";
import { useStepActivityLabel } from "./workflowStepActivityState";

type ActivityInput = {
  readonly label: string | null;
  readonly enabled: boolean;
  readonly scope: string;
};

function createActivityThrottle(initial: ActivityInput) {
  let snapshot = { scope: initial.scope, label: initial.enabled ? initial.label : null };
  let appliedAt = snapshot.label === null ? -Infinity : Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const publish = (scope: string, label: string | null) => {
    if (scope === snapshot.scope && label === snapshot.label) return;
    snapshot = { scope, label };
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    update(input: ActivityInput) {
      cancel();
      if (input.scope !== snapshot.scope) appliedAt = -Infinity;
      if (!input.enabled || input.label === null) {
        if (!input.enabled) appliedAt = -Infinity;
        publish(input.scope, null);
        return;
      }
      if (input.scope === snapshot.scope && input.label === snapshot.label) return;
      const apply = () => {
        timer = null;
        appliedAt = Date.now();
        publish(input.scope, input.label);
      };
      const remaining = STEP_ACTIVITY_THROTTLE_MS - (Date.now() - appliedAt);
      if (remaining <= 0) apply();
      else timer = setTimeout(apply, remaining);
    },
    dispose: cancel,
  };
}

function useThrottledActivityLabel({ label, enabled, scope }: ActivityInput): string | null {
  const [throttle] = useState(() => createActivityThrottle({ label, enabled, scope }));
  const shown = useSyncExternalStore(throttle.subscribe, throttle.getSnapshot);
  // The timer is an external clock. React subscribes to its bounded updates rather than
  // adjusting state in an effect on every tool event.
  // oxlint-disable-next-line t3code/react-effect-budget -- Apply live activity changes to the external timer store after the render commits.
  useLayoutEffect(() => {
    throttle.update({ label, enabled, scope });
  }, [label, enabled, scope, throttle]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Subscribe to external run activity and update the step activity view.
  useEffect(() => throttle.dispose, [throttle]);
  return enabled && label !== null && shown.scope === scope ? shown.label : null;
}

/**
 * The activity line of one running step: a short, throttled description of what the
 * step's own thread is doing right now.
 */
export function useWorkflowStepActivity(input: {
  readonly environmentId: EnvironmentId;
  /** The thread doing the step: the driving thread, or a subagent's thread. */
  readonly threadId: ThreadId | null;
  readonly startedAt: string | null;
  readonly running: boolean;
}): string | null {
  const source =
    input.running && input.threadId !== null
      ? {
          environmentId: input.environmentId,
          threadId: input.threadId,
          startedAt: input.startedAt,
        }
      : null;
  const label = useStepActivityLabel(source);
  return useThrottledActivityLabel({
    label,
    enabled: input.running,
    scope:
      source === null ? "" : `${source.environmentId}:${source.threadId}:${source.startedAt ?? ""}`,
  });
}
