import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";

import { journeyItemFailed, type JourneyStop } from "./journey";

type Item = ThreadStructureVisibleTurnItem["item"];
const PREVIEW_LIMIT = 4;

export function journeyExcerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}

function itemStatus(item: Item): string {
  if (journeyItemFailed(item)) return "Failed";
  switch (item.status) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    case "waiting":
      return "Waiting";
    case "idle":
    case "pending":
      return "Pending";
    default:
      return "In progress";
  }
}

export function journeyStopPreview(
  stop: JourneyStop,
  items: ReadonlyArray<ThreadStructureVisibleTurnItem>,
) {
  const start = items.findIndex(({ item }) => item.id === stop.id);
  const entries: Array<{ id: string; text: string; detail: string | null }> = [];
  let entryCount = 0;
  const addEntry = (entry: (typeof entries)[number]) => {
    entryCount += 1;
    if (entries.length < PREVIEW_LIMIT) entries.push(entry);
  };
  const outcomes = new Map<string, number>();
  let text: string | null = null;
  let assistantItemId: string | undefined;
  let assistantMessageId: string | undefined;
  if (start !== -1) {
    for (let index = start; index < items.length; index++) {
      const item = items[index]!.item;
      switch (item.type) {
        case "user_message":
          text = journeyExcerpt(item.text || item.title || "Prompt text unavailable");
          break;
        case "assistant_message":
          assistantItemId = item.id;
          assistantMessageId = item.messageId;
          break;
        case "file_change": {
          const paths = [
            ...new Set(
              item.changes?.length ? item.changes.map((change) => change.path) : [item.fileName],
            ),
          ];
          for (const path of paths)
            addEntry({
              id: `${item.id}:${path}`,
              text: path,
              detail:
                paths.length === 1 && (item.additions !== undefined || item.deletions !== undefined)
                  ? `+${item.additions ?? 0} −${item.deletions ?? 0}`
                  : null,
            });
          break;
        }
        case "command_execution": {
          const status = itemStatus(item);
          outcomes.set(status, (outcomes.get(status) ?? 0) + 1);
          addEntry({
            id: item.id,
            text: journeyExcerpt(item.input),
            detail: `${status}${item.exitCode === undefined ? "" : ` · exit ${item.exitCode}`}`,
          });
          break;
        }
        case "file_search":
          text = item.pattern ? journeyExcerpt(item.pattern) : null;
          break;
        case "web_search":
          text = item.patterns ? journeyExcerpt(item.patterns.join(", ")) : null;
          break;
        case "approval_request":
          text = journeyExcerpt(item.prompt || item.reason || "Approval requested");
          break;
        case "error":
          text = journeyExcerpt(item.failure.message);
          break;
        case "dynamic_tool":
          text = item.toolName;
          break;
      }
      if (item.id === stop.lastItemId) break;
    }
  }
  return {
    text,
    entries,
    omitted: Math.max(0, entryCount - PREVIEW_LIMIT),
    outcome:
      outcomes.size === 0
        ? null
        : ["Failed", "In progress", "Waiting", "Pending", "Cancelled", "Interrupted", "Completed"]
            .filter((status) => outcomes.has(status))
            .map((status) => `${outcomes.get(status)} ${status.toLowerCase()}`)
            .join(" · "),
    assistantItemId,
    assistantMessageId,
  };
}
