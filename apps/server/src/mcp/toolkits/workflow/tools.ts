import {
  WorkflowTemplateSummary,
  WorkflowTemplateUse,
  WorkflowTemplateUseResult,
  WorkflowTags,
  WorkflowScheduleKnobs,
} from "@t3tools/contracts";
import {
  NonNegativeInt,
  OrchestratorMcpFailure,
  ProjectId,
  ScheduledTaskDeleteResult,
  ScheduledTaskId,
  ScheduledTaskListResult,
  ScheduledTaskMutationResult,
  ScheduledTaskUpsertSchedule,
  ThreadId,
  TrimmedNonEmptyString,
  WorkflowDefinition,
  WorkflowLayout,
  WorkflowLoop,
  WorkflowRunStatus,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowSlug,
  WorkflowStepRun,
  WorkflowStep,
  WorkflowListing,
  ModelSelection,
  WorkflowMcpInventorySnapshot,
  WorkflowReadinessSnapshot,
  WorkflowSkillInfo,
  WorkflowSkillDocument,
  WorkflowBlocker,
  WorkflowDraft,
  WorkflowUpdate,
  WorkflowEdit,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowRunner from "../../../workflows/WorkflowRunner.ts";
import { RUN_AS_GUIDE, NESTED_RUN_GUIDE } from "../../../workflows/workflowDelegation.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const ProjectArgument = Schema.optional(ProjectId).annotate({
  description: "The workflow's project. Omit inside a T3 thread to use the thread's project.",
});
const RunId = TrimmedNonEmptyString.annotate({ description: "A run id from workflow_run." });
const StepId = WorkflowSlug.annotate({ description: "A step id from the workflow." });
const target = { projectId: ProjectArgument, workflow: WorkflowSlug };

/** Only ready steps carry prompts, keeping past skill text out of the agent's context. */
export const WorkflowRunView = Schema.Struct({
  runId: Schema.String,
  driverThreadId: ThreadId,
  parent: WorkflowRun.fields.parent,
  ready: Schema.Array(
    Schema.Struct({
      runId: Schema.String,
      stepId: Schema.String,
      title: Schema.String,
      skill: Schema.String,
      model: Schema.optional(ModelSelection),
      prompt: Schema.String,
      runAs: Schema.Literals(["subagent", "self", "prefer-subagent", "agent-decides"]),
      /** How many work attempts this step has used; a repair keeps the same owner. */
      attempts: NonNegativeInt,
      round: Schema.optional(NonNegativeInt),
      executionToken: Schema.optional(TrimmedNonEmptyString),
      error: Schema.optional(Schema.String),
    }),
  ),
  /** Ready work plus every card type, typed blockers and next actions. */
  context: WorkflowRunContext,
  workflow: Schema.String,
  name: Schema.String,
  status: WorkflowRunStatus,
  startedAt: Schema.String,
  endedAt: Schema.optional(Schema.String),
  subagentModels: WorkflowDefinition.fields.subagentModels,
  subagents: WorkflowRun.fields.subagents,
  exhaustedLoops: WorkflowRun.fields.exhaustedLoops,
  lastRunResult: WorkflowRun.fields.lastRunResult,
  /** Run-start resource observations, including attached credentials (never values). */
  preflight: Schema.optional(WorkflowReadinessSnapshot),
  steps: Schema.Array(
    Schema.Struct({
      ...WorkflowStepRun.fields,
      title: Schema.String,
      skill: Schema.String,
    }),
  ),
});

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    WorkflowRunner.WorkflowRunner,
  ],
};

const INPUT_GUIDE =
  "Inputs accept optional defaultValue (at most 4,000 characters); URL defaults must use http(s). Missing run inputs use their defaults. Unknown properties are rejected; use defaultValue, not default.";

