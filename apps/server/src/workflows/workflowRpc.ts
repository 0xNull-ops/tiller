import {
  FORK_WS_METHOD_TAGS_ALL,
  WorkflowRpcError,
  WS_METHODS,
  WsRpcGroup,
  type WorkflowEdit,
  type WorkflowEditResult,
  type WorkflowRead,
  type WorkflowReadResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import * as WorkflowRunner from "./WorkflowRunner.ts";
import * as WorkflowDrafts from "./WorkflowDrafts.ts";
import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";

type Runner = WorkflowRunner.WorkflowRunner["Service"];

/** Keeps the runner's plain-words message, so the canvas can say why an edit was refused. */
const toRpcError = (cause: { readonly message: string }) =>
  new WorkflowRpcError({ cause, reason: cause.message });

const reply = <A, E extends { readonly message: string }>(
  effect: Effect.Effect<A, E>,
  toResult: (value: A) => WorkflowEditResult,
) => effect.pipe(Effect.map(toResult), Effect.mapError(toRpcError));
const nothing = (): WorkflowEditResult => ({});
const madeRun = (run: { readonly id: string }): WorkflowEditResult => ({ runId: run.id });
const madeFile = (file: { readonly path: string }): WorkflowEditResult => ({ path: file.path });

/** The canvas's changes. Edits from a client carry no thread, so they are recorded as the user's. */
const edit = (
  runner: Runner,
  input: WorkflowEdit,
): Effect.Effect<WorkflowEditResult, WorkflowRpcError> => {
  switch (input._tag) {
    case "import":
      return reply(
        runner.importWorkflow({
          projectId: input.projectId,
          slug: input.workflow,
          definition: input.definition,
          skills: input.skills,
        }),
        madeFile,
      );
    case "triggerSet":
      return reply(
        runner.triggerSet({
          projectId: input.projectId,
          slug: input.workflow,
          afterWorkflow: input.afterWorkflow,
          when: input.when,
          enabled: input.enabled,
        }),
        madeFile,
      );
    case "create":
      return reply(
        runner.create({
          projectId: input.projectId,
          slug: input.workflow,
          name: input.name,
          brief: input.brief,
        }),
        madeFile,
      );
    case "delete":
      return reply(runner.remove({ projectId: input.projectId, slug: input.workflow }), nothing);
    case "keep":
      return reply(runner.keep({ projectId: input.projectId, slug: input.workflow }), nothing);
    case "meta":
      return reply(
        runner.meta({
          projectId: input.projectId,
          slug: input.workflow,
          name: input.name,
          brief: input.brief,
          model: input.model,
          subagentModels: input.subagentModels,
          execution: input.execution,
          credentialApprovals: input.credentialApprovals,
          delegation: input.delegation,
        }),
        nothing,
      );
    case "tagsSet":
      return reply(
        runner.tagsSet({ projectId: input.projectId, slug: input.workflow, tags: input.tags }),
        nothing,
      );
    case "workflowPinSet":
      return reply(
        runner.setWorkflowPinned(
          { projectId: input.projectId, workflow: input.workflow },
          input.pinned,
        ),
        nothing,
      );
    case "inputsSet":
      return reply(
        runner.inputsSet({
          projectId: input.projectId,
          slug: input.workflow,
          inputs: input.inputs,
        }),
        nothing,
      );
    case "layoutSet":
      return reply(
        runner.layoutSet({
          projectId: input.projectId,
          slug: input.workflow,
          positions: input.positions,
          reset: input.reset,
        }),
        nothing,
      );
    case "notePut":
      return reply(
        runner.notePut({
          projectId: input.projectId,
          slug: input.workflow,
          note: input.note,
        }),
        nothing,
      );
    case "noteRemove":
      return reply(
        runner.noteRemove({
          projectId: input.projectId,
          slug: input.workflow,
          noteId: input.noteId,
        }),
        nothing,
      );
    case "stepPut":
      return reply(
        runner.stepPut({
          projectId: input.projectId,
          slug: input.workflow,
          step: input.step,
          after: input.after,
        }),
        nothing,
      );
    case "stepMove":
      return reply(
        runner.stepMove({
          projectId: input.projectId,
          slug: input.workflow,
          stepId: input.stepId,
          after: input.after,
        }),
        nothing,
      );
    case "stepRemove":
      return reply(
        runner.stepRemove({
          projectId: input.projectId,
          slug: input.workflow,
          stepId: input.stepId,
        }),
        nothing,
      );
    case "loopPut":
      return reply(
        runner.loopPut({
          projectId: input.projectId,
          slug: input.workflow,
          loop: input.loop,
        }),
        nothing,
      );
    case "loopRemove":
      return reply(
        runner.loopRemove({
          projectId: input.projectId,
          slug: input.workflow,
          loopId: input.loopId,
        }),
        nothing,
      );
    case "skillWrite":
      return reply(runner.skillWrite(input), madeFile);
    case "skillCopyToProject":
      return reply(runner.skillCopyToProject(input), madeFile);
    case "skillPinSet":
      return reply(runner.setSkillPinned(input.name, input.pinned), nothing);
    case "preferencesSet":
      return reply(
        Effect.gen(function* () {
          if (
            input.pinnedWorkflows !== undefined ||
            input.showBuiltinWorkflows !== undefined ||
            input.hiddenBuiltins !== undefined
          )
            yield* runner.setGalleryPreferences({
              ...(input.pinnedWorkflows === undefined
                ? {}
                : { pinnedWorkflows: input.pinnedWorkflows }),
              ...(input.showBuiltinWorkflows === undefined
                ? {}
                : { showBuiltinWorkflows: input.showBuiltinWorkflows }),
              ...(input.hiddenBuiltins === undefined
                ? {}
                : { hiddenBuiltins: input.hiddenBuiltins }),
            });
          if (input.maxSubagentModels !== undefined)
            yield* runner.setMaxSubagentModels(input.maxSubagentModels);
          if (input.workflowFirstForNewThreads !== undefined)
            yield* runner.setWorkflowFirstForNewThreads(input.workflowFirstForNewThreads);
        }),
        nothing,
      );
    case "workflowFirstSet":
      return reply(Effect.void, nothing);
    case "runStart":
      return reply(
        runner.start({
          projectId: input.projectId,
          slug: input.workflow,
          driverThreadId: input.driverThreadId,
          inputs: input.inputs,
        }),
        madeRun,
      );
    case "stepRerun":
      return reply(runner.stepRerun(input), madeRun);
    case "stepChecksRun":
      return reply(runner.stepChecksRun(input), madeRun);
    case "stepSkip":
      return reply(runner.stepSkip(input), madeRun);
    case "scheduleAdd":
      return reply(
        runner.scheduleAdd({
          projectId: input.projectId,
          workflow: input.workflow,
          driverThreadId: input.driverThreadId,
          inputs: input.inputs,
          ...(input.id === undefined ? {} : { id: input.id }),
          schedule: input.schedule,
          ...(input.knobs === undefined ? {} : { knobs: input.knobs }),
        }),
        (result) => ({ taskId: result.task.id }),
      );
    case "scheduleTest":
      return reply(runner.scheduleTest(input), (result) => ({ webhookOutcome: result.outcome }));
    case "scheduleRemove":
      return reply(
        runner.scheduleRemove({
          projectId: input.projectId,
          workflow: input.workflow,
          id: input.id,
        }),
        nothing,
      );
    case "scheduleSetEnabled":
      return reply(
        runner.scheduleSetEnabled({
          projectId: input.projectId,
          workflow: input.workflow,
          id: input.id,
          enabled: input.enabled,
        }),
        nothing,
      );
    case "refresh":
      return reply(
        runner.refresh({
          projectId: input.projectId,
          workflow: input.workflow,
          runId: input.runId,
        }),
        nothing,
      );
    case "probe":
      return reply(
        runner.probe({
          projectId: input.projectId,
          slug: input.workflow,
          stepIds: input.stepIds,
          contextThreadId: input.contextThreadId,
        }),
        (snapshot) => ({ readiness: snapshot }),
      );
    case "mcpInventoryRefresh":
      return reply(
        runner.refreshMcpInventory({
          projectId: input.projectId,
          workflow: input.workflow,
          stepId: input.stepId,
          contextThreadId: input.contextThreadId,
        }),
        (inventory) => ({ mcpInventory: inventory }),
      );
  }
};

const read = (
  runner: Runner,
  drafts: WorkflowDrafts.WorkflowDrafts["Service"],
  input: WorkflowRead,
): Effect.Effect<WorkflowReadResult, WorkflowRpcError> =>
  input._tag === "draftFromThread"
    ? drafts.draftFromThread(input).pipe(
        Effect.map((draft) => ({ _tag: "draftFromThread" as const, draft })),
        Effect.mapError(toRpcError),
      )
    : input._tag === "workflowFirst"
      ? Effect.succeed({ _tag: "workflowFirst" as const, enabled: false })
      : input._tag === "skills"
        ? runner.skillList(input).pipe(
            Effect.map((skills) => ({ _tag: "skills" as const, skills })),
            Effect.mapError(toRpcError),
          )
        : input._tag === "scheduleList"
          ? runner.scheduleList(input).pipe(
              Effect.map((result) => ({ _tag: "scheduleList" as const, tasks: result.tasks })),
              Effect.mapError(toRpcError),
            )
          : input._tag === "mcpInventory"
            ? runner
                .mcpInventory({
                  projectId: input.projectId,
                  workflow: input.workflow,
                  stepId: input.stepId,
                  contextThreadId: input.contextThreadId,
                })
                .pipe(
                  Effect.map((inventory) => ({ _tag: "mcpInventory" as const, inventory })),
                  Effect.mapError(toRpcError),
                )
            : input._tag === "preferences"
              ? runner.preferencesRead.pipe(
                  Effect.map((preferences) => ({ _tag: "preferences" as const, preferences })),
                  Effect.mapError(toRpcError),
                )
              : runner.skillRead(input).pipe(
                  Effect.map((skill) => ({ _tag: "skill" as const, skill })),
                  Effect.mapError(toRpcError),
                );

const workflowMethods = [
  WS_METHODS.workflowTemplatesList,
  WS_METHODS.workflowTemplateUse,
  WS_METHODS.workflowsListRuns,
  WS_METHODS.workflowsSubscribeRuns,
  WS_METHODS.workflowsStop,
  WS_METHODS.workflowsApprove,
  WS_METHODS.workflowsResume,
  WS_METHODS.workflowsEdit,
  WS_METHODS.workflowsRead,
] as const;
const workflowMethodSet = new Set<string>(workflowMethods);
type WsMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

// tsc-rs loses the requirements type when it infers upstream and workflow handlers together.
// Separate registration preserves typed requirements while keeping the shared wire group.
// Credential handlers are omitted for the same reason; they get their own layer too.
export const baseGroup = WsRpcGroup.omit(
  ...FORK_WS_METHOD_TAGS_ALL.workflows,
  ...FORK_WS_METHOD_TAGS_ALL.credentials,
  ...FORK_WS_METHOD_TAGS_ALL.skillsSh,
).middleware(RpcInstrumentation);
const workflowGroup = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (tag): tag is Exclude<WsMethod, (typeof workflowMethods)[number]> =>
      !workflowMethodSet.has(tag),
  ),
).middleware(RpcInstrumentation);

