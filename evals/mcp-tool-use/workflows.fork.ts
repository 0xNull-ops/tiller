import { WorkflowDefinition, WorkflowStepRun } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { buildStepPrompt } from "../../apps/server/src/workflows/stepPrompt.ts";
import { parseStepVerdict } from "../../apps/server/src/workflows/workflowGraph.ts";

import {
  workflowFirstPolicy,
  withWorkflowFirstContext,
} from "../../apps/server/src/workflows/workflowFirstInstructions.ts";

const WorkflowVerdict = Schema.Literals(["pass", "revise"]);

const WorkflowStepPrompt = Schema.Struct({
  runId: Schema.String,
  definition: WorkflowDefinition,
  stepRun: WorkflowStepRun,
  skill: Schema.Struct({ name: Schema.String, path: Schema.String, text: Schema.String }),
  upstream: Schema.Array(
    Schema.Struct({
      stepId: Schema.String,
      title: Schema.String,
      summary: Schema.UndefinedOr(Schema.String),
      outputs: Schema.UndefinedOr(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
});

export const workflowCaseFields = {
  workflowFirst: Schema.optional(Schema.Boolean),
  /** Replaces `prompt` with the production ready-step prompt built from this fixture. */
  workflowStepPrompt: Schema.optional(WorkflowStepPrompt),
};
export const workflowCallFields = {
  /** The verdict the runner parses from this call's summary and outputs. */
  workflowVerdict: Schema.optional(WorkflowVerdict),
};

export const workflowCasePrompt = (testCase: {
  readonly prompt: string;
  readonly workflowFirst?: boolean | undefined;
  readonly workflowStepPrompt?: typeof WorkflowStepPrompt.Type | undefined;
}): string => {
  const fixture = testCase.workflowStepPrompt;
  if (fixture === undefined) {
    return testCase.workflowFirst
      ? withWorkflowFirstContext(workflowFirstPolicy("thread_1"), testCase.prompt)
      : testCase.prompt;
  }
  const step = fixture.definition.steps.find((step) => step.id === fixture.stepRun.stepId);
  if (step === undefined || step.kind === "workflow") {
    throw new Error(`Workflow eval fixture has no skill step ${fixture.stepRun.stepId}`);
  }
  return buildStepPrompt({ ...fixture, step });
};

const StepResult = Schema.Struct({
  summary: Schema.String,
  outputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const isStepResult = Schema.is(StepResult);

export const matchesWorkflowVerdict = (
  expected: { readonly workflowVerdict?: typeof WorkflowVerdict.Type | undefined },
  call: { readonly tool: string; readonly input: unknown },
): boolean =>
  expected.workflowVerdict === undefined ||
  (call.tool === "workflow_step_done" &&
    isStepResult(call.input) &&
    parseStepVerdict(call.input.summary, call.input.outputs).verdict === expected.workflowVerdict);
