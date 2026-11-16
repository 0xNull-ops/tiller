import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import type { ScheduledTask } from "./scheduledTask.ts";
import { WorkflowSlug } from "./workflow.ts";

const PREFIX = "T3_WORKFLOW_SCHEDULE ";

import { WorkflowScheduleKnobs } from "./workflowScheduleKnobs.ts";
export { WorkflowScheduleKnobs } from "./workflowScheduleKnobs.ts";
export const WorkflowScheduleBinding = Schema.Struct({
  ...WorkflowScheduleKnobs.fields,
  version: Schema.Literals([1, 2]),
  projectId: ProjectId,
  workflow: WorkflowSlug,
  inputs: Schema.Record(Schema.String, Schema.String),
});
export type WorkflowScheduleBinding = typeof WorkflowScheduleBinding.Type;

const decodeBinding = Schema.decodeUnknownOption(Schema.fromJsonString(WorkflowScheduleBinding));

/** A strict marker keeps workflow schedules distinct from other thread automations. */
export function workflowScheduleBinding(
  task: Pick<ScheduledTask, "prompt" | "projectId" | "threadId">,
): WorkflowScheduleBinding | null {
  if (task.threadId === null || !task.prompt.startsWith(PREFIX)) return null;
  const firstLine = task.prompt.split("\n", 1)[0]!;
  const decoded = decodeBinding(firstLine.slice(PREFIX.length));
  return Option.isSome(decoded) && decoded.value.projectId === task.projectId
    ? { ...decoded.value, version: 2 }
    : null;
}

export function workflowSchedulePrompt(binding: WorkflowScheduleBinding): string {
  return `${PREFIX}${JSON.stringify(binding)}\n\nRun the ${binding.workflow} workflow in this chat.\nCall workflow_run with ${JSON.stringify(
    {
      projectId: binding.projectId,
      workflow: binding.workflow,
      inputs: binding.inputs,
    },
  )}. Use this thread as the driver and continue until the run finishes or needs user approval. Follow the ready-step runId when driving nested workflows.`;
}

export { workflowScheduleNextRuns } from "./workflowSchedulePreview.ts";
