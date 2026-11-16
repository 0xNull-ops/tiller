import { scheduledTaskSource } from "../../../workflows/scheduledStart.ts";
import {
  OrchestratorMcpFailure,
  type ProjectId,
  type ScheduledTaskError,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowDrafts from "../../../workflows/WorkflowDrafts.ts";
import type { WorkflowDraftEmptyError } from "../../../workflows/workflowDraft.ts";

import * as SkillCatalog from "../../../workflows/SkillCatalog.ts";
import * as WorkflowRunner from "../../../workflows/WorkflowRunner.ts";
import { WorkflowSubagentModelCapError } from "../../../workflows/workflowSubagentModelCap.ts";
import * as WorkflowPreparation from "../../../workflows/WorkflowPreparation.ts";
import * as WorkflowSchedules from "../../../workflows/WorkflowSchedules.ts";
import * as WorkflowMcpInventory from "../../../workflows/WorkflowMcpInventory.ts";
import * as WorkflowStore from "../../../workflows/WorkflowStore.ts";
import * as WorkflowPreferences from "../../../workflows/WorkflowPreferences.ts";
import { scheduledTurnStart } from "../../../workflows/scheduledStart.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, resolveProjectId } from "../../threadAccess.ts";
import { WorkflowToolkit } from "./tools.ts";

type WorkflowError =
  | WorkflowDraftEmptyError
  | WorkflowDrafts.WorkflowDraftReadError
  | WorkflowStore.WorkflowFileError
  | WorkflowPreferences.WorkflowPreferencesWriteError
  | WorkflowStore.WorkflowNotFoundError
  | WorkflowStore.WorkflowProjectNotFoundError
  | WorkflowStore.WorkflowRunNotFoundError
  | WorkflowPreparation.WorkflowInvalidError
  | WorkflowSubagentModelCapError
  | WorkflowRunner.WorkflowSkillsMissingError
  | WorkflowRunner.WorkflowInputsError
  | WorkflowRunner.WorkflowBlockedError
  | WorkflowRunner.WorkflowSkillError
  | SkillCatalog.SkillReadError
  | WorkflowRunner.WorkflowStepNotFoundError
  | WorkflowRunner.WorkflowStepStateError
  | WorkflowRunner.WorkflowStepCallerError
  | WorkflowRunner.WorkflowNestingError
  | WorkflowRunner.WorkflowFirstThreadNotFoundError
  | WorkflowMcpInventory.WorkflowMcpInventoryStepNotFoundError
  | ScheduledTaskError
  | ThreadManagementService.ThreadManagementError
  | Effect.Error<
      ReturnType<ThreadManagementService.ThreadManagementService["Service"]["getThreadShell"]>
    >
  | WorkflowSchedules.WorkflowScheduleInputsError
  | WorkflowSchedules.WorkflowScheduleNotFoundError;

const toFailure = (error: WorkflowError) =>
  new OrchestratorMcpFailure({
    code:
      error._tag === "WorkflowFileError"
        ? "orchestration_error"
        : error._tag === "WorkflowRunNotFoundError"
          ? "run_not_found"
          : error._tag === "WorkflowStepCallerError"
            ? "capability_denied"
            : "invalid_request",
    message: error.message,
  });

/** Says what failed when the inventory answer itself broke, instead of Effect's generic text. */
const inventoryFailure = {
  code: "orchestration_error" as const,
  message:
    "T3 couldn't read this workflow's MCP connections: the provider's inventory answer failed. Refresh it; if this repeats, the provider answer can't be represented.",
};

const runView = (
  run: Effect.Success<ReturnType<WorkflowRunner.WorkflowRunner["Service"]["start"]>>,
) => ({
  runId: run.id,
  driverThreadId: run.driverThreadId,
  ...(run.parent === undefined ? {} : { parent: run.parent }),
  ready: run.ready,
  context: run.context,
  workflow: run.workflow,
  name: run.definition.name,
  status: run.status,
  startedAt: run.startedAt,
  ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
  ...(run.definition.subagentModels === undefined
    ? {}
    : { subagentModels: run.definition.subagentModels }),
  ...(run.subagents === undefined ? {} : { subagents: run.subagents }),
  ...(run.exhaustedLoops === undefined ? {} : { exhaustedLoops: run.exhaustedLoops }),
  ...(run.lastRunResult === undefined ? {} : { lastRunResult: run.lastRunResult }),
  ...(run.preflight === undefined ? {} : { preflight: run.preflight }),
  steps: run.steps.map((step) => {
    const definition = run.definition.steps.find((candidate) => candidate.id === step.stepId);
    const skill =
      definition !== undefined && definition.kind !== "workflow" ? definition.skill : "";
    return { ...step, title: definition?.title ?? step.stepId, skill };
  }),
});

const projectOf = (projectId: ProjectId | undefined) =>
  loadCaller().pipe(Effect.flatMap((context) => resolveProjectId(context, projectId)));

export const layer = McpToolAccess.toLayer(WorkflowToolkit, {
  workflow_first_read: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "workflow_first_read",
      );
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const state = yield* runner
        .workflowFirstRead({ threadId: thread.threadId })
        .pipe(Effect.mapError(toFailure));
      return { enabled: state.enabled, threadId: thread.threadId };
    }),
  ),
  workflow_first_set: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "workflow_first_set",
      );
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const state = yield* runner
        .workflowFirstSet({ threadId: thread.threadId, enabled: input.enabled })
        .pipe(Effect.mapError(toFailure));
      return { enabled: state.enabled };
    }),
  ),
  workflow_draft_from_thread: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const threadId =
        input.threadId ??
        (yield* McpInvocationContext.requireThreadScope(scope, "workflow_draft_from_thread")).thread
          .threadId;
      const drafts = yield* WorkflowDrafts.WorkflowDrafts;
      return yield* drafts
        .draftFromThread({ projectId, threadId })
        .pipe(Effect.mapError(toFailure));
    }).pipe(Effect.provide(WorkflowDrafts.layer)),
  ),
  workflow_import: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .importWorkflow({
          projectId,
          slug: input.workflow,
          definition: input.definition,
          skills: input.skills,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = input.allProjects === true ? undefined : yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const snapshot = yield* runner
        .list({ projectId, includeScratch: input.includeScratch })
        .pipe(Effect.mapError(toFailure));
      const preferences = yield* runner.preferencesRead;
      return {
        workflows: snapshot.workflows.map((item) => ({
          ...item,
          tags: item.definition?.tags ?? [],
          pinned: preferences.pinnedWorkflows.some(
            (pin) => pin.projectId === item.projectId && pin.workflow === item.workflow,
          ),
        })),
        runs: snapshot.runs.map(runView),
      };
    }),
  ),
  workflow_tags_set: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .tagsSet({
          projectId,
          slug: input.workflow,
          tags: input.tags,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_pin_set: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner
        .setWorkflowPinned({ projectId, workflow: input.workflow }, input.pinned)
        .pipe(Effect.mapError(toFailure));
      return {};
    }),
  ),
  workflow_keep: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .keep({
          projectId,
          slug: input.workflow,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_save: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return yield* runner
        .save({
          projectId,
          slug: input.workflow,
          definition: input.definition,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_templates_list: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      return yield* (yield* WorkflowRunner.WorkflowRunner).templatesList;
    }),
  ),
  workflow_template_use: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      return yield* (yield* WorkflowRunner.WorkflowRunner)
        .templateUse(input)
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_trigger_put: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .triggerSet({
          projectId,
          slug: input.workflow,
          afterWorkflow: input.afterWorkflow,
          when: input.when,
          enabled: input.enabled,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_trigger_delete: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .triggerSet({
          projectId,
          slug: input.workflow,
          afterWorkflow: input.afterWorkflow,
          when: null,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_loop_put: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .loopPut({
          projectId,
          slug: input.workflow,
          loop: input.loop,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_loop_delete: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .loopRemove({
          projectId,
          slug: input.workflow,
          loopId: input.loopId,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_step_put: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .stepPut({
          projectId,
          slug: input.workflow,
          step: input.step,
          after: input.after,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_layout_set: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .layoutSet({
          projectId,
          slug: input.workflow,
          positions: input.positions,
          reset: input.reset,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_update: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const update = input.update;
      const target = {
        projectId,
        slug: update.workflow,
        callerThreadId: scope.thread?.threadId,
      };
      switch (update._tag) {
        case "meta":
          return yield* runner
            .meta({
              ...target,
              name: update.name,
              brief: update.brief,
              model: update.model,
              subagentModels: update.subagentModels,
              execution: update.execution,
              credentialApprovals: update.credentialApprovals,
            })
            .pipe(Effect.mapError(toFailure));
        case "inputsSet":
          return yield* runner
            .inputsSet({ ...target, inputs: update.inputs })
            .pipe(Effect.mapError(toFailure));
        case "notePut":
          return yield* runner
            .notePut({ ...target, note: update.note })
            .pipe(Effect.mapError(toFailure));
        case "noteRemove":
          return yield* runner
            .noteRemove({ ...target, noteId: update.noteId })
            .pipe(Effect.mapError(toFailure));
      }
    }),
  ),
  workflow_step_remove: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .stepRemove({
          projectId,
          slug: input.workflow,
          stepId: input.stepId,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_skill_save: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .skillWrite({
          projectId,
          name: input.name,
          content: input.content,
          target: input.target ?? "project",
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_skill_pin: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner.setSkillPinned(input.name, input.pinned).pipe(Effect.mapError(toFailure));
      return {};
    }),
  ),
  workflow_skill_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return { skills: yield* runner.skillList({ projectId }).pipe(Effect.mapError(toFailure)) };
    }),
  ),
  workflow_skill_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .skillRead({ projectId, name: input.name })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_skill_copy: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .skillCopyToProject({ projectId, name: input.name, callerThreadId: scope.thread?.threadId })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_preflight: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return {
        blockers: yield* runner
          .preflight({ projectId, slug: input.workflow })
          .pipe(Effect.mapError(toFailure)),
        readiness: yield* runner
          .readiness({ projectId, slug: input.workflow })
          .pipe(Effect.mapError(toFailure)),
      };
    }),
  ),
  workflow_mcp_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const request = {
        projectId,
        workflow: input.workflow,
        ...(input.stepId === undefined ? {} : { stepId: input.stepId }),
        ...(scope.thread === undefined ? {} : { contextThreadId: scope.thread.threadId }),
      };
      return yield* (
        input.refresh === true ? runner.refreshMcpInventory(request) : runner.mcpInventory(request)
      ).pipe(
        Effect.mapError(toFailure),
        // A defect here would reach the agent as Effect's generic internal-error text, which says
        // nothing. Declared workflow errors keep their own shape.
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause as Cause.Cause<never>);
          const failure = Cause.findFail(cause);
          return Result.isSuccess(failure) &&
            failure.success.error._tag === "OrchestratorMcpFailure"
            ? Effect.fail(failure.success.error)
            : Effect.fail(new OrchestratorMcpFailure(inventoryFailure));
        }),
      );
    }),
  ),
  workflow_probe: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .probe({
          projectId,
          slug: input.workflow,
          stepIds: input.stepIds,
          ...(scope.thread === undefined ? {} : { contextThreadId: scope.thread.threadId }),
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_step_rerun: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "workflow_step_rerun",
      );
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return runView(
        yield* runner
          .stepRerun({
            runId: input.runId,
            stepId: input.stepId,
            driverThreadId: thread.threadId,
            callerThreadId: thread.threadId,
          })
          .pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_step_checks_run: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return runView(
        yield* runner
          .stepChecksRun({ ...input, callerThreadId: scope.thread?.threadId })
          .pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_step_skip: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return runView(
        yield* runner
          .stepSkip({ ...input, callerThreadId: scope.thread?.threadId })
          .pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_delete: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      yield* runner
        .remove({ projectId, slug: input.workflow, callerThreadId: scope.thread?.threadId })
        .pipe(Effect.mapError(toFailure));
      return { deleted: true };
    }),
  ),
  workflow_schedule_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = input.allProjects === true ? undefined : yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .scheduleList({ projectId, workflow: input.workflow })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_schedule_add: McpToolAccess.startsThreads(
    () => ({}),
    (input) =>
      Effect.gen(function* () {
        const caller = yield* loadCaller();
        const projectId = yield* resolveProjectId(caller, input.projectId);
        const driverThreadId = input.driverThreadId ?? caller.scope.thread?.threadId;
        if (driverThreadId === undefined)
          return yield* new OrchestratorMcpFailure({
            code: "target_required",
            message: "Choose an existing chat to drive scheduled workflow runs.",
          });
        const runner = yield* WorkflowRunner.WorkflowRunner;
        return yield* runner
          .scheduleAdd({
            projectId,
            workflow: input.workflow,
            driverThreadId,
            inputs: input.inputs,
            schedule: input.schedule,
            ...(input.knobs === undefined ? {} : { knobs: input.knobs }),
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(Effect.mapError(toFailure));
      }),
    { refused: "schedule workflows in this environment" },
  ),
  workflow_schedule_put: McpToolAccess.startsThreads(
    () => ({}),
    (input) =>
      Effect.gen(function* () {
        const caller = yield* loadCaller();
        const projectId = yield* resolveProjectId(caller, input.projectId);
        const driverThreadId = input.driverThreadId ?? caller.scope.thread?.threadId;
        if (driverThreadId === undefined)
          return yield* new OrchestratorMcpFailure({
            code: "target_required",
            message: "Choose an existing chat to drive scheduled workflow runs.",
          });
        const runner = yield* WorkflowRunner.WorkflowRunner;
        return yield* runner
          .scheduleAdd({
            projectId,
            workflow: input.workflow,
            driverThreadId,
            inputs: input.inputs,
            ...(input.id === undefined ? {} : { id: input.id }),
            schedule: input.schedule,
            ...(input.knobs === undefined ? {} : { knobs: input.knobs }),
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(Effect.mapError(toFailure));
      }),
    { refused: "schedule workflows in this environment" },
  ),
  workflow_schedule_remove: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .scheduleRemove({ projectId, workflow: input.workflow, id: input.id })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_schedule_set_enabled: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .scheduleSetEnabled({
          projectId,
          workflow: input.workflow,
          id: input.id,
          enabled: input.enabled,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_step_move: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return yield* runner
        .stepMove({
          projectId,
          slug: input.workflow,
          stepId: input.stepId,
          after: input.after,
          callerThreadId: scope.thread?.threadId,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  workflow_step_start: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "workflow_step_start",
      );
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return runView(
        yield* runner
          .stepStart({ ...input, callerThreadId: thread.threadId })
          .pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_run: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const projectId = yield* projectOf(input.projectId);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "workflow_run");
      const projection = yield* threads
        .getThreadProjection(thread.threadId)
        .pipe(Effect.orElseSucceed(() => undefined));
      const run = yield* runner
        .start({
          projectId,
          slug: input.workflow,
          driverThreadId: thread.threadId,
          callerThreadId: thread.threadId,
          inputs: input.inputs,
          ...(projection === undefined || !scheduledTurnStart(projection)
            ? {}
            : { unattended: true, ...scheduledTaskSource(projection) }),
        })
        .pipe(Effect.mapError(toFailure));
      return runView(run);
    }),
  ),
  workflow_status: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return runView(
        yield* runner.status(input.runId, scope.thread?.threadId).pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_stop: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return runView(
        yield* runner.stop(input.runId, scope.thread?.threadId).pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_approve: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return runView(
        yield* runner
          .approve({ ...input, callerThreadId: scope.thread?.threadId })
          .pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_resume: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return runView(
        yield* runner
          .resume({ ...input, callerThreadId: scope.thread?.threadId })
          .pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
  workflow_step_done: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "workflow_step_done",
      );
      const runner = yield* WorkflowRunner.WorkflowRunner;
      return runView(
        yield* runner
          .stepDone({
            runId: input.runId,
            stepId: input.stepId,
            callerThreadId: thread.threadId,
            ...(input.round === undefined ? {} : { round: input.round }),
            ...(input.executionToken === undefined ? {} : { executionToken: input.executionToken }),
            summary: input.summary,
            outputs: input.outputs ?? {},
            failed: input.failed ?? false,
          })
          .pipe(Effect.mapError(toFailure)),
      );
    }),
  ),
});
