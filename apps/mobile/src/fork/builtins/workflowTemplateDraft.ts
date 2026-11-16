import type {
  ProjectId,
  ThreadId,
  WorkflowDefinition,
  WorkflowScheduleKnobs,
} from "@t3tools/contracts";
export interface WorkflowTemplateDraft {
  readonly workflow: string;
  readonly projectId: ProjectId;
  readonly fields: NonNullable<WorkflowDefinition["inputs"]>;
  readonly inputs: Readonly<Record<string, string>>;
  readonly driverThreadId: ThreadId | null;
  readonly knobs: WorkflowScheduleKnobs;
}
