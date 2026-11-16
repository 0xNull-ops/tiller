/**
 * The elapsed-time label a workflow run shows, shared by web and mobile so the two
 * clients cannot drift on the wording. The clock is wall time from `startedAt`, waits
 * included; a finished run stops at `endedAt`. Callers own the ticking and the colours.
 */
import type { WorkflowRun } from "@t3tools/contracts";

export type WorkflowElapsedTone = "running" | "waiting" | "done";

export interface WorkflowElapsedLabel {
  readonly text: string;
  readonly tone: WorkflowElapsedTone;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;

/** `m:ss` under an hour, then `1h 04m`. Negative or unreadable durations read as zero. */
export function formatRunElapsed(ms: number): string {
  const totalSeconds = Math.floor((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 1000);
  if (totalSeconds < SECONDS_PER_HOUR) {
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function runElapsedLabel(
  run: Pick<WorkflowRun, "status" | "startedAt" | "endedAt">,
  nowMs: number,
): WorkflowElapsedLabel {
  const startedMs = Date.parse(run.startedAt);
  switch (run.status) {
    case "running":
      return { text: `Running ${formatRunElapsed(nowMs - startedMs)}`, tone: "running" };
    case "waiting":
      return { text: `Waiting ${formatRunElapsed(nowMs - startedMs)}`, tone: "waiting" };
    case "done":
    case "failed":
    case "stopped":
      // A finished run with no endedAt has no honest total, so it shows no label.
      if (run.endedAt === undefined) return { text: "", tone: "done" };
      return {
        text: `Took ${formatRunElapsed(Date.parse(run.endedAt) - startedMs)}`,
        tone: "done",
      };
  }
}
