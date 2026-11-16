import type { WorkflowScheduleKnobs } from "@t3tools/contracts";
import {
  ProjectId,
  ScheduledTaskError,
  ScheduledTaskId,
  ThreadId,
  WorkflowSlug,
  workflowScheduleBinding,
  workflowSchedulePrompt,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type ScheduledTask,
  type ScheduledTaskDeleteResult,
  type ScheduledTaskListResult,
  type ScheduledTaskMutationResult,
  type ScheduledTaskUpsertSchedule,
  type WorkflowDefinition,
  type WorkflowScheduleBinding,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as WorkflowStore from "./WorkflowStore.ts";
import { resolveRunInputs } from "./workflowGraph.ts";

export class WorkflowScheduleNotFoundError extends Schema.TaggedError<WorkflowScheduleNotFoundError>()(
  "WorkflowScheduleNotFoundError",
  {
    projectId: ProjectId,
    workflow: WorkflowSlug,
    taskId: ScheduledTaskId,
  },
) {
  override get message(): string {
    return "No scheduled task with that id belongs to this workflow.";
  }
}

/**
 * A schedule is refused up front rather than saved wrong: a missing or malformed
 * input would only surface when the first run fails to start.
 */
export class WorkflowScheduleInputsError extends Schema.TaggedError<WorkflowScheduleInputsError>()(
  "WorkflowScheduleInputsError",
  {
    projectId: ProjectId,
    workflow: WorkflowSlug,
    /** Required input ids left empty. */
    missing: Schema.Array(Schema.String),
    /** Input ids that are undeclared or whose value fails their kind, such as a url that is not http(s). */
    invalid: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    const parts = [
      ...(this.missing.length > 0 ? [`missing ${this.missing.join(", ")}`] : []),
      ...(this.invalid.length > 0 ? [`invalid ${this.invalid.join(", ")}`] : []),
    ];
    return `These schedule inputs are not ready: ${parts.join("; ")}.`;
  }
}

/**
 * Failures the adapter passes through: the store and thread services already
 * describe them in the user's words, and transports map them by message.
 */
export type WorkflowScheduleStoreError =
  | ScheduledTaskError
  | WorkflowStore.WorkflowProjectNotFoundError
  | WorkflowStore.WorkflowNotFoundError
  | WorkflowStore.WorkflowFileError
  | ThreadManagementService.ThreadManagementError;

export type WorkflowScheduleAddError =
  | WorkflowScheduleStoreError
  | WorkflowScheduleInputsError
  | WorkflowScheduleNotFoundError;
export type WorkflowScheduleTargetError =
  | WorkflowScheduleStoreError
  | WorkflowScheduleNotFoundError;

/**
 * A workflow's schedules: each one is an upstream scheduled task bound to the
 * run's driver thread, marked with its workflow identity in the prompt. The
 * upstream scheduler fires the wake; the thread's agent drives the run.
 */
export class WorkflowSchedules extends Context.Service<
  WorkflowSchedules,
  {
    readonly add: (input: {
      readonly projectId: ProjectId;
      readonly workflow: WorkflowSlug;
      readonly driverThreadId: ThreadId;
      /** Explicit string inputs, such as an app name. Never credentials. */
      readonly inputs?: Readonly<Record<string, string>>;
      readonly id?: ScheduledTaskId;
      readonly knobs?: WorkflowScheduleKnobs;
      readonly schedule: ScheduledTaskUpsertSchedule;
      readonly createdBy?: OrchestrationV2Actor;
      readonly creationSource?: OrchestrationV2CreationSource;
    }) => Effect.Effect<ScheduledTaskMutationResult, WorkflowScheduleAddError>;
    readonly list: (input: {
      readonly projectId?: ProjectId | undefined;
      readonly workflow?: WorkflowSlug | undefined;
    }) => Effect.Effect<ScheduledTaskListResult, ScheduledTaskError>;
    readonly testWebhook: (input: {
      readonly projectId: ProjectId;
      readonly workflow: WorkflowSlug;
      readonly id: ScheduledTaskId;
      readonly body: string;
    }) => Effect.Effect<{ outcome: string }, WorkflowScheduleTargetError>;
    readonly remove: (input: {
      readonly projectId: ProjectId;
      readonly workflow: WorkflowSlug;
      readonly id: ScheduledTaskId;
    }) => Effect.Effect<ScheduledTaskDeleteResult, WorkflowScheduleTargetError>;
    readonly setEnabled: (input: {
      readonly projectId: ProjectId;
      readonly workflow: WorkflowSlug;
      readonly id: ScheduledTaskId;
      readonly enabled: boolean;
    }) => Effect.Effect<ScheduledTaskMutationResult, WorkflowScheduleTargetError>;
    /** Deletes every schedule of a workflow; called when the workflow itself is deleted. */
    readonly removeForWorkflow: (input: {
      readonly projectId: ProjectId;
      readonly workflow: WorkflowSlug;
    }) => Effect.Effect<void, ScheduledTaskError>;
    readonly updateBinding?: (input: {
      readonly projectId: ProjectId;
      readonly workflow: WorkflowSlug;
      readonly id: ScheduledTaskId;
      readonly binding: WorkflowScheduleBinding;
    }) => Effect.Effect<ScheduledTaskMutationResult, WorkflowScheduleTargetError>;
  }
>()("t3/workflows/WorkflowSchedules") {}

/** A task belongs to a workflow only through its exact marker, never by text it happens to mention. */
const ownsTask = (
  task: Pick<ScheduledTask, "prompt" | "projectId" | "threadId">,
  target: { readonly projectId: ProjectId; readonly workflow: WorkflowSlug },
): boolean => {
  const binding = workflowScheduleBinding(task);
  return (
    binding !== null &&
    binding.projectId === target.projectId &&
    binding.workflow === target.workflow
  );
};

/**
 * Bound runs execute in the driver's own workspace, so the task records that
 * workspace instead of inventing one. Upstream stores `{ type: "root" }` for
 * thread-bound tasks whose thread runs in the project checkout.
 */
const driverWorkspace = (thread: {
  readonly worktreePath: string | null;
}): OrchestrationV2ThreadLaunchWorkspaceStrategy =>
  thread.worktreePath === null
    ? { type: "root" }
    : { type: "existing_worktree", worktreePath: thread.worktreePath };

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/** Ids the caller sees in the refusal; capped so the error stays bounded. */
const MAX_REPORTED_INPUT_IDS = 8;

/**
 * Checks the supplied values against the definition's declared inputs, keyed by input id so the
 * refusal names each field. Kept here so this adapter stays free of any runner dependency.
 */
const scheduleInputProblems = (
  declared: WorkflowDefinition["inputs"],
  inputs: Readonly<Record<string, string>>,
): { readonly missing: ReadonlyArray<string>; readonly invalid: ReadonlyArray<string> } => {
  const inputsDeclared = declared ?? [];
  const declaredIds = new Set(inputsDeclared.map((input) => input.id));
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const declaredInput of inputsDeclared) {
    const value = inputs[declaredInput.id];
    if (value === undefined || value.trim() === "") {
      if (declaredInput.required === true) missing.push(declaredInput.id);
    } else if (declaredInput.kind === "url" && !isHttpUrl(value)) {
      invalid.push(declaredInput.id);
    }
  }
  for (const id of Object.keys(inputs)) {
    if (!declaredIds.has(id)) invalid.push(id);
  }
  return {
    missing: missing.slice(0, MAX_REPORTED_INPUT_IDS),
    invalid: invalid.slice(0, MAX_REPORTED_INPUT_IDS),
  };
};

