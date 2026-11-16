import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import { workflowScheduleNextRuns, type ScheduledTaskSchedule } from "@t3tools/contracts";
import { nextScheduledRunAt } from "../scheduledTasks/Schedule.ts";

it("previews the scheduler's next five times across DST and weekdays", () => {
  const from = "2026-03-07T15:00:00.000Z";
  for (const schedule of [
    { type: "interval", everyMs: 900000 },
    { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
    { type: "fixed_time", timeOfDay: "09:00" },
  ] satisfies ScheduledTaskSchedule[]) {
    let cursor = DateTime.setZoneNamedUnsafe(DateTime.makeUnsafe(from), "America/New_York");
    const expected: string[] = [];
    for (let index = 0; index < 5; index++) {
      cursor = nextScheduledRunAt(schedule, cursor) as DateTime.Zoned;
      expected.push(DateTime.formatIso(cursor));
    }
    expect(workflowScheduleNextRuns(schedule, from, "America/New_York")).toEqual(expected);
  }
  expect(workflowScheduleNextRuns({ type: "webhook" }, from, "UTC")).toEqual([]);
});
