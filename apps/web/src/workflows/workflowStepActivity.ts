import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2TurnItem,
  ThreadId,
} from "@t3tools/contracts";
import { commandProgramName } from "@t3tools/client-runtime/work-log/command-label";
import { classifyToolActivity } from "@t3tools/shared/toolActivity";
import * as DateTime from "effect/DateTime";

/** Publish at most two activity labels per second. */
export const STEP_ACTIVITY_THROTTLE_MS = 500;

/** One short phrase. The card is 200px wide and the line must not wrap. */
const STEP_ACTIVITY_MAX_CHARS = 72;

const LIVE_STATUSES: ReadonlySet<OrchestrationV2TurnItem["status"]> = new Set([
  "pending",
  "running",
  "waiting",
]);

/**
 * The driver's own workflow calls are bookkeeping about the run, not the work of the step
 * that is running, so they never become the step's activity line.
 */
const WORKFLOW_TOOL = /(?:^|__|[.:/])workflow_/i;

const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "applypatch",
  "createfile",
  "edit",
  "multiedit",
  "notebookedit",
  "strreplaceeditor",
  "write",
  "writefile",
]);

const FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
  "notebook_path",
  "target_file",
  "file",
] as const;

const PATTERN_KEYS = [
  "pattern",
  "query",
  "searchTerm",
  "regex",
  "glob_pattern",
  "globPattern",
] as const;

type TurnItem = OrchestrationV2TurnItem;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (record === undefined) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function toolNameToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase().replace(/[_\s-]/gu, "");
}

/** The chat calls a file change an edit; the same tool names show up in other providers. */
function isFileEditTool(toolName: string | undefined): boolean {
  const token = toolNameToken(toolName);
  return token !== undefined && FILE_EDIT_TOOLS.has(token);
}

function isWorkflowBookkeepingItem(item: TurnItem): boolean {
  return item.type === "dynamic_tool" && WORKFLOW_TOOL.test(item.toolName ?? "");
}

function isLiveActivityItem(item: TurnItem): boolean {
  return LIVE_STATUSES.has(item.status);
}

/**
 * A step only owns the work that started after it started. Anything older belongs to the
 * step before it, or to the parent thread's own work.
 */
function itemStartMillis(item: TurnItem): number | null {
  const value = item.startedAt ?? item.updatedAt;
  if (value === null || value === undefined) return null;
  return DateTime.toEpochMillis(value);
}

function commandLabel(command: string): string {
  const program = commandProgramName(command);
  return program === null ? "Running a command" : `Running ${program}`;
}

function fileChangeLabel(item: Extract<TurnItem, { readonly type: "file_change" }>): string {
  const paths = item.changes?.map((change) => change.path) ?? [];
  if (paths.length > 1) return `Editing ${paths.length} files`;
  const target = paths[0] ?? item.fileName;
  return `Editing ${target}`;
}

function dynamicToolLabel(
  item: Extract<TurnItem, { readonly type: "dynamic_tool" }>,
): string | null {
  const toolName = item.toolName?.trim() ?? "";
  if (toolName.length === 0) return null;
  const input = asRecord(item.input);
  const path = firstString(input, FILE_PATH_KEYS);
  const pattern = firstString(input, PATTERN_KEYS);
  const action = isFileEditTool(toolName)
    ? "file_change"
    : classifyToolActivity({
        itemType: "dynamic_tool_call",
        title: item.title ?? undefined,
        data: { toolName, input: item.input },
      });
  switch (action) {
    case "read":
      return path === undefined ? "Reading a file" : `Reading ${path}`;
    case "search":
      return pattern === undefined ? "Searching files" : `Searching ${pattern}`;
    case "file_change":
      return path === undefined ? "Editing a file" : `Editing ${path}`;
    case "command": {
      const command = firstString(input, ["command"]);
      return command === undefined ? "Running a command" : commandLabel(command);
    }
    default: {
      const title = item.title?.trim();
      return title === undefined || title.length === 0 ? toolName : title;
    }
  }
}

/**
 * The one-liner for a live item. It mirrors the wording the chat uses for the same work,
 * in the present tense, because the card reads as "what is happening now".
 */
export function stepActivityLabel(item: TurnItem): string | null {
  switch (item.type) {
    case "reasoning":
      return "Thinking";
    case "command_execution":
      return commandLabel(item.input);
    case "file_change":
      return fileChangeLabel(item);
    case "file_search":
      return item.pattern === undefined ? "Searching files" : `Searching ${item.pattern}`;
    case "web_search":
      return "Searching the web";
    case "dynamic_tool":
      return dynamicToolLabel(item);
    default:
      return null;
  }
}

export function capStepActivityText(text: string, maxChars = STEP_ACTIVITY_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

interface StepActivitySource {
  /** The visible turn items of the thread that is doing the step. */
  readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  readonly threadId?: ThreadId;
  /** When the step started. Older work is not this step's work. */
  readonly startedAt: string | null;
}

/**
 * The activity of one step: the newest live item of the step's own thread that started
 * after the step did. Returns null when the step is idle.
 */
export function deriveStepActivityLabel(source: StepActivitySource): string | null {
  const startedAtMillis = source.startedAt === null ? null : Date.parse(source.startedAt);
  const filter = startedAtMillis === null || Number.isNaN(startedAtMillis) ? null : startedAtMillis;
  for (let index = source.items.length - 1; index >= 0; index -= 1) {
    const item = source.items[index]!.item;
    if (source.threadId !== undefined && item.threadId !== source.threadId) continue;
    if (!isLiveActivityItem(item)) continue;
    if (isWorkflowBookkeepingItem(item)) continue;
    if (filter !== null) {
      const itemMillis = itemStartMillis(item);
      if (itemMillis !== null && itemMillis < filter) continue;
    }
    const label = stepActivityLabel(item);
    if (label === null) continue;
    return capStepActivityText(label);
  }
  return null;
}