const make = Effect.gen(function* () {
  const store = yield* WorkflowStore.WorkflowStore;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const tasks = yield* ScheduledTaskService.ScheduledTaskService;

  // Covered by remove/setEnabled's own span; this is per-call bookkeeping.
  const loadOwnedTask = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly workflow: WorkflowSlug;
    readonly id: ScheduledTaskId;
  }) {
    const { tasks: all } = yield* tasks.list();
    const task = all.find((candidate) => candidate.id === input.id && ownsTask(candidate, input));
    return task === undefined
      ? yield* new WorkflowScheduleNotFoundError({
          projectId: input.projectId,
          workflow: input.workflow,
          taskId: input.id,
        })
      : task;
  });

  const add = Effect.fn("WorkflowSchedules.add")(function* (input: {
    readonly projectId: ProjectId;
    readonly workflow: WorkflowSlug;
    readonly driverThreadId: ThreadId;
    readonly inputs?: Readonly<Record<string, string>>;
    readonly id?: ScheduledTaskId;
    readonly knobs?: WorkflowScheduleKnobs;
    readonly schedule: ScheduledTaskUpsertSchedule;
    readonly createdBy?: OrchestrationV2Actor;
    readonly creationSource?: OrchestrationV2CreationSource;
  }) {
    const definition = yield* store.readDefinition({
      projectId: input.projectId,
      slug: input.workflow,
    });
    const resolvedInputs = resolveRunInputs(definition.inputs, input.inputs);
    const rotate = input.knobs?.rotate;
    const inputs =
      rotate &&
      rotate.values.length > 0 &&
      (resolvedInputs[rotate.inputId] === undefined ||
        resolvedInputs[rotate.inputId]!.trim() === "")
        ? {
            ...resolvedInputs,
            [rotate.inputId]:
              rotate.values[
                ((rotate.next % rotate.values.length) + rotate.values.length) % rotate.values.length
              ]!,
          }
        : resolvedInputs;
    const problems = scheduleInputProblems(definition.inputs, inputs);
    if (problems.missing.length > 0 || problems.invalid.length > 0) {
      return yield* new WorkflowScheduleInputsError({
        projectId: input.projectId,
        workflow: input.workflow,
        missing: problems.missing,
        invalid: problems.invalid,
      });
    }
    const { thread } = yield* threads.getProjectThreadRecords(
      { projectId: input.projectId, threadId: input.driverThreadId },
      [],
    );
    const binding: WorkflowScheduleBinding = {
      ...input.knobs,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      version: 2,
      projectId: input.projectId,
      workflow: input.workflow,
      inputs,
    };
    const previous =
      input.id === undefined
        ? undefined
        : yield* loadOwnedTask({
            projectId: input.projectId,
            workflow: input.workflow,
            id: input.id,
          });
    return yield* tasks.upsert({
      ...(input.id === undefined ? {} : { id: input.id }),
      title: `Workflow schedule: ${definition.name}`,
      prompt: workflowSchedulePrompt(binding),
      enabled: previous?.enabled ?? true,
      schedule: input.schedule,
      projectId: input.projectId,
      threadId: input.driverThreadId,
      workspaceStrategy: driverWorkspace(thread),
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
      ...(input.creationSource === undefined ? {} : { creationSource: input.creationSource }),
    });
  });

  const list = Effect.fn("WorkflowSchedules.list")(function* (input: {
    readonly projectId?: ProjectId | undefined;
    readonly workflow?: WorkflowSlug | undefined;
  }) {
    const { tasks: all } = yield* tasks.list();
    return {
      tasks: all.filter((task) => {
        const binding = workflowScheduleBinding(task);
        if (binding === null) return false;
        if (input.projectId !== undefined && binding.projectId !== input.projectId) return false;
        if (input.workflow !== undefined && binding.workflow !== input.workflow) return false;
        return true;
      }),
    };
  });

  const remove = Effect.fn("WorkflowSchedules.remove")(function* (input: {
    readonly projectId: ProjectId;
    readonly workflow: WorkflowSlug;
    readonly id: ScheduledTaskId;
  }) {
    yield* loadOwnedTask(input);
    return yield* tasks.delete({ id: input.id });
  });

  const setEnabled = Effect.fn("WorkflowSchedules.setEnabled")(function* (input: {
    readonly projectId: ProjectId;
    readonly workflow: WorkflowSlug;
    readonly id: ScheduledTaskId;
    readonly enabled: boolean;
  }) {
    yield* loadOwnedTask(input);
    return yield* tasks.setEnabled({ id: input.id, enabled: input.enabled });
  });

  const removeForWorkflow = Effect.fn("WorkflowSchedules.removeForWorkflow")(function* (input: {
    readonly projectId: ProjectId;
    readonly workflow: WorkflowSlug;
  }) {
    const { tasks: owned } = yield* list(input);
    yield* Effect.forEach(owned, (task) => tasks.delete({ id: task.id }));
  });

  const testWebhook = Effect.fn("WorkflowSchedules.testWebhook")(function* (input: {
    projectId: ProjectId;
    workflow: WorkflowSlug;
    id: ScheduledTaskId;
    body: string;
  }) {
    const task = yield* loadOwnedTask(input);
    if (!task.webhook)
      return yield* new ScheduledTaskError({ message: "This schedule has no webhook endpoint." });
    const parts = task.webhook.path.split("/");
    const outcome = yield* tasks.triggerWebhook({
      hookId: decodeURIComponent(parts.at(-2)!),
      token: parts.at(-1)!,
      method: "POST",
      path: task.webhook.path,
      query: "",
      headers: { "content-type": "application/json" },
      bodyText: input.body,
      body: new TextEncoder().encode(input.body),
    });
    return { outcome: outcome._tag === "accepted" ? outcome.outcome : outcome._tag };
  });
  const updateBinding = Effect.fn("WorkflowSchedules.updateBinding")(function* (input: {
    readonly projectId: ProjectId;
    readonly workflow: WorkflowSlug;
    readonly id: ScheduledTaskId;
    readonly binding: WorkflowScheduleBinding;
  }) {
    const task = yield* loadOwnedTask(input);
    return yield* tasks.upsert({
      id: task.id,
      title: task.title,
      prompt: workflowSchedulePrompt(input.binding),
      enabled: task.enabled,
      schedule: task.schedule,
      projectId: task.projectId,
      threadId: task.threadId,
      workspaceStrategy: task.workspaceStrategy,
      modelSelection: task.modelSelection,
      runtimeMode: task.runtimeMode,
      interactionMode: task.interactionMode,
    });
  });
  return WorkflowSchedules.of({
    add,
    list,
    remove,
    setEnabled,
    removeForWorkflow,
    testWebhook,
    updateBinding,
  });
});

export const layer = Layer.effect(WorkflowSchedules, make);
