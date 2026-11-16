import * as DateTime from "effect/DateTime";
import type { ScheduledTaskUpsertSchedule } from "./scheduledTask.ts";

export function workflowScheduleNextRuns(
  schedule: ScheduledTaskUpsertSchedule,
  from: string,
  timeZone: string,
  count = 5,
): ReadonlyArray<string> {
  if (schedule.type === "webhook") return [];
  if (schedule.type === "once")
    return Date.parse(schedule.runAt) > Date.parse(from) ? [schedule.runAt] : [];
  const results: string[] = [];
  let cursor = DateTime.setZoneNamedUnsafe(DateTime.makeUnsafe(from), timeZone);
  for (let i = 0; i < count; i++) {
    if (schedule.type === "interval")
      cursor = DateTime.addDuration(cursor, Math.max(60_000, schedule.everyMs));
    else {
      const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
      let found = false;
      for (let offset = 0; offset <= 7; offset++) {
        const candidate = DateTime.setParts(DateTime.add(cursor, { days: offset }), {
          hour: hour!,
          minute: minute!,
          second: 0,
          millisecond: 0,
        });
        if (DateTime.toEpochMillis(candidate) <= DateTime.toEpochMillis(cursor)) continue;
        if (
          schedule.weekdays?.length &&
          !schedule.weekdays.includes(DateTime.toParts(candidate).weekDay)
        )
          continue;
        cursor = candidate;
        found = true;
        break;
      }
      if (!found) return results;
    }
    results.push(DateTime.formatIso(cursor));
  }
  return results;
}