const STEP_GUIDE =
  "Saved T3 workflows live in .t3/workflows. Each step uses a named SKILL.md. readsFrom lists dependencies (default: previous step; []: independent). gate waits for user approval before starting and is drawn as an Approval card before its target; pauseAfter waits after finishing. checks run after a Skill as its Check card and allow up to three attempts. attachments on a step are non-executable Requirement, Service login, MCP connection or Credential resource cards; ids are unique within that step. A credential attachment is { kind: \"credential\", templateId, credentialId?, optional? }: templateId is the portable type (such as app-store-connect or custom) and credentialId is this machine's vault id from credential_list. It never carries a value. Notes live in definition.notes and never execute; edit them with workflow_update. A green check never authorizes an approval gate; only the user's explicit approval in this conversation does.";

const SAVE_FROM_THREAD_GUIDE =
  "After multi-step delegated work the user may want to repeat, offer to save it as a workflow: draft it, show the user and adjust it, then import.";

/**
 * Scratch provenance is explicit: the agent says a save is automatic, and the caller's own thread
 * is the only one it can name. Manual saves carry no origin and stay ordinary workflows.
 */
const ORIGIN_GUIDE =
  'definition.origin is scratch provenance: set it to {kind: "workflow-first", threadId} only when T3 is creating this workflow automatically under Workflow-first, using the threadId workflow_first_read returns. Omit origin when the user asked for the workflow, and never change or drop an existing one; workflow_keep is the only way to clear it.';

const WorkflowDraftFromThreadTool = Tool.make("workflow_draft_from_thread", {
  ...shared,
  description: `Draft a saved T3 workflow for .t3/workflows from a thread's direct delegated tasks. Omit threadId to use the calling thread. Returns proposed steps and skill text without saving. ${SAVE_FROM_THREAD_GUIDE}`,
  parameters: Schema.Struct({ projectId: ProjectArgument, threadId: Schema.optional(ThreadId) }),
  success: WorkflowDraft,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WorkflowFirstReadTool = Tool.make("workflow_first_read", {
  ...shared,
  description:
    "Read whether Workflow-first is enabled for this thread, and this thread's id for a scratch workflow's origin. Uses the current T3 thread and project.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({ enabled: Schema.Boolean, threadId: ThreadId }),
}).annotate(Tool.Readonly, true);
const WorkflowFirstSetTool = Tool.make("workflow_first_set", {
  ...shared,
  description:
    "Turn Workflow-first on or off for this thread. Takes effect with the next submitted message.",
  parameters: Schema.Struct({ enabled: Schema.Boolean }),
  success: Schema.Struct({ enabled: Schema.Boolean }),
});

const WorkflowImportTool = Tool.make("workflow_import", {
  ...shared,
  description: `Save a reviewed, possibly edited draft in .t3/workflows/<workflow>.json, writing missing project skills first. Existing project skills stay untouched; an existing workflow is rejected. ${SAVE_FROM_THREAD_GUIDE} ${ORIGIN_GUIDE}`,
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug,
    definition: WorkflowDefinition,
    skills: Schema.Array(
      Schema.Struct({
        name: WorkflowSlug,
        content: Schema.String.check(Schema.isMaxLength(200_000)),
      }),
    ),
  }),
  success: Schema.Struct({ path: Schema.String, missingSkills: Schema.Array(Schema.String) }),
}).annotate(Tool.Destructive, false);

