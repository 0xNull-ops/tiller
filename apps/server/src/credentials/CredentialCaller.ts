import {
  CredentialUseError,
  type CredentialCaller,
  type ThreadId,
  type WorkflowRun,
  type WorkflowStepRun,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowRunner from "../workflows/WorkflowRunner.ts";
import * as WorkflowStore from "../workflows/WorkflowStore.ts";

/**
 * A step agent can name its run and step before `workflow_step_start` has linked its thread. The
 * hint is only a claim: `hintedStep` trusts it only when the named step can belong to this caller,
 * and the first driver child to name an unlinked step records that claim so a sibling cannot
 * inherit the step's approvals by naming it too.
 */
export interface CredentialCallerHint {
  readonly runId?: string | undefined;
  readonly stepId?: string | undefined;
}

const make = Effect.gen(function* () {
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const runner = yield* WorkflowRunner.WorkflowRunner;
  const store = yield* WorkflowStore.WorkflowStore;

  const hintedStep = Effect.fnUntraced(function* (input: {
    threadId: ThreadId;
    parentThreadId: ThreadId | null;
    projectId: WorkflowRun["projectId"];
    hint: CredentialCallerHint | undefined;
  }): Effect.fn.Return<
    { readonly run: WorkflowRun; readonly step: WorkflowStepRun } | undefined,
    never,
    never
  > {
    const { hint, threadId, parentThreadId, projectId } = input;
    if (hint?.runId === undefined || hint.stepId === undefined) return undefined;
    const run = (yield* runner.activeRunsForProject(projectId)).find(
      (item) => item.id === hint.runId,
    );
    if (run === undefined) return undefined;
    const step = run.steps.find((item) => item.stepId === hint.stepId);
    const definition = run.definition.steps.find((item) => item.id === hint.stepId);
    if (step === undefined || definition?.kind !== "skill") return undefined;
    if (step.status !== "ready" && step.status !== "running") return undefined;
    // A step linked to another thread belongs to it alone, never to a sibling or the driver.
    if (step.threadId !== null) return step.threadId === threadId ? { run, step } : undefined;
    // The driver always may act for its own run. A child must claim the step first, and a sibling
    // that reaches the same unlinked step afterwards is refused instead of sharing its approvals.
    if (threadId === run.driverThreadId) return { run, step };
    if (parentThreadId !== run.driverThreadId) return undefined;
    const claimed = yield* runner.claimStepThread({ runId: run.id, stepId: step.stepId, threadId });
    return claimed ? { run, step } : undefined;
  });

  return {
    resolve: Effect.fn("CredentialCaller.resolve")(function* (
      threadId: ThreadId,
      hint?: CredentialCallerHint,
    ) {
      // Credential use only needs shell metadata, regardless of conversation length.
      const thread = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => new CredentialUseError({ reason: "not-found" })));
      if (thread === null || thread.deletedAt !== null)
        return yield* new CredentialUseError({ reason: "not-found" });
      const provider = yield* providers.getInstance(thread.modelSelection.instanceId);
      const hinted = yield* hintedStep({
        threadId,
        parentThreadId: thread.lineage.parentThreadId,
        projectId: thread.projectId,
        hint,
      });
      const candidates = yield* runner.activeRunsForThread(threadId, thread.projectId);
      let run = hinted?.run;
      let step = hinted?.step;
      if (hinted === undefined) {
        const owningSteps = candidates.filter((r) =>
          r.steps.some((s) => s.threadId === threadId && s.status === "running"),
        );
        const matches = owningSteps.length > 0 ? owningSteps : candidates;
        if (matches.length > 1) return yield* new CredentialUseError({ reason: "ambiguous-run" });
        run = matches[0];
        step =
          run?.steps.find((s) => s.threadId === threadId && s.status === "running") ??
          run?.steps.find((s) => s.threadId === threadId);
      }
      const caller: CredentialCaller = {
        threadId,
        threadTitle: thread.title,
        projectId: thread.projectId,
        provider: provider?.driverKind ?? thread.modelSelection.instanceId,
        model: thread.modelSelection.model,
        agentRole: thread.lineage.parentThreadId === null ? "main" : "subagent",
        ...(run === undefined
          ? {}
          : {
              workflow: run.workflow,
              runId: run.id,
              credentialApprovals: run.definition.credentialApprovals ?? "once-per-run",
            }),
        ...(step === undefined
          ? {}
          : {
              stepId: step.stepId,
              stepTitle:
                run?.definition.steps.find((s) => s.id === step.stepId)?.title ?? step.stepId,
            }),
      };
      const cwd =
        thread.worktreePath ??
        (yield* store
          .projectRoot(thread.projectId)
          .pipe(Effect.mapError(() => new CredentialUseError({ reason: "not-found" }))));
      return { caller, cwd };
    }),
  };
});
export class CredentialCallerResolver extends Context.Service<
  CredentialCallerResolver,
  Effect.Success<typeof make>
>()("t3/credentials/CredentialCaller/CredentialCallerResolver") {}
export const layer = Layer.effect(CredentialCallerResolver, make);
