import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

import {
  applyScheduledRotation,
  formatCarryOverBrief,
  resolveScheduledCarryOver,
  scheduledStartDecision,
  scheduledTurnStart,
} from "./scheduledStart.ts";

type Entry =
  | {
      readonly kind: "user";
      readonly scheduledTaskId?: string;
      readonly visibility?: "local" | "inherited";
    }
  | { readonly kind: "assistant" };

const entry = (position: number, input: Entry): OrchestrationV2ProjectedTurnItem =>
  ({
    position,
    visibility: input.kind === "user" ? (input.visibility ?? "local") : "local",
    sourceThreadId: "thread-1",
    sourceItemId: `item-${position}`,
    item:
      input.kind === "user"
        ? {
            type: "user_message",
            ...(input.scheduledTaskId === undefined
              ? {}
              : { scheduledTaskId: input.scheduledTaskId }),
          }
        : { type: "assistant_message" },
  }) as never;

describe("scheduledTurnStart", () => {
  it("recognizes a schedule-fired prompt as the latest message", () => {
    expect(
      scheduledTurnStart({
        visibleTurnItems: [
          entry(1, { kind: "user" }),
          entry(2, { kind: "assistant" }),
          entry(3, { kind: "user", scheduledTaskId: "task-1" }),
        ],
      }),
    ).toBe(true);
  });

  it("treats a later typed message as an attended run", () => {
    expect(
      scheduledTurnStart({
        visibleTurnItems: [
          entry(3, { kind: "user", scheduledTaskId: "task-1" }),
          entry(4, { kind: "user" }),
        ],
      }),
    ).toBe(false);
  });

  it("ignores messages inherited from another thread and empty transcripts", () => {
    expect(scheduledTurnStart({ visibleTurnItems: [] })).toBe(false);
    expect(
      scheduledTurnStart({
        visibleTurnItems: [
          entry(1, { kind: "user", scheduledTaskId: "task-1", visibility: "inherited" }),
        ],
      }),
    ).toBe(false);
  });
});

it("enforces end limits, overnight windows and overlap", () => {
  const binding = {
    version: 2 as const,
    timeZone: "UTC",
    projectId: "p" as import("@t3tools/contracts").ProjectId,
    workflow: "flow",
    inputs: {},
  };
  const base = { binding, now: "2026-01-01T12:00:00.000Z", runCount: 0, active: false };
  expect(scheduledStartDecision(base)).toBe("start");
  expect(scheduledStartDecision({ ...base, active: true })).toBe("skip");
  expect(
    scheduledStartDecision({ ...base, active: true, binding: { ...binding, overlap: "queue" } }),
  ).toBe("queue");
  expect(
    scheduledStartDecision({ ...base, active: true, binding: { ...binding, overlap: "start" } }),
  ).toBe("start");
  expect(
    scheduledStartDecision({
      ...base,
      binding: { ...binding, ends: { afterRuns: 1 } },
      runCount: 1,
    }),
  ).toBe("ended");
  expect(
    scheduledStartDecision({
      ...base,
      binding: { ...binding, ends: { at: "2026-01-01T00:00:00.000Z" } },
    }),
  ).toBe("ended");
  expect(
    scheduledStartDecision({
      ...base,
      binding: { ...binding, window: { from: "22:00", to: "06:00" } },
    }),
  ).toBe("window");
  expect(
    scheduledStartDecision({
      ...base,
      now: "2026-01-01T23:00:00.000Z",
      binding: { ...binding, window: { from: "22:00", to: "06:00" } },
    }),
  ).toBe("start");
});

it("resolves carry-over from the latest finished done run and rotates scheduled inputs", () => {
  const projectId = "p" as import("@t3tools/contracts").ProjectId;
  const binding = {
    version: 2 as const,
    timeZone: "UTC",
    projectId,
    workflow: "flow",
    inputs: { area: "Initial" },
    carryOver: true,
    rotate: { inputId: "area", values: ["Billing", "Onboarding", "Search"], next: 1 },
  };
  const carryOver = resolveScheduledCarryOver(binding, [
    {
      id: "run-failed",
      projectId,
      workflow: "flow",
      driverThreadId: "t1" as import("@t3tools/contracts").ThreadId,
      definition: { version: 3, name: "Flow", steps: [{ id: "audit", skill: "s" }] },
      skills: [],
      status: "failed",
      startedAt: "2026-10-28T10:00:00.000Z",
      endedAt: "2026-10-28T10:05:00.000Z",
      steps: [{ stepId: "audit", status: "failed", threadId: null, attempts: 1, summary: "Bad" }],
    },
    {
      id: "run-done",
      projectId,
      workflow: "flow",
      driverThreadId: "t1" as import("@t3tools/contracts").ThreadId,
      definition: { version: 3, name: "Flow", steps: [{ id: "audit", skill: "s" }] },
      skills: [],
      status: "done",
      startedAt: "2026-10-27T10:00:00.000Z",
      endedAt: "2026-10-27T10:05:00.000Z",
      steps: [
        {
          stepId: "audit",
          status: "done",
          threadId: null,
          attempts: 1,
          summary: "Cleaned up billing",
          outputs: { pr: "https://example.test/pr/1" },
        },
      ],
    },
  ]);
  expect(carryOver).toEqual({
    runId: "run-done",
    endedAt: "2026-10-27T10:05:00.000Z",
    summary: "Cleaned up billing",
    outputs: { pr: "https://example.test/pr/1" },
  });
  expect(formatCarryOverBrief(carryOver!)).toBe(
    "Last run (2026-10-27T10:05:00.000Z) result: Cleaned up billing\nOutputs:\n- pr: https://example.test/pr/1",
  );

  const rotated = applyScheduledRotation(binding, { area: "Initial" });
  expect(rotated.inputs).toEqual({ area: "Onboarding" });
  expect(rotated.nextBinding.rotate).toEqual({
    inputId: "area",
    values: ["Billing", "Onboarding", "Search"],
    next: 2,
  });
});
