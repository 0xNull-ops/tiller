import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  WorkflowSlug,
  workflowScheduleBinding,
  workflowSchedulePrompt,
  type ScheduledTask,
  type WorkflowDefinition,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as WorkflowSchedules from "./WorkflowSchedules.ts";
import * as WorkflowStore from "./WorkflowStore.ts";

const projectId = ProjectId.make("project-1");
const workflow = WorkflowSlug.make("site-snapshot");
const driverThreadId = ThreadId.make("driver");
const definition: WorkflowDefinition = {
  version: 3,
  name: "Site snapshot",
  inputs: [
    {
      id: "site",
      label: "Site",
      kind: "url",
      required: true,
      defaultValue: "https://example.test",
    },
    { id: "note", label: "Note", kind: "text", defaultValue: "Default note" },
  ],
  steps: [{ id: "capture", skill: "snapshot" }],
};

it.effect("saves resolved defaults in schedule bindings while preserving explicit values", () =>
  Effect.gen(function* () {
    const schedules = yield* WorkflowSchedules.WorkflowSchedules;
    yield* schedules.add({
      projectId,
      workflow,
      driverThreadId,
      inputs: { note: "Explicit note" },
      schedule: { type: "interval", everyMs: 60_000 },
    });
    const blank = yield* Effect.flip(
      schedules.add({
        projectId,
        workflow,
        driverThreadId,
        inputs: { site: "" },
        schedule: { type: "interval", everyMs: 60_000 },
      }),
    );
    expect(blank._tag).toBe("WorkflowScheduleInputsError");
    if (blank._tag === "WorkflowScheduleInputsError") expect(blank.missing).toEqual(["site"]);
  }).pipe(
    Effect.provide(
      WorkflowSchedules.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkflowStore.WorkflowStore)({
              readDefinition: () => Effect.succeed(definition),
            }),
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              getProjectThreadRecords: () =>
                Effect.succeed({ thread: { worktreePath: null } } as never),
            }),
            Layer.mock(ScheduledTaskService.ScheduledTaskService)({
              upsert: (input) =>
                Effect.sync(() => {
                  expect(
                    workflowScheduleBinding({
                      prompt: input.prompt,
                      projectId,
                      threadId: driverThreadId,
                    }),
                  ).toEqual({
                    version: 2,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    projectId,
                    workflow,
                    inputs: { site: "https://example.test", note: "Explicit note" },
                  });
                  return {} as never;
                }),
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("removes only the deleted workflow's schedules", () => {
  const tasks: ScheduledTask[] = [];
  const otherWorkflow = WorkflowSlug.make("nightly-qa");
  return Effect.gen(function* () {
    const schedules = yield* WorkflowSchedules.WorkflowSchedules;
    yield* schedules.add({
      projectId,
      workflow,
      driverThreadId,
      inputs: { site: "https://example.test" },
      schedule: { type: "interval", everyMs: 60_000 },
    });
    yield* schedules.add({
      projectId,
      workflow: otherWorkflow,
      driverThreadId,
      inputs: { site: "https://other.test" },
      schedule: { type: "interval", everyMs: 60_000 },
    });
    expect(tasks).toHaveLength(2);
    yield* schedules.removeForWorkflow({ projectId, workflow });
    const remaining = yield* schedules.list({ projectId });
    expect(remaining.tasks.map((task) => workflowScheduleBinding(task)?.workflow)).toEqual([
      otherWorkflow,
    ]);
  }).pipe(
    Effect.provide(
      WorkflowSchedules.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkflowStore.WorkflowStore)({
              readDefinition: () => Effect.succeed(definition),
            }),
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              getProjectThreadRecords: () =>
                Effect.succeed({ thread: { worktreePath: null } } as never),
            }),
            Layer.mock(ScheduledTaskService.ScheduledTaskService)({
              upsert: (input) =>
                Effect.sync(() => {
                  const task = {
                    id: ScheduledTaskId.make(`task-${tasks.length + 1}`),
                    prompt: input.prompt,
                    projectId: input.projectId,
                    threadId: input.threadId,
                  } as ScheduledTask;
                  tasks.push(task);
                  return { task } as never;
                }),
              list: () => Effect.succeed({ tasks: [...tasks] } as never),
              delete: (input) =>
                Effect.sync(() => {
                  const index = tasks.findIndex((task) => task.id === input.id);
                  tasks.splice(index, 1);
                  return {} as never;
                }),
            }),
          ),
        ),
      ),
    ),
  );
});

it.effect("tests only webhooks owned by the requested workflow", () => {
  const id = ScheduledTaskId.make("task-hook");
  const task = {
    id,
    projectId,
    threadId: driverThreadId,
    prompt: workflowSchedulePrompt({ version: 2, projectId, workflow, inputs: {} }),
    webhook: { path: "/api/webhooks/task-hook/test-token", url: null, hasSecret: true },
  } as never;
  return Effect.gen(function* () {
    const schedules = yield* WorkflowSchedules.WorkflowSchedules;
    expect(yield* schedules.testWebhook({ projectId, workflow, id, body: "{}" })).toEqual({
      outcome: "rejected_signature",
    });
    expect(
      (yield* schedules
        .testWebhook({ projectId, workflow: "different", id, body: "{}" })
        .pipe(Effect.result))._tag,
    ).toBe("Failure");
  }).pipe(
    Effect.provide(
      WorkflowSchedules.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkflowStore.WorkflowStore)({}),
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
            Layer.mock(ScheduledTaskService.ScheduledTaskService)({
              list: () => Effect.succeed({ tasks: [task] }),
              triggerWebhook: () => Effect.succeed({ _tag: "rejected_signature" as const }),
            }),
          ),
        ),
      ),
    ),
  );
});
