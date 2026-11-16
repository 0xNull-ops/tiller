import type {
  ModelSelection,
  ServerProvider,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowSubagentsSnapshot,
} from "@t3tools/contracts";

import { resolveSubagentModels } from "@t3tools/shared/workflowSubagents";

export function workflowExecutor(input: {
  definition: WorkflowDefinition;
  step?: WorkflowStep | undefined;
  driver?: Pick<ModelSelection, "instanceId" | "model"> | undefined;
  subagents?: WorkflowSubagentsSnapshot | undefined;
  providers?: ReadonlyArray<ServerProvider> | undefined;
}) {
  const own = input.step?.kind === "workflow" ? undefined : input.step?.model;
  const override =
    own === undefined
      ? undefined
      : input.providers === undefined
        ? own
        : resolveSubagentModels([own], input.providers).usable[0];
  const hints = input.definition.subagentModels;
  const snapshot =
    input.subagents ??
    (hints === undefined ? undefined : resolveSubagentModels(hints, input.providers ?? []));
  return (
    override ??
    snapshot?.usable[0] ??
    (hints === undefined ? input.definition.model : undefined) ??
    input.driver
  );
}

export function resolveRunAs(definition: WorkflowDefinition, step: WorkflowStep) {
  // A workflow step is always driven by this thread itself: it starts the child run and works
  // the child's steps, so there is nothing to hand to a subagent.
  if (step.kind === "workflow") return "self";
  if (step.delegation !== undefined) return step.delegation;
  // Version 1 files call execution `delegation`; the store upgrades them on read.
  const execution = definition.execution ?? definition.delegation;
  if (execution === "always-subagents") return "subagent";
  if (execution === "prefer-subagents") return "prefer-subagent";
  return "agent-decides";
}

export const RUN_AS_GUIDE =
  "Follow each ready step's runAs: subagent means delegate_task with the step's prompt and model if set; self means do it in this thread; prefer-subagent means delegate unless the step is trivial; agent-decides means do small steps yourself or delegate_task, preferring subagents for heavy or parallel steps. The chat thread's main agent always drives the run. If a step lists preferred subagent models, the user chose them: prefer them when delegating (use T3's delegate_task to target a cross-provider model); otherwise choose yourself.";

/** How the driving agent works nested workflow steps and their child runs. */
export const NESTED_RUN_GUIDE =
  "A step with kind: workflow runs another saved workflow as a child run in this same thread; no new thread is created. Start it with workflow_step_start on the parent run, then work the child's ready steps: every ready step carries the runId to use in workflow_step_start and workflow_step_done. For child steps that is the CHILD run's id. The parent step finishes by itself when the child run does; never call workflow_step_done for it. After a child run finishes, call workflow_status on its parent.runId and continue; repeat through ancestors when they finish. Parent status includes ready descendants.";
