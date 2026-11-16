import { workflowTemplates } from "@t3tools/shared/workflowTemplates";
import { type WorkflowTemplateUse, type WorkflowTemplateUseResult } from "@t3tools/contracts";
import {
  applyScheduledRotation,
  formatCarryOverBrief,
  resolveScheduledCarryOver,
  scheduledStartDecision,
} from "./scheduledStart.ts";
import * as Clock from "effect/Clock";
import { workflowResumeAt } from "@t3tools/contracts";
import type {
  WorkflowCarryOverResult,
  WorkflowLoop,
  WorkflowScheduleKnobs,
  WorkflowStepRoundSummary,
} from "@t3tools/contracts";
import {
  CommandId,
  MessageId,
  type WorkflowSubagentModel,
  type WorkflowSubagentsSnapshot,
  type ServerProvider,
  MAX_WORKFLOW_NESTING_EDGES,
  MAX_WORKFLOW_STEP_ATTEMPTS,
  type CredentialId,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type ScheduledTaskDeleteResult,
  type ScheduledTaskError,
  type ScheduledTaskId,
  type ScheduledTaskListResult,
  type ScheduledTaskMutationResult,
  type ScheduledTaskUpsertSchedule,
  type ThreadId,
  type ProjectId,
  type WorkflowCheckResult,
  WorkflowDefinition,
  type WorkflowDelegation,
  type WorkflowInput,
  type WorkflowRun,
  type WorkflowSlug,
  type WorkflowStep,
  type WorkflowStepCheck,
  type WorkflowStepRun,
  type WorkflowNote,
  type WorkflowLayout,
  type WorkflowListing,
  type WorkflowsSnapshot,
  upgradeWorkflowDefinition,
  workflowScheduleBinding,
  workflowSemanticDefinition,
  type ModelSelection,
  type WorkflowBlocker,
  type WorkflowMcpInventorySnapshot,
  type WorkflowReadinessSnapshot,
  type WorkflowSkillDocument,
  type WorkflowSkillInfo,
  type WorkflowPreferences as WorkflowPreferencesValue,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { resolveSubagentModels } from "@t3tools/shared/workflowSubagents";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { resolveWorkspaceFilePath } from "@t3tools/shared/path";
import { CommandAvailability } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts"; // fork(workflow-first)
import { CredentialPolicySession } from "../credentials/CredentialPolicySession.ts";
import * as CredentialStore from "../credentials/CredentialStore.ts";
import * as CredentialUnlock from "../credentials/CredentialUnlock.ts";
import * as CredentialRedaction from "../credentials/CredentialRedaction.ts";
import * as WorkflowCredentialPreapprovals from "../credentials/WorkflowCredentialPreapprovals.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as SkillCatalog from "./SkillCatalog.ts";
import * as CredentialAttachments from "./credentialAttachments.ts";
import { resolveRunAs } from "./workflowDelegation.ts";
import {
  buildRunContext,
  clip,
  failedCheckProblems,
  initialWakeMessage,
  MAX_WAKE_CHARS,
  updateWakeMessage,
} from "./driverContext.ts";
import { buildStepPrompt, buildWorkflowStepPrompt } from "./stepPrompt.ts";
import {
  enclosingLoopForStep,
  loopRangeStepIds,
  nextActions,
  parseStepVerdict,
  renderInputValue,
  resolveRunInputs,
  stepDependencies,
  validateNesting,
  validateRunInputs,
  validateWorkflow,
} from "./workflowGraph.ts";
import * as WorkflowSchedules from "./WorkflowSchedules.ts";
import * as WorkflowStore from "./WorkflowStore.ts";
import * as WorkflowPreferences from "./WorkflowPreferences.ts";
import {
  assertSubagentModelCap,
  WorkflowSubagentModelCapError,
} from "./workflowSubagentModelCap.ts";
import * as WorkflowOutputPreviews from "./WorkflowOutputPreviews.ts";
import * as WorkflowReadiness from "./WorkflowReadiness.ts";
import * as WorkflowMcpConfigDiscovery from "./WorkflowMcpConfigDiscovery.ts";
import * as WorkflowMcpInventory from "./WorkflowMcpInventory.ts";
import * as WorkflowPreparation from "./WorkflowPreparation.ts";

const DEFAULT_CHECK_TIMEOUT_SEC = 300;
const CHECK_OUTPUT_TAIL = 400;
/** Kept in the step so a driver reading status after a restart knows why it is ready again. */
const VALIDATION_INTERRUPTED =
  "Validation was interrupted before it finished. Review the outputs and run the step again.";
/** The web app matches this text to turn the refusal into its unlock dialog. */
const PREAPPROVAL_UNLOCK_PROBLEM =
  "Unlock the credential vault to pre-approve workflow credentials.";

/** One in-flight check run. The token is persisted, so a late result can be discarded. */
type ValidationHandle = {
  readonly runId: string;
  readonly stepId: string;
  readonly token: string;
  readonly cancel: Deferred.Deferred<void>;
};

export class WorkflowSkillsMissingError extends Schema.TaggedError<WorkflowSkillsMissingError>()(
  "WorkflowSkillsMissingError",
  { workflow: Schema.String, skills: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Workflow "${this.workflow}" uses skills that aren't installed: ${this.skills.join(", ")}. Add each as .agents/skills/<name>/SKILL.md in the project.`;
  }
}

export class WorkflowInputsError extends Schema.TaggedError<WorkflowInputsError>()(
  "WorkflowInputsError",
  { workflow: Schema.String, problems: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Workflow "${this.workflow}" inputs aren't ready: ${this.problems.join(" ")}`;
  }
}

export class WorkflowNestingError extends Schema.TaggedError<WorkflowNestingError>()(
  "WorkflowNestingError",
  { workflow: Schema.String, problem: Schema.String },
) {
  override get message(): string {
    return `Workflow "${this.workflow}" can't nest deeper than two levels: ${this.problem}`;
  }
}

export class WorkflowBlockedError extends Schema.TaggedError<WorkflowBlockedError>()(
  "WorkflowBlockedError",
  { workflow: Schema.String, problems: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Workflow "${this.workflow}" can't run on this server: ${this.problems.join(" ")}`;
  }
}

export class WorkflowSkillError extends Schema.TaggedError<WorkflowSkillError>()(
  "WorkflowSkillError",
  { skillName: Schema.String, problem: Schema.String },
) {
  override get message(): string {
    return `Skill "${this.skillName}": ${this.problem}`;
  }
}

export class WorkflowStepNotFoundError extends Schema.TaggedError<WorkflowStepNotFoundError>()(
  "WorkflowStepNotFoundError",
  { runId: Schema.String, stepId: Schema.String },
) {
  override get message(): string {
    return `Run ${this.runId} has no step "${this.stepId}".`;
  }
}

export class WorkflowStepStateError extends Schema.TaggedError<WorkflowStepStateError>()(
  "WorkflowStepStateError",
  {
    runId: Schema.String,
    stepId: Schema.String,
    expected: Schema.Literals([
      "ready",
      "running",
      "current-round",
      "awaiting-approval",
      "awaiting-resume",
      "skippable",
      "finished-run",
      "child-completion",
      "validating",
      "failed-checks",
    ]),
    status: Schema.String,
  },
) {
  override get message(): string {
    if (this.expected === "running")
      return `Step "${this.stepId}" was reset for a new loop round; call workflow_step_start before completing it.`;
    if (this.expected === "current-round")
      return `Step "${this.stepId}" is on ${this.status}; the reported completion belongs to an earlier round.`;
    if (this.expected === "child-completion")
      return `Step "${this.stepId}" runs a workflow; complete its child run instead of reporting the step done.`;
    if (this.expected === "validating")
      return `Step "${this.stepId}" is validating its output; wait for its checks to finish.`;
    if (this.expected === "failed-checks")
      return `Step "${this.stepId}" has no failed checks to rerun, or the step is active or stopped.`;
    if (this.expected === "finished-run")
      return `Run ${this.runId} is still ${this.status}; stop it or let it finish before rerunning a step.`;
    if (this.expected === "skippable")
      return `Step "${this.stepId}" is ${this.status}; only queued, ready or waiting steps of a live run can be skipped.`;
    const wanted =
      this.expected === "ready"
        ? "ready or running"
        : this.expected === "awaiting-approval"
          ? "waiting for approval"
          : "waiting to be resumed";
    return `Step "${this.stepId}" is ${this.status}, not ${wanted}.`;
  }
}

export class WorkflowStepCallerError extends Schema.TaggedError<WorkflowStepCallerError>()(
  "WorkflowStepCallerError",
  { runId: Schema.String, stepId: Schema.String },
) {
  override get message(): string {
    return `Only the driving thread or an authorized step thread can change step "${this.stepId}".`;
  }
}

/**
 * Workflow-first state lives per thread, so every read and write resolves the thread's project here.
 * An unknown thread is answered plainly instead of falling back to a default setting.
 */
export class WorkflowFirstThreadNotFoundError extends Schema.TaggedError<WorkflowFirstThreadNotFoundError>()(
  "WorkflowFirstThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return "Thread not found.";
  }
}

type WorkflowFirstError =
  | Effect.Error<
      ReturnType<ThreadManagementService.ThreadManagementService["Service"]["getThreadShell"]>
    >
  | WorkflowFirstThreadNotFoundError;

type StoreError = WorkflowStore.WorkflowFileError | WorkflowStore.WorkflowRunNotFoundError;
type DefinitionError =
  | WorkflowPreparation.WorkflowInvalidError
  | WorkflowSubagentModelCapError
  | WorkflowStore.WorkflowProjectNotFoundError
  | WorkflowStore.WorkflowNotFoundError
  | WorkflowStore.WorkflowFileError
  | WorkflowMcpInventory.WorkflowMcpInventoryStepNotFoundError
  | ThreadManagementService.ThreadManagementError;
type StepError =
  | StoreError
  | WorkflowStepNotFoundError
  | WorkflowStepStateError
  | WorkflowStepCallerError
  | WorkflowNestingError
  | StartError;
type ReadyStep = {
  runId: string;
  stepId: string;
  title: string;
  skill: string;
  model?: ModelSelection;
  prompt: string;
  runAs: ReturnType<typeof resolveRunAs>;
  attempts: number;
  round?: number;
  executionToken?: string;
  error?: string;
};
type RunResult = WorkflowRun & {
  ready: ReadonlyArray<ReadyStep>;
  context: import("@t3tools/contracts").WorkflowRunContext;
};
type Edit = { projectId: ProjectId; slug: WorkflowSlug; callerThreadId?: ThreadId | undefined };
type SkillError = WorkflowSkillError | SkillCatalog.SkillReadError | DefinitionError;
type StartError =
  | WorkflowSchedules.WorkflowScheduleTargetError
  | DefinitionError
  | WorkflowNestingError
  | WorkflowSkillsMissingError
  | WorkflowBlockedError
  | WorkflowInputsError
  | StoreError;
type StepAction = { runId: string; stepId: string; callerThreadId?: ThreadId | undefined };

