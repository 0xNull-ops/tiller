import { describe, expect, it } from "vite-plus/test";

import { BLOCK_MS, carBlock, deriveJourneyStops, journeyBlocks, type JourneyStop } from "./journey";

type Items = Parameters<typeof deriveJourneyStops>[0];

// Only the fields the journey reads; the rest of a turn item does not affect it.
function items(...list: ReadonlyArray<Record<string, unknown>>): Items {
  return list.map((item, ordinal) => ({
    item: { id: `item-${ordinal}`, status: "completed", title: null, ...item },
  })) as unknown as Items;
}

describe("deriveJourneyStops", () => {
  it("starts a turn at each prompt and points its stops at the prompt's chat row", () => {
    const { stops, turns } = deriveJourneyStops(
      items(
        { type: "user_message", messageId: "msg-1" },
        { type: "file_change", fileName: "src/a.ts" },
        { type: "user_message", messageId: "msg-2" },
        { type: "command_execution", input: "vp test run src/a.test.ts" },
      ),
    );
    expect(turns).toBe(2);
    expect(stops.map((stop) => [stop.kind, stop.turn, stop.jumpRowId])).toEqual([
      ["prompt", 1, "msg-1"],
      ["edit", 1, "msg-1"],
      ["prompt", 2, "msg-2"],
      ["command", 2, "msg-2"],
    ]);
  });

  it("folds a run of the same kind into one stop and keeps a failure visible", () => {
    const { stops } = deriveJourneyStops(
      items(
        { type: "user_message", messageId: "msg-1" },
        { type: "file_change", fileName: "a.ts" },
        { type: "file_change", fileName: "b.ts", status: "failed" },
        { type: "reasoning" },
        { type: "file_change", fileName: "c.ts" },
      ),
    );
    expect(stops).toHaveLength(2);
    expect(stops[1]).toMatchObject({
      kind: "edit",
      count: 3,
      failed: true,
      label: "Edited 3 files",
    });
  });

  it("ends each turn at a checkpoint that points at the reply", () => {
    const { stops } = deriveJourneyStops(
      items(
        { type: "user_message", messageId: "msg-1" },
        { type: "assistant_message", messageId: "reply-a" },
        { type: "command_execution", input: "ls" },
        { type: "assistant_message", messageId: "reply-b" },
        { type: "assistant_message", messageId: "reply-c" },
      ),
    );
    expect(stops.map((stop) => [stop.kind, stop.jumpRowId])).toEqual([
      ["prompt", "msg-1"],
      ["checkpoint", "reply-a"],
      ["command", "msg-1"],
      ["checkpoint", "reply-c"],
    ]);
  });
});

function stop(kind: JourneyStop["kind"], at: number): JourneyStop {
  return {
    id: `${kind}-${at}`,
    lastItemId: `${kind}-${at}`,
    kind,
    label: kind,
    turn: 1,
    jumpRowId: null,
    failed: false,
    count: 1,
    at,
  };
}

describe("journey distance", () => {
  it("spaces stops by the time between them, and not by time spent waiting on the user", () => {
    const stops = [
      stop("prompt", 0),
      stop("edit", BLOCK_MS * 4),
      stop("approval", BLOCK_MS * 5),
      stop("command", BLOCK_MS * 60),
    ];
    expect(journeyBlocks(stops)).toEqual([0, 4, 5, 7]);
  });

  it("keeps a working car moving past its last stop and parks a stopped one on it", () => {
    const stops = [stop("prompt", 0), stop("edit", BLOCK_MS * 2)];
    const blocks = journeyBlocks(stops);
    expect(carBlock(stops, blocks, "driving", BLOCK_MS * 5)).toBe(5);
    expect(carBlock(stops, blocks, "parked", BLOCK_MS * 5)).toBe(2);
    expect(carBlock(stops, blocks, "driving", BLOCK_MS * 5, BLOCK_MS * 4)).toBe(3);
  });
});
