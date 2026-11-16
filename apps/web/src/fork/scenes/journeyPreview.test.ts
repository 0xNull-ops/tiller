import { expect, it } from "vite-plus/test";

import { deriveJourneyStops } from "./journey";
import { journeyStopPreview } from "./journeyPreview";

type Items = Parameters<typeof deriveJourneyStops>[0];

function items(...list: ReadonlyArray<Record<string, unknown>>): Items {
  return list.map((item, ordinal) => ({
    item: { id: `item-${ordinal}`, status: "completed", title: null, ...item },
  })) as unknown as Items;
}

it("previews the prompt body and grouped file paths without mixing turns", () => {
  const input = items(
    {
      type: "user_message",
      messageId: "prompt",
      title: "Short title",
      text: "Fix the journey map",
    },
    { type: "file_change", fileName: "src/map.tsx", additions: 8, deletions: 2 },
    { type: "reasoning" },
    {
      type: "file_change",
      fileName: "2 files",
      changes: [{ path: "src/map.css" }, { path: "src/marker.ts" }],
      additions: 10,
    },
    { type: "user_message", messageId: "next", text: "Now change settings" },
    { type: "file_change", fileName: "src/settings.tsx" },
  );
  const { stops } = deriveJourneyStops(input);
  expect(journeyStopPreview(stops[0]!, input).text).toBe("Fix the journey map");
  expect(journeyStopPreview(stops[1]!, input).entries).toEqual([
    { id: "item-1:src/map.tsx", text: "src/map.tsx", detail: "+8 −2" },
    { id: "item-3:src/map.css", text: "src/map.css", detail: null },
    { id: "item-3:src/marker.ts", text: "src/marker.ts", detail: null },
  ]);
});

it("keeps failures visible in grouped commands without calling unfinished commands successful", () => {
  const input = items(
    { type: "command_execution", input: "vp test run", exitCode: 1 },
    { type: "command_execution", input: "vp lint", exitCode: 0 },
    { type: "command_execution", input: "vp build", status: "running" },
    { type: "command_execution", input: "vp test", outputIndicatesFailure: true },
    { type: "command_execution", input: "vp fmt" },
  );
  const { stops } = deriveJourneyStops(input);
  const preview = journeyStopPreview(stops[0]!, input);
  expect(stops[0]!.failed).toBe(true);
  expect(preview.entries.map((entry) => entry.detail)).toEqual([
    "Failed · exit 1",
    "Completed · exit 0",
    "In progress",
    "Failed",
  ]);
  expect(preview.omitted).toBe(1);
  expect(preview.outcome).toBe("2 failed · 1 in progress · 2 completed");
});

it("uses the latest reply in a folded checkpoint and bounds preview text", () => {
  const input = items(
    { type: "assistant_message", messageId: "first" },
    { type: "assistant_message", messageId: "latest" },
    { type: "user_message", text: "a".repeat(1_000) },
  );
  const { stops } = deriveJourneyStops(input);
  expect(journeyStopPreview(stops[0]!, input)).toMatchObject({
    assistantItemId: "item-1",
    assistantMessageId: "latest",
  });
  expect(journeyStopPreview(stops[1]!, input).text?.length).toBeLessThanOrEqual(601);
});