const WorkflowListTool = Tool.make("workflow_list", {
  ...shared,
  description:
    "List saved T3 workflows (.t3/workflows/*.json) and their steps, plus recent runs. Pass allProjects: true to list across every project on this server. Each workflow's scratch flag says T3 saved it automatically under Workflow-first and the user hasn't kept it yet; pass includeScratch: false to propose only kept workflows as reusable fits.",
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    allProjects: Schema.optional(Schema.Boolean),
    includeScratch: Schema.optional(
      Schema.Boolean.annotate({
        description:
          "Default true lists scratch workflows too, each flagged scratch. False hides them, for matching only kept workflows.",
      }),
    ),
  }),
  success: Schema.Struct({
    workflows: Schema.Array(
      Schema.Struct({
        ...WorkflowListing.fields,
        tags: Schema.Array(Schema.String),
        pinned: Schema.Boolean,
      }),
    ),
    runs: Schema.Array(WorkflowRunView),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WorkflowTagsSetTool = Tool.make("workflow_tags_set", {
  ...shared,
  description:
    "Replace tags on a saved workflow in .t3/workflows. Up to six tags, lowercase letters, digits and hyphens, at most 24 characters each. An empty list clears tags.",
  parameters: Schema.Struct({ ...target, tags: WorkflowTags }),
  success: WorkflowListing,
});
const WorkflowPinSetTool = Tool.make("workflow_pin_set", {
  ...shared,
  description:
    "Pin or unpin a saved .t3/workflows workflow on this server. Pins are personal preferences and never change the workflow file.",
  parameters: Schema.Struct({ ...target, pinned: Schema.Boolean }),
  success: Schema.Struct({}),
});

const WorkflowKeepTool = Tool.make("workflow_keep", {
  ...shared,
  description:
    "Keep a scratch workflow in .t3/workflows so it stops being grouped under From threads. Clears only its origin; steps, notes and past runs are untouched, and keeping it twice succeeds. Only when the user asked to keep it.",
  parameters: Schema.Struct({ projectId: ProjectArgument, workflow: WorkflowSlug }),
  success: WorkflowListing,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.Strict, true);

const WorkflowSaveTool = Tool.make("workflow_save", {
  ...shared,
  description: `Create or replace a workflow in the project, as .t3/workflows/<workflow>.json. ${STEP_GUIDE} Notes are stored in definition.notes; add or change them with workflow_update. Empty steps are allowed so you can build it live with workflow_step_put; an omitted origin is preserved, so a kept workflow stays kept. Missing skills are reported; write them with workflow_skill_save. ${INPUT_GUIDE} ${ORIGIN_GUIDE}`,
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug.annotate({ description: "The file name, such as launch-site." }),
    definition: WorkflowDefinition,
  }),
  success: Schema.Struct({ path: Schema.String, missingSkills: Schema.Array(Schema.String) }),
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.Strict, true);

const WorkflowRunTool = Tool.make("workflow_run", {
  ...shared,
  description: `Run a saved T3 workflow in .t3/workflows. You drive the run. Provide the workflow's declared inputs (workflow_list shows them); omitted inputs use defaultValue when declared. The run re-checks its Requirement and Service login cards first and stops with their reasons instead of starting. An unattended start (a scheduled task firing this thread) is also refused when a required attached credential is missing, ambiguous, incomplete, expired or not allowed here; a manual run starts and its step prompt says what to fix. The result includes context: definition version/revision, ready executable steps, needsUser items and next actions. ${RUN_AS_GUIDE} ${NESTED_RUN_GUIDE} Call workflow_step_start, passing the subagent's childThreadId when delegated. Build workflows live with workflow_save then workflow_step_put so the canvas grows; write missing skills with workflow_skill_save. Gated steps wait for the user; you get a message on approval. Don't approve gates unless the user said so in this conversation; a passing check never approves one.`,
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug,
    inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, false);

const WorkflowStatusTool = Tool.make("workflow_status", {
  ...shared,
  description: `Read a saved T3 workflow run from .t3/workflows: each step's status, thread, attempts, summary, outputs, check results and error, plus ready steps with prompts and runAs. context summarizes the definition version and revision, the driver thread, ready executable work only, typed needsUser items (approval, resume) and actions (repair, validation, resource problems), resource observations (unknown stays unknown), workflow notes and next actions. Notes and resource cards are never ready work. ${RUN_AS_GUIDE} ${NESTED_RUN_GUIDE}`,
  parameters: Schema.Struct({ runId: RunId }),
  success: WorkflowRunView,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WorkflowStopTool = Tool.make("workflow_stop", {
  ...shared,
  description:
    "Stop a saved T3 workflow run from .t3/workflows. Linked subagents are interrupted and unfinished steps skipped.",
  parameters: Schema.Struct({ runId: RunId }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, true);

const WorkflowApproveTool = Tool.make("workflow_approve", {
  ...shared,
  description:
    "Mark a gated step in a saved T3 workflow in .t3/workflows ready. Only call this after the user has approved it in this conversation.",
  parameters: Schema.Struct({ runId: RunId, stepId: StepId }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, true);

const WorkflowResumeTool = Tool.make("workflow_resume", {
  ...shared,
  description:
    "Continue a saved T3 workflow run in .t3/workflows past a step that paused after finishing (pauseAfter).",
  parameters: Schema.Struct({ runId: RunId, stepId: StepId }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, false);

const WorkflowStepDoneTool = Tool.make("workflow_step_done", {
  ...shared,
  description: `For an agent doing a saved T3 workflow skill step from .t3/workflows: report the step finished, with a short summary and named outputs. Call from the driver, the linked step thread, or a child of the driver. Server checks settle the result immediately. If you can't finish, set failed: true and explain in summary. ${NESTED_RUN_GUIDE}`,
  parameters: Schema.Struct({
    runId: RunId,
    stepId: StepId,
    round: Schema.optional(NonNegativeInt),
    executionToken: Schema.optional(TrimmedNonEmptyString),
    summary: Schema.String.check(Schema.isMaxLength(4_000)),
    outputs: Schema.optional(
      Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(2_000))).annotate({
        description: "Name → project-relative, absolute or ~/ path, URL or short text.",
      }),
    ),
    failed: Schema.optional(Schema.Boolean),
  }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, false);

const WorkflowStepPutTool = Tool.make("workflow_step_put", {
  ...shared,
  description: `Insert or replace a step in a saved T3 workflow in .t3/workflows. The workflow must exist. New steps go after the named step, first when null, last when omitted. Replacements keep their position. Set gate here for an Approval card; set checks here for the Skill's Check card; put Requirement, Service login, MCP connection and Credential attachments here too. Attach a credential when the step needs one: { kind: "credential", templateId, credentialId }, where templateId is the type (app-store-connect, custom, …) and credentialId comes from credential_list. Leave credentialId out to keep the file portable; the step then matches exactly one usable credential of that type, asks the user to choose between several, and is blocked when a scheduled run has none. The result includes each step's credential readiness. Use workflow_update for metadata, inputs and notes.`,
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug,
    step: WorkflowStep,
    after: Schema.optional(
      Schema.NullOr(WorkflowSlug).annotate({
        description: "Put the step after this one; null puts it first; omit to append.",
      }),
    ),
  }),
  success: WorkflowListing,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Strict, true);

const WorkflowLayoutSetTool = Tool.make("workflow_layout_set", {
  ...shared,
  description:
    "Arrange saved T3 workflow cards in .t3/workflows with canvas x/y positions. Keys are a step slug, gate:<step>, checks:<step>, or resource:<step>:<attachment>. Positions merge by default; reset: true clears old positions first, and reset with empty positions restores automatic layout. Positions are presentation only: they never change order, dependencies or runs, and keys for cards that no longer exist are dropped. Use it only when the user asks you to tidy the canvas; notes keep their own x/y through workflow_update.",
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug,
    positions: WorkflowLayout,
    reset: Schema.optional(Schema.Boolean),
  }),
  success: WorkflowListing,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);
const WorkflowAgentUpdate = Schema.Union([
  Schema.Struct({
    ...WorkflowUpdate.members[0].fields,
    subagentModels: WorkflowEdit.members[2].fields.subagentModels,
  }),
  WorkflowUpdate.members[1],
  WorkflowUpdate.members[2],
  WorkflowUpdate.members[3],
]);

const WorkflowUpdateTool = Tool.make("workflow_update", {
  ...shared,
  description: `Change a saved T3 workflow's draft metadata, inputs or non-executable notes in .t3/workflows. update is tagged: meta (name, brief, subagentModels, execution; model is a legacy alias for a one-item subagentModels list), inputsSet (the whole input list), notePut (add or replace a note by id) or noteRemove. subagentModels replaces the model choices with up to 16 { driver?, instanceId, model } hints; null clears them. Notes are canvas context; they never execute, become ready or block. Steps, gates, checks and resource attachments stay on workflow_step_put. Origin is never edited here; only workflow_keep clears it. ${INPUT_GUIDE}`,
  parameters: Schema.Struct({ projectId: ProjectArgument, update: WorkflowAgentUpdate }),
  success: WorkflowListing,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Strict, true);

const WorkflowStepRemoveTool = Tool.make("workflow_step_remove", {
  ...shared,
  description:
    "Remove a step from a saved T3 workflow in .t3/workflows, including references in other steps' readsFrom.",
  parameters: Schema.Struct({ projectId: ProjectArgument, workflow: WorkflowSlug, stepId: StepId }),
  success: WorkflowListing,
}).annotate(Tool.Destructive, true);
const WorkflowSkillSaveTool = Tool.make("workflow_skill_save", {
  ...shared,
  description:
    "Write a skill used by saved T3 workflows in .t3/workflows. Name must be a slug. target: project (the default) writes this project's .agents/skills/<name>/SKILL.md, never touching other projects; installed rewrites the SKILL.md where the skill is installed now, which may be global and affect every project; only do that when the user asked.",
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    name: WorkflowSlug,
    content: Schema.String,
    target: Schema.optional(Schema.Literals(["project", "installed"])),
  }),
  success: Schema.Struct({ path: Schema.String }),
}).annotate(Tool.Destructive, false);
const WorkflowSkillPinTool = Tool.make("workflow_skill_pin", {
  ...shared,
  description:
    "Pin or unpin a skill by name for this T3 server. Pins appear in workflow skill pickers in every project where that skill is available; skill files remain in .t3/workflows and their normal skill folders.",
  parameters: Schema.Struct({ name: TrimmedNonEmptyString, pinned: Schema.Boolean }),
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, false);
const WorkflowSkillListTool = Tool.make("workflow_skill_list", {
  ...shared,
  description:
    "List the skills usable by saved T3 workflows in .t3/workflows: name, description, SKILL.md path, project or global scope, and requires.",
  parameters: Schema.Struct({ projectId: ProjectArgument }),
  success: Schema.Struct({ skills: Schema.Array(WorkflowSkillInfo) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const WorkflowSkillReadTool = Tool.make("workflow_skill_read", {
  ...shared,
  description:
    "Read one skill used by saved T3 workflows in .t3/workflows: its info plus the full SKILL.md text.",
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    name: TrimmedNonEmptyString.annotate({ description: "A skill name from workflow_skill_list." }),
  }),
  success: WorkflowSkillDocument,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const WorkflowSkillCopyTool = Tool.make("workflow_skill_copy", {
  ...shared,
  description:
    "Copy a skill's whole folder into this project's .agents/skills/<name> for saved T3 workflows in .t3/workflows so it can be edited for this project only; the project copy then wins.",
  parameters: Schema.Struct({ projectId: ProjectArgument, name: WorkflowSlug }),
  success: Schema.Struct({ path: Schema.String }),
}).annotate(Tool.Destructive, false);
const WorkflowPreflightTool = Tool.make("workflow_preflight", {
  ...shared,
  description:
    "What statically stops a saved T3 workflow in .t3/workflows from running on this server (missing skills, invalid definition, unmet requires:) plus cached Requirement, Service login, MCP and Credential observations. Credential cards report ready, matched automatically, choose, missing, incomplete, expired, expiring, not allowed in this project or vault unavailable, with names and env-var names only. It does not run command or login probes; checks run only when the user asks for workflow_probe or a run starts. An empty blockers list means no static blocker. MCP observations verify provider-reported connection status, not access to files or signed-in accounts.",
  parameters: Schema.Struct({ projectId: ProjectArgument, workflow: WorkflowSlug }),
  success: Schema.Struct({
    blockers: Schema.Array(WorkflowBlocker),
    readiness: WorkflowReadinessSnapshot,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const WorkflowMcpListTool = Tool.make("workflow_mcp_list", {
  ...shared,
  description:
    "List the MCP connections and their tools that the step's effective provider instance reports, as a read-only inventory for a saved T3 workflow in .t3/workflows. Choose the provider with the step's model, the first usable workflow subagent model, or the context thread's model, in that order. Cached reads are cheap; refresh: true asks the selected provider instance once (bounded, single-flight) without invoking a tool, signing in or changing configuration. A live session reports connection status and tools; with no live session the provider's own read-only configuration is read instead, which lists server names only with unknown status and unavailable tools. Online means the provider reported connected; needs-auth, failed, disabled and unknown stay distinct. A provider with no read-only configuration source says so instead of returning a fabricated empty list.",
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug,
    stepId: Schema.optional(StepId),
    refresh: Schema.optional(
      Schema.Boolean.annotate({
        description: "Ask the live provider now instead of serving the cached snapshot.",
      }),
    ),
  }),
  success: WorkflowMcpInventorySnapshot,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);
const WorkflowProbeTool = Tool.make("workflow_probe", {
  ...shared,
  description:
    "Explicitly re-check a saved T3 workflow's resource cards in .t3/workflows: OS and PATH requirements, real tool versions, curated non-interactive CLI login statuses, and honest MCP availability. This is not a side-effect-free read: it runs bounded status commands on this server. It never signs in, stores credentials or returns raw command output; sign-in instructions are for the user. Omit stepIds to check the whole workflow. Missing, signed-out or unverifiable required resources block workflow_run with a reason. MCP observations verify provider-reported connection status, not access to files or signed-in accounts.",
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug,
    stepIds: Schema.optional(
      Schema.Array(WorkflowSlug).annotate({
        description: "Only re-check these steps' resource cards.",
      }),
    ),
  }),
  success: WorkflowReadinessSnapshot,
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);
const WorkflowStepRerunTool = Tool.make("workflow_step_rerun", {
  ...shared,
  description:
    "Start a NEW run of a finished saved T3 workflow in .t3/workflows from this step: the step and everything downstream run again with the skills as they are now, earlier finished results are copied. Use after the user improved a skill or wants a step redone.",
  parameters: Schema.Struct({ runId: RunId, stepId: StepId }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, false);
const WorkflowStepChecksRunTool = Tool.make("workflow_step_checks_run", {
  ...shared,
  description:
    "Run failed checks again against the reported outputs of a saved T3 workflow in .t3/workflows, without rerunning the agent or consuming an attempt. Live runs continue when checks pass; finished runs stay finished.",
  parameters: Schema.Struct({ runId: RunId, stepId: StepId }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, false);
const WorkflowStepSkipTool = Tool.make("workflow_step_skip", {
  ...shared,
  description:
    "Skip a queued, ready or waiting step of a live saved T3 workflow run in .t3/workflows; the run continues. Only when the user asked.",
  parameters: Schema.Struct({ runId: RunId, stepId: StepId }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, true);
const WorkflowStepMoveTool = Tool.make("workflow_step_move", {
  ...shared,
  description:
    "Move a step of a saved T3 workflow in .t3/workflows after another step, or to the start; other steps' readsFrom are kept.",
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: WorkflowSlug,
    stepId: StepId,
    after: Schema.NullOr(WorkflowSlug).annotate({
      description: "Put the step after this one; null puts it first.",
    }),
  }),
  success: WorkflowListing,
}).annotate(Tool.Destructive, false);
const WorkflowDeleteTool = Tool.make("workflow_delete", {
  ...shared,
  description:
    "Delete a saved T3 workflow's file from .t3/workflows and its schedules. Past runs stay in history. Only when the user asked.",
  parameters: Schema.Struct({ projectId: ProjectArgument, workflow: WorkflowSlug }),
  success: Schema.Struct({ deleted: Schema.Boolean }),
}).annotate(Tool.Destructive, true);
const WorkflowStepStartTool = Tool.make("workflow_step_start", {
  ...shared,
  description: `The driving thread follows its runAs and starts a ready step in a saved T3 workflow in .t3/workflows. For skill steps, pass a delegated subagent's childThreadId as threadId; omit to do it yourself. Calling again while a skill step is running updates the linked thread without counting another attempt. For workflow steps, returns the same child run on repeated calls and keeps this driver. ${NESTED_RUN_GUIDE}`,
  parameters: Schema.Struct({ runId: RunId, stepId: StepId, threadId: Schema.optional(ThreadId) }),
  success: WorkflowRunView,
}).annotate(Tool.Destructive, false);

const scheduleGuide =
  "Saved T3 workflows live in .t3/workflows. Schedules wake an existing chat; its main agent drives the workflow, including child runs. The server must be running.";
const WorkflowScheduleListTool = Tool.make("workflow_schedule_list", {
  ...shared,
  description: `List workflow schedules, next run times, and last results. Omit workflow to list all scheduled workflows in the project, or pass allProjects: true to list across every project. ${scheduleGuide}`,
  parameters: Schema.Struct({
    projectId: ProjectArgument,
    workflow: Schema.optional(WorkflowSlug),
    allProjects: Schema.optional(Schema.Boolean),
  }),
  success: ScheduledTaskListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const WorkflowScheduleAddTool = Tool.make("workflow_schedule_add", {
  ...shared,
  description: `Schedule this workflow with its input values. Pass schedule as an object: interval everyMs, fixed_time timeOfDay/weekdays (server local time), or webhook. Omit driverThreadId for this chat. To edit an existing schedule use workflow_schedule_put. Report task.nextRunAt for timers or task.webhook.url for a webhook; if the public URL is absent, explain that T3 Connect remote access is needed. Use request_secret for a signing secret and pass signature.secretRef, never ask for a secret in chat. ${scheduleGuide}`,
  parameters: Schema.Struct({
    ...target,
    driverThreadId: Schema.optional(ThreadId),
    inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    knobs: Schema.optional(WorkflowScheduleKnobs),
    schedule: ScheduledTaskUpsertSchedule,
  }),
  success: ScheduledTaskMutationResult,
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const WorkflowSchedulePutTool = Tool.make("workflow_schedule_put", {
  ...shared,
  description:
    "Create or update a workflow schedule for .t3/workflows. Pass id to edit an existing schedule owned by this workflow. Knobs include window, ends, overlap, carryOver and rotate.",
  parameters: Schema.Struct({
    ...target,
    id: Schema.optional(ScheduledTaskId),
    driverThreadId: Schema.optional(ThreadId),
    inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    knobs: Schema.optional(WorkflowScheduleKnobs),
    schedule: ScheduledTaskUpsertSchedule,
  }),
  success: ScheduledTaskMutationResult,
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const WorkflowScheduleRemoveTool = Tool.make("workflow_schedule_remove", {
  ...shared,
  description: `Delete a schedule belonging to this workflow. To pause it instead, use workflow_schedule_set_enabled. Only when the user asked. ${scheduleGuide}`,
  parameters: Schema.Struct({ ...target, id: ScheduledTaskId }),
  success: ScheduledTaskDeleteResult,
}).annotate(Tool.Destructive, true);
const WorkflowScheduleSetEnabledTool = Tool.make("workflow_schedule_set_enabled", {
  ...shared,
  description: `Pause or resume a schedule belonging to this workflow. ${scheduleGuide}`,
  parameters: Schema.Struct({ ...target, id: ScheduledTaskId, enabled: Schema.Boolean }),
  success: ScheduledTaskMutationResult,
}).annotate(Tool.Destructive, true);

const WorkflowTriggerPutTool = Tool.make("workflow_trigger_put", {
  ...shared,
  description:
    "Start this workflow in .t3/workflows after another workflow in the same project finishes. Cycles and chains longer than two edges are refused.",
  parameters: Schema.Struct({
    ...target,
    afterWorkflow: WorkflowSlug,
    when: Schema.Literals(["succeeded", "finished"]),
    enabled: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ path: Schema.String, missingSkills: Schema.Array(Schema.String) }),
}).annotate(Tool.Destructive, false);
const WorkflowTriggerDeleteTool = Tool.make("workflow_trigger_delete", {
  ...shared,
  description: "Remove this workflow's after-workflow trigger in .t3/workflows.",
  parameters: Schema.Struct({ ...target, afterWorkflow: WorkflowSlug }),
  success: Schema.Struct({ path: Schema.String, missingSkills: Schema.Array(Schema.String) }),
}).annotate(Tool.Destructive, true);

const WorkflowLoopPutTool = Tool.make("workflow_loop_put", {
  ...shared,
  description:
    "Add or update a bounded loop-back connection in a saved T3 workflow in .t3/workflows. `to` must come before `from` in step order, maxRounds is 1 to 20, and loops must nest or be disjoint without crossing.",
  parameters: Schema.Struct({
    ...target,
    loop: WorkflowLoop,
  }),
  success: WorkflowListing,
}).annotate(Tool.Destructive, false);

const WorkflowLoopDeleteTool = Tool.make("workflow_loop_delete", {
  ...shared,
  description: "Remove a loop-back connection from a saved T3 workflow in .t3/workflows.",
  parameters: Schema.Struct({ ...target, loopId: WorkflowSlug }),
  success: WorkflowListing,
}).annotate(Tool.Destructive, true);

export const WorkflowToolkit = Toolkit.make(
  Tool.make("workflow_templates_list", {
    ...shared,
    description:
      "List bundled workflow templates, their definitions, plans and required skills. Copy one with workflow_template_use into .t3/workflows before editing or running it.",
    parameters: Tool.EmptyParams,
    success: Schema.Array(WorkflowTemplateSummary),
  }),
  Tool.make("workflow_template_use", {
    ...shared,
    description:
      "Copy a bundled template into a chosen project as an editable workflow in .t3/workflows. Returns its new slug and optional suggestedSchedule; existing files are preserved and no scheduled task is created. If suggestedSchedule is returned, offer to configure workflow_schedule_add with its schedule and knobs, asking the user to choose a driver chat and inputs.",
    parameters: WorkflowTemplateUse,
    success: WorkflowTemplateUseResult,
  }),
  WorkflowTriggerPutTool,
  WorkflowTriggerDeleteTool,
  WorkflowLoopPutTool,
  WorkflowLoopDeleteTool,
  WorkflowDraftFromThreadTool,
  WorkflowImportTool,
  WorkflowListTool,
  WorkflowTagsSetTool,
  WorkflowPinSetTool,
  WorkflowKeepTool,
  WorkflowFirstReadTool,
  WorkflowFirstSetTool,
  WorkflowSaveTool,
  WorkflowStepPutTool,
  WorkflowUpdateTool,
  WorkflowLayoutSetTool,
  WorkflowStepRemoveTool,
  WorkflowSkillSaveTool,
  WorkflowSkillPinTool,
  WorkflowSkillListTool,
  WorkflowSkillReadTool,
  WorkflowSkillCopyTool,
  WorkflowPreflightTool,
  WorkflowMcpListTool,
  WorkflowProbeTool,
  WorkflowStepStartTool,
  WorkflowRunTool,
  WorkflowStatusTool,
  WorkflowStopTool,
  WorkflowApproveTool,
  WorkflowResumeTool,
  WorkflowStepDoneTool,
  WorkflowStepRerunTool,
  WorkflowStepChecksRunTool,
  WorkflowStepSkipTool,
  WorkflowStepMoveTool,
  WorkflowDeleteTool,
  WorkflowScheduleListTool,
  WorkflowScheduleAddTool,
  WorkflowSchedulePutTool,
  WorkflowScheduleRemoveTool,
  WorkflowScheduleSetEnabledTool,
);
