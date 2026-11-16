import { useEffect } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";

type JumpListener = (rowId: string) => void;
const listeners = new Set<JumpListener>();

/** Asks the open chat to scroll to a timeline row, such as the prompt that started a turn. */
export function requestTimelineJump(rowId: string): void {
  for (const listener of listeners) listener(rowId);
}

/** Lets the chat timeline answer jump requests from scene widgets like the map. */
export function useTimelineJumpRequests(
  rows: ReadonlyArray<{ readonly id: string }>,
  scrollToIndex: (index: number) => void,
): void {
  const onJump = useStableCallback((rowId: string) => {
    const index = rows.findIndex((row) => row.id === rowId);
    if (index >= 0) scrollToIndex(index);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this timeline with the jump channel while mounted.
  useEffect(() => {
    listeners.add(onJump);
    return () => {
      listeners.delete(onJump);
    };
  }, [onJump]);
}
