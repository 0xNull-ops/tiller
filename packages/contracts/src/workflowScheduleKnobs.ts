import { IsoDateTime } from "./baseSchemas.ts";
import * as Schema from "effect/Schema";
const TimeOfDay = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));
export const WorkflowScheduleKnobs = Schema.Struct({
  timeZone: Schema.optional(Schema.String),
  window: Schema.optional(Schema.Struct({ from: TimeOfDay, to: TimeOfDay })),
  ends: Schema.optional(
    Schema.Struct({
      afterRuns: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
      at: Schema.optional(IsoDateTime),
    }),
  ),
  overlap: Schema.optional(Schema.Literals(["skip", "queue", "start"])),
  carryOver: Schema.optional(Schema.Boolean),
  rotate: Schema.optional(
    Schema.Struct({
      inputId: Schema.String,
      values: Schema.Array(Schema.String),
      next: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});
export type WorkflowScheduleKnobs = typeof WorkflowScheduleKnobs.Type;
