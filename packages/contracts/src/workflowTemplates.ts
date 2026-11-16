import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import { ScheduledTaskUpsertSchedule } from "./scheduledTask.ts";
import { WorkflowScheduleKnobs } from "./workflowScheduleKnobs.ts";
import { WorkflowDefinition, WorkflowSlug } from "./workflow.ts";
export const WorkflowTemplateUse = Schema.Struct({
  templateId: WorkflowSlug,
  projectId: ProjectId,
});
export const WorkflowSuggestedSchedule = Schema.Struct({
  schedule: ScheduledTaskUpsertSchedule,
  knobs: WorkflowScheduleKnobs,
});
export type WorkflowSuggestedSchedule = typeof WorkflowSuggestedSchedule.Type;
export const WorkflowTemplateUseResult = Schema.Struct({
  slug: WorkflowSlug,
  path: Schema.String,
  suggestedSchedule: Schema.optional(WorkflowSuggestedSchedule),
});
export const WorkflowTemplateSummary = Schema.Struct({
  id: WorkflowSlug,
  version: Schema.Number,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  steps: Schema.Number,
  skills: Schema.Record(Schema.String, Schema.String),
  requires: Schema.Array(Schema.String),
  schedule: Schema.optional(ScheduledTaskUpsertSchedule),
  knobs: Schema.optional(WorkflowScheduleKnobs),
  definition: WorkflowDefinition,
});

export type WorkflowTemplateUse = typeof WorkflowTemplateUse.Type;
export type WorkflowTemplateUseResult = typeof WorkflowTemplateUseResult.Type;
export type WorkflowTemplateSummary = typeof WorkflowTemplateSummary.Type;
