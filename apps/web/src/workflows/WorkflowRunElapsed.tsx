import type { WorkflowRun } from "@t3tools/contracts";
import {
  formatRunElapsed,
  runElapsedLabel,
  type WorkflowElapsedLabel,
  type WorkflowElapsedTone,
} from "@t3tools/shared/workflowElapsed";

import { cn } from "~/lib/utils";
import { useNowSecond } from "../hooks/useNowSecond";

const TONE_CLASS: Record<WorkflowElapsedTone, string> = {
  running: "text-primary",
  waiting: "text-warning",
  done: "text-muted-foreground",
};

type RunTiming = Pick<WorkflowRun, "status" | "startedAt" | "endedAt">;

/**
 * The run's timer label: `Running 4:12`, amber `Waiting 12:30`, or a frozen `Took 14:02`.
 * Only a live run is mounted with the shared clock, so a finished run never ticks.
 */
export function WorkflowRunElapsed(props: {
  readonly run: RunTiming;
  readonly className?: string | undefined;
}) {
  if (props.run.status === "running" || props.run.status === "waiting") {
    return <LiveRunElapsed run={props.run} className={props.className} />;
  }
  // A finished run's label reads endedAt, so the clock is not needed.
  return <ElapsedLabel label={runElapsedLabel(props.run, 0)} className={props.className} />;
}

function LiveRunElapsed(props: {
  readonly run: RunTiming;
  readonly className?: string | undefined;
}) {
  const nowMs = useNowSecond();
  return <ElapsedLabel label={runElapsedLabel(props.run, nowMs)} className={props.className} />;
}

function ElapsedLabel(props: {
  readonly label: WorkflowElapsedLabel;
  readonly className?: string | undefined;
}) {
  if (props.label.text === "") return null;
  return (
    <span className={cn("tabular-nums", TONE_CLASS[props.label.tone], props.className)}>
      {props.label.text}
    </span>
  );
}

/** A running row's time alone (`4:12`); the sidebar already says the run is running. */
export function WorkflowRunDuration(props: {
  readonly startedAt: string;
  readonly className?: string | undefined;
}) {
  const nowMs = useNowSecond();
  return (
    <span className={cn("tabular-nums", props.className)}>
      {formatRunElapsed(nowMs - Date.parse(props.startedAt))}
    </span>
  );
}
