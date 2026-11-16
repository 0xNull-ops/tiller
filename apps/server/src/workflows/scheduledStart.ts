import * as DateTime from "effect/DateTime";
import type {
  OrchestrationV2ThreadProjection,
  WorkflowCarryOverResult,
  WorkflowRun,
  WorkflowScheduleBinding,
} from "@t3tools/contracts";

/**
 * True when this thread's latest visible user message came from a scheduled task. A run start has
 * no other signal for "nobody is watching": the schedule prompt arrives as a user message that
 * carries its task id, so an unattended start can be held to a stricter standard than a click.
 */
export const scheduledTurnStart = (
  projection: Pick<OrchestrationV2ThreadProjection, "visibleTurnItems">,
): boolean => {
  let latest: (typeof projection.visibleTurnItems)[number] | undefined;
  for (const entry of projection.visibleTurnItems) {
    if (entry.visibility !== "local" || entry.item.type !== "user_message") continue;
    if (latest === undefined || entry.position > latest.position) latest = entry;
  }
  return latest?.item.type === "user_message" && latest.item.scheduledTaskId !== undefined;
};

export function scheduledStartDecision(input: {
  readonly binding: import("@t3tools/contracts").WorkflowScheduleBinding;
  readonly now: string;
  readonly runCount: number;
  readonly active: boolean;
}): "start" | "window" | "ended" | "skip" | "queue" {
  const { binding, now, runCount, active } = input;
  if (
    (binding.ends?.afterRuns !== undefined && runCount >= binding.ends.afterRuns) ||
    (binding.ends?.at !== undefined && now >= binding.ends.at)
  )
    return "ended";
  const time = DateTime.format(
    DateTime.setZoneNamedUnsafe(
      DateTime.makeUnsafe(now),
      binding.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  );
  const window = binding.window;
  if (
    window &&
    !(window.from <= window.to
      ? time >= window.from && time < window.to
      : time >= window.from || time < window.to)
  )
    return "window";
  if (active && binding.overlap !== "start") return binding.overlap === "queue" ? "queue" : "skip";
  return "start";
}

export function resolveScheduledCarryOver(
  binding: Pick<WorkflowScheduleBinding, "carryOver" | "projectId" | "workflow">,
  runs: Iterable<WorkflowRun>,
): WorkflowCarryOverResult | undefined {
  if (!binding.carryOver) return undefined;
  const finished = [...runs]
    .filter(
      (run) =>
        run.parent === undefined &&
        run.projectId === binding.projectId &&
        run.workflow === binding.workflow &&
        run.status === "done",
    )
    .toSorted((left, right) =>
      (right.endedAt ?? right.startedAt).localeCompare(left.endedAt ?? left.startedAt),
    );
  const latest = finished[0];
  if (!latest) return undefined;
  const lastStep =
    [...latest.steps]
      .toReversed()
      .find(
        (step) =>
          step.status === "done" &&
          ((step.summary !== undefined && step.summary.trim() !== "") ||
            (step.outputs !== undefined && Object.keys(step.outputs).length > 0)),
      ) ?? [...latest.steps].toReversed().find((step) => step.status === "done");
  const outputs =
    lastStep?.outputs && Object.keys(lastStep.outputs).length > 0 ? lastStep.outputs : undefined;
  const summary =
    lastStep?.summary?.trim() ||
    Object.entries(outputs ?? {})
      .map(([name, value]) => `${name}: ${value}`)
      .join(", ") ||
    "Completed.";
  return {
    runId: latest.id,
    endedAt: latest.endedAt ?? latest.startedAt,
    summary,
    ...(outputs === undefined ? {} : { outputs }),
  };
}

export function formatCarryOverBrief(result: WorkflowCarryOverResult): string {
  const outputEntries = Object.entries(result.outputs ?? {});
  const outputList =
    outputEntries.length === 0
      ? ""
      : `\nOutputs:\n${outputEntries.map(([name, value]) => `- ${name}: ${value}`).join("\n")}`;
  return `Last run (${result.endedAt}) result: ${result.summary}${outputList}`;
}

export function applyScheduledRotation(
  binding: WorkflowScheduleBinding,
  inputs: Readonly<Record<string, string>> = binding.inputs,
): {
  readonly inputs: Readonly<Record<string, string>>;
  readonly rotatedValue: string | undefined;
  readonly nextBinding: WorkflowScheduleBinding;
  readonly changed: boolean;
} {
  const rotate = binding.rotate;
  if (!rotate || rotate.values.length === 0) {
    return { inputs, rotatedValue: undefined, nextBinding: binding, changed: false };
  }
  const index =
    ((rotate.next % rotate.values.length) + rotate.values.length) % rotate.values.length;
  const rotatedValue = rotate.values[index]!;
  const nextIndex = (index + 1) % rotate.values.length;
  const nextInputs = { ...inputs, [rotate.inputId]: rotatedValue };
  return {
    inputs: nextInputs,
    rotatedValue,
    nextBinding: {
      ...binding,
      inputs: { ...binding.inputs, [rotate.inputId]: rotatedValue },
      rotate: {
        ...rotate,
        next: nextIndex,
      },
    },
    changed: true,
  };
}

export function scheduledTaskSource(
  projection: Pick<OrchestrationV2ThreadProjection, "visibleTurnItems">,
) {
  const latest = projection.visibleTurnItems
    .filter((entry) => entry.visibility === "local" && entry.item.type === "user_message")
    .toSorted((a, b) => b.position - a.position)[0];
  return latest?.item.type === "user_message" && latest.item.scheduledTaskId
    ? { scheduleTaskId: latest.item.scheduledTaskId }
    : {};
}
