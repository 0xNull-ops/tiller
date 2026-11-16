import {
  WorkflowDefinition,
  ScheduledTaskUpsertSchedule,
  WorkflowScheduleKnobs,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import definitions from "./templates.json" with { type: "json" };

const Template = Schema.Struct({
  id: Schema.String,
  version: Schema.Number,
  skills: Schema.Record(Schema.String, Schema.String),
  requires: Schema.Array(Schema.Literal("loops")),
  definition: WorkflowDefinition,
  schedule: Schema.optional(ScheduledTaskUpsertSchedule),
  knobs: Schema.optional(WorkflowScheduleKnobs),
});
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

export const workflowTemplates = freeze(
  Schema.decodeUnknownSync(Schema.Array(Template))(definitions).map((template) => ({
    ...template,
  })),
);
