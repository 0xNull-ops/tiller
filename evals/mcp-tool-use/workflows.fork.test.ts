// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { buildStepPrompt } from "../../apps/server/src/workflows/stepPrompt.ts";

import {
  buildBase,
  buildMessages,
  gradeSample,
  makeSample,
  McpToolUseCase,
  type SampleRun,
} from "./run.ts";

const template = {
  system: [
    { type: "text", text: "x-anthropic-billing-header: cc_version=1;" },
    { type: "text", text: "You are Claude Code." },
  ],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\n# currentDate\n</system-reminder>" },
        { type: "text", text: "<system-reminder>\n# gitStatus\nmain\n</system-reminder>" },
        { type: "text", text: "The captured prompt." },
      ],
    },
    {
      role: "system",
      content:
        "Main prompt.\n - Primary working directory: /home/alice/app\n\n<runtime_info>old</runtime_info>\n\n## T3 Code orchestration\nold text",
    },
    {
      role: "system",
      content:
        "You are powered by the model named Opus 5.5. The exact model ID is claude-opus-5-5.\n\nThe following deferred tools are now available via ToolSearch. Load them first:\nMonitor\n\nAfter the list.",
    },
  ],
  tools: [
    { name: "mcp__host__term_Bash", input_schema: { type: "object" } },
    { name: "mcp__host__clown_ToolSearch", input_schema: { type: "object" } },
  ],
};

const decodeCase = Schema.decodeUnknownSync(Schema.fromJsonString(McpToolUseCase));

const loadWorkflowCases = (): ReadonlyArray<McpToolUseCase> =>
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "cases", "workflows.ndjson"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => decodeCase(line));

it("advertises WorkflowToolkit loop tools and executionToken in the eval runner", () => {
  const top = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const topToolNames = top.t3.map((tool) => tool.name);
  assert.includeMembers(topToolNames, [
    "mcp__t3-code__workflow_loop_put",
    "mcp__t3-code__workflow_loop_delete",
    "mcp__t3-code__workflow_step_done",
  ]);
  const stepDoneTool = top.t3.find((tool) => tool.name === "mcp__t3-code__workflow_step_done");
  assert.include(JSON.stringify(stepDoneTool?.input_schema), '"executionToken"');
  assert.include(JSON.stringify(stepDoneTool?.input_schema), '"round"');
});