export const layer = workflowGroup
  .toLayer(
    Effect.gen(function* () {
      const runner = yield* WorkflowRunner.WorkflowRunner;
      const drafts = yield* WorkflowDrafts.WorkflowDrafts;
      return workflowGroup.of({
        [WS_METHODS.workflowTemplatesList]: () => runner.templatesList,
        [WS_METHODS.workflowTemplateUse]: (input) =>
          runner.templateUse(input).pipe(Effect.mapError(toRpcError)),
        [WS_METHODS.workflowsListRuns]: (input) =>
          runner.listRuns(input).pipe(Effect.mapError(toRpcError)),
        [WS_METHODS.workflowsSubscribeRuns]: (input) =>
          runner.subscribeRuns(input).pipe(Stream.mapError(toRpcError)),
        [WS_METHODS.workflowsStop]: (input) =>
          runner.stop(input.runId).pipe(Effect.mapError(toRpcError)),
        [WS_METHODS.workflowsApprove]: (input) =>
          runner.approve(input).pipe(Effect.mapError(toRpcError)),
        [WS_METHODS.workflowsResume]: (input) =>
          runner.resume(input).pipe(Effect.mapError(toRpcError)),
        [WS_METHODS.workflowsEdit]: (input) =>
          input._tag === "workflowFirstSet"
            ? // The runner owns thread→project resolution and the shared Workflow-first instance, so
              // this handler stays thin and cannot fall back to a second, silently-off instance.
              runner.workflowFirstSet({ threadId: input.threadId, enabled: input.enabled }).pipe(
                Effect.map(() => ({})),
                Effect.mapError(toRpcError),
              )
            : edit(runner, input),
        [WS_METHODS.workflowsRead]: (input) =>
          input._tag === "workflowFirst"
            ? runner.workflowFirstRead({ threadId: input.threadId }).pipe(
                Effect.map((state) => ({ _tag: "workflowFirst" as const, enabled: state.enabled })),
                Effect.mapError(toRpcError),
              )
            : read(runner, drafts, input),
      });
    }),
  )
  .pipe(Layer.provide(WorkflowDrafts.layer));

/** Merges the workflow handlers next to upstream's, which now builds them with `Layer.effectContext`. */
export const mergeInto = <A, E, R>(base: Layer.Layer<A, E, R>) => Layer.merge(base, layer);