export class WorkflowRunner extends Context.Service<
  WorkflowRunner,
  {
    readonly workflowSlugs: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<string>, DefinitionError>;
    readonly triggerSet: (
      input: Edit & {
        afterWorkflow: WorkflowSlug;
        when: "succeeded" | "finished" | null;
        enabled?: boolean | undefined;
      },
    ) => Effect.Effect<{ path: string; missingSkills: ReadonlyArray<string> }, DefinitionError>;
    readonly save: (
      input: Edit & { definition: WorkflowDefinition },
    ) => Effect.Effect<{ path: string; missingSkills: ReadonlyArray<string> }, DefinitionError>;
    readonly importWorkflow: (
      input: Edit & {
        definition: WorkflowDefinition;
        skills: ReadonlyArray<{ name: WorkflowSlug; content: string }>;
      },
    ) => Effect.Effect<{ path: string; missingSkills: ReadonlyArray<string> }, DefinitionError>;
    readonly templatesList: Effect.Effect<
      ReadonlyArray<import("@t3tools/contracts").WorkflowTemplateSummary>
    >;
    readonly templateUse: (
      input: WorkflowTemplateUse,
    ) => Effect.Effect<
      WorkflowTemplateUseResult,
      | WorkflowSubagentModelCapError
      | WorkflowPreparation.WorkflowInvalidError
      | WorkflowStore.WorkflowProjectNotFoundError
      | WorkflowStore.WorkflowFileError
    >;
    readonly create: (
      input: Edit & { name: string; brief?: string | undefined },
    ) => Effect.Effect<{ path: string }, DefinitionError>;
    /** Also removes the workflow's schedules; a failed schedule removal leaves the workflow in place. */
    readonly remove: (
      input: Edit,
    ) => Effect.Effect<
      void,
      DefinitionError | ScheduledTaskError | WorkflowPreferences.WorkflowPreferencesWriteError
    >;
    /**
     * Promotes a scratch workflow: clears `origin` and nothing else. Idempotent, and the only edit
     * that clears it, so an automatic save can never un-keep a workflow.
     */
    readonly keep: (input: Edit) => Effect.Effect<WorkflowListing, DefinitionError>;
    /** Workflow-first is per thread; the runner resolves the thread's project before reading it. */
    readonly workflowFirstRead: (input: {
      threadId: ThreadId;
    }) => Effect.Effect<WorkflowFirst.WorkflowFirstEntry, WorkflowFirstError>;
    /** Turning it on or off also refreshes the project's canvases, like a preferences change. */
    readonly workflowFirstSet: (input: {
      threadId: ThreadId;
      enabled: boolean;
    }) => Effect.Effect<WorkflowFirst.WorkflowFirstEntry, WorkflowFirstError>;
    /** Null clears a field. */
    readonly meta: (
      input: Edit & {
        name?: string | undefined;
        brief?: string | null | undefined;
        credentialApprovals?: "ask" | "once-per-run" | "pre-approved" | undefined;
        model?: ModelSelection | null | undefined;
        subagentModels?: ReadonlyArray<WorkflowSubagentModel> | null | undefined;
        execution?: WorkflowDelegation | null | undefined;
        /** Legacy name for execution; setting it is the same as setting execution. */
        delegation?: WorkflowDelegation | null | undefined;
      },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly tagsSet: (
      input: Edit & { tags: NonNullable<WorkflowDefinition["tags"]> },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly setWorkflowPinned: (
      pin: WorkflowPreferencesValue["pinnedWorkflows"][number],
      pinned: boolean,
    ) => Effect.Effect<
      void,
      WorkflowPreferences.WorkflowPreferencesWriteError | WorkflowStore.WorkflowFileError
    >;
    readonly setGalleryPreferences: (
      input: Partial<
        Pick<
          WorkflowPreferencesValue,
          "pinnedWorkflows" | "showBuiltinWorkflows" | "hiddenBuiltins"
        >
      >,
    ) => Effect.Effect<
      void,
      WorkflowPreferences.WorkflowPreferencesWriteError | WorkflowStore.WorkflowFileError
    >;
    /** Replaces the workflow's input list; an empty list clears it. */
    readonly inputsSet: (
      input: Edit & { inputs: ReadonlyArray<WorkflowInput> },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    /** Adds a note, or replaces the note with this id. Notes never execute or block. */
    readonly notePut: (
      input: Edit & { note: WorkflowNote },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    /** Merges saved card positions; reset clears them first. Presentation only. */
    readonly layoutSet: (
      input: Edit & { positions: WorkflowLayout; reset?: boolean | undefined },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly noteRemove: (
      input: Edit & { noteId: WorkflowSlug },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    /** New steps go after `after`, first when null, last when absent. */
    readonly stepPut: (
      input: Edit & { step: WorkflowStep; after?: string | null | undefined },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly stepMove: (
      input: Edit & { stepId: string; after: string | null },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly stepRemove: (
      input: Edit & { stepId: string },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly loopPut: (
      input: Edit & { loop: WorkflowLoop },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly loopRemove: (
      input: Edit & { loopId: WorkflowSlug },
    ) => Effect.Effect<WorkflowListing, DefinitionError>;
    readonly skillSave: (input: {
      projectId: ProjectId;
      name: string;
      content: string;
      callerThreadId?: ThreadId | undefined;
    }) => Effect.Effect<{ path: string }, DefinitionError>;
    /** installed rewrites the SKILL.md the skill resolves to now, which may be global. */
    readonly skillWrite: (input: {
      projectId: ProjectId;
      name: string;
      content: string;
      target: "project" | "installed";
      callerThreadId?: ThreadId | undefined;
    }) => Effect.Effect<{ path: string }, SkillError>;
    readonly skillCopyToProject: (input: {
      projectId: ProjectId;
      name: string;
      callerThreadId?: ThreadId | undefined;
    }) => Effect.Effect<{ path: string }, SkillError>;
    readonly skillList: (input: {
      projectId: ProjectId;
    }) => Effect.Effect<ReadonlyArray<WorkflowSkillInfo>, DefinitionError>;
    readonly preferencesRead: Effect.Effect<WorkflowPreferencesValue>;
    readonly notifyPreferenceChange: (projectId: ProjectId) => Effect.Effect<void>;
    readonly setSkillPinned: (
      name: string,
      pinned: boolean,
    ) => Effect.Effect<
      void,
      WorkflowPreferences.WorkflowPreferencesWriteError | WorkflowStore.WorkflowFileError
    >;
    readonly setMaxSubagentModels: (
      maxSubagentModels: WorkflowPreferencesValue["maxSubagentModels"],
    ) => Effect.Effect<
      void,
      WorkflowPreferences.WorkflowPreferencesWriteError | WorkflowStore.WorkflowFileError
    >;
    readonly setWorkflowFirstForNewThreads: (
      enabled: boolean,
    ) => Effect.Effect<
      void,
      WorkflowPreferences.WorkflowPreferencesWriteError | WorkflowStore.WorkflowFileError
    >;
    readonly skillRead: (input: {
      projectId: ProjectId;
      name: string;
    }) => Effect.Effect<WorkflowSkillDocument, SkillError>;
    /** Everything that stops the saved workflow from running on this server. */
    readonly preflight: (input: {
      projectId: ProjectId;
      slug: string;
    }) => Effect.Effect<ReadonlyArray<WorkflowBlocker>, DefinitionError>;
    /** Static and cached resource readiness for the canvas. Never runs a probe command. */
    readonly readiness: (input: {
      projectId: ProjectId;
      slug: string;
    }) => Effect.Effect<WorkflowReadinessSnapshot, DefinitionError>;
    /** Explicitly re-checks resources with bounded, non-interactive probes. */
    readonly probe: (input: {
      projectId: ProjectId;
      slug: string;
      stepIds?: ReadonlyArray<WorkflowSlug> | undefined;
      contextThreadId?: ThreadId | undefined;
    }) => Effect.Effect<WorkflowReadinessSnapshot, DefinitionError>;
    /** Cheap cached MCP inventory for a step's effective provider. Never queries the provider. */
    readonly mcpInventory: (input: {
      projectId: ProjectId;
      workflow: WorkflowSlug | string;
      stepId?: WorkflowSlug | string | undefined;
      contextThreadId?: ThreadId | undefined;
    }) => Effect.Effect<WorkflowMcpInventorySnapshot, DefinitionError>;
    /** Explicitly asks the step's effective provider for its live MCP connections. */
    readonly refreshMcpInventory: (input: {
      projectId: ProjectId;
      workflow: WorkflowSlug | string;
      stepId?: WorkflowSlug | string | undefined;
      contextThreadId?: ThreadId | undefined;
    }) => Effect.Effect<WorkflowMcpInventorySnapshot, DefinitionError>;
    readonly scheduleList: (input: {
      projectId?: ProjectId | undefined;
      workflow?: WorkflowSlug | undefined;
    }) => Effect.Effect<ScheduledTaskListResult, ScheduledTaskError>;
    readonly scheduleAdd: (input: {
      projectId: ProjectId;
      workflow: WorkflowSlug;
      driverThreadId: ThreadId;
      inputs?: Readonly<Record<string, string>> | undefined;
      id?: ScheduledTaskId;
      knobs?: WorkflowScheduleKnobs;
      schedule: ScheduledTaskUpsertSchedule;
      createdBy?: OrchestrationV2Actor | undefined;
      creationSource?: OrchestrationV2CreationSource | undefined;
    }) => Effect.Effect<ScheduledTaskMutationResult, WorkflowSchedules.WorkflowScheduleAddError>;
    readonly scheduleTest: (input: {
      projectId: ProjectId;
      workflow: WorkflowSlug;
      id: ScheduledTaskId;
      body: string;
    }) => Effect.Effect<{ outcome: string }, WorkflowSchedules.WorkflowScheduleTargetError>;
    readonly scheduleRemove: (input: {
      projectId: ProjectId;
      workflow: WorkflowSlug;
      id: ScheduledTaskId;
    }) => Effect.Effect<ScheduledTaskDeleteResult, WorkflowSchedules.WorkflowScheduleTargetError>;
    readonly scheduleSetEnabled: (input: {
      projectId: ProjectId;
      workflow: WorkflowSlug;
      id: ScheduledTaskId;
      enabled: boolean;
    }) => Effect.Effect<ScheduledTaskMutationResult, WorkflowSchedules.WorkflowScheduleTargetError>;
    readonly refresh: (input: {
      projectId: ProjectId;
      workflow?: WorkflowSlug | undefined;
      runId?: string | undefined;
    }) => Effect.Effect<void, DefinitionError | StoreError>;
    /** A caller other than the driver, such as the canvas, messages the driver to begin. */
    readonly start: (input: {
      projectId: ProjectId;
      slug: string;
      driverThreadId: ThreadId;
      callerThreadId?: ThreadId | undefined;
      inputs?: Readonly<Record<string, string>> | undefined;
      /** A scheduled or otherwise unattended start: missing required credentials block it. */
      scheduleTaskId?: ScheduledTaskId;
      triggerSourceRunId?: string;
      unattended?: boolean | undefined;
    }) => Effect.Effect<RunResult, StartError>;
    /** The credential ids a pinned run's steps resolve to, for the pre-approved policy. */
    readonly attachedCredentialIds: (input: {
      runId: string;
      stepId?: string | undefined;
    }) => Effect.Effect<ReadonlyArray<CredentialId>>;
    /**
     * Records that this thread works an unlinked step, using the same link `stepStart` writes.
     * The first thread to name the step holds it, so a sibling that names it too is refused.
     */
    readonly claimStepThread: (input: {
      runId: string;
      stepId: string;
      threadId: ThreadId;
    }) => Effect.Effect<boolean>;
    /** Starts a new run of the saved workflow from one step, copying earlier finished results. */
    readonly stepRerun: (
      input: StepAction & { driverThreadId?: ThreadId | undefined },
    ) => Effect.Effect<RunResult, StartError | StepError>;
    readonly stepChecksRun: (input: StepAction) => Effect.Effect<RunResult, StepError>;
    readonly stepSkip: (input: StepAction) => Effect.Effect<RunResult, StepError>;
    readonly status: (
      runId: string,
      callerThreadId?: ThreadId | undefined,
    ) => Effect.Effect<RunResult, StoreError>;
    /** Retries wakeups that never reached their driver; one pass, no polling. */
    readonly reconcileWakeups: (input?: {
      projectId?: ProjectId | undefined;
      threadId?: ThreadId | undefined;
      runId?: string | undefined;
    }) => Effect.Effect<void>;
    readonly list: (input: {
      projectId?: ProjectId | undefined;
      /** False hides scratch workflows, which is how matching only proposes kept ones. */
      includeScratch?: boolean | undefined;
    }) => Effect.Effect<
      { workflows: ReadonlyArray<WorkflowListing>; runs: ReadonlyArray<RunResult> },
      StoreError
    >;
    readonly activeRunsForThread: (
      threadId: ThreadId,
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<WorkflowRun>>;
    /** Live runs in one project, for callers that must verify a run before trusting a thread. */
    readonly activeRunsForProject: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<WorkflowRun>>;
    readonly listRuns: (input: {
      projectId?: ProjectId | undefined;
    }) => Effect.Effect<WorkflowsSnapshot>;
    readonly subscribeRuns: (input: {
      projectId?: ProjectId | undefined;
    }) => Stream.Stream<WorkflowsSnapshot>;
    readonly stop: (
      runId: string,
      callerThreadId?: ThreadId,
    ) => Effect.Effect<RunResult, StoreError>;
    readonly approve: (input: StepAction) => Effect.Effect<RunResult, StepError>;
    readonly resume: (input: StepAction) => Effect.Effect<RunResult, StepError>;
    readonly stepStart: (
      input: StepAction & { callerThreadId: ThreadId; threadId?: ThreadId | undefined },
    ) => Effect.Effect<RunResult, StepError>;
    readonly stepDone: (
      input: StepAction & {
        callerThreadId: ThreadId;
        round?: number | undefined;
        executionToken?: string | undefined;
        summary: string;
        outputs: Readonly<Record<string, string>>;
        failed: boolean;
      },
    ) => Effect.Effect<RunResult, StepError>;
  }
>()("t3/workflows/WorkflowRunner") {}

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const sameDefinition = WorkflowPreparation.sameDefinition;
const terminal = (run: WorkflowRun) => ["done", "failed", "stopped"].includes(run.status);
const stepTerminal = (step: WorkflowStepRun) => ["done", "failed", "skipped"].includes(step.status);
const replaceStep = (
  run: WorkflowRun,
  id: string,
  update: (step: WorkflowStepRun) => WorkflowStepRun,
): WorkflowRun => ({
  ...run,
  steps: run.steps.map((step) => (step.stepId === id ? update(step) : step)),
});
const withoutWaiting = (step: WorkflowStepRun): WorkflowStepRun => {
  const { waitingFor: _, resumeAt: _resumeAt, ...rest } = step;
  return rest;
};
const withoutChecking = (step: WorkflowStepRun): WorkflowStepRun => {
  const { checking: _, ...rest } = step;
  return rest;
};
/** A step that will never validate again: no wait reason, no in-flight validation. */
const settled = (step: WorkflowStepRun) => withoutChecking(withoutWaiting(step));
const stopRunRecord = (run: WorkflowRun, now: string): WorkflowRun => ({
  ...run,
  status: "stopped",
  endedAt: now,
  steps: run.steps.map((step) =>
    stepTerminal(step)
      ? withoutChecking(step)
      : { ...settled(step), status: "skipped", endedAt: now },
  ),
});
const liveStatus = (run: WorkflowRun): WorkflowRun["status"] =>
  run.steps.some((step) => step.status === "ready" || step.status === "running")
    ? "running"
    : run.steps.some((step) => step.status === "waiting")
      ? "waiting"
      : "running";

const make = Effect.gen(function* () {
  const store = yield* WorkflowStore.WorkflowStore;
  const outputPreviews = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
  const serviceScope = yield* Effect.scope;
  const skills = yield* SkillCatalog.SkillCatalog;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  // Captured here, not read per call: every consumer of the runner must share one Workflow-first
  // instance, and an absent service must fail the layer instead of silently answering "off".
  const workflowFirst = yield* WorkflowFirst.WorkflowFirst;
  const schedules = yield* WorkflowSchedules.WorkflowSchedules;
  const workflowPreferences = yield* WorkflowPreferences.WorkflowPreferences;
  const credentialUnlock = yield* CredentialUnlock.CredentialUnlock;
  const credentialRedaction = yield* CredentialRedaction.CredentialRedaction;
  const credentialStore = yield* CredentialStore.CredentialStore;
  const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const crypto = yield* SecureRandom.SecureRandom;
  const digester = yield* Digest.Digest;
  const platform = yield* HostProcess.Platform;
  const commandAvailable = yield* CommandAvailability;
  const preparation = yield* WorkflowPreparation.WorkflowPreparation;
  // Ready prompts are built under the mutation lock; consume registry updates outside it.
  const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  let providerSnapshots: ReadonlyArray<ServerProvider> = Option.isSome(registry)
    ? yield* registry.value.getProviders
    : [];
  if (Option.isSome(registry)) {
    yield* registry.value.streamChanges.pipe(
      Stream.runForEach((providers) =>
        Effect.sync(() => {
          providerSnapshots = providers;
        }),
      ),
      Effect.forkScoped,
    );
  }
  const lock = yield* Semaphore.make(1);
  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) => lock.withPermits(1)(effect);
  /** Checks run outside the lock; these handles let a stop cancel the command they are running. */
  const validations = new Map<string, ValidationHandle>();
  const validationKey = (runId: string, stepId: string) => `${runId}\n${stepId}`;
  const cancelRunValidations = (runId: string) =>
    Effect.forEach(
      [...validations.values()].filter((entry) => entry.runId === runId),
      (entry) => Deferred.succeed(entry.cancel, undefined),
      { discard: true },
    );
  const recoverValidation = (runId: string, stepId: string, token: string) =>
    locked(
      Effect.gen(function* () {
        const run = yield* readRun(runId);
        const step = run.steps.find((item) => item.stepId === stepId);
        if (step?.checking?.token !== token) return;
        if (terminal(run)) {
          yield* writeRun(
            replaceStep(run, stepId, (current) => ({
              ...withoutChecking(current),
              status: "failed",
              error: VALIDATION_INTERRUPTED,
            })),
          );
          return;
        }
        const now = yield* nowIso;
        const failed = step.attempts >= MAX_WORKFLOW_STEP_ATTEMPTS;
        const updated = yield* advance(
          replaceStep(run, stepId, (current) => ({
            ...withoutChecking(current),
            status: failed ? "failed" : "ready",
            error: VALIDATION_INTERRUPTED,
            ...(failed ? { endedAt: now } : {}),
          })),
        );
        yield* writeRun(updated);
      }),
    );
  // Older runs predate model snapshots. Upgrade their definition in memory, but resolve missing
  // snapshots when building a view so provider changes can update legacy live runs.
  const normalizeRun = (run: WorkflowRun): WorkflowRun => {
    const definition = upgradeWorkflowDefinition(run.definition);
    return { ...run, definition };
  };
  const currentSubagents = (
    run: WorkflowRun,
    providers: ReadonlyArray<ServerProvider>,
  ): WorkflowRun =>
    run.subagents !== undefined || run.definition.subagentModels === undefined
      ? run
      : { ...run, subagents: resolveSubagentModels(run.definition.subagentModels, providers) };
  const runs = new Map((yield* store.listRuns).map((run) => [run.id, normalizeRun(run)]));
  const listings = new Map<ProjectId, ReadonlyArray<WorkflowListing>>();
  // fork(workflow-first): environment-wide defaults can change before any project exists.
  const changes = yield* PubSub.unbounded<ProjectId | undefined>();
  const newestRuns = () =>
    [...runs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, 30);
  let runSnapshot = newestRuns();
  const skillInfo = (skill: Omit<SkillCatalog.ResolvedSkill, "text">): WorkflowSkillInfo => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope: skill.scope,
    requires: skill.requires,
  });
  /** Pre-flight, shared by the canvas listing, workflow_preflight and run start. */
  const blockersFor = Effect.fnUntraced(function* (
    projectId: ProjectId,
    definition: WorkflowDefinition,
    installed: ReadonlyArray<Omit<SkillCatalog.ResolvedSkill, "text">>,
    stepIds?: ReadonlySet<string>,
  ) {
    const blockers: WorkflowBlocker[] = validateWorkflow(definition).map((message) => ({
      stepId: null,
      kind: "invalid",
      message,
    }));
    const byName = new Map(installed.map((skill) => [skill.name.toLowerCase(), skill]));
    const commands = new Map<string, boolean>();
    const nestedSlugs = new Set(
      definition.steps.filter((step) => step.kind === "workflow").map((step) => step.workflow),
    );
    const existingNested = nestedSlugs.size > 0 ? yield* store.listDefinitions(projectId) : [];
    const existingNestedNames = new Set(
      existingNested.filter((entry) => entry.definition !== null).map((entry) => entry.slug),
    );
    for (const step of definition.steps) {
      if (stepIds !== undefined && !stepIds.has(step.id)) continue;
      const label = step.title ?? step.id;
      if (step.kind === "workflow") {
        if (!existingNestedNames.has(step.workflow)) {
          blockers.push({
            stepId: step.id as WorkflowSlug,
            kind: "missing-workflow",
            message: `"${label}" calls workflow "${step.workflow}", which isn't saved.`,
          });
        }
        continue;
      }
      const skill = byName.get(step.skill.toLowerCase());
      if (skill === undefined) {
        blockers.push({
          stepId: step.id as WorkflowSlug,
          kind: "missing-skill",
          message: `"${label}" uses skill "${step.skill}", which isn't installed.`,
        });
        continue;
      }
      for (const requirement of skill.requires) {
        const os = WorkflowReadiness.osRequirement(requirement);
        if (os !== undefined) {
          if (os.platform !== platform)
            blockers.push({
              stepId: step.id as WorkflowSlug,
              kind: "requirement",
              message: `"${label}" needs ${os.label}; this server isn't.`,
            });
          continue;
        }
        if (!commands.has(requirement))
          commands.set(
            requirement,
            yield* commandAvailable(requirement).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
            ),
          );
        if (!commands.get(requirement))
          blockers.push({
            stepId: step.id as WorkflowSlug,
            kind: "requirement",
            message: `"${label}" needs \`${requirement}\` on this server's PATH.`,
          });
      }
    }
    return blockers;
  });
  const refreshListings = Effect.fnUntraced(function* (
    projectId: ProjectId,
    editor?: ThreadId,
    editedSlug?: string,
  ) {
    const root = yield* store.projectRoot(projectId);
    const installedSkills = yield* skills.list({ projectRoot: root });
    const installed = new Map(installedSkills.map((skill) => [skill.name.toLowerCase(), skill]));
    // One read for the whole project: a schedule makes the pre-approved knob a requirement.
    // A scheduler read failure only costs the advisory warning, never the canvas.
    const scheduled = yield* schedules
      .list({ projectId })
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.as(Effect.logDebug("workflow.schedules-unavailable"), { tasks: [] }),
        ),
      );
    const scheduledWorkflows = new Set(
      scheduled.tasks
        .map((task) => workflowScheduleBinding(task)?.workflow)
        .filter((slug): slug is WorkflowSlug => slug !== undefined),
    );
    const withWarnings = Effect.fnUntraced(function* (
      snapshot: WorkflowReadinessSnapshot,
      definition: WorkflowDefinition,
      slug: string,
    ) {
      const warnings = [
        ...(snapshot.warnings ?? []),
        ...(scheduledWorkflows.has(slug as WorkflowSlug)
          ? CredentialAttachments.credentialApprovalWarnings(definition)
          : []),
        ...CredentialAttachments.credentialPreapprovalWarnings({
          definition,
          snapshot,
          approvedIds: yield* preapprovals.approved({ projectId, workflow: slug }),
        }),
      ];
      return warnings.length === 0 ? snapshot : { ...snapshot, warnings };
    });
    const previous = listings.get(projectId) ?? [];
    const updatedAt = yield* nowIso;
    const items = yield* Effect.forEach(yield* store.listDefinitions(projectId), (item) =>
      Effect.gen(function* () {
        const problems =
          item.definition === null ? [] : validateWorkflow(item.definition, { allowEmpty: true });
        const old = previous.find((entry) => entry.workflow === item.slug);
        const names = [
          ...new Set(
            item.definition?.steps
              .filter((step) => step.kind !== "workflow")
              .map((step) => step.skill) ?? [],
          ),
        ];
        const problem = item.problem ?? (problems.length ? problems.join(" ") : null);
        const visibleReadiness =
          item.definition === null
            ? undefined
            : yield* preparation.card({
                projectId,
                slug: item.slug,
                definition: item.definition,
                workspaceRoot: root,
              });
        return {
          projectId,
          workflow: item.slug as WorkflowSlug,
          definition: item.definition,
          problem,
          missingSkills: names.filter((name) => !installed.has(name.toLowerCase())),
          skills: names.flatMap((name) => {
            const skill = installed.get(name.toLowerCase());
            return skill === undefined ? [] : [skillInfo(skill)];
          }),
          blockers:
            item.definition === null
              ? [{ stepId: null, kind: "invalid" as const, message: problem ?? "Unreadable." }]
              : yield* blockersFor(projectId, item.definition, installedSkills),
          // Static checks and unexpired observations only: rendering a canvas never spawns a probe.
          ...(visibleReadiness === undefined || visibleReadiness.entries.length === 0
            ? {}
            : {
                readiness:
                  item.definition === null
                    ? visibleReadiness
                    : yield* withWarnings(visibleReadiness, item.definition, item.slug),
              }),
          updatedAt: editedSlug === item.slug ? updatedAt : (old?.updatedAt ?? updatedAt),
          editedByThreadId:
            editedSlug === item.slug ? (editor ?? null) : (old?.editedByThreadId ?? null),
          // Provenance is the definition's own origin; the flag is a projection of it, never a
          // second copy that could disagree.
          scratch: item.definition?.origin !== undefined,
        } satisfies WorkflowListing;
      }),
    );
    listings.set(projectId, items);
    return items;
  });
  /**
   * A scratch workflow names the thread that made it, and that thread must be in the same project.
   * A thread that no longer exists still explains where the file came from, so it is accepted.
   */
  const assertOriginInProject = Effect.fnUntraced(function* (
    projectId: ProjectId,
    slug: WorkflowSlug,
    definition: WorkflowDefinition,
  ) {
    const origin = definition.origin;
    if (origin === undefined) return;
    const projection = yield* threads.getThreadProjection(origin.threadId).pipe(Effect.option);
    if (Option.isNone(projection) || projection.value.thread.projectId === projectId) return;
    return yield* new WorkflowPreparation.WorkflowInvalidError({
      workflow: slug,
      problems: ["That thread belongs to another project, so this workflow can't come from it."],
    });
  });
  /**
   * New provenance must name the caller's own thread: an agent may not label work it didn't do. A
   * stored origin is preserved instead, so a later edit from another thread keeps it.
   */
  const assertCallerOrigin = (
    slug: WorkflowSlug,
    definition: WorkflowDefinition,
    callerThreadId: ThreadId | undefined,
  ) => {
    const origin = definition.origin;
    if (origin === undefined || callerThreadId === undefined || origin.threadId === callerThreadId)
      return Effect.void;
    return Effect.fail(
      new WorkflowPreparation.WorkflowInvalidError({
        workflow: slug,
        problems: ["A new scratch workflow can only come from the thread that saved it."],
      }),
    );
  };
  const workflowFirstProject = Effect.fnUntraced(function* (threadId: ThreadId) {
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null) return yield* new WorkflowFirstThreadNotFoundError({ threadId });
    return shell.projectId;
  });
  let environmentListingsLoaded = false;
  const ensureListings = Effect.fnUntraced(function* (projectId?: ProjectId) {
    if (projectId === undefined && environmentListingsLoaded) return;
    const ids = projectId === undefined ? yield* store.projectIds : [projectId];
    for (const id of ids)
      if (!listings.has(id))
        yield* refreshListings(id).pipe(
          Effect.catch((error) =>
            Effect.logDebug("workflow.listing-unavailable", { projectId: id, error: error._tag }),
          ),
        );
    if (projectId === undefined) environmentListingsLoaded = true;
  });
  /**
   * A readiness input changed outside a project's files, so every canvas re-reads its listings.
   * One project's failure is logged and never stops the others.
   */
  const refreshEveryListing = Effect.fnUntraced(function* (log: string) {
    const projectIds = new Set<ProjectId>([...listings.keys(), ...(yield* store.projectIds)]);
    for (const id of projectIds) {
      yield* refreshListings(id).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) => Effect.logDebug(log, { projectId: id, cause }),
        ),
      );
      yield* PubSub.publish(changes, id);
    }
  });
  /**
   * The vault is environment-wide, so a credential added, edited or deleted changes what every
   * project's canvases can run. Readiness reads vault metadata only, so re-reading the listings
   * is cheap, and it turns a "Missing" card into the real state without a manual Check.
   */
  yield* credentialStore.changes.pipe(
    Stream.runForEach(() => locked(refreshEveryListing("workflow.vault-readiness-unavailable"))),
    Effect.forkIn(serviceScope),
  );
  /**
   * Withdrawing a workflow pre-approval from the vault changes readiness the same way: the canvas
   * must offer "Re-approve credentials" without a reload.
   */
  yield* preapprovals.changes.pipe(
    Stream.runForEach(() =>
      locked(refreshEveryListing("workflow.preapproval-readiness-unavailable")),
    ),
    Effect.forkIn(serviceScope),
  );
  const listRuns: WorkflowRunner["Service"]["listRuns"] = (input) =>
    locked(
      Effect.gen(function* () {
        yield* ensureListings(input.projectId).pipe(
          Effect.catch((error) =>
            Effect.logDebug("workflow.projects-unavailable", { error: error._tag }),
          ),
        );
        const preferences = yield* workflowPreferences.read;
        return {
          workflows: yield* Effect.forEach(
            [...listings.values()]
              .flat()
              .filter(
                (item) => input.projectId === undefined || item.projectId === input.projectId,
              ),
            (item) =>
              Effect.gen(function* () {
                const pinned = preferences.pinnedWorkflows.some(
                  (pin) => pin.projectId === item.projectId && pin.workflow === item.workflow,
                );
                if (item.definition === null || item.readiness === undefined)
                  return { ...item, pinned };
                const workspaceRoot =
                  item.readiness.context?.workspaceRoot ?? item.readiness.entries[0]?.workspaceRoot;
                if (workspaceRoot === undefined) return { ...item, pinned };
                return {
                  ...item,
                  pinned,
                  readiness: yield* preparation.cached({
                    projectId: item.projectId,
                    definition: item.definition,
                    workspaceRoot,
                    observed: item.readiness,
                  }),
                };
              }),
            { concurrency: 2 },
          ),
          runs: runSnapshot.filter(
            (run) => input.projectId === undefined || run.projectId === input.projectId,
          ),
        };
      }),
    );
  const subscribeRuns: WorkflowRunner["Service"]["subscribeRuns"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        // A client reattaching subscribes first; retry any wakeup that never reached its driver.
        yield* reconcileWakeups(input).pipe(Effect.forkIn(serviceScope));
        return Stream.concat(
          Stream.fromEffect(listRuns(input)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter(
              (id) => id === undefined || input.projectId === undefined || id === input.projectId,
            ),
            Stream.mapEffect(() => listRuns(input)),
          ),
        );
      }),
    );
  const armedWaits = new Map<string, Deferred.Deferred<void>>();
  const armWaits = Effect.fn("WorkflowRunner.armWaits")(function* (
    run: WorkflowRun,
  ): Effect.fn.Return<void> {
    const live = new Set(
      terminal(run)
        ? []
        : run.steps
            .filter((step) => step.waitingFor === "timer" && step.resumeAt)
            .map((step) => `${run.id}:${step.stepId}:${step.resumeAt}`),
    );
    for (const [key, cancel] of armedWaits) {
      if (key.startsWith(`${run.id}:`) && !live.has(key)) {
        armedWaits.delete(key);
        yield* Deferred.succeed(cancel, undefined);
      }
    }
    yield* Effect.forEach(
      run.steps,
      (step) =>
        Effect.gen(function* () {
          if (terminal(run) || step.waitingFor !== "timer" || !step.resumeAt) return;
          const key = `${run.id}:${step.stepId}:${step.resumeAt}`;
          if (armedWaits.has(key)) return;
          const cancel = yield* Deferred.make<void>();
          armedWaits.set(key, cancel);
          yield* Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const elapsed = yield* Effect.race(
              Effect.sleep(Math.max(0, Date.parse(step.resumeAt!) - now)).pipe(Effect.as(true)),
              Deferred.await(cancel).pipe(Effect.as(false)),
            );
            if (!elapsed) return;
            armedWaits.delete(key);
            yield* changeWaiting({ runId: run.id, stepId: step.stepId }, "timer").pipe(
              Effect.ignore,
            );
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                armedWaits.delete(key);
              }),
            ),
            Effect.forkIn(serviceScope),
          );
        }),
      { discard: true },
    );
  });
  const writeRun = (run: WorkflowRun): Effect.Effect<void, WorkflowStore.WorkflowFileError> =>
    store.writeRun(run).pipe(
      Effect.andThen(
        Effect.sync(() => {
          runs.set(run.id, run);
          runSnapshot = newestRuns();
        }),
      ),
      Effect.andThen(PubSub.publish(changes, run.projectId)),
      Effect.andThen(armWaits(run)),
      Effect.andThen(
        terminal(run) && run.triggerDispatchPending === true
          ? Effect.suspend(() => fireAfter(run)).pipe(Effect.forkIn(serviceScope))
          : Effect.void,
      ),
      Effect.asVoid,
      Effect.uninterruptible,
    );
  // Suspend so a run is read when the effect runs, after a caller's lock is held, not when
  // the effect is built. Otherwise a waiting delivery could commit from a stale snapshot.
  const readRun = (id: string) =>
    Effect.suspend(() =>
      runs.has(id)
        ? Effect.succeed(runs.get(id)!)
        : store.readRun(id).pipe(Effect.map(normalizeRun)),
    );
  const attachedCredentialIds: WorkflowRunner["Service"]["attachedCredentialIds"] = Effect.fn(
    "WorkflowRunner.attachedCredentialIds",
  )(function* (input) {
    const run = yield* readRun(input.runId).pipe(Effect.option);
    if (Option.isNone(run)) return [];
    const credentials = yield* credentialStore.list().pipe(Effect.option);
    // Never pre-approve from a partial view: an unreadable vault resolves nothing.
    if (Option.isNone(credentials)) return [];
    const steps =
      input.stepId === undefined
        ? run.value.definition.steps
        : run.value.definition.steps.filter((step) => step.id === input.stepId);
    return steps.flatMap((step) =>
      CredentialAttachments.attachedCredentialIds({
        step,
        projectId: run.value.projectId,
        credentials: credentials.value,
      }),
    );
  });
  const claimStepThread: WorkflowRunner["Service"]["claimStepThread"] = Effect.fn(
    "WorkflowRunner.claimStepThread",
  )(function* (input) {
    return yield* locked(
      Effect.gen(function* () {
        const run = yield* readRun(input.runId).pipe(Effect.option);
        if (Option.isNone(run)) return false;
        const step = run.value.steps.find((item) => item.stepId === input.stepId);
        if (step === undefined) return false;
        if (
          input.threadId !== run.value.driverThreadId &&
          step.previousRounds?.some((round) => round.threadId === input.threadId)
        )
          return false;
        if (step.threadId !== null) return step.threadId === input.threadId;
        if (step.status !== "ready" && step.status !== "running") return false;
        // A claim that cannot be persisted must fail closed: the caller gets no step context.
        return yield* writeRun(
          replaceStep(run.value, input.stepId, (current) => ({
            ...current,
            threadId: input.threadId,
          })),
        ).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
      }),
    );
  });
  const captureOutputs = Effect.fn("WorkflowRunner.captureOutputs")(function* (
    run: WorkflowRun,
    step: WorkflowStepRun,
    options?: { readonly force?: boolean },
  ) {
    if (!step.outputs || !Object.keys(step.outputPreviews ?? {}).length) return;
    const outputs = { ...step.outputs };
    yield* Effect.gen(function* () {
      const cwd = yield* workingDirectory(run, step.threadId ?? run.driverThreadId).pipe(
        Effect.option,
      );
      return yield* outputPreviews.prepare({
        runId: run.id,
        threadId: run.driverThreadId,
        outputs,
        ...(Option.isSome(cwd) ? { cwd: cwd.value } : {}),
        ...(options?.force ? { force: true } : {}),
      });
    }).pipe(
      Effect.flatMap((previews) =>
        locked(
          Effect.gen(function* () {
            const current = yield* readRun(run.id);
            const latest = current.steps.find((item) => item.stepId === step.stepId);
            if (
              !latest ||
              latest.attempts !== step.attempts ||
              Object.keys(latest.outputs ?? {}).length !== Object.keys(outputs).length ||
              Object.entries(outputs).some(([key, value]) => latest.outputs?.[key] !== value)
            )
              return;
            yield* writeRun(
              replaceStep(current, step.stepId, (item) => ({
                ...item,
                outputPreviews: previews,
              })),
            );
          }),
        ),
      ),
      Effect.catchCause(() => Effect.logDebug("workflow-output-preview.unavailable")),
      Effect.forkIn(serviceScope),
    );
  });
  const requireStep = (run: WorkflowRun, stepId: string) => {
    const step = run.steps.find((step) => step.stepId === stepId);
    return step === undefined
      ? Effect.fail(new WorkflowStepNotFoundError({ runId: run.id, stepId }))
      : Effect.succeed(step);
  };
  const workingDirectory = (run: WorkflowRun, threadId = run.driverThreadId) =>
    threads.getThreadProjection(threadId).pipe(
      Effect.option,
      Effect.flatMap((projection) =>
        Option.isSome(projection) && projection.value.thread.worktreePath !== null
          ? Effect.succeed(projection.value.thread.worktreePath)
          : store.projectRoot(run.projectId),
      ),
    );
  /** A stable identity for the pinned definition, so the driver can tell versions apart. */
  const encodeDefinition = Schema.encodeEffect(Schema.fromJsonString(WorkflowDefinition));
  const definitionDigest = Effect.fnUntraced(function* (definition: WorkflowDefinition) {
    const text = yield* encodeDefinition(workflowSemanticDefinition(definition));
    const digest = yield* digester.digest(Digest.sha256, new TextEncoder().encode(text));
    return `sha256:${Hex.encode(digest)}`;
  }, Effect.orDie);
  const result = Effect.fnUntraced(function* (
    run: WorkflowRun,
  ): Effect.fn.Return<RunResult, StoreError> {
    const providers = Option.isSome(registry)
      ? yield* registry.value.getProviders
      : providerSnapshots;
    const ready: ReadyStep[] = [];
    const queue = [run];
    const visited = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const owner = currentSubagents(queue[index]!, providers);
      if (visited.has(owner.id) || terminal(owner)) continue;
      visited.add(owner.id);
      const texts = owner.steps.some((step) => step.status === "ready")
        ? yield* store.readSkillTexts(owner.id)
        : {};
      for (const state of owner.steps) {
        if (state.status === "running" && state.childRunId !== undefined) {
          const child = yield* readRun(state.childRunId);
          if (child.parent?.runId === owner.id && child.parent.stepId === state.stepId)
            queue.push(child);
        }
        if (state.status !== "ready") continue;
        const step = owner.definition.steps.find((step) => step.id === state.stepId)!;
        if (step.kind === "workflow") {
          ready.push({
            runId: owner.id,
            stepId: step.id,
            title: step.title ?? step.id,
            skill: step.workflow,
            runAs: resolveRunAs(owner.definition, step),
            attempts: state.attempts,
            ...(state.round === undefined ? {} : { round: state.round }),
            ...(state.executionToken === undefined ? {} : { executionToken: state.executionToken }),
            ...(state.error === undefined ? {} : { error: state.error }),
            prompt: buildWorkflowStepPrompt({
              runId: owner.id,
              definition: owner.definition,
              step,
              stepRun: state,
              steps: owner.steps,
              ...(owner.loopRounds === undefined ? {} : { loopRounds: owner.loopRounds }),
              inputs: owner.inputs ?? {},
              childInputs: mappedChildInputs(step, owner.inputs, owner.lastRunResult?.summary),
              ...(owner.preflight === undefined ? {} : { preflight: owner.preflight }),
              ...(owner.lastRunResult === undefined ? {} : { lastRunResult: owner.lastRunResult }),
            }),
          });
          continue;
        }
        const pinned = owner.skills.find((skill) => skill.name === step.skill)!;
        const override =
          step.model === undefined ? undefined : resolveSubagentModels([step.model], providers);
        const subagents =
          owner.definition.subagentModels === undefined
            ? undefined
            : resolveSubagentModels(owner.definition.subagentModels, providers);
        const model = override?.usable[0];
        ready.push({
          runId: owner.id,
          stepId: step.id,
          title: step.title ?? step.id,
          skill: step.skill,
          runAs: resolveRunAs(owner.definition, step),
          ...(model === undefined
            ? {}
            : { model: { ...step.model, instanceId: model.instanceId, model: model.model } }),
          attempts: state.attempts,
          ...(state.round === undefined ? {} : { round: state.round }),
          ...(state.executionToken === undefined ? {} : { executionToken: state.executionToken }),
          ...(state.error === undefined ? {} : { error: state.error }),
          prompt: buildStepPrompt({
            runId: owner.id,
            definition: owner.definition,
            step,
            stepRun: state,
            steps: owner.steps,
            ...(owner.loopRounds === undefined ? {} : { loopRounds: owner.loopRounds }),
            inputs: owner.inputs,
            ...(owner.lastRunResult === undefined ? {} : { lastRunResult: owner.lastRunResult }),
            skill: { name: pinned.name, path: pinned.path, text: texts[pinned.name] ?? "" },
            subagents,
            stepSubagents: override,
            upstream: stepDependencies(owner.definition, step.id).map((id) => {
              const previous = owner.steps.find((item) => item.stepId === id);
              return {
                stepId: id,
                title: owner.definition.steps.find((item) => item.id === id)?.title ?? id,
                summary: previous?.summary,
                outputs: previous?.outputs,
              };
            }),
            ...(owner.preflight === undefined ? {} : { preflight: owner.preflight }),
            ...(state.error === undefined
              ? {}
              : {
                  retry: {
                    attempt: state.attempts + 1,
                    problems: [...new Set([state.error, ...failedCheckProblems(state.checks)])],
                  },
                }),
          }),
        });
      }
    }
    if (yield* credentialRedaction.available(run.projectId).pipe(Effect.orDie)) {
      for (const step of ready)
        step.prompt +=
          "\nCredential tools are available: use credential_list and credential_exec; values stay private.";
    }
    const definitionRevision = run.definitionRevision ?? (yield* definitionDigest(run.definition));
    return {
      ...currentSubagents(run, providers),
      ready,
      context: buildRunContext({
        run: currentSubagents(run, providers),
        definitionRevision,
        ready: ready.map((step) => ({
          stepId: step.stepId,
          title: step.title,
          skill: step.skill,
          runAs: step.runAs,
        })),
      }),
    };
  });
  /**
   * Wakeups are persisted on the run before delivery, so a failed thread send is not lost. A
   * stable command/message id per revision makes a retry idempotent, and the acknowledgement
   * lets startup, refresh and reattachment retry only outstanding work.
   */
  const deliveryInFlight = new Set<string>();
  const wakeKey = Effect.fnUntraced(function* (run: WorkflowRun, message: string) {
    const state = [
      message,
      run.status,
      ...run.steps.map((step) =>
        [
          step.stepId,
          step.status,
          step.attempts,
          step.round ?? 1,
          step.previousRounds?.length ?? 0,
          step.waitingFor ?? "",
          step.error ?? "",
          step.checking?.token ?? "",
          step.childRunId ?? "",
        ].join("\u0000"),
      ),
    ].join("\u0001");
    const digest = yield* digester
      .digest(Digest.sha256, new TextEncoder().encode(state))
      .pipe(Effect.orDie);
    return `sha256:${Hex.encode(digest)}`;
  });
  const wakeStateKey = (run: WorkflowRun) => wakeKey(run, "");
  /** Queues one wakeup; call under the lock, deliver outside it. True means there is work to send. */
  const queueWakeupLocked = Effect.fnUntraced(function* (run: WorkflowRun, message: string) {
    const latest = yield* readRun(run.id);
    const key = yield* wakeKey(latest, message);
    const existing = latest.driverWakeup;
    const stateKey = yield* wakeStateKey(latest);
    // The same state delivered already needs nothing; the same state pending only retries.
    if (existing?.key === key) {
      if (existing.stateKey !== stateKey)
        yield* writeRun({ ...latest, driverWakeup: { ...existing, stateKey } });
      return existing.acknowledgedRevision < existing.revision;
    }
    const now = yield* nowIso;
    yield* writeRun({
      ...latest,
      driverWakeup: {
        revision: (existing?.revision ?? 0) + 1,
        acknowledgedRevision: existing?.acknowledgedRevision ?? 0,
        key,
        stateKey,
        message: clip(message, MAX_WAKE_CHARS + 600),
        queuedAt: now,
        attempts: 0,
      },
    });
    return true;
  });
  const recordWakeFailureLocked = Effect.fnUntraced(function* (
    runId: string,
    revision: number,
    reason: string,
  ) {
    const latest = yield* readRun(runId);
    const wake = latest.driverWakeup;
    // A newer revision owns the pending slot; never overwrite it with an old attempt.
    if (wake === undefined || wake.revision !== revision) return;
    const now = yield* nowIso;
    yield* writeRun({
      ...latest,
      driverWakeup: {
        ...wake,
        attempts: wake.attempts + 1,
        lastAttemptAt: now,
        lastError: clip(reason, 200),
      },
    });
  });
  const acknowledgeWakeupLocked = Effect.fnUntraced(function* (runId: string, revision: number) {
    const latest = yield* readRun(runId);
    const wake = latest.driverWakeup;
    // An acknowledgement for an older revision must not clear a newer pending one.
    if (wake === undefined || wake.revision !== revision) return;
    if (wake.acknowledgedRevision >= revision) return;
    yield* writeRun({
      ...latest,
      driverWakeup: { ...wake, acknowledgedRevision: revision },
    });
  });
  const failureReason = (cause: Cause.Cause<unknown>): string => {
    const failure = Cause.squash(cause);
    return typeof failure === "object" && failure !== null && "_tag" in failure
      ? String((failure as { readonly _tag: unknown })._tag)
      : "unavailable";
  };
  /** Sends the outstanding wakeup once. Delivery I/O never runs under the mutation lock. */
  const sendWakeup = Effect.fn("WorkflowRunner.deliverWakeup")(function* (runId: string) {
    const latest = yield* locked(readRun(runId));
    const wake = latest.driverWakeup;
    if (wake === undefined || wake.acknowledgedRevision >= wake.revision) return;
    const guard = `${runId}:${wake.revision}`;
    if (deliveryInFlight.has(guard)) return;
    deliveryInFlight.add(guard);
    yield* Effect.gen(function* () {
      const commandId = CommandId.make(`workflow:${runId}:wake:${wake.revision}`);
      // A previous send may have landed before its acknowledgement was written.
      const alreadyDelivered = yield* threads
        .hasReceipt(commandId)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      if (!alreadyDelivered) {
        const sent = yield* threads
          .sendToThread({
            projectId: latest.projectId,
            threadId: latest.driverThreadId,
            commandId,
            messageId: MessageId.make(`workflow:${runId}:wake:${wake.revision}`),
            text: wake.message,
            attachments: [],
            mode: "queue",
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(
            Effect.as({ ok: true as const }),
            Effect.catchCause((cause) =>
              Effect.succeed({ ok: false as const, reason: failureReason(cause) }),
            ),
          );
        if (!sent.ok) {
          yield* locked(recordWakeFailureLocked(runId, wake.revision, sent.reason)).pipe(
            Effect.ignoreCause,
          );
          yield* Effect.logWarning("workflow.wakeup-failed", {
            runId,
            revision: wake.revision,
            reason: sent.reason,
          });
          return;
        }
      }
      yield* locked(acknowledgeWakeupLocked(runId, wake.revision)).pipe(Effect.ignoreCause);
    }).pipe(Effect.ensuring(Effect.sync(() => deliveryInFlight.delete(guard))));
  });
  /** Delivery never fails the mutation that queued it; the pending state is the retry record. */
  const deliverWakeup = (runId: string) =>
    sendWakeup(runId).pipe(
      Effect.catchCause(() => Effect.logDebug("workflow.wakeup-skipped", { runId })),
    );
  /**
   * Reconcile pending deliveries and live state changes whose process stopped before it could queue
   * a wakeup. Terminal runs are excluded so restart never replays old completion messages.
   */
  const reconcileWakeups = Effect.fnUntraced(function* (input?: {
    projectId?: ProjectId | undefined;
    threadId?: ThreadId | undefined;
    runId?: string | undefined;
  }) {
    const candidates = [...runs.values()].filter((run) => {
      if (input?.projectId !== undefined && run.projectId !== input.projectId) return false;
      if (input?.threadId !== undefined && run.driverThreadId !== input.threadId) return false;
      if (input?.runId !== undefined && run.id !== input.runId) return false;
      return true;
    });
    for (const run of candidates) {
      if (!terminal(run)) {
        const currentStateKey = yield* wakeStateKey(run);
        if (run.driverWakeup?.stateKey !== currentStateKey) {
          const queued = yield* locked(
            Effect.gen(function* () {
              const latestOption = yield* readRun(run.id).pipe(Effect.option);
              if (Option.isNone(latestOption)) return false;
              const latest = latestOption.value;
              if (
                terminal(latest) ||
                (yield* wakeStateKey(latest)) === latest.driverWakeup?.stateKey
              )
                return false;
              const view = yield* result(latest);
              return yield* queueWakeupLocked(
                view,
                updateWakeMessage(
                  view,
                  view.context,
                  "Workflow state changed; call workflow_status before acting.",
                ),
              );
            }),
          );
          if (queued) yield* deliverWakeup(run.id);
        }
      }
      const latest = yield* readRun(run.id).pipe(Effect.option);
      if (Option.isSome(latest)) {
        const wake = latest.value.driverWakeup;
        if (wake !== undefined && wake.acknowledgedRevision < wake.revision)
          yield* deliverWakeup(run.id);
      }
    }
  });
  const reconcileWakeupsBestEffort: WorkflowRunner["Service"]["reconcileWakeups"] = (input) =>
    reconcileWakeups(input).pipe(Effect.ignoreCause);
  /**
   * Queues the wakeup and then delivers it. A caller that is the driver already has the tool
   * result, so it is never woken by its own action.
   */
  const wakeDriver = Effect.fnUntraced(function* (
    run: WorkflowRun,
    text: string,
    caller?: ThreadId,
    initial = false,
  ) {
    if (caller === run.driverThreadId) {
      yield* locked(
        Effect.gen(function* () {
          const latest = yield* readRun(run.id);
          const stateKey = yield* wakeStateKey(latest);
          const wake = latest.driverWakeup;
          if (wake === undefined || wake.stateKey !== stateKey)
            yield* writeRun({
              ...latest,
              driverWakeup:
                wake === undefined
                  ? {
                      revision: 1,
                      acknowledgedRevision: 1,
                      key: stateKey,
                      stateKey,
                      message: "",
                      queuedAt: yield* nowIso,
                      attempts: 0,
                    }
                  : { ...wake, stateKey },
            });
        }),
      );
      return;
    }
    const queued = yield* locked(
      Effect.gen(function* () {
        const latest = yield* readRun(run.id).pipe(Effect.flatMap(result));
        const message = initial
          ? initialWakeMessage(latest, latest.context)
          : updateWakeMessage(latest, latest.context, text);
        return yield* queueWakeupLocked(latest, message);
      }),
    );
    if (queued) yield* deliverWakeup(run.id);
  });
  const runCheck = (cwd: string, check: WorkflowStepCheck): Effect.Effect<WorkflowCheckResult> => {
    if (check.kind === "file") {
      const target = path.resolve(expandHomePath(resolveWorkspaceFilePath(check.path, cwd), home));
      const minBytes = check.minBytes ?? 1;
      return fileSystem.stat(target).pipe(
        Effect.map((info) => {
          const size = Number(info.size);
          return size >= minBytes
            ? { check, ok: true, message: `${check.path} exists (${size} bytes).` }
            : {
                check,
                ok: false,
                message: `${check.path} is ${size} bytes; expected ${minBytes}.`,
              };
        }),
        Effect.orElseSucceed(() => ({ check, ok: false, message: `${check.path} is missing.` })),
      );
    }
    const shell =
      platform === "win32"
        ? { command: "cmd.exe", args: ["/d", "/s", "/c", check.command] }
        : { command: "/bin/sh", args: ["-c", check.command] };
    return processRunner
      .run({
        ...shell,
        cwd,
        timeout: `${check.timeoutSec ?? DEFAULT_CHECK_TIMEOUT_SEC} seconds`,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.flatMap((output) =>
          credentialRedaction.matcher().pipe(
            Effect.orDie,
            Effect.map((redact): WorkflowCheckResult => {
              if (output.timedOut) {
                return { check, ok: false, message: `\`${check.command}\` timed out.` };
              }
              if (output.code === 0) {
                return { check, ok: true, message: `\`${check.command}\` passed.` };
              }
              const tail = (
                output.stderrTruncated || output.stdoutTruncated
                  ? "[output truncated]"
                  : redact(output.stderr || output.stdout)
              )
                .trim()
                .slice(-CHECK_OUTPUT_TAIL);
              return {
                check,
                ok: false,
                message: `\`${check.command}\` exited ${output.code ?? "abnormally"}${tail ? `: ${tail}` : "."}`,
              };
            }),
          ),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            check,
            ok: false,
            message: `\`${check.command}\` couldn't run: ${error.message}`,
          }),
        ),
      );
  };

  const interruptLinked = (run: WorkflowRun, reason: string) =>
    Effect.forEach(
      [
        ...new Set(
          run.steps
            .filter(
              (step) =>
                step.status === "running" &&
                step.threadId !== null &&
                step.threadId !== run.driverThreadId,
            )
            .map((step) => step.threadId!),
        ),
      ],
      (threadId) =>
        threads
          .interruptThread({
            projectId: run.projectId,
            threadId,
            commandId: CommandId.make(`workflow:${run.id}:${threadId}:stop`),
            reason,
          })
          .pipe(Effect.ignore),
      { discard: true },
    );
  /** The runs below this one in the parent chain, so a stop reaches grandchildren too. */
  const descendantsOf = (runId: string): ReadonlyArray<WorkflowRun> => {
    const children = new Map<string, WorkflowRun[]>();
    for (const candidate of runs.values()) {
      const parentId = candidate.parent?.runId;
      if (parentId === undefined) continue;
      const siblings = children.get(parentId);
      if (siblings === undefined) children.set(parentId, [candidate]);
      else siblings.push(candidate);
    }
    const found: WorkflowRun[] = [];
    const queue = [runId];
    const visited = new Set(queue);
    for (let index = 0; index < queue.length; index++) {
      for (const child of children.get(queue[index]!) ?? []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        found.push(child);
        queue.push(child.id);
      }
    }
    return found;
  };
  /** Ends every run below this one, so nothing keeps working after the run itself ends. */
  const stopDescendants = Effect.fnUntraced(function* (
    run: WorkflowRun,
    reason: string,
    now: string,
  ) {
    for (const descendant of descendantsOf(run.id)) {
      if (terminal(descendant)) continue;
      yield* interruptLinked(descendant, reason);
      yield* writeRun(stopRunRecord(descendant, now));
      yield* cancelRunValidations(descendant.id);
    }
  });
  const advance = Effect.fnUntraced(function* (run: WorkflowRun) {
    const actions = nextActions(run.definition, run.steps);
    const now = yield* nowIso;
    if (actions.finished !== null) {
      if (actions.finished === "failed") {
        yield* interruptLinked(run, "Another workflow step failed.");
        yield* stopDescendants(run, "Another workflow step failed.", now);
      }
      yield* cancelRunValidations(run.id);
      return {
        ...run,
        status: actions.finished,
        endedAt: now,
        steps: run.steps.map((step) =>
          stepTerminal(step)
            ? withoutChecking(step)
            : { ...settled(step), status: "skipped" as const, endedAt: now },
        ),
      };
    }
    for (const id of actions.start) {
      const wait = run.definition.steps.find((step) => step.id === id)?.waitBefore;
      run = replaceStep(run, id, (step) =>
        wait
          ? {
              ...step,
              status: "waiting",
              waitingFor: "timer",
              resumeAt: workflowResumeAt(wait, Date.parse(now)),
            }
          : { ...step, status: "ready" },
      );
    }
    for (const id of actions.awaitApproval) {
      const wait = run.definition.steps.find((step) => step.id === id)?.waitBefore;
      run = replaceStep(run, id, (step) => ({
        ...step,
        status: "waiting",
        waitingFor: wait ? "timer" : "approval",
        ...(wait ? { resumeAt: workflowResumeAt(wait, Date.parse(now)) } : {}),
      }));
    }
    return { ...run, status: liveStatus(run) };
  });
  /**
   * Pre-approval authority lives on this machine, not in the project file: a downloaded or
   * hand-edited workflow that says "pre-approved" grants nothing until the unlocked user action
   * records which credential ids it covers. The knob itself stays in the file as intent, because
   * workflows are portable.
   */
  const syncPreapproval = Effect.fn("WorkflowRunner.syncPreapproval")(function* (
    input: Edit & { definition: WorkflowDefinition },
    previous?: WorkflowDefinition | null,
    options?: { readonly reapprove?: boolean },
  ) {
    if (input.definition.credentialApprovals !== "pre-approved") {
      yield* preapprovals.revoke({ projectId: input.projectId, workflow: input.slug });
      return;
    }
    // The knob is the user's intent and stays in the portable file. Only the user asking for it
    // again, or a change to it, records a grant; a later attachment must ask for its own approval.
    if (options?.reapprove !== true && previous?.credentialApprovals === "pre-approved") return;
    const sessionId = yield* CredentialPolicySession;
    const ok =
      sessionId === undefined
        ? false
        : yield* credentialUnlock.requireUnlocked(sessionId).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
    if (!ok || sessionId === undefined)
      return yield* new WorkflowPreparation.WorkflowInvalidError({
        workflow: input.slug,
        problems: [PREAPPROVAL_UNLOCK_PROBLEM],
      });
    const credentials = yield* credentialStore.list().pipe(
      Effect.mapError(
        () =>
          new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems: ["Couldn't read the credential vault, so the pre-approval wasn't recorded."],
          }),
      ),
    );
    // Exactly what the user can see attached now: an id added later is never covered silently.
    const credentialIds = input.definition.steps.flatMap((step) =>
      CredentialAttachments.attachedCredentialIds({
        step,
        projectId: input.projectId,
        credentials,
      }),
    );
    const granted = yield* preapprovals.grant(
      { projectId: input.projectId, workflow: input.slug, credentialIds },
      sessionId,
    );
    if (!granted)
      return yield* new WorkflowPreparation.WorkflowInvalidError({
        workflow: input.slug,
        problems: ["Couldn't record the pre-approval on this server. Try again."],
      });
  });
  const saveLocked = Effect.fnUntraced(function* (
    input: Edit & { definition: WorkflowDefinition },
    options?: { readonly reapprove?: boolean; readonly imported?: boolean },
  ) {
    const problems = validateWorkflow(input.definition, { allowEmpty: true });
    if (problems.length)
      return yield* new WorkflowPreparation.WorkflowInvalidError({
        workflow: input.slug,
        problems,
      });
    yield* assertOriginInProject(input.projectId, input.slug, input.definition);
    const projectMap = new Map<string, WorkflowDefinition | null>();
    for (const item of yield* store.listDefinitions(input.projectId))
      projectMap.set(item.slug, item.definition);
    if (!options?.imported) {
      const previous = projectMap.get(input.slug)?.subagentModels ?? [];
      const next = upgradeWorkflowDefinition(input.definition).subagentModels ?? [];
      const previousKeys = new Set(
        previous.flatMap((hint) => [
          `${hint.instanceId}\0${hint.model}`,
          `${hint.driver ?? hint.instanceId}\0${hint.model}`,
        ]),
      );
      // Imported choices may exceed this server's cap. Preserve them or remove them gradually;
      // once over the cap, replacing a choice also counts as adding one.
      if (
        next.length > previous.length ||
        next.some(
          (hint) =>
            !previousKeys.has(`${hint.instanceId}\0${hint.model}`) &&
            !previousKeys.has(`${hint.driver ?? hint.instanceId}\0${hint.model}`),
        )
      ) {
        const preferences = yield* workflowPreferences.read;
        yield* assertSubagentModelCap(next.length, preferences.maxSubagentModels);
      }
    }
    yield* syncPreapproval(input, projectMap.get(input.slug), options);
    projectMap.set(input.slug, input.definition);
    const nesting = validateNesting(projectMap);
    if (nesting.length)
      return yield* new WorkflowPreparation.WorkflowInvalidError({
        workflow: input.slug,
        problems: nesting,
      });
    const filePath = yield* store.writeDefinition(input);
    const items = yield* refreshListings(input.projectId, input.callerThreadId, input.slug);
    yield* PubSub.publish(changes, input.projectId);
    return {
      path: filePath,
      missingSkills: items.find((item) => item.workflow === input.slug)!.missingSkills,
    };
  });
  const save: WorkflowRunner["Service"]["save"] = (input) =>
    locked(
      Effect.gen(function* () {
        const existing = yield* store
          .readDefinition(input)
          .pipe(
            Effect.asSome,
            Effect.catchTags({ WorkflowNotFoundError: () => Effect.succeedNone }),
          );
        // Provenance is fixed at birth. Once a file exists, its own origin -- present or
        // absent -- is authoritative: a later save keeps a stored scratch origin and cannot
        // re-mark a workflow the user kept or one that was never scratch. Replaying an old
        // auto-saved definition therefore cannot un-keep anything.
        if (Option.isSome(existing)) {
          const { origin: _incoming, ...content } = input.definition;
          const stored = existing.value.origin;
          return yield* saveLocked({
            ...input,
            definition: stored === undefined ? content : { ...content, origin: stored },
          });
        }
        yield* assertCallerOrigin(input.slug, input.definition, input.callerThreadId);
        return yield* saveLocked(input);
      }),
    );
  const importWorkflow: WorkflowRunner["Service"]["importWorkflow"] = (input) =>
    locked(
      Effect.gen(function* () {
        const existing = yield* store.listDefinitions(input.projectId);
        if (existing.some((item) => item.slug === input.slug))
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems: ["A workflow with this name already exists."],
          });
        // A file that came from elsewhere never arrives pre-approved on this machine: the knob is
        // portable intent, and this machine's user records approval through the canvas.
        const definition =
          input.definition.credentialApprovals === "pre-approved"
            ? { ...input.definition, credentialApprovals: "once-per-run" as const }
            : input.definition;
        const problems = validateWorkflow(definition, { allowEmpty: true });
        if (problems.length)
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems,
          });
        yield* assertCallerOrigin(input.slug, definition, input.callerThreadId);
        const projectRoot = yield* store.projectRoot(input.projectId);
        const installed = yield* skills.list({ projectRoot });
        const projectSkills = new Set(
          installed
            .filter((skill) => skill.scope === "project")
            .map((skill) => skill.name.toLowerCase()),
        );
        for (const skill of input.skills) {
          if (projectSkills.has(skill.name.toLowerCase())) continue;
          yield* store.writeSkill({ projectId: input.projectId, ...skill, overwrite: false });
          projectSkills.add(skill.name.toLowerCase());
        }
        return yield* saveLocked({ ...input, definition }, { imported: true });
      }),
    );
  const stepPut: WorkflowRunner["Service"]["stepPut"] = (input) =>
    locked(
      Effect.gen(function* () {
        const definition = yield* store.readDefinition(input);
        const steps = [...definition.steps];
        const index = steps.findIndex((step) => step.id === input.step.id);
        if (index >= 0) steps[index] = input.step;
        else {
          const after =
            input.after === undefined
              ? steps.length - 1
              : input.after === null
                ? -1
                : steps.findIndex((step) => step.id === input.after);
          if (typeof input.after === "string" && after < 0)
            return yield* new WorkflowPreparation.WorkflowInvalidError({
              workflow: input.slug,
              problems: [`No step named "${input.after}" exists.`],
            });
          steps.splice(after + 1, 0, input.step);
        }
        yield* saveLocked({ ...input, definition: { ...definition, steps } });
        return listings.get(input.projectId)!.find((item) => item.workflow === input.slug)!;
      }),
    );
  const stepRemove: WorkflowRunner["Service"]["stepRemove"] = (input) =>
    locked(
      Effect.gen(function* () {
        const definition = yield* store.readDefinition(input);
        if (!definition.steps.some((step) => step.id === input.stepId))
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems: [`No step named "${input.stepId}" exists.`],
          });
        const steps = definition.steps
          .filter((step) => step.id !== input.stepId)
          .map((step) =>
            step.readsFrom === undefined
              ? step
              : { ...step, readsFrom: step.readsFrom.filter((id) => id !== input.stepId) },
          );
        // A note anchored to a removed step stays, but loses the anchor instead of dangling.
        const notes = definition.notes?.map((note) => {
          if (note.anchorStepId !== input.stepId) return note;
          const { anchorStepId: _anchor, ...rest } = note;
          return rest;
        });
        const loops = definition.loops?.filter(
          (loop) => loop.from !== input.stepId && loop.to !== input.stepId,
        );
        const { loops: _loops, ...withoutLoops } = definition;
        yield* saveLocked({
          ...input,
          definition: {
            ...withoutLoops,
            steps,
            ...(notes === undefined ? {} : { notes }),
            ...(loops !== undefined && loops.length > 0 ? { loops } : {}),
          },
        });
        return listings.get(input.projectId)!.find((item) => item.workflow === input.slug)!;
      }),
    );
  const loopPut: WorkflowRunner["Service"]["loopPut"] = Effect.fn("WorkflowRunner.loopPut")(
    (input) =>
      locked(
        Effect.gen(function* () {
          const definition = yield* store.readDefinition(input);
          const loops = [...(definition.loops ?? [])];
          const index = loops.findIndex(
            (loop) => loop.id === input.loop.id || loop.from === input.loop.from,
          );
          if (index >= 0) loops[index] = input.loop;
          else loops.push(input.loop);
          yield* saveLocked({
            ...input,
            definition: { ...definition, loops },
          });
          return listing(input);
        }),
      ),
  );
  const loopRemove: WorkflowRunner["Service"]["loopRemove"] = Effect.fn(
    "WorkflowRunner.loopRemove",
  )((input) =>
    locked(
      Effect.gen(function* () {
        const definition = yield* store.readDefinition(input);
        const existing = definition.loops ?? [];
        if (!existing.some((loop) => loop.id === input.loopId))
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems: [`No loop named "${input.loopId}" exists.`],
          });
        const loops = existing.filter((loop) => loop.id !== input.loopId);
        const { loops: _loops, ...rest } = definition;
        yield* saveLocked({
          ...input,
          definition: loops.length > 0 ? { ...rest, loops } : rest,
        });
        return listing(input);
      }),
    ),
  );
  const listing = (input: Edit) =>
    listings.get(input.projectId)!.find((item) => item.workflow === input.slug)!;
  const templatesList = Effect.succeed(
    workflowTemplates.map((template) => ({
      ...template,
      title: template.definition.name,
      tags: template.definition.tags ?? [],
      steps: template.definition.steps.length,
    })),
  );
  const templateUse: WorkflowRunner["Service"]["templateUse"] = Effect.fn(
    "WorkflowRunner.templateUse",
  )((input) =>
    locked(
      Effect.gen(function* () {
        const template = workflowTemplates.find((item) => item.id === input.templateId);
        if (!template)
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.templateId,
            problems: ["Unknown workflow template."],
          });
        const existing = new Set(
          (yield* store.listDefinitions(input.projectId)).map((item) => item.slug),
        );
        let slug = template.id;
        for (let suffix = 2; existing.has(slug); suffix++) slug = `${template.id}-${suffix}`;
        const saved = yield* saveLocked({
          projectId: input.projectId,
          slug,
          definition: { ...structuredClone(template.definition), builtinTemplate: template.id },
        });
        return {
          slug,
          path: saved.path,
          ...(template.schedule
            ? { suggestedSchedule: { schedule: template.schedule, knobs: template.knobs ?? {} } }
            : {}),
        };
      }),
    ),
  );
  const create: WorkflowRunner["Service"]["create"] = (input) =>
    locked(
      Effect.gen(function* () {
        const existing = yield* store
          .readDefinition(input)
          .pipe(
            Effect.asSome,
            Effect.catchTags({ WorkflowNotFoundError: () => Effect.succeedNone }),
          );
        if (Option.isSome(existing))
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems: ["A workflow with this name already exists."],
          });
        const saved = yield* saveLocked({
          ...input,
          definition: {
            version: 1,
            name: input.name,
            ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
            steps: [],
          },
        });
        return { path: saved.path };
      }),
    );
  const remove: WorkflowRunner["Service"]["remove"] = (input) =>
    locked(
      Effect.gen(function* () {
        yield* store.readDefinition(input);
        // Schedules go first: if their removal fails the workflow survives and the delete can be
        // retried. The reverse order would leave a schedule firing for a workflow that is gone.
        yield* schedules.removeForWorkflow({ projectId: input.projectId, workflow: input.slug });
        yield* workflowPreferences.setWorkflowPinned(
          { projectId: input.projectId, workflow: input.slug },
          false,
        );
        yield* store.deleteDefinition(input);
        // The grant names the user's approval of this workflow's credentials; it dies with it.
        yield* preapprovals.revoke({ projectId: input.projectId, workflow: input.slug });
        yield* refreshListings(input.projectId, input.callerThreadId, input.slug);
        yield* PubSub.publish(changes, input.projectId);
      }),
    );
  const keep: WorkflowRunner["Service"]["keep"] = (input) =>
    locked(
      Effect.gen(function* () {
        const definition = yield* store.readDefinition(input);
        if (definition.origin === undefined) {
          // Already kept: still refresh, so a canvas that missed the first keep sees the same answer.
          yield* refreshListings(input.projectId, input.callerThreadId, input.slug);
          yield* PubSub.publish(changes, input.projectId);
          return listing(input);
        }
        const { origin: _origin, ...kept } = definition;
        yield* saveLocked({ ...input, definition: kept });
        return listing(input);
      }),
    );
  const workflowFirstRead: WorkflowRunner["Service"]["workflowFirstRead"] = Effect.fn(
    "WorkflowRunner.workflowFirstRead",
  )(function* (input) {
    const projectId = yield* workflowFirstProject(input.threadId);
    return yield* workflowFirst.read({ threadId: input.threadId, projectId });
  });
  const workflowFirstSet: WorkflowRunner["Service"]["workflowFirstSet"] = Effect.fn(
    "WorkflowRunner.workflowFirstSet",
  )(function* (input) {
    const projectId = yield* workflowFirstProject(input.threadId);
    const state = yield* workflowFirst.set({
      threadId: input.threadId,
      projectId,
      enabled: input.enabled,
    });
    yield* notifyPreferenceChange(projectId);
    return state;
  });
  const meta: WorkflowRunner["Service"]["meta"] = (input) =>
    locked(
      Effect.gen(function* () {
        const {
          brief: _brief,
          model: _model,
          subagentModels: _subagentModels,
          delegation: _delegation,
          execution: _execution,
          ...definition
        } = yield* store.readDefinition(input);
        const brief = input.brief === undefined ? _brief : (input.brief ?? undefined);
        const legacyDriver = providerSnapshots.find(
          (provider) => provider.instanceId === input.model?.instanceId,
        )?.driver;
        const subagentModels =
          input.subagentModels !== undefined
            ? (input.subagentModels ?? undefined)
            : input.model !== undefined
              ? input.model === null
                ? undefined
                : [
                    {
                      ...(legacyDriver === undefined ? {} : { driver: legacyDriver }),
                      instanceId: input.model.instanceId,
                      model: input.model.model,
                    },
                  ]
              : _subagentModels;
        if (
          subagentModels !== undefined &&
          (input.subagentModels !== undefined || input.model !== undefined)
        ) {
          const seen = new Set<string>();
          for (const hint of subagentModels) {
            const key = `${hint.driver ?? hint.instanceId}\0${hint.model}`;
            if (seen.has(key))
              return yield* new WorkflowPreparation.WorkflowInvalidError({
                workflow: input.slug,
                problems: [
                  `Duplicate subagent model: ${hint.model} (${hint.driver ?? hint.instanceId}).`,
                ],
              });
            seen.add(key);
          }
        }
        const execution =
          input.execution !== undefined
            ? (input.execution ?? undefined)
            : input.delegation !== undefined
              ? (input.delegation ?? undefined)
              : (_execution ?? _delegation);
        yield* saveLocked(
          {
            ...input,
            definition: {
              ...definition,
              ...(input.credentialApprovals === undefined
                ? {}
                : { credentialApprovals: input.credentialApprovals }),
              ...(execution === undefined ? {} : { execution }),
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(brief === undefined ? {} : { brief }),
              ...(subagentModels === undefined ? {} : { subagentModels }),
            },
          },
          // Choosing Pre-approved is the action that records which credentials it covers.
          { reapprove: input.credentialApprovals === "pre-approved" },
        );
        return listing(input);
      }),
    );
  const tagsSet: WorkflowRunner["Service"]["tagsSet"] = Effect.fn("WorkflowRunner.tagsSet")(
    function* (input) {
      return yield* locked(
        Effect.gen(function* () {
          const definition = yield* store.readDefinition(input);
          yield* saveLocked({ ...input, definition: { ...definition, tags: input.tags } });
          return listing(input);
        }),
      );
    },
  );
  const inputsSet: WorkflowRunner["Service"]["inputsSet"] = (input) =>
    locked(
      Effect.gen(function* () {
        const { steps, ...definition } = yield* store.readDefinition(input);
        yield* saveLocked({
          ...input,
          definition: { ...definition, steps, inputs: input.inputs },
        });
        return listing(input);
      }),
    );
  const notePut: WorkflowRunner["Service"]["notePut"] = (input) =>
    locked(
      Effect.gen(function* () {
        const definition = yield* store.readDefinition(input);
        const notes = [...(definition.notes ?? [])];
        const index = notes.findIndex((note) => note.id === input.note.id);
        if (index >= 0) notes[index] = input.note;
        else notes.push(input.note);
        yield* saveLocked({ ...input, definition: { ...definition, notes } });
        return listing(input);
      }),
    );
  const layoutSet: WorkflowRunner["Service"]["layoutSet"] = Effect.fn("WorkflowRunner.layoutSet")(
    (input) =>
      locked(
        Effect.gen(function* () {
          const definition = yield* store.readDefinition(input);
          yield* saveLocked({
            ...input,
            definition: {
              ...definition,
              layout: { ...(input.reset ? {} : definition.layout), ...input.positions },
            },
          });
          return listing(input);
        }),
      ),
  );
  const noteRemove: WorkflowRunner["Service"]["noteRemove"] = (input) =>
    locked(
      Effect.gen(function* () {
        const definition = yield* store.readDefinition(input);
        const existing = definition.notes ?? [];
        if (!existing.some((note) => note.id === input.noteId))
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems: [`No note named "${input.noteId}" exists.`],
          });
        const { notes: _notes, ...rest } = definition;
        const notes = existing.filter((note) => note.id !== input.noteId);
        yield* saveLocked({
          ...input,
          definition: notes.length > 0 ? { ...rest, notes } : rest,
        });
        return listing(input);
      }),
    );
  const stepMove: WorkflowRunner["Service"]["stepMove"] = (input) =>
    locked(
      Effect.gen(function* () {
        const definition = yield* store.readDefinition(input);
        const step = definition.steps.find((item) => item.id === input.stepId);
        const steps = definition.steps.filter((item) => item.id !== input.stepId);
        const after =
          input.after === null ? -1 : steps.findIndex((item) => item.id === input.after);
        if (step === undefined || (input.after !== null && after < 0))
          return yield* new WorkflowPreparation.WorkflowInvalidError({
            workflow: input.slug,
            problems: [
              `No step named "${step === undefined ? input.stepId : input.after}" exists.`,
            ],
          });
        steps.splice(after + 1, 0, step);
        yield* saveLocked({ ...input, definition: { ...definition, steps } });
        return listing(input);
      }),
    );
  const skillsChanged = Effect.fnUntraced(function* (
    projectId: ProjectId,
    callerThreadId: ThreadId | undefined,
  ) {
    yield* refreshListings(projectId, callerThreadId);
    const updatedAt = yield* nowIso;
    // Skill changes affect every listing in the project, including missing-skill warnings.
    listings.set(
      projectId,
      listings.get(projectId)!.map((item) => ({
        ...item,
        updatedAt,
        editedByThreadId: callerThreadId ?? null,
      })),
    );
    yield* PubSub.publish(changes, projectId);
  });
  const resolveSkill = (projectId: ProjectId, name: string) =>
    store.projectRoot(projectId).pipe(
      Effect.flatMap((projectRoot) => skills.resolve({ projectRoot, name })),
      Effect.catchTags({
        SkillNotFoundError: () =>
          Effect.fail(new WorkflowSkillError({ skillName: name, problem: "it isn't installed." })),
      }),
    );
  const skillWrite: WorkflowRunner["Service"]["skillWrite"] = (input) =>
    locked(
      Effect.gen(function* () {
        let saved: { path: string };
        if (input.target === "project") saved = yield* store.writeSkill(input);
        else {
          const skill = yield* resolveSkill(input.projectId, input.name);
          yield* store.rewriteSkillFile({ path: skill.path, content: input.content });
          saved = { path: skill.path };
        }
        yield* skillsChanged(input.projectId, input.callerThreadId);
        return saved;
      }),
    );
  const skillCopyToProject: WorkflowRunner["Service"]["skillCopyToProject"] = (input) =>
    locked(
      Effect.gen(function* () {
        const skill = yield* resolveSkill(input.projectId, input.name);
        if (skill.scope === "project")
          return yield* new WorkflowSkillError({
            skillName: input.name,
            problem: "it's already a project skill.",
          });
        const saved = yield* store.copySkill({
          projectId: input.projectId,
          name: input.name,
          sourceDirectory: path.dirname(skill.path),
        });
        yield* skillsChanged(input.projectId, input.callerThreadId);
        return saved;
      }),
    );
  const skillList: WorkflowRunner["Service"]["skillList"] = Effect.fn("WorkflowRunner.skillList")(
    function* (input) {
      const preferences = yield* workflowPreferences.read;
      const projectRoot = yield* store.projectRoot(input.projectId);
      const list = yield* skills.list({ projectRoot });
      // Project skills first, the way the picker groups them.
      return WorkflowPreferences.markPinnedSkills(
        list.map(skillInfo),
        preferences.pinnedSkills,
      ).toSorted((a, b) => (a.scope === b.scope ? 0 : a.scope === "project" ? -1 : 1));
    },
  );
  const publishPreferenceChange = Effect.fn("WorkflowRunner.publishPreferenceChange")(function* () {
    for (const projectId of yield* store.projectIds) yield* PubSub.publish(changes, projectId);
  });
  const notifyPreferenceChange: WorkflowRunner["Service"]["notifyPreferenceChange"] = (projectId) =>
    PubSub.publish(changes, projectId).pipe(Effect.asVoid);
  const setWorkflowPinned: WorkflowRunner["Service"]["setWorkflowPinned"] = Effect.fn(
    "WorkflowRunner.setWorkflowPinned",
  )(function* (pin, pinned) {
    yield* locked(
      workflowPreferences
        .setWorkflowPinned(pin, pinned)
        .pipe(Effect.andThen(publishPreferenceChange())),
    );
  });
  const setGalleryPreferences: WorkflowRunner["Service"]["setGalleryPreferences"] = Effect.fn(
    "WorkflowRunner.setGalleryPreferences",
  )(function* (input) {
    yield* locked(
      workflowPreferences.setGallery(input).pipe(Effect.andThen(publishPreferenceChange())),
    );
  });
  const setSkillPinned: WorkflowRunner["Service"]["setSkillPinned"] = (name, pinned) =>
    locked(
      workflowPreferences.setPinned(name, pinned).pipe(Effect.andThen(publishPreferenceChange())),
    );
  const setMaxSubagentModels: WorkflowRunner["Service"]["setMaxSubagentModels"] = (
    maxSubagentModels,
  ) =>
    locked(
      workflowPreferences
        .setMaxSubagentModels(maxSubagentModels)
        .pipe(Effect.andThen(publishPreferenceChange())),
    );
  const setWorkflowFirstForNewThreads: WorkflowRunner["Service"]["setWorkflowFirstForNewThreads"] =
    (enabled) =>
      locked(
        workflowPreferences
          .setWorkflowFirstForNewThreads(enabled)
          // fork(workflow-first): this preference is environment-wide, including with no projects.
          .pipe(Effect.andThen(PubSub.publish(changes, undefined)), Effect.asVoid),
      );
  const skillRead: WorkflowRunner["Service"]["skillRead"] = (input) =>
    resolveSkill(input.projectId, input.name).pipe(
      Effect.map((skill) => ({ ...skillInfo(skill), text: skill.text })),
    );
  const preflight: WorkflowRunner["Service"]["preflight"] = Effect.fn("WorkflowRunner.preflight")(
    function* (input) {
      const definition = yield* store.readDefinition(input);
      const projectRoot = yield* store.projectRoot(input.projectId);
      const blockers = yield* blockersFor(
        input.projectId,
        definition,
        yield* skills.list({ projectRoot }),
      );
      const projectMap = new Map<string, WorkflowDefinition | null>();
      for (const item of yield* store.listDefinitions(input.projectId))
        projectMap.set(item.slug, item.definition);
      projectMap.set(input.slug, definition);
      for (const message of validateNesting(projectMap))
        blockers.push({ stepId: null, kind: "invalid", message });
      return blockers;
    },
  );
  const readiness: WorkflowRunner["Service"]["readiness"] = Effect.fn("WorkflowRunner.readiness")(
    function* (input) {
      return yield* preparation.readiness(input);
    },
  );
  const probe: WorkflowRunner["Service"]["probe"] = Effect.fn("WorkflowRunner.probe")(
    function* (input) {
      // Probes run outside the mutation lock; login and version checks may take seconds.
      const probed = yield* preparation.probeResources(input);
      const applied = yield* locked(
        Effect.gen(function* () {
          const applied = yield* preparation.recordProbe({
            projectId: input.projectId,
            slug: input.slug,
            definition: probed.definition,
            contextKey: probed.contextKey,
            snapshot: probed.snapshot,
          });
          if (!applied) return false;
          yield* refreshListings(input.projectId);
          yield* PubSub.publish(changes, input.projectId);
          return true;
        }),
      );
      if (!applied)
        return yield* new WorkflowPreparation.WorkflowInvalidError({
          workflow: input.slug,
          problems: ["The workflow changed while readiness was being checked. Check it again."],
        });
      return probed.snapshot;
    },
  );
  const skillSave: WorkflowRunner["Service"]["skillSave"] = (input) =>
    locked(
      Effect.gen(function* () {
        const saved = yield* store.writeSkill(input);
        yield* skillsChanged(input.projectId, input.callerThreadId);
        return saved;
      }),
    );
  /**
   * Pins skills and writes a new run. `seed` carries steps copied from an earlier run; only the
   * steps left to run need their skills installed and their requirements met.
   */
  const createRun = Effect.fnUntraced(function* (input: {
    projectId: ProjectId;
    slug: string;
    driverThreadId: ThreadId;
    callerThreadId?: ThreadId | undefined;
    definition: WorkflowDefinition;
    inputs?: Readonly<Record<string, string>> | undefined;
    lastRunResult?: WorkflowCarryOverResult | undefined;
    triggerSourceRunId?: string;
    scheduleTaskId?: ScheduledTaskId;
    parent?: WorkflowRun["parent"];
    seed?: ReadonlyMap<string, WorkflowStepRun>;
    rerunOf?: WorkflowRun["rerunOf"];
    /** Run-start readiness; blocked requirements stop the run with their own reasons. */
    preflight?: WorkflowReadinessSnapshot | undefined;
    subagents?: WorkflowSubagentsSnapshot | undefined;
    beforePersist?: Effect.Effect<void, StartError> | undefined;
    rollbackBeforePersist?: Effect.Effect<void> | undefined;
  }): Effect.fn.Return<RunResult, StartError> {
    const { definition } = input;
    const problems = validateWorkflow(definition);
    if (problems.length)
      return yield* new WorkflowPreparation.WorkflowInvalidError({
        workflow: input.slug,
        problems,
      });
    const projectMap = new Map<string, WorkflowDefinition | null>();
    for (const item of yield* store.listDefinitions(input.projectId))
      projectMap.set(item.slug, item.definition);
    projectMap.set(input.slug, definition);
    // Running ancestors keep their pinned definitions even if their saved files were edited.
    const visited = new Set<string>();
    let parentId = input.parent?.runId;
    while (parentId !== undefined) {
      if (visited.has(parentId))
        return yield* new WorkflowPreparation.WorkflowInvalidError({
          workflow: input.slug,
          problems: ["The parent runs include each other in a loop."],
        });
      visited.add(parentId);
      const parent = yield* readRun(parentId);
      projectMap.set(parent.workflow, parent.definition);
      parentId = parent.parent?.runId;
    }
    const nesting = validateNesting(projectMap);
    if (nesting.length)
      return yield* new WorkflowPreparation.WorkflowInvalidError({
        workflow: input.slug,
        problems: nesting,
      });
    const inputs = resolveRunInputs(definition.inputs, input.inputs);
    const inputProblems = validateRunInputs(definition, inputs);
    if (inputProblems.length)
      return yield* new WorkflowInputsError({ workflow: input.slug, problems: inputProblems });
    if (input.preflight?.blocksRun) {
      const problems = [
        ...new Set(
          input.preflight.entries
            .filter(
              (entry) =>
                entry.kind !== "mcp-connection" &&
                // Credential cards are advisory here; unattended starts check them above.
                entry.kind !== "credential" &&
                (entry.status === "missing" ||
                  entry.status === "error" ||
                  entry.status === "unknown"),
            )
            .map((entry) => entry.message),
        ),
      ];
      return yield* new WorkflowBlockedError({ workflow: input.slug, problems });
    }
    const projection = yield* threads.getThreadProjection(input.driverThreadId).pipe(
      Effect.mapError(
        (cause) =>
          new WorkflowStore.WorkflowFileError({
            operation: "read",
            path: `thread ${input.driverThreadId}`,
            cause,
          }),
      ),
    );
    const root = projection.thread.worktreePath ?? (yield* store.projectRoot(input.projectId));
    const toRun = definition.steps.filter((step) => !input.seed?.has(step.id));
    const skillSteps = toRun.filter((step) => step.kind !== "workflow");
    const names = [...new Set(skillSteps.map((step) => step.skill))];
    const resolved = yield* Effect.forEach(names, (name) =>
      skills.resolve({ projectRoot: root, name }).pipe(Effect.option),
    );
    const missing = names.filter((_, i) => Option.isNone(resolved[i]!));
    if (missing.length)
      return yield* new WorkflowSkillsMissingError({ workflow: input.slug, skills: missing });
    const blocked = yield* blockersFor(
      input.projectId,
      definition,
      yield* skills.list({ projectRoot: root }),
      new Set(toRun.map((step) => step.id)),
    );
    if (blocked.length)
      return yield* new WorkflowBlockedError({
        workflow: input.slug,
        problems: blocked.map((blocker) => blocker.message),
      });
    const pinned = names.map((name, i) => ({ name, skill: Option.getOrThrow(resolved[i]!) }));
    const now = yield* nowIso;
    const uuid = yield* crypto.uuidV4().pipe(Effect.orDie);
    const loopStepIds = new Set(
      (definition.loops ?? []).flatMap((loop) => [...loopRangeStepIds(definition, loop)]),
    );
    const initialLoopRounds =
      definition.loops && definition.loops.length > 0
        ? Object.fromEntries(definition.loops.map((loop) => [loop.id, 1]))
        : undefined;
    let run = yield* advance({
      id: `wf-${now.slice(0, 10).replaceAll("-", "")}-${uuid.slice(0, 8)}`,
      projectId: input.projectId,
      workflow: input.slug as WorkflowSlug,
      driverThreadId: input.driverThreadId,
      ...(input.inputs === undefined && Object.keys(inputs).length === 0 ? {} : { inputs }),
      ...(input.lastRunResult === undefined ? {} : { lastRunResult: input.lastRunResult }),
      ...(initialLoopRounds === undefined ? {} : { loopRounds: initialLoopRounds }),
      ...(input.scheduleTaskId === undefined ? {} : { scheduleTaskId: input.scheduleTaskId }),
      ...(input.triggerSourceRunId === undefined
        ? {}
        : { triggerSourceRunId: input.triggerSourceRunId }),
      ...(input.parent === undefined ? {} : { parent: input.parent }),
      ...(input.rerunOf === undefined ? {} : { rerunOf: input.rerunOf }),
      triggerDispatchPending: true,
      status: "running",
      startedAt: now,
      definition,
      definitionRevision: yield* definitionDigest(definition),
      ...(input.subagents === undefined ? {} : { subagents: input.subagents }),
      skills: pinned.map(({ name, skill }) => ({
        name,
        path: skill.path,
        sha256: skill.sha256,
      })),
      ...(input.preflight === undefined || input.preflight.entries.length === 0
        ? {}
        : { preflight: input.preflight }),
      steps: yield* Effect.forEach(definition.steps, (step) =>
        Effect.gen(function* () {
          const seeded = input.seed?.get(step.id);
          if (seeded !== undefined) return seeded;
          const inLoop = loopStepIds.has(step.id);
          const executionToken = inLoop
            ? (yield* crypto.uuidV4().pipe(Effect.orDie)).slice(0, 12)
            : undefined;
          return {
            stepId: step.id,
            status: "queued" as const,
            threadId: null,
            attempts: 0,
            ...(inLoop ? { round: 1, executionToken } : {}),
          };
        }),
      ),
    });
    if (input.callerThreadId === input.driverThreadId) {
      const stateKey = yield* wakeStateKey(run);
      run = {
        ...run,
        driverWakeup: {
          revision: 1,
          acknowledgedRevision: 1,
          key: stateKey,
          stateKey,
          message: "",
          queuedAt: now,
          attempts: 0,
        },
      };
    }
    if (input.beforePersist !== undefined) yield* input.beforePersist;
    yield* store
      .writeSkillTexts(
        run.id,
        Object.fromEntries(pinned.map(({ name, skill }) => [name, skill.text])),
      )
      .pipe(
        Effect.andThen(writeRun(run)),
        Effect.tapError(() => input.rollbackBeforePersist ?? Effect.void),
      );
    return yield* result(run);
  });
  /**
   * Reject unattended runs that need an approval prompt no one can answer.
   * Only workflows claiming pre-approval are checked against the local grant.
   * Other controls come from the run and workflow grants made while watching.
   */
  const unattendedCredentialBlockers = Effect.fn("WorkflowRunner.unattendedCredentialBlockers")(
    function* (input: {
      readonly projectId: ProjectId;
      readonly slug: string;
      readonly definition: WorkflowDefinition;
    }) {
      const credentials = yield* credentialStore.list().pipe(Effect.option);
      // An unreadable vault is the readiness blocker's business; this check never guesses.
      if (Option.isNone(credentials)) return [];
      const approved = new Set(
        yield* preapprovals.approved({ projectId: input.projectId, workflow: input.slug }),
      );
      // Only a workflow that claims pre-approval is governed by that grant.
      const preApproved = input.definition.credentialApprovals === "pre-approved";
      const uncovered: string[] = [];
      const alwaysAsk: string[] = [];
      for (const step of input.definition.steps) {
        for (const attachment of step.attachments ?? []) {
          if (attachment.kind !== "credential" || attachment.optional === true) continue;
          const resolution = CredentialAttachments.resolveCredentialAttachment({
            attachment,
            projectId: input.projectId,
            credentials: credentials.value,
          });
          // A credential the step cannot use at all is the readiness blocker's business.
          if (
            resolution.state !== "ready" &&
            resolution.state !== "matched" &&
            resolution.state !== "expiring"
          )
            continue;
          const credential = resolution.credential;
          if (credential.policy.alwaysAsk) {
            alwaysAsk.push(credential.name);
            continue;
          }
          if (preApproved && !approved.has(credential.id)) uncovered.push(credential.name);
        }
      }
      const names = [...new Set([...uncovered, ...alwaysAsk])];
      if (names.length === 0) return [];
      return [
        `Re-approve credentials for scheduled runs: ${names.join(", ")}.`,
        ...alwaysAsk.map(
          (name) => `"${name}" always asks before use, so a scheduled run can't use it.`,
        ),
      ];
    },
  );
  // Saved definitions can be edited under a running parent, so every start walks the nested graph
  // before creating a run: a loop must fail as a nesting error, not recurse forever.
  const assertNestedDefinitionsAcyclic = Effect.fnUntraced(function* (
    projectId: ProjectId,
    slug: string,
    root: WorkflowDefinition,
    snapshots: ReadonlyMap<string, WorkflowDefinition> = new Map(),
  ) {
    const definitions = new Map(
      (yield* store.listDefinitions(projectId)).map((entry) => [entry.slug, entry.definition]),
    );
    for (const [snapshotSlug, definition] of snapshots) definitions.set(snapshotSlug, definition);
    definitions.set(slug, root);
    const visit = Effect.fnUntraced(function* (
      definition: WorkflowDefinition,
      ancestors: ReadonlySet<string>,
    ): Effect.fn.Return<void, WorkflowNestingError> {
      for (const step of definition.steps) {
        if (step.kind !== "workflow") continue;
        const nested = definitions.get(step.workflow);
        if (nested === undefined || nested === null) continue;
        if (ancestors.has(step.workflow))
          return yield* new WorkflowNestingError({
            workflow: slug,
            problem: `The nested workflow graph contains a loop through "${step.workflow}".`,
          });
        yield* visit(nested, new Set([...ancestors, step.workflow]));
      }
    });
    yield* visit(root, new Set([slug]));
  });
  const start: WorkflowRunner["Service"]["start"] = Effect.fn("WorkflowRunner.start")(
    function* (input) {
      // Read and probe the pinned definition outside the mutation lock; login checks may take seconds.
      const definition = yield* locked(store.readDefinition(input));
      yield* assertNestedDefinitionsAcyclic(input.projectId, input.slug, definition);
      const subagents = yield* preparation.subagents(definition);
      const prepared = yield* preparation.prepare({
        subagents,
        projectId: input.projectId,
        definition,
        contextThreadId: input.driverThreadId,
      });
      // Nobody is watching an unattended start, so an unusable required credential stops it with
      // a reason instead of greeting the driver with a step it can't carry out.
      if (input.unattended === true) {
        const blocked = CredentialAttachments.blockingCredentialEntries(prepared);
        if (blocked.length > 0)
          return yield* new WorkflowBlockedError({
            workflow: input.slug,
            problems: [...new Set(blocked.map((entry) => entry.message))],
          });
        const uncovered = yield* unattendedCredentialBlockers({
          projectId: input.projectId,
          slug: input.slug,
          definition,
        });
        if (uncovered.length > 0)
          return yield* new WorkflowBlockedError({
            workflow: input.slug,
            problems: uncovered,
          });
      }
      const run = yield* locked(
        Effect.gen(function* () {
          const latest = yield* store.readDefinition(input);
          if (!sameDefinition(latest, definition))
            return yield* new WorkflowBlockedError({
              workflow: input.slug,
              problems: [
                "The saved workflow changed during readiness checks. Review and run it again.",
              ],
            });
          yield* assertNestedDefinitionsAcyclic(input.projectId, input.slug, latest);
          let endsAfterStart = false;
          let lastRunResult: WorkflowCarryOverResult | undefined;
          let nextScheduleBinding:
            | {
                readonly id: ScheduledTaskId;
                readonly previous: ReturnType<typeof applyScheduledRotation>["nextBinding"];
                readonly next: ReturnType<typeof applyScheduledRotation>["nextBinding"];
              }
            | undefined;
          if (input.triggerSourceRunId) {
            const existing = [...runs.values()].find(
              (candidate) =>
                candidate.projectId === input.projectId &&
                candidate.workflow === input.slug &&
                candidate.triggerSourceRunId === input.triggerSourceRunId,
            );
            if (existing) return yield* result(existing);
          }
          if (input.scheduleTaskId) {
            const { tasks } = yield* schedules.list({
              projectId: input.projectId,
              workflow: input.slug as WorkflowSlug,
            });
            const task = tasks.find((task) => task.id === input.scheduleTaskId);
            const binding = task ? workflowScheduleBinding(task) : null;
            if (!task || !binding)
              return yield* new WorkflowBlockedError({
                workflow: input.slug,
                problems: ["This schedule no longer exists."],
              });
            const active = [...runs.values()].find(
              (run) =>
                run.projectId === input.projectId && run.workflow === input.slug && !terminal(run),
            );
            const decision = scheduledStartDecision({
              binding,
              now: yield* nowIso,
              runCount: [...runs.values()].filter((run) => run.scheduleTaskId === task.id).length,
              active: active !== undefined,
            });
            if (decision === "ended")
              yield* schedules.setEnabled({
                projectId: input.projectId,
                workflow: input.slug as WorkflowSlug,
                id: task.id,
                enabled: false,
              });
            if (decision === "queue" && active) {
              yield* writeRun({
                ...active,
                queuedScheduleTaskIds: [
                  ...new Set([...(active.queuedScheduleTaskIds ?? []), task.id]),
                ],
              });
              return yield* result(active);
            }
            if (decision !== "start")
              return yield* new WorkflowBlockedError({
                workflow: input.slug,
                problems: [`Schedule fire skipped: ${decision}.`],
              });
            const now = yield* nowIso;
            const number =
              [...runs.values()].filter((run) => run.scheduleTaskId === task.id).length + 1;
            endsAfterStart =
              binding.ends?.afterRuns !== undefined && number >= binding.ends.afterRuns;
            lastRunResult = resolveScheduledCarryOver(binding, runs.values());
            const rotated = applyScheduledRotation(binding, input.inputs ?? binding.inputs);
            if (rotated.nextBinding !== binding)
              nextScheduleBinding = {
                id: task.id,
                previous: binding,
                next: rotated.nextBinding,
              };
            const carryOverText =
              lastRunResult === undefined ? "" : formatCarryOverBrief(lastRunResult);
            input = {
              ...input,
              inputs: Object.fromEntries(
                Object.entries(rotated.inputs).map(([id, value]) => [
                  id,
                  value
                    .replaceAll("{{date}}", now.slice(0, 10))
                    .replaceAll("{{run.number}}", String(number))
                    .replaceAll("{{last.result}}", carryOverText),
                ]),
              ),
            };
          }
          const created = yield* createRun({
            ...input,
            definition,
            ...(lastRunResult === undefined ? {} : { lastRunResult }),
            preflight: prepared,
            subagents,
            ...(nextScheduleBinding !== undefined && schedules.updateBinding !== undefined
              ? {
                  beforePersist: schedules.updateBinding({
                    projectId: input.projectId,
                    workflow: input.slug as WorkflowSlug,
                    id: nextScheduleBinding.id,
                    binding: nextScheduleBinding.next,
                  }),
                  rollbackBeforePersist: schedules
                    .updateBinding({
                      projectId: input.projectId,
                      workflow: input.slug as WorkflowSlug,
                      id: nextScheduleBinding.id,
                      binding: nextScheduleBinding.previous,
                    })
                    .pipe(Effect.ignore),
                }
              : {}),
          });
          if (endsAfterStart && input.scheduleTaskId)
            yield* schedules.setEnabled({
              projectId: input.projectId,
              workflow: input.slug as WorkflowSlug,
              id: input.scheduleTaskId,
              enabled: false,
            });
          return created;
        }),
      );
      yield* wakeDriver(run, "run started from the canvas.", input.callerThreadId, true);
      return run;
    },
  );
  const fireAfter = Effect.fn("WorkflowRunner.fireAfter")(function* (source: WorkflowRun) {
    if (!source.triggerDispatchPending) return;
    for (const taskId of source.queuedScheduleTaskIds ?? []) {
      const { tasks } = yield* schedules.list({
        projectId: source.projectId,
        workflow: source.workflow,
      });
      const task = tasks.find((task) => task.id === taskId);
      const binding = task ? workflowScheduleBinding(task) : null;
      if (task?.enabled && binding && task.threadId)
        yield* start({
          projectId: source.projectId,
          slug: source.workflow,
          driverThreadId: task.threadId,
          inputs: binding.inputs,
          scheduleTaskId: task.id,
          triggerSourceRunId: source.id,
          unattended: true,
        }).pipe(Effect.ignore);
    }
    for (const entry of yield* store.listDefinitions(source.projectId)) {
      if (
        !entry.definition?.startAfter?.some(
          (trigger) =>
            trigger.enabled !== false &&
            trigger.workflow === source.workflow &&
            (trigger.when === "finished" || source.status === "done"),
        )
      )
        continue;
      yield* start({
        projectId: source.projectId,
        slug: entry.slug,
        driverThreadId: source.driverThreadId,
        triggerSourceRunId: source.id,
        unattended: true,
      }).pipe(Effect.catch((error) => Effect.logWarning("workflow.after-start-failed", error)));
    }
    yield* locked(
      Effect.gen(function* () {
        const current = yield* readRun(source.id);
        yield* writeRun({ ...current, triggerDispatchPending: false });
      }),
    );
  });
  const stepRerun: WorkflowRunner["Service"]["stepRerun"] = Effect.fn("WorkflowRunner.stepRerun")(
    function* (input) {
      const state = yield* locked(
        Effect.gen(function* () {
          const previous = yield* readRun(input.runId);
          yield* requireStep(previous, input.stepId);
          if (!terminal(previous))
            return yield* new WorkflowStepStateError({
              runId: previous.id,
              stepId: input.stepId,
              expected: "finished-run",
              status: previous.status,
            });
          const definition = yield* store.readDefinition({
            projectId: previous.projectId,
            slug: previous.workflow,
          });
          if (!definition.steps.some((step) => step.id === input.stepId))
            return yield* new WorkflowPreparation.WorkflowInvalidError({
              workflow: previous.workflow,
              problems: [`The saved workflow no longer has a step "${input.stepId}".`],
            });
          const rerun = new Set([input.stepId]);
          for (let grew = true; grew;) {
            grew = false;
            for (const step of definition.steps)
              if (
                !rerun.has(step.id) &&
                stepDependencies(definition, step.id).some((id) => rerun.has(id))
              ) {
                rerun.add(step.id);
                grew = true;
              }
          }
          return { previous, definition, rerun };
        }),
      );
      const driverThreadId = input.driverThreadId ?? state.previous.driverThreadId;
      yield* assertNestedDefinitionsAcyclic(
        state.previous.projectId,
        state.previous.workflow,
        state.definition,
      );
      const subagents = yield* preparation.subagents(state.definition);
      const preflight = yield* preparation.prepare({
        subagents,
        projectId: state.previous.projectId,
        definition: state.definition,
        contextThreadId: driverThreadId,
        stepIds: state.rerun,
      });
      const run = yield* locked(
        Effect.gen(function* () {
          const previous = yield* readRun(input.runId);
          if (!terminal(previous))
            return yield* new WorkflowStepStateError({
              runId: previous.id,
              stepId: input.stepId,
              expected: "finished-run",
              status: previous.status,
            });
          const definition = yield* store.readDefinition({
            projectId: previous.projectId,
            slug: previous.workflow,
          });
          if (!sameDefinition(definition, state.definition))
            return yield* new WorkflowBlockedError({
              workflow: previous.workflow,
              problems: [
                "The saved workflow changed during readiness checks. Review and rerun it again.",
              ],
            });
          yield* assertNestedDefinitionsAcyclic(previous.projectId, previous.workflow, definition);
          const seed = new Map(
            previous.steps
              .filter(
                (step) =>
                  step.status === "done" &&
                  !state.rerun.has(step.stepId) &&
                  definition.steps.some((item) => item.id === step.stepId),
              )
              .map((step) => [step.stepId, step]),
          );
          return yield* createRun({
            projectId: previous.projectId,
            slug: previous.workflow,
            driverThreadId,
            callerThreadId: input.callerThreadId,
            definition,
            inputs: previous.inputs,
            seed,
            rerunOf: { runId: previous.id, stepId: input.stepId as WorkflowSlug },
            preflight,
            subagents,
          });
        }),
      );
      yield* wakeDriver(
        run,
        `rerunning from step "${input.stepId}" (earlier results copied from ${input.runId}).`,
        input.callerThreadId,
        true,
      );
      return run;
    },
  );
  const stepSkip: WorkflowRunner["Service"]["stepSkip"] = Effect.fn("WorkflowRunner.stepSkip")(
    function* (input) {
      const skipped = yield* locked(
        Effect.gen(function* () {
          let run = yield* readRun(input.runId);
          const step = yield* requireStep(run, input.stepId);
          if (terminal(run) || !["queued", "ready", "waiting"].includes(step.status))
            return yield* new WorkflowStepStateError({
              runId: run.id,
              stepId: step.stepId,
              expected: "skippable",
              status: terminal(run) ? run.status : step.status,
            });
          const now = yield* nowIso;
          run = replaceStep(run, step.stepId, (current) => ({
            ...withoutWaiting(current),
            status: "skipped",
            endedAt: now,
          }));
          run = yield* advance(run);
          yield* writeRun(run);
          yield* settleChildCompletion(run);
          return { run, view: yield* result(run), stepId: step.stepId };
        }),
      );
      yield* wakeDriver(
        skipped.run,
        `step "${skipped.stepId}" skipped by the user.`,
        input.callerThreadId,
      );
      return skipped.view;
    },
  );
  const depthOf = (run: WorkflowRun): number => {
    let depth = 0;
    let parentId = run.parent?.runId;
    const visited = new Set([run.id]);
    while (parentId !== undefined) {
      if (visited.has(parentId)) return Infinity;
      visited.add(parentId);
      depth += 1;
      const ancestor = runs.get(parentId);
      if (ancestor === undefined || ancestor.parent === undefined) break;
      parentId = ancestor.parent.runId;
    }
    return depth;
  };

  /** A workflow step's input mapping, with {{input.<id>}} resolved against the parent run's inputs. */
  const mappedChildInputs = (
    step: Extract<WorkflowStep, { kind: "workflow" }>,
    parentInputs: Readonly<Record<string, string>> | undefined,
    lastResult?: string,
  ): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(step.inputs ?? {}))
      out[id] = renderInputValue(value, parentInputs ?? {}, lastResult);
    return out;
  };

  /** Evaluates a loop ending at `step.stepId`, resetting enclosed steps and budgets on `revise`. */
  const evaluateStepLoop = Effect.fnUntraced(function* (
    run: WorkflowRun,
    step: WorkflowStepRun,
    loop: NonNullable<WorkflowDefinition["loops"]>[number],
    input: {
      callerThreadId: ThreadId;
      summary: string;
      outputs: Readonly<Record<string, string>>;
      checks: ReadonlyArray<WorkflowCheckResult>;
      checkFailures: string;
      attempts: number;
      now: string;
    },
    advanceRun = true,
  ) {
    const currentRound = run.loopRounds?.[loop.id] ?? step.round ?? 1;
    const verdictResult =
      loop.until.kind === "checks-pass"
        ? {
            verdict: input.checks.every((check) => check.ok)
              ? ("pass" as const)
              : ("revise" as const),
            ...(input.checkFailures ? { reason: input.checkFailures } : {}),
          }
        : parseStepVerdict(input.summary, input.outputs);
    if (verdictResult.verdict !== "revise") return undefined;
    const definition = run.definition.steps.find((item) => item.id === step.stepId)!;
    if (currentRound < loop.maxRounds) {
      const nextRound = currentRound + 1;
      const rangeIds = new Set(loopRangeStepIds(run.definition, loop));
      // Interrupt running subagent threads, stop child runs, and cancel validations inside the reset range.
      const staleThreads = [
        ...new Set(
          run.steps
            .filter(
              (candidate) =>
                rangeIds.has(candidate.stepId) &&
                candidate.stepId !== step.stepId &&
                candidate.threadId !== null &&
                candidate.threadId !== run.driverThreadId,
            )
            .map((candidate) => candidate.threadId!),
        ),
      ];
      for (const threadId of staleThreads) {
        yield* threads
          .interruptThread({
            projectId: run.projectId,
            threadId,
            commandId: CommandId.make(
              `workflow:${run.id}:${threadId}:loop:${loop.id}:${nextRound}`,
            ),
            reason: "The workflow loop started a new round.",
          })
          .pipe(Effect.ignore);
      }
      for (const candidate of run.steps) {
        if (!rangeIds.has(candidate.stepId) || candidate.stepId === step.stepId) continue;
        const handle = validations.get(validationKey(run.id, candidate.stepId));
        if (handle !== undefined) yield* Deferred.succeed(handle.cancel, undefined);
        if (candidate.childRunId !== undefined) {
          const childRun = runs.get(candidate.childRunId);
          if (childRun !== undefined && !terminal(childRun)) {
            yield* interruptLinked(childRun, "The parent workflow loop started a new round.");
            yield* writeRun(stopRunRecord(childRun, input.now));
            yield* stopDescendants(
              childRun,
              "The parent workflow loop started a new round.",
              input.now,
            );
            yield* cancelRunValidations(childRun.id);
          }
        }
      }
      const allLoops = run.definition.loops ?? [];
      const indices = new Map(run.definition.steps.map((item, index) => [item.id, index]));
      const toIndex = indices.get(loop.to)!;
      const fromIndex = indices.get(loop.from)!;
      // Dependency expansion may include an outer loop's endpoint without enclosing that loop.
      const enclosedLoops = allLoops.filter(
        (other) =>
          other.id !== loop.id &&
          indices.get(other.to)! >= toIndex &&
          indices.get(other.from)! <= fromIndex,
      );
      const enclosedLoopIds = new Set(enclosedLoops.map((other) => other.id));
      const nextLoopRounds: Record<string, number> = {
        ...Object.fromEntries(allLoops.map((item) => [item.id, 1])),
        ...run.loopRounds,
        [loop.id]: nextRound,
      };
      for (const enclosed of enclosedLoops) nextLoopRounds[enclosed.id] = 1;
      const nextStepRound = (stepId: string): number => {
        const owner = enclosingLoopForStep(run.definition, stepId);
        return owner === null ? nextRound : (nextLoopRounds[owner.id] ?? 1);
      };
      const remainingExhausted = (run.exhaustedLoops ?? []).filter(
        (id) => id !== loop.id && !enclosedLoopIds.has(id),
      );
      const { exhaustedLoops: _exhausted, ...runWithoutExhausted } = run;
      const resetSteps = yield* Effect.forEach(run.steps, (current) =>
        Effect.gen(function* () {
          if (!rangeIds.has(current.stepId)) return current;
          const isFrom = current.stepId === step.stepId;
          const roundSummary = isFrom ? input.summary : current.summary;
          const roundOutputs = isFrom ? input.outputs : current.outputs;
          const roundChecks = isFrom ? input.checks : current.checks;
          const roundError = isFrom ? verdictResult.reason : current.error;
          const roundEndedAt = isFrom ? input.now : current.endedAt;
          const roundStatus = isFrom ? "done" : current.status;
          const roundAttempts = isFrom ? input.attempts : current.attempts;
          const roundThreadId = isFrom
            ? current.status === "ready"
              ? input.callerThreadId
              : current.threadId
            : current.threadId;
          const shouldRecord = isFrom || current.status !== "queued" || current.threadId !== null;
          const record: WorkflowStepRoundSummary = {
            round: isFrom ? currentRound : (current.round ?? currentRound),
            ...(current.executionToken === undefined
              ? {}
              : { executionToken: current.executionToken }),
            status: roundStatus,
            attempts: roundAttempts,
            ...(roundThreadId !== null && roundThreadId !== undefined
              ? { threadId: roundThreadId }
              : {}),
            ...(roundSummary !== undefined && roundSummary !== "" ? { summary: roundSummary } : {}),
            ...(roundOutputs !== undefined ? { outputs: roundOutputs } : {}),
            ...(roundChecks !== undefined && roundChecks.length > 0
              ? { checks: [...roundChecks] }
              : {}),
            ...(roundError !== undefined && roundError !== "" ? { error: roundError } : {}),
            ...(roundEndedAt !== undefined ? { endedAt: roundEndedAt } : {}),
            ...(isFrom ? { verdict: verdictResult.verdict } : {}),
          };
          const executionToken = (yield* crypto.uuidV4().pipe(Effect.orDie)).slice(0, 12);
          return {
            stepId: current.stepId,
            status: "queued" as const,
            threadId: null,
            attempts: 0,
            round: nextStepRound(current.stepId),
            executionToken,
            previousRounds: [...(current.previousRounds ?? []), ...(shouldRecord ? [record] : [])],
          };
        }),
      );
      const loopedRun: WorkflowRun = {
        ...runWithoutExhausted,
        loopRounds: nextLoopRounds,
        ...(remainingExhausted.length > 0 ? { exhaustedLoops: remainingExhausted } : {}),
        steps: resetSteps,
      };
      return advanceRun ? yield* advance(loopedRun) : loopedRun;
    }
    const previews = WorkflowOutputPreviews.pendingPreviews(input.outputs);
    const exhaustedStatus: WorkflowStepRun["status"] = definition.pauseAfter ? "waiting" : "done";
    const exhaustedRun: WorkflowRun = {
      ...replaceStep(run, step.stepId, (current) => {
        const {
          error: _error,
          endedAt: _endedAt,
          outputPreviews: _previews,
          checking: _checking,
          ...clean
        } = current;
        return {
          ...clean,
          status: exhaustedStatus,
          attempts: input.attempts,
          round: currentRound,
          loopExhausted: true,
          threadId: step.status === "ready" ? input.callerThreadId : step.threadId,
          startedAt: step.status === "ready" ? input.now : step.startedAt,
          ...(input.summary !== "" || current.summary !== undefined
            ? { summary: input.summary }
            : {}),
          ...(Object.keys(input.outputs).length > 0 || current.outputs !== undefined
            ? { outputs: input.outputs }
            : {}),
          ...(Object.keys(previews).length ? { outputPreviews: previews } : {}),
          ...(input.checks.length > 0 || current.checks !== undefined
            ? { checks: input.checks }
            : {}),
          ...(exhaustedStatus === "waiting" ? { waitingFor: "resume" as const } : {}),
          endedAt: input.now,
        };
      }),
      exhaustedLoops: [...new Set([...(run.exhaustedLoops ?? []), loop.id])],
    };
    return advanceRun ? yield* advance(exhaustedRun) : exhaustedRun;
  });

  /** Terminal children settle their owning steps, cascading until an ancestor needs more work. */
  const settleChildCompletion = Effect.fnUntraced(function* (child: WorkflowRun) {
    const visited = new Set([child.id]);
    while (child.parent !== undefined && terminal(child)) {
      if (visited.has(child.parent.runId)) return;
      visited.add(child.parent.runId);
      const parentOpt = yield* readRun(child.parent.runId).pipe(Effect.option);
      if (Option.isNone(parentOpt)) return;
      const parent = parentOpt.value;
      if (terminal(parent)) return;
      const parentStep = parent.steps.find((item) => item.stepId === child.parent!.stepId);
      if (parentStep?.status !== "running" || parentStep.childRunId !== child.id) return;
      const definition = parent.definition.steps.find((item) => item.id === parentStep.stepId);
      if (definition?.kind !== "workflow") return;
      const now = yield* nowIso;
      const failed = child.status !== "done";
      const lastDoneChildStep = [...child.steps]
        .toReversed()
        .find((item) => item.status === "done");
      const childSummary = lastDoneChildStep?.summary ?? "";
      const childOutputs = lastDoneChildStep?.outputs ?? {};
      const childChecks = lastDoneChildStep?.checks ?? [];
      const loop = (parent.definition.loops ?? []).find(
        (candidate) => candidate.from === parentStep.stepId,
      );
      if (!failed && loop !== undefined) {
        const checkFailures = childChecks
          .filter((check) => !check.ok)
          .map((check) => check.message)
          .join(" ");
        const looped = yield* evaluateStepLoop(parent, parentStep, loop, {
          callerThreadId: parentStep.threadId ?? parent.driverThreadId,
          summary: childSummary,
          outputs: childOutputs,
          checks: childChecks,
          checkFailures,
          attempts: parentStep.attempts,
          now,
        });
        if (looped !== undefined) {
          child = looped;
          yield* writeRun(child);
          continue;
        }
      }
      const status = failed ? "failed" : definition.pauseAfter ? "waiting" : "done";
      const updated = replaceStep(parent, parentStep.stepId, (current) => ({
        ...withoutWaiting(current),
        status,
        endedAt: now,
        ...(!failed && childSummary !== "" ? { summary: childSummary } : {}),
        ...(!failed && Object.keys(childOutputs).length > 0 ? { outputs: childOutputs } : {}),
        ...(status === "waiting" ? { waitingFor: "resume" as const } : {}),
        ...(failed
          ? {
              error:
                child.status === "stopped"
                  ? "The child workflow was stopped."
                  : "A child step failed.",
            }
          : {}),
      }));
      child = yield* advance(updated);
      yield* writeRun(child);
    }
  });

  const stepStart: WorkflowRunner["Service"]["stepStart"] = Effect.fn("WorkflowRunner.stepStart")(
    function* (input) {
      const candidate = yield* locked(
        Effect.gen(function* () {
          const run = yield* readRun(input.runId);
          const step = yield* requireStep(run, input.stepId);
          if (input.callerThreadId !== run.driverThreadId)
            return yield* new WorkflowStepCallerError({ runId: run.id, stepId: step.stepId });
          if (terminal(run) || (step.status !== "ready" && step.status !== "running"))
            return yield* new WorkflowStepStateError({
              runId: run.id,
              stepId: step.stepId,
              expected: "ready",
              status: step.status,
            });
          if (step.status !== "ready" || step.checking !== undefined) return undefined;
          const definitionStep = run.definition.steps.find((item) => item.id === step.stepId)!;
          const definition =
            definitionStep.kind === "workflow"
              ? yield* store.readDefinition({
                  projectId: run.projectId,
                  slug: definitionStep.workflow,
                })
              : run.definition;
          // A step's owner is the thread that claimed it. Probing the driver's workspace and
          // executor for a claimed step checks a context the step will never run in, so the
          // owner is resolved once here and committed unchanged.
          const ownerThreadId = input.threadId ?? step.threadId ?? run.driverThreadId;
          return {
            run,
            definition,
            ...(definitionStep.kind === "workflow" ? { ownerDefinition: run.definition } : {}),
            ...(definitionStep.kind === "workflow" ? {} : { stepIds: new Set([step.stepId]) }),
            contextThreadId: ownerThreadId,
            ownerThreadId,
          };
        }),
      );
      const subagents =
        candidate === undefined
          ? undefined
          : candidate.stepIds === undefined
            ? yield* preparation.subagents(candidate.definition)
            : candidate.run.subagents;
      const mcpSnapshots = new Map<string | undefined, WorkflowMcpInventorySnapshot | undefined>();
      const prepared =
        candidate === undefined
          ? undefined
          : yield* preparation.prepare({
              projectId: candidate.run.projectId,
              definition: candidate.definition,
              subagents,
              contextThreadId: candidate.contextThreadId,
              mcpSnapshots,
              ...(candidate.stepIds === undefined ? {} : { stepIds: candidate.stepIds }),
            });
      const ownerPrepared =
        candidate?.ownerDefinition === undefined
          ? undefined
          : yield* preparation.prepare({
              projectId: candidate.run.projectId,
              definition: candidate.ownerDefinition,
              subagents: candidate.run.subagents,
              contextThreadId: candidate.contextThreadId,
              mcpSnapshots,
              stepIds: new Set([input.stepId]),
            });
      if (prepared?.blocksRun || ownerPrepared?.blocksRun) {
        const blockers = [...(prepared?.entries ?? []), ...(ownerPrepared?.entries ?? [])]
          .filter(
            (entry) =>
              entry.kind !== "mcp-connection" &&
              entry.kind !== "credential" &&
              (entry.status === "missing" ||
                entry.status === "error" ||
                entry.status === "unknown"),
          )
          .map((entry) => entry.message);
        return yield* new WorkflowBlockedError({
          workflow: candidate?.definition.name ?? "workflow",
          problems: blockers.length ? blockers : ["Required resources could not be verified."],
        });
      }
      return yield* locked(
        Effect.gen(function* () {
          const run = yield* readRun(input.runId);
          const step = yield* requireStep(run, input.stepId);
          if (input.callerThreadId !== run.driverThreadId)
            return yield* new WorkflowStepCallerError({ runId: run.id, stepId: step.stepId });
          if (terminal(run) || (step.status !== "ready" && step.status !== "running"))
            return yield* new WorkflowStepStateError({
              runId: run.id,
              stepId: step.stepId,
              expected: "ready",
              status: step.status,
            });
          // Checks already own this attempt; starting again must not clear or double count it.
          if (step.checking !== undefined) return yield* result(run);
          const definitionStep = run.definition.steps.find((item) => item.id === step.stepId)!;
          if (definitionStep.kind === "workflow") {
            if (step.status === "running") {
              if (step.childRunId === undefined)
                return yield* new WorkflowStepStateError({
                  runId: run.id,
                  stepId: step.stepId,
                  expected: "child-completion",
                  status: step.status,
                });
              const child = yield* readRun(step.childRunId);
              if (child.parent?.runId !== run.id || child.parent.stepId !== step.stepId)
                return yield* new WorkflowStepStateError({
                  runId: run.id,
                  stepId: step.stepId,
                  expected: "child-completion",
                  status: step.status,
                });
              return yield* result(child);
            }
            if (depthOf(run) + 1 > MAX_WORKFLOW_NESTING_EDGES)
              return yield* new WorkflowNestingError({
                workflow: run.workflow,
                problem: `${run.workflow} is already deep enough that "${definitionStep.workflow}" would go one level too far.`,
              });
            const childDefinition = yield* store.readDefinition({
              projectId: run.projectId,
              slug: definitionStep.workflow,
            });
            if (candidate === undefined || !sameDefinition(childDefinition, candidate.definition))
              return yield* new WorkflowBlockedError({
                workflow: definitionStep.workflow,
                problems: [
                  "The nested workflow changed during readiness checks. Review and start it again.",
                ],
              });
            let rootRun = run;
            const ancestors: Array<WorkflowRun> = [];
            const seenRunIds = new Set([run.id]);
            while (rootRun.parent !== undefined) {
              if (seenRunIds.has(rootRun.parent.runId))
                return yield* new WorkflowNestingError({
                  workflow: run.workflow,
                  problem: "The nested workflow run ancestry contains a loop.",
                });
              seenRunIds.add(rootRun.parent.runId);
              const parentRun = yield* readRun(rootRun.parent.runId);
              ancestors.unshift(parentRun);
              rootRun = parentRun;
            }
            // Running ancestors keep their pinned definitions even if their saved files changed.
            const nestedSnapshots = new Map(
              [...ancestors.slice(1), run].map((ancestor) => [
                ancestor.workflow,
                ancestor.definition,
              ]),
            );
            nestedSnapshots.set(definitionStep.workflow, childDefinition);
            yield* assertNestedDefinitionsAcyclic(
              run.projectId,
              rootRun.workflow,
              rootRun.definition,
              nestedSnapshots,
            );
            const child = yield* createRun({
              projectId: run.projectId,
              slug: definitionStep.workflow,
              driverThreadId: run.driverThreadId,
              definition: childDefinition,
              inputs: mappedChildInputs(definitionStep, run.inputs, run.lastRunResult?.summary),
              parent: { runId: run.id, stepId: step.stepId },
              preflight: prepared,
              subagents,
            });
            const now = yield* nowIso;
            const updated = replaceStep(run, step.stepId, (current) => ({
              ...current,
              status: "running",
              threadId: run.driverThreadId,
              attempts: current.attempts + (current.status === "ready" ? 1 : 0),
              startedAt: current.status === "ready" ? now : current.startedAt,
              childRunId: child.id,
            }));
            yield* writeRun(updated);
            return child;
          }
          const now = yield* nowIso;
          const fallbackToken =
            step.executionToken === undefined && step.round !== undefined
              ? (yield* crypto.uuidV4().pipe(Effect.orDie)).slice(0, 12)
              : undefined;
          const updated = replaceStep(run, step.stepId, (current) => {
            const { checks: _checks, error: _error, checking: _checking, ...clean } = current;
            // A new work attempt starts clean; the previous attempt's failed checks are history.
            const base = current.status === "ready" ? clean : current;
            const executionToken = current.executionToken ?? fallbackToken;
            return {
              ...base,
              status: "running",
              ...(executionToken === undefined ? {} : { executionToken }),
              // A thread that already claimed this step keeps it, so a late start cannot move the
              // credentials it was approved for to the driver. The owner the checks ran against is
              // the owner that gets recorded.
              threadId:
                candidate?.ownerThreadId ??
                input.threadId ??
                current.threadId ??
                run.driverThreadId,
              attempts: current.attempts + (current.status === "ready" ? 1 : 0),
              startedAt: current.status === "ready" ? now : current.startedAt,
            };
          });
          yield* writeRun(updated);
          return yield* result(updated);
        }),
      );
    },
  );
  /** Applies a reported completion, its check results, and whatever it unlocks. Call under the lock. */
  const applyCompletion = Effect.fnUntraced(function* (
    run: WorkflowRun,
    step: WorkflowStepRun,
    input: {
      callerThreadId: ThreadId;
      summary: string;
      outputs: Readonly<Record<string, string>>;
      failed: boolean;
    },
    attempts: number,
    checks: ReadonlyArray<WorkflowCheckResult>,
    advanceRun = true,
  ) {
    const now = yield* nowIso;
    const definition = run.definition.steps.find((item) => item.id === step.stepId)!;
    const loop = (run.definition.loops ?? []).find((candidate) => candidate.from === step.stepId);
    const checkFailures = checks
      .filter((check) => !check.ok)
      .map((check) => check.message)
      .join(" ");
    const loopChecksPass = loop?.until.kind === "checks-pass" && !input.failed;
    const error = input.failed
      ? input.summary || "The agent couldn't finish the step."
      : loopChecksPass
        ? ""
        : checkFailures;
    if (loop !== undefined && !input.failed && !error) {
      const looped = yield* evaluateStepLoop(
        run,
        step,
        loop,
        {
          callerThreadId: input.callerThreadId,
          summary: input.summary,
          outputs: input.outputs,
          checks,
          checkFailures,
          attempts,
          now,
        },
        advanceRun,
      );
      if (looped !== undefined) return looped;
    }
    const status: WorkflowStepRun["status"] = error
      ? input.failed || attempts >= MAX_WORKFLOW_STEP_ATTEMPTS
        ? "failed"
        : "ready"
      : definition.pauseAfter
        ? "waiting"
        : "done";
    const previews = error ? {} : WorkflowOutputPreviews.pendingPreviews(input.outputs);
    const updated = replaceStep(run, step.stepId, (current) => {
      const {
        error: _error,
        endedAt: _endedAt,
        outputPreviews: _previews,
        checking: _checking,
        ...clean
      } = current;
      return {
        ...clean,
        status,
        attempts,
        threadId: step.status === "ready" ? input.callerThreadId : step.threadId,
        startedAt: step.status === "ready" ? now : step.startedAt,
        summary: input.summary,
        outputs: input.outputs,
        ...(Object.keys(previews).length ? { outputPreviews: previews } : {}),
        checks,
        ...(status === "waiting" ? { waitingFor: "resume" as const } : {}),
        ...(status === "done" || status === "waiting" || status === "failed"
          ? { endedAt: now }
          : {}),
        ...(error ? { error } : {}),
      };
    });
    return advanceRun ? yield* advance(updated) : updated;
  });
  /** Wakes the run's driving thread and captures outputs after a completion is committed. */
  const afterCompletion = Effect.fnUntraced(function* (
    run: WorkflowRun,
    stepId: string,
    callerThreadId: ThreadId | undefined,
  ) {
    let current = yield* readRun(run.id);
    const step = current.steps.find((item) => item.stepId === stepId);
    if (step === undefined) return yield* result(run);
    if (step.error === undefined) yield* captureOutputs(current, step);
    current = yield* locked(
      Effect.gen(function* () {
        const latest = yield* readRun(run.id);
        yield* settleChildCompletion(latest);
        return yield* readRun(run.id);
      }),
    );
    // A delegated task may have ended an earlier turn to ask the user a question.
    // Its later step result still needs to wake the workflow's driving thread.
    let owner = current;
    const visited = new Set([owner.id]);
    while (owner.parent && !visited.has(owner.parent.runId)) {
      const parent = yield* readRun(owner.parent.runId).pipe(Effect.option);
      if (Option.isNone(parent)) break;
      owner = parent.value;
      visited.add(owner.id);
    }
    yield* wakeDriver(
      owner,
      `Step "${stepId}" in run ${current.id} is ${step.status}.${step.error ? ` ${step.error}` : ""}`,
      callerThreadId,
    );
    return yield* result(current);
  });
  /**
   * Completion reserves the attempt under the lock, then command/file checks run without it so
   * unrelated work and stop stay responsive. Only the reserved token may commit the result.
   */
  const completeStep = Effect.fn("WorkflowRunner.completeStep")(function* (
    input: Parameters<WorkflowRunner["Service"]["stepDone"]>[0],
    checksOnly = false,
    checksCaller?: ThreadId,
  ) {
    // Redact before anything is persisted: a step's summary and outputs are shown in the canvas.
    const redact = yield* credentialRedaction.matcher().pipe(Effect.orDie);
    input = {
      ...input,
      summary: redact(input.summary),
      outputs: Object.fromEntries(
        Object.entries(input.outputs).map(([key, value]) => [redact(key), redact(value)]),
      ),
    };
    const cancel = yield* Deferred.make<void>();
    const reservation = yield* locked(
      Effect.gen(function* () {
        const run = yield* readRun(input.runId);
        const step = yield* requireStep(run, input.stepId);
        if (input.callerThreadId !== run.driverThreadId) {
          if (
            step.previousRounds?.some((round) => round.threadId === input.callerThreadId) ||
            (step.threadId !== null &&
              step.threadId !== run.driverThreadId &&
              step.threadId !== input.callerThreadId)
          )
            return yield* new WorkflowStepCallerError({ runId: run.id, stepId: step.stepId });
          if (input.callerThreadId !== step.threadId) {
            const caller = yield* threads
              .getThreadProjection(input.callerThreadId)
              .pipe(Effect.option);
            if (
              Option.isNone(caller) ||
              caller.value.thread.lineage.parentThreadId !== run.driverThreadId
            )
              return yield* new WorkflowStepCallerError({ runId: run.id, stepId: step.stepId });
          }
        }
        if (step.checking !== undefined)
          return yield* new WorkflowStepStateError({
            runId: run.id,
            stepId: step.stepId,
            expected: "validating",
            status: "validating",
          });
        if (
          checksOnly &&
          (!step.checks?.some((check) => !check.ok) ||
            !["ready", "failed"].includes(step.status) ||
            run.status === "stopped")
        )
          return yield* new WorkflowStepStateError({
            runId: run.id,
            stepId: step.stepId,
            expected: "failed-checks",
            status: step.status,
          });
        const requiresStepStart = (step.previousRounds?.length ?? 0) > 0;
        if (
          !checksOnly &&
          (terminal(run) ||
            (requiresStepStart
              ? step.status !== "running"
              : step.status !== "ready" && step.status !== "running"))
        )
          return yield* new WorkflowStepStateError({
            runId: run.id,
            stepId: step.stepId,
            expected: requiresStepStart ? "running" : "ready",
            status: step.status,
          });
        if (!checksOnly) {
          const currentRound = step.round ?? 1;
          const tokenMismatch =
            input.executionToken !== undefined && input.executionToken !== step.executionToken;
          const roundMismatch =
            input.round !== undefined &&
            (input.round !== currentRound ||
              (input.executionToken === undefined &&
                step.previousRounds?.some((prior) => prior.round === input.round) === true));
          const hasPriorRounds = (step.previousRounds?.length ?? 0) > 0;
          const missingRequiredToken =
            hasPriorRounds &&
            input.callerThreadId === run.driverThreadId &&
            input.executionToken === undefined &&
            input.round === undefined;
          if (tokenMismatch || roundMismatch || missingRequiredToken)
            return yield* new WorkflowStepStateError({
              runId: run.id,
              stepId: step.stepId,
              expected: "current-round",
              status: `round ${currentRound}`,
            });
        }
        const definition = run.definition.steps.find((item) => item.id === step.stepId)!;
        if (definition.kind === "workflow")
          return yield* new WorkflowStepStateError({
            runId: run.id,
            stepId: step.stepId,
            expected: "child-completion",
            status: step.status,
          });
        const attempts = step.attempts + (!checksOnly && step.status === "ready" ? 1 : 0);
        const checks = definition.checks ?? [];
        const completion = checksOnly
          ? { ...input, summary: step.summary ?? "", outputs: step.outputs ?? {}, failed: false }
          : input;
        if (completion.failed || checks.length === 0) {
          const completed = yield* applyCompletion(run, step, completion, attempts, []);
          yield* writeRun(completed);
          return { _tag: "completed" as const, run: completed };
        }
        const now = yield* nowIso;
        const token = yield* crypto.uuidV4().pipe(Effect.orDie);
        // The producer stays running with dependents blocked until the checks decide.
        const reserved = replaceStep(run, step.stepId, (current) => {
          const {
            error: _error,
            endedAt: _endedAt,
            checks: _checks,
            outputPreviews: _previews,
            ...rest
          } = current;
          return {
            ...rest,
            ...(checksOnly ? current : {}),
            status: checksOnly && terminal(run) ? ("failed" as const) : ("running" as const),
            attempts,
            threadId: checksOnly
              ? step.threadId
              : step.status === "ready"
                ? input.callerThreadId
                : step.threadId,
            startedAt: checksOnly ? step.startedAt : step.status === "ready" ? now : step.startedAt,
            summary: completion.summary,
            outputs: completion.outputs,
            checking: { token, startedAt: now },
          };
        });
        yield* writeRun(reserved);
        const handle: ValidationHandle = {
          runId: reserved.id,
          stepId: input.stepId,
          token,
          cancel,
        };
        // Stop takes this same lock, so it cannot miss a reserved validation.
        validations.set(validationKey(handle.runId, handle.stepId), handle);
        return {
          _tag: "validating" as const,
          completion,
          finishedRun: terminal(run),
          run: reserved,
          checks,
          token,
          handle,
        };
      }),
    );
    if (reservation._tag === "completed")
      return yield* afterCompletion(
        reservation.run,
        input.stepId,
        checksOnly ? checksCaller : input.callerThreadId,
      );

    const { handle } = reservation;
    const key = validationKey(handle.runId, handle.stepId);
    const outcome = yield* Effect.gen(function* () {
      const cwd = yield* workingDirectory(reservation.run).pipe(Effect.option);
      const checked = (
        Option.isNone(cwd)
          ? Effect.succeed(
              reservation.checks.map((check) => ({
                check,
                ok: false,
                message: "The project folder couldn't be found.",
              })),
            )
          : Effect.forEach(reservation.checks, (check) => runCheck(cwd.value, check))
      ).pipe(
        // A failed check's message quotes the command or path it ran; redact any vault value.
        Effect.flatMap((results) =>
          credentialRedaction.matcher().pipe(
            Effect.orDie,
            Effect.map((redact) => ({
              _tag: "checked" as const,
              results: results.map((result) => ({ ...result, message: redact(result.message) })),
            })),
          ),
        ),
      );
      return yield* Effect.race(
        checked,
        Deferred.await(handle.cancel).pipe(Effect.map(() => ({ _tag: "cancelled" as const }))),
      );
    }).pipe(
      Effect.onInterrupt(() => recoverValidation(handle.runId, handle.stepId, handle.token)),
      Effect.ensuring(
        Effect.sync(() => {
          if (validations.get(key) === handle) validations.delete(key);
        }),
      ),
    );
    const commit = yield* locked(
      Effect.gen(function* () {
        const current = yield* readRun(reservation.run.id);
        const currentStep = current.steps.find((item) => item.stepId === input.stepId);
        if (
          (terminal(current) &&
            !(reservation.finishedRun && current.status === reservation.run.status)) ||
          (currentStep?.status !== "running" &&
            !(reservation.finishedRun && currentStep?.status === "failed")) ||
          currentStep.checking?.token !== reservation.token
        )
          return { applied: false as const, run: current };
        if (outcome._tag === "cancelled") return { applied: false as const, run: current };
        const completed = yield* applyCompletion(
          current,
          currentStep,
          reservation.completion,
          currentStep.attempts,
          outcome.results,
          !reservation.finishedRun,
        );
        yield* writeRun(completed);
        return { applied: true as const, run: completed };
      }),
    );
    return commit.applied
      ? yield* afterCompletion(
          commit.run,
          input.stepId,
          checksOnly ? checksCaller : input.callerThreadId,
        )
      : yield* result(commit.run);
  });
  const stepDone: WorkflowRunner["Service"]["stepDone"] = Effect.fn("WorkflowRunner.stepDone")(
    (input) => completeStep(input),
  );
  const stepChecksRun: WorkflowRunner["Service"]["stepChecksRun"] = Effect.fn(
    "WorkflowRunner.stepChecksRun",
  )(function* (input) {
    const run = yield* readRun(input.runId);
    return yield* completeStep(
      {
        ...input,
        callerThreadId: input.callerThreadId ?? run.driverThreadId,
        summary: "",
        outputs: {},
        failed: false,
      },
      true,
      input.callerThreadId,
    );
  });
  const changeWaiting = Effect.fn("WorkflowRunner.changeWaiting")(function* (
    input: StepAction,
    waitingFor: "approval" | "resume" | "timer",
  ) {
    const changed = yield* locked(
      Effect.gen(function* () {
        let run = yield* readRun(input.runId);
        const step = yield* requireStep(run, input.stepId);
        if (terminal(run) || step.status !== "waiting" || step.waitingFor !== waitingFor)
          return yield* new WorkflowStepStateError({
            runId: run.id,
            stepId: step.stepId,
            expected: waitingFor === "approval" ? "awaiting-approval" : "awaiting-resume",
            status: step.status,
          });
        run = replaceStep(run, step.stepId, (current) => ({
          ...withoutWaiting(current),
          status:
            waitingFor === "resume"
              ? "done"
              : waitingFor === "timer" &&
                  run.definition.steps.find((definition) => definition.id === step.stepId)?.gate
                ? "waiting"
                : "ready",
          ...(waitingFor === "timer" &&
          run.definition.steps.find((definition) => definition.id === step.stepId)?.gate
            ? { waitingFor: "approval" as const }
            : {}),
        }));
        run = yield* advance(run);
        yield* writeRun(run);
        yield* settleChildCompletion(run);
        return { run, view: yield* result(run), stepId: step.stepId };
      }),
    );
    yield* wakeDriver(
      changed.run,
      `step "${changed.stepId}" ${waitingFor === "approval" ? "approved" : "resumed"}.`,
      input.callerThreadId,
    );
    return changed.view;
  });
  const stop: WorkflowRunner["Service"]["stop"] = Effect.fn("WorkflowRunner.stop")(
    function* (runId, caller) {
      const outcome = yield* locked(
        Effect.gen(function* () {
          let run = yield* readRun(runId);
          if (terminal(run)) return { run, stoppedNow: false as const };
          yield* interruptLinked(run, "The workflow run was stopped.");
          const now = yield* nowIso;
          run = stopRunRecord(run, now);
          yield* writeRun(run);
          // Stopping a run also stops every run below it, grandchildren included.
          yield* stopDescendants(run, "The parent workflow run was stopped.", now);
          yield* settleChildCompletion(run);
          return { run, stoppedNow: true as const };
        }),
      );
      // The record is already stopped; releasing the checks now also kills their commands.
      yield* cancelRunValidations(runId);
      if (outcome.stoppedNow) yield* wakeDriver(outcome.run, "run stopped.", caller);
      return yield* result(outcome.run);
    },
  );
  const refresh: WorkflowRunner["Service"]["refresh"] = Effect.fn("WorkflowRunner.refresh")(
    function* (input) {
      yield* locked(
        Effect.gen(function* () {
          yield* refreshListings(input.projectId);
          yield* PubSub.publish(changes, input.projectId);
          const candidates = runSnapshot.filter(
            (run) =>
              run.projectId === input.projectId &&
              (input.runId !== undefined
                ? run.id === input.runId
                : input.workflow !== undefined
                  ? run.workflow === input.workflow
                  : true),
          );
          for (const candidate of candidates) {
            let changed = false;
            const steps = candidate.steps.map((step) => {
              if (
                step.status !== "done" &&
                !(step.status === "waiting" && step.waitingFor === "resume")
              )
                return step;
              const pending = WorkflowOutputPreviews.pendingPreviews(step.outputs ?? {});
              const retryable = Object.fromEntries(
                Object.entries(pending).filter(
                  ([key]) => step.outputPreviews?.[key]?.status !== "ready",
                ),
              );
              if (!Object.keys(retryable).length) return step;
              changed = true;
              return { ...step, outputPreviews: { ...step.outputPreviews, ...retryable } };
            });
            const updated = changed ? { ...candidate, steps } : candidate;
            if (changed) yield* writeRun(updated);
            for (const step of updated.steps) {
              if (
                (step.status === "done" ||
                  (step.status === "waiting" && step.waitingFor === "resume")) &&
                Object.values(step.outputPreviews ?? {}).some(
                  (preview) => preview.status === "pending" || preview.status === "unavailable",
                )
              ) {
                yield* captureOutputs(updated, step, { force: true });
              }
            }
          }
        }),
      );
      // An explicit refresh is a reattachment point: retry wakeups that never landed.
      yield* reconcileWakeups({
        projectId: input.projectId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
      });
    },
  );
  // Older completed runs can predate preview support. Backfill only the visible history;
  // the preview cache still owns once-per-run attempts, including failures and interruptions.
  for (const original of runSnapshot) {
    let changed = false;
    const steps = original.steps.map((step) => {
      if (step.status !== "done" && !(step.status === "waiting" && step.waitingFor === "resume"))
        return step;
      const missing = Object.fromEntries(
        Object.entries(WorkflowOutputPreviews.pendingPreviews(step.outputs ?? {})).filter(
          ([key]) => step.outputPreviews?.[key] === undefined,
        ),
      );
      if (!Object.keys(missing).length) return step;
      changed = true;
      return { ...step, outputPreviews: { ...step.outputPreviews, ...missing } };
    });
    const run = changed ? { ...original, steps } : original;
    if (changed) yield* writeRun(run);
    for (const step of run.steps) {
      if (
        (step.status === "done" || (step.status === "waiting" && step.waitingFor === "resume")) &&
        Object.values(step.outputPreviews ?? {}).some((preview) => preview.status === "pending")
      )
        yield* captureOutputs(run, step);
    }
  }
  // A check in flight when the server stopped never reported. The producer is unverified, so it
  // goes back to the driver within the same attempt budget, and its dependents stay blocked.
  for (const original of Array.from(runs.values())) {
    if (!original.steps.some((step) => step.checking !== undefined)) continue;
    const steps = original.steps.map((step) => {
      if (step.checking === undefined) return step;
      const rest = withoutChecking(step);
      if (terminal(original) || step.status !== "running") return rest;
      return step.attempts >= MAX_WORKFLOW_STEP_ATTEMPTS
        ? {
            ...rest,
            status: "failed" as const,
            error: VALIDATION_INTERRUPTED,
            endedAt: step.endedAt ?? step.checking.startedAt,
          }
        : { ...rest, status: "ready" as const, error: VALIDATION_INTERRUPTED };
    });
    const recovered = { ...original, steps };
    yield* writeRun(terminal(original) ? recovered : yield* advance(recovered));
  }
  // Startup is a reconciliation point: retry any wakeup that never reached its thread once.
  // There is no polling timer; later retries happen only on explicit reattach, refresh or status.
  for (const run of Array.from(runs.values())) {
    yield* armWaits(run);
    if (terminal(run) && run.triggerDispatchPending)
      yield* fireAfter(run).pipe(Effect.forkIn(serviceScope));
  }
  yield* reconcileWakeups();
  const status: WorkflowRunner["Service"]["status"] = Effect.fn("WorkflowRunner.status")(
    function* (id, caller) {
      const viewed = yield* locked(readRun(id).pipe(Effect.flatMap(result)));
      const wake = viewed.driverWakeup;
      if (wake !== undefined && wake.acknowledgedRevision < wake.revision) {
        // The driver reading authoritative status doesn't need to be woken by itself.
        if (caller === viewed.driverThreadId)
          yield* locked(acknowledgeWakeupLocked(viewed.id, wake.revision));
        else yield* deliverWakeup(id);
      }
      return viewed;
    },
  );
  // Inventory requests have no run id; use the newest active run in the named workflow/thread.
  const inventoryInput = (
    input: WorkflowMcpInventory.McpInventoryInput,
  ): WorkflowMcpInventory.McpInventoryInput => {
    if (input.contextThreadId === undefined) return input;
    const active = [...runs.values()]
      .filter(
        (run) =>
          run.projectId === input.projectId &&
          run.workflow === input.workflow &&
          !terminal(run) &&
          (run.driverThreadId === input.contextThreadId ||
            run.steps.some((step) => step.threadId === input.contextThreadId)),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0];
    return active === undefined ? input : { ...input, run: active };
  };

  return WorkflowRunner.of({
    templatesList,
    templateUse,
    workflowSlugs: Effect.fn("WorkflowRunner.workflowSlugs")(function* (projectId) {
      return (yield* store.listDefinitions(projectId)).map((item) => item.slug);
    }),
    triggerSet: Effect.fn("WorkflowRunner.triggerSet")((input) =>
      locked(
        Effect.gen(function* () {
          const definition = yield* store.readDefinition(input);
          const rest = (definition.startAfter ?? []).filter(
            (trigger) => trigger.workflow !== input.afterWorkflow,
          );
          return yield* saveLocked({
            ...input,
            definition: {
              ...definition,
              startAfter:
                input.when === null
                  ? rest
                  : [
                      ...rest,
                      {
                        workflow: input.afterWorkflow,
                        when: input.when,
                        enabled: input.enabled ?? true,
                      },
                    ],
            },
          });
        }),
      ),
    ),
    save,
    importWorkflow,
    create,
    remove,
    keep,
    workflowFirstRead,
    workflowFirstSet,
    meta,
    inputsSet,
    tagsSet,
    setWorkflowPinned,
    setGalleryPreferences,
    notePut,
    layoutSet,
    noteRemove,
    stepPut,
    stepMove,
    stepRemove,
    loopPut,
    loopRemove,
    skillSave,
    skillWrite,
    skillCopyToProject,
    skillList,
    preferencesRead: workflowPreferences.read,
    notifyPreferenceChange,
    setSkillPinned,
    setMaxSubagentModels,
    setWorkflowFirstForNewThreads,
    skillRead,
    preflight,
    readiness,
    probe,
    mcpInventory: Effect.fn("WorkflowRunner.mcpInventory")(function* (input) {
      return yield* preparation.inventory(inventoryInput(input));
    }),
    refreshMcpInventory: Effect.fn("WorkflowRunner.refreshMcpInventory")(function* (input) {
      // The provider query runs outside the mutation lock; its tallies can take a while.
      const refreshed = yield* preparation.refreshInventory(inventoryInput(input));
      yield* locked(
        Effect.gen(function* () {
          yield* preparation.recordInventory({
            projectId: input.projectId,
            slug: input.workflow,
            definition: refreshed.definition,
            contextKey: refreshed.contextKey,
            context: refreshed.context,
          });
          yield* refreshListings(input.projectId);
          yield* PubSub.publish(changes, input.projectId);
        }),
      );
      return refreshed.snapshot;
    }),
    scheduleList: Effect.fn("WorkflowRunner.scheduleList")((input) => schedules.list(input)),
    scheduleAdd: Effect.fn("WorkflowRunner.scheduleAdd")((input) => {
      const { createdBy, creationSource, inputs, ...rest } = input;
      return schedules.add({
        ...rest,
        ...(createdBy === undefined ? {} : { createdBy }),
        ...(creationSource === undefined ? {} : { creationSource }),
        ...(inputs === undefined ? {} : { inputs }),
      });
    }),
    scheduleTest: Effect.fn("WorkflowRunner.scheduleTest")((input) => schedules.testWebhook(input)),
    scheduleRemove: Effect.fn("WorkflowRunner.scheduleRemove")((input) => schedules.remove(input)),
    scheduleSetEnabled: Effect.fn("WorkflowRunner.scheduleSetEnabled")((input) =>
      schedules.setEnabled(input),
    ),
    refresh,
    start,
    attachedCredentialIds,
    claimStepThread,
    stepRerun,
    stepSkip,
    stepChecksRun,
    stepStart,
    stepDone,
    stop,
    approve: Effect.fn("WorkflowRunner.approve")((input) => changeWaiting(input, "approval")),
    resume: Effect.fn("WorkflowRunner.resume")(function* (input) {
      const run = yield* readRun(input.runId);
      return yield* changeWaiting(
        input,
        run.steps.find((step) => step.stepId === input.stepId)?.waitingFor === "timer"
          ? "timer"
          : "resume",
      );
    }),
    status,
    reconcileWakeups: reconcileWakeupsBestEffort,
    list: Effect.fn("WorkflowRunner.list")((input) =>
      listRuns(input).pipe(
        Effect.flatMap((snapshot) =>
          Effect.forEach(snapshot.runs, result).pipe(
            Effect.map((runs) => ({
              // Filtered after listings are resolved, so the caller's project context is the
              // authority and a scratch workflow never leaks into a matching list.
              workflows:
                input.includeScratch === false
                  ? snapshot.workflows.filter((item) => !item.scratch)
                  : snapshot.workflows,
              runs,
            })),
          ),
        ),
      ),
    ),
    activeRunsForThread: Effect.fn("WorkflowRunner.activeRunsForThread")(
      (threadId: ThreadId, projectId: ProjectId) =>
        locked(
          Effect.sync(() =>
            [...runs.values()].filter(
              (run) =>
                run.projectId === projectId &&
                !terminal(run) &&
                (run.driverThreadId === threadId ||
                  run.steps.some((step) => step.threadId === threadId)),
            ),
          ),
        ),
    ),
    activeRunsForProject: Effect.fn("WorkflowRunner.activeRunsForProject")((projectId: ProjectId) =>
      locked(
        Effect.sync(() =>
          [...runs.values()].filter((run) => run.projectId === projectId && !terminal(run)),
        ),
      ),
    ),
    listRuns,
    subscribeRuns,
  });
});
export const layer = Layer.effect(WorkflowRunner, make).pipe(
  Layer.provide(WorkflowPreferences.layer),
  Layer.provide(WorkflowPreparation.layer),
  Layer.provide(WorkflowReadiness.layer),
  Layer.provide(WorkflowMcpInventory.layer),
  Layer.provide(WorkflowMcpConfigDiscovery.layer),
);