it("builds and grades all workflow loop and verdict eval cases", () => {
  const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const cases = loadWorkflowCases();
  assert.lengthOf(cases, 6);
  assert.deepEqual(
    cases
      .filter((testCase) => testCase.workflowStepPrompt !== undefined)
      .map((testCase) => testCase.id),
    ["workflow-loop-step-done-verdict-and-token", "workflow-loop-step-done-pass-control"],
  );

  for (const testCase of cases) {
    const sample = makeSample(testCase, base);
    const messages = buildMessages(sample);
    if (testCase.workflowFirst) {
      assert.include(sample.testCase.prompt, "Workflow-first is ON");
      assert.include(sample.testCase.prompt, testCase.prompt);
    } else {
      assert.equal(testCase.source?.pr, "https://github.com/Antler-Web-Studios/tiller/pull/33");
    }
    const fixture = testCase.workflowStepPrompt;
    if (fixture !== undefined) {
      const step = fixture.definition.steps.find((step) => step.id === fixture.stepRun.stepId)!;
      assert.equal(testCase.prompt, "");
      assert.equal(sample.testCase.prompt, buildStepPrompt({ ...fixture, step }));
    }
    assert.isTrue(
      messages.some((message) =>
        message.content.some(
          (block) => block.type === "text" && block.text === sample.testCase.prompt,
        ),
      ),
      `${testCase.id} should send its prompt`,
    );
  }

  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const failed = (id: string, run: SampleRun) =>
    gradeSample(byId.get(id)!.expect, run)
      .filter((check) => !check.pass)
      .map((check) => check.check);

  assert.isNotEmpty(
    failed("workflow-first-build-before-approval", {
      calls: [],
      text: "1. Invent a direction. 2. Generate and review. Save and schedule this workflow?",
      stopReason: "end_turn",
    }),
  );

  const canvasCalls = [
    { step: 0, tool: "workflow_save", input: { definition: { steps: [] } } },
    ...["direction", "moodboard", "review", "save"].map((id, index) => ({
      step: index + 1,
      tool: "workflow_step_put",
      input: { step: { id, gate: id === "save" } },
    })),
    { step: 5, tool: "workflow_loop_put", input: {} },
  ];
  assert.deepEqual(
    failed("workflow-first-build-before-approval", {
      calls: canvasCalls,
      text: "Built the workflow. Enable its Monday schedule?",
      stopReason: "end_turn",
    }),
    [],
  );
  assert.isNotEmpty(
    failed("workflow-first-build-before-approval", {
      calls: canvasCalls.filter((call) => call.tool !== "workflow_step_put"),
      text: "Created an empty canvas.",
      stopReason: "end_turn",
    }),
  );

  assert.deepEqual(
    failed("workflow-loop-put-adds-feedback-arc", {
      calls: [
        {
          step: 0,
          tool: "workflow_loop_put",
          input: {
            projectId: "proj_1",
            workflow: "release-audit",
            loop: {
              id: "review-to-draft",
              from: "review",
              to: "draft",
              maxRounds: 3,
              until: { kind: "step-says-pass" },
            },
          },
        },
      ],
      text: "Added the review -> draft loop.",
      stopReason: "end_turn",
    }),
    [],
  );

  assert.deepEqual(
    failed("workflow-loop-delete-removes-arc", {
      calls: [
        {
          step: 0,
          tool: "workflow_loop_delete",
          input: {
            projectId: "proj_1",
            workflow: "release-audit",
            loopId: "review-to-draft",
          },
        },
      ],
      text: "Removed the review-to-draft loop.",
      stopReason: "end_turn",
    }),
    [],
  );

  assert.deepEqual(
    failed("workflow-loop-step-done-verdict-and-token", {
      calls: [
        {
          step: 0,
          tool: "workflow_step_done",
          input: {
            runId: "run_loop_1",
            stepId: "review",
            executionToken: "tok_review_r1",
            summary:
              "Changelog is missing the breaking flag.\nVERDICT: revise: add breaking flag to auth endpoint",
            failed: false,
          },
        },
      ],
      text: "Requested revision.",
      stopReason: "end_turn",
    }),
    [],
  );

  assert.includeMembers(
    failed("workflow-loop-step-done-verdict-and-token", {
      calls: [
        {
          step: 0,
          tool: "workflow_step_done",
          input: {
            runId: "run_loop_1",
            stepId: "review",
            summary: "Changelog is missing the breaking flag.",
            failed: true,
          },
        },
      ],
      text: "Failed.",
      stopReason: "end_turn",
    }),
    ['callsMustNot workflow_step_done {"failed":true}'],
  );

  for (const { verdict, summary, outputs, passes } of [
    { verdict: "revise", summary: "VERDICT: revise: missing flag\nVERDICT: pass", passes: false },
    {
      verdict: "pass",
      summary: "VERDICT: pass\nVERDICT: revise: still missing flag",
      passes: false,
    },
    {
      verdict: "revise",
      summary: "Needs changes",
      outputs: { review: "VERDICT: revise: missing flag" },
      passes: true,
    },
    {
      verdict: "pass",
      summary: "VERDICT: pass",
      outputs: { review: "VERDICT: revise: missing flag" },
      passes: true,
    },
    {
      verdict: "revise",
      summary: "VERDICT: revise: missing flag",
      outputs: { review: "VERDICT: pass" },
      passes: true,
    },
    { verdict: "pass", summary: "All findings resolved", passes: true },
    { verdict: "revise", summary: "Needs changes", passes: false },
  ]) {
    const id =
      verdict === "revise"
        ? "workflow-loop-step-done-verdict-and-token"
        : "workflow-loop-step-done-pass-control";
    const failures = failed(id, {
      calls: [
        {
          step: 0,
          tool: "workflow_step_done",
          input: {
            runId: "run_loop_1",
            stepId: "review",
            executionToken: verdict === "revise" ? "tok_review_r1" : "tok_review_r2",
            summary,
            ...(outputs === undefined ? {} : { outputs }),
          },
        },
      ],
      text: "Review complete.",
      stopReason: "end_turn",
    });
    assert.equal(failures.length === 0, passes, JSON.stringify({ verdict, summary, outputs }));
  }
});
