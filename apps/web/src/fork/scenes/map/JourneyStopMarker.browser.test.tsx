import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../../test/render";
import { deriveJourneyStops } from "../journey";
import { requestTimelineJump, useTimelineJumpRequests } from "../timelineJump";
import { JourneyStopMarker } from "./JourneyStopMarker";

const state = vi.hoisted(() => ({
  reply: "The journey map now shows previews.",
  checkpoints: [] as ReadonlyArray<ThreadCheckpointSummary>,
}));

vi.mock("../../../state/entities", () => ({
  useAssistantMessageText: (_ref: unknown, itemId: string | undefined) =>
    itemId ? state.reply : null,
  useThreadCheckpointSummaries: () => state.checkpoints,
}));

function setup(...input: ReadonlyArray<Record<string, unknown>>) {
  state.reply = "The journey map now shows previews.";
  state.checkpoints = [];
  return input.map((item, ordinal) => ({
    item: { id: `item-${ordinal}`, status: "completed", title: null, ...item },
  })) as unknown as ReadonlyArray<ThreadStructureVisibleTurnItem>;
}

function Trip({
  items,
  scrollToIndex,
  disabled = false,
}: {
  items: ReadonlyArray<ThreadStructureVisibleTurnItem>;
  scrollToIndex: (index: number) => void;
  disabled?: boolean;
}) {
  const { stops } = deriveJourneyStops(items);
  useTimelineJumpRequests([{ id: "prompt" }, { id: "reply" }], scrollToIndex);
  return (
    <svg width={300} height={200}>
      {stops.map((stop, index) => (
        <JourneyStopMarker
          key={stop.id}
          stop={stop}
          items={items}
          threadRef={null}
          transform={`translate(${50 + index * 60} 100)`}
          disabled={disabled}
          onJump={() => {
            if (stop.jumpRowId) requestTimelineJump(stop.jumpRowId);
          }}
        >
          <circle r={12} />
        </JourneyStopMarker>
      ))}
    </svg>
  );
}

it("opens a stop preview outside the SVG, dismisses it, and jumps to the prompt on click", async () => {
  const items = setup(
    { type: "user_message", messageId: "prompt", text: "Fix the journey map" },
    { type: "command_execution", input: "vp test run map.test.ts", exitCode: 1 },
  );
  const scrollToIndex = vi.fn();
  await using screen = await render(<Trip items={items} scrollToIndex={scrollToIndex} />);
  const command = screen.getByRole("button", { name: "Turn 1 · Ran vp test run" });
  await userEvent.hover(command);
  await expect.element(page.getByText("Failed · exit 1", { exact: true })).toBeVisible();
  expect(document.querySelector('[role="tooltip"]')?.closest("svg")).toBeNull();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
  expect(scrollToIndex).not.toHaveBeenCalled();
  await userEvent.click(command);
  expect(scrollToIndex).toHaveBeenCalledWith(0);
});

it("previews checkpoints on keyboard focus and uses the saved checkpoint totals", async () => {
  const items = setup({ type: "assistant_message", messageId: "reply" });
  state.checkpoints = [
    {
      assistantMessageId: "reply",
      checkpointRef: "refs/checkpoints/test",
      checkpointTurnCount: 1,
      runId: "run",
      status: "ready",
      completedAt: "2026-11-08T12:00:00Z",
      files: [{ path: "src/map.tsx", kind: "modified", additions: 8, deletions: 2 }],
      filesTotal: { count: 6, additions: 20, deletions: 4 },
    },
  ] as unknown as ReadonlyArray<ThreadCheckpointSummary>;
  const scrollToIndex = vi.fn();
  await using _screen = await render(<Trip items={items} scrollToIndex={scrollToIndex} />);
  await userEvent.tab();
  await expect.element(page.getByText("Checkpoint saved", { exact: true })).toBeVisible();
  await expect.element(page.getByText("6 changed files · +20 −4", { exact: true })).toBeVisible();
  await expect.element(page.getByText("+5 more files", { exact: true })).toBeVisible();
  await expect.element(page.getByText(state.reply)).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(scrollToIndex).toHaveBeenCalledWith(1);
  await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
});

it("does not attach a different reply's checkpoint and closes the card during map dragging", async () => {
  const items = setup({ type: "assistant_message", messageId: "narration" });
  state.checkpoints = [
    { assistantMessageId: "reply", status: "ready", files: [] },
  ] as unknown as ReadonlyArray<ThreadCheckpointSummary>;
  const scrollToIndex = vi.fn();
  await using screen = await render(<Trip items={items} scrollToIndex={scrollToIndex} />);
  await userEvent.hover(screen.getByRole("button", { name: "Turn 1 · Replied" }));
  await expect
    .element(page.getByText("Reply · no saved checkpoint available", { exact: true }))
    .toBeVisible();
  await screen.rerender(<Trip items={items} scrollToIndex={scrollToIndex} disabled />);
  await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
  await screen.rerender(<Trip items={items} scrollToIndex={scrollToIndex} />);
  await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
});
