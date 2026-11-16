import type {
  ThreadRuntimeSummary,
  ThreadStructureVisibleTurnItem,
} from "@t3tools/client-runtime/state/models";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import * as DateTime from "effect/DateTime";

/**
 * A thread as a trip. Time is distance: while the agent works its car covers one block every
 * `BLOCK_MS`, each thing it does is pinned where the car was at the time, and the reply that ends a
 * turn is a checkpoint. Every scene draws this same model in its own style.
 */
export const BLOCK_MS = 2_500;
// Time spent waiting on the user (an approval, or between turns) is not driving.
const MAX_IDLE_GAP_BLOCKS = 2;
const MAX_STOPS = 60;

export type JourneyStopKind =
  | "prompt"
  | "edit"
  | "command"
  | "search"
  | "tool"
  | "agent"
  | "approval"
  | "error"
  | "checkpoint";

export type JourneyStop = {
  id: string;
  lastItemId: string;
  kind: JourneyStopKind;
  label: string;
  /** 1-based turn number, counted by user prompts. */
  turn: number;
  /** The chat row a click should scroll to. */
  jumpRowId: string | null;
  failed: boolean;
  /** How many items of the same kind this stop stands for. */
  count: number;
  /** When it happened, in epoch milliseconds, when known. */
  at: number | null;
};

export type JourneyStatus = "driving" | "waiting" | "failed" | "parked";

type Item = ThreadStructureVisibleTurnItem["item"];

function basename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function shortCommand(command: string): string {
  return command.trim().split(/\s+/).slice(0, 3).join(" ");
}

function classify(item: Item): { kind: JourneyStopKind; label: string } | null {
  switch (item.type) {
    case "user_message":
      return { kind: "prompt", label: item.title ?? "Prompt" };
    case "assistant_message":
      return { kind: "checkpoint", label: "Replied" };
    case "file_change":
      return { kind: "edit", label: `Edited ${basename(item.fileName)}` };
    case "command_execution":
      return { kind: "command", label: `Ran ${shortCommand(item.input)}` };
    case "file_search":
      return { kind: "search", label: "Searched files" };
    case "web_search":
      return { kind: "search", label: "Searched the web" };
    case "dynamic_tool":
      return { kind: "tool", label: item.toolName ? `Used ${item.toolName}` : "Used a tool" };
    case "subagent":
      return { kind: "agent", label: "Sent a subagent" };
    case "approval_request":
      return { kind: "approval", label: "Asked for approval" };
    case "error":
      return { kind: "error", label: "Hit an error" };
    default:
      return null;
  }
}

export function journeyItemFailed(item: Item): boolean {
  if (item.status === "failed") return true;
  return (
    item.type === "command_execution" &&
    (item.outputIndicatesFailure === true || (item.exitCode !== undefined && item.exitCode !== 0))
  );
}

function timeOf(item: Item): number | null {
  return item.startedAt ? DateTime.toEpochMillis(item.startedAt) : null;
}

/** Turns a thread's visible items into stops, folding runs of the same kind into one stop. */
export function deriveJourneyStops(items: ReadonlyArray<ThreadStructureVisibleTurnItem>): {
  stops: ReadonlyArray<JourneyStop>;
  turns: number;
} {
  const stops: JourneyStop[] = [];
  let turn = 0;
  let promptRowId: string | null = null;
  for (const { item } of items) {
    const stop = classify(item);
    if (!stop) continue;
    // Chat rows are keyed by message id, not turn item id.
    if (item.type === "user_message") {
      turn += 1;
      promptRowId = item.messageId;
    }
    const jumpRowId = item.type === "assistant_message" ? item.messageId : promptRowId;
    const failed = journeyItemFailed(item);
    const last = stops.at(-1);
    if (
      last &&
      last.kind === stop.kind &&
      stop.kind !== "prompt" &&
      last.turn === Math.max(turn, 1)
    ) {
      // A turn's last reply is its checkpoint, so later narration moves the checkpoint forward.
      stops[stops.length - 1] = {
        ...last,
        lastItemId: item.id,
        count: last.count + 1,
        failed: last.failed || failed,
        label: stop.kind === "edit" ? `Edited ${last.count + 1} files` : stop.label,
        ...(stop.kind === "checkpoint" ? { at: timeOf(item) ?? last.at, jumpRowId } : {}),
      };
      continue;
    }
    stops.push({
      id: item.id,
      lastItemId: item.id,
      ...stop,
      turn: Math.max(turn, 1),
      jumpRowId,
      failed,
      count: 1,
      at: timeOf(item),
    });
  }
  return { stops: stops.slice(-MAX_STOPS), turns: turn };
}

/** The block each stop sits on: the gap between stops is the time between them, at least one block. */
export function journeyBlocks(stops: ReadonlyArray<JourneyStop>): ReadonlyArray<number> {
  const blocks: number[] = [];
  stops.forEach((stop, index) => {
    if (index === 0) {
      blocks.push(0);
      return;
    }
    const prev = stops[index - 1]!;
    const elapsed = stop.at !== null && prev.at !== null ? (stop.at - prev.at) / BLOCK_MS : 1;
    const idle = prev.kind === "approval" || prev.kind === "checkpoint";
    const gap = Math.max(1, Math.round(idle ? Math.min(MAX_IDLE_GAP_BLOCKS, elapsed) : elapsed));
    blocks.push(blocks[index - 1]! + gap);
  });
  return blocks;
}

/**
 * Where the car is, in blocks. A working thread keeps driving past its last stop as time passes;
 * a stopped one sits on its last stop. `resumedAt` is when the current run of activity began, so
 * time spent waiting at an approval is not counted as distance.
 */
export function carBlock(
  stops: ReadonlyArray<JourneyStop>,
  blocks: ReadonlyArray<number>,
  status: JourneyStatus,
  now: number,
  resumedAt: number | null = null,
): number {
  const last = blocks.at(-1) ?? 0;
  const lastAt = stops.at(-1)?.at ?? null;
  if (status !== "driving" || lastAt === null) return last;
  const from = resumedAt !== null ? Math.max(lastAt, resumedAt) : lastAt;
  return last + Math.max(0, (now - from) / BLOCK_MS);
}

/** Whole-thread state, from the cheap shell fields every thread has. */
export function journeyStatus(shell: {
  runtime: ThreadRuntimeSummary | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): JourneyStatus {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return "waiting";
  if (shell.runtime?.status === "failed") return "failed";
  return threadRuntimeIsActive(shell.runtime) ? "driving" : "parked";
}
