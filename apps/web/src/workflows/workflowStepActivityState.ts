import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../state/threads";
import { deriveStepActivityLabel } from "./workflowStepActivity";

const EMPTY_LABEL_ATOM = Atom.make<string | null>(null).pipe(
  Atom.withLabel("workflow-step-activity:empty"),
);

export interface StepActivitySource {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly startedAt: string | null;
}

function sourceKey(source: StepActivitySource): string {
  return `${source.environmentId}\u0000${source.threadId}\u0000${source.startedAt ?? ""}`;
}

function parseSourceKey(key: string): StepActivitySource {
  const [environmentId = "", threadId = "", startedAt = ""] = key.split("\u0000");
  return {
    environmentId: environmentId as EnvironmentId,
    threadId: threadId as ThreadId,
    startedAt: startedAt.length === 0 ? null : startedAt,
  };
}

/**
 * The label of a running step, read from the live turn items of the thread that is doing
 * the step. One thread is read at a time, and only while its step runs, so the canvas
 * never holds a subscription to the whole store.
 */
const stepActivityLabelAtom = Atom.family((key: string) => {
  const source = parseSourceKey(key);
  return Atom.map(
    environmentThreadDetails.visibleTurnItemsAtom({
      environmentId: source.environmentId,
      threadId: source.threadId,
    }),
    (items) =>
      deriveStepActivityLabel({ items, startedAt: source.startedAt, threadId: source.threadId }),
  ).pipe(Atom.setIdleTTL(0), Atom.withLabel(`workflow-step-activity:${key}`));
});

/**
 * The live activity of one step, or null when nothing is running. A null source reads
 * nothing at all, which is what a step that is not running needs.
 */
export function useStepActivityLabel(source: StepActivitySource | null): string | null {
  return useAtomValue(
    source === null ? EMPTY_LABEL_ATOM : stepActivityLabelAtom(sourceKey(source)),
  );
}
