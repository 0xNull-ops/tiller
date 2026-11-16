import { describe, expect, it } from "vite-plus/test";

import type {
  WorkflowDefinition,
  WorkflowSkillStep,
  WorkflowStep,
  WorkflowStepRun,
} from "@t3tools/contracts";
import {
  loopRangeStepIds,
  nextActions,
  parseStepVerdict,
  renderInputTemplates,
  renderInputValue,
  stepDependencies,
  validateWorkflow,
} from "./workflowGraph.ts";

const step = (id: string, extra: Partial<WorkflowSkillStep> = {}): WorkflowStep => ({
  id,
  kind: "skill",
  skill: "test",
  ...extra,
});
const definition = (...steps: WorkflowStep[]): WorkflowDefinition => ({
  version: 1,
  name: "Build",
  steps,
});
const run = (stepId: string, status: WorkflowStepRun["status"]): WorkflowStepRun => ({
  stepId,
  status,
  threadId: null,
  attempts: 0,
});

describe("workflowGraph", () => {
  it("uses the previous step by default and respects explicit dependencies", () => {
    const workflow = definition(
      step("one"),
      step("two"),
      step("three", { readsFrom: ["one"] }),
      step("four", { readsFrom: [] }),
    );
    expect(stepDependencies(workflow, "one")).toEqual([]);
    expect(stepDependencies(workflow, "two")).toEqual(["one"]);
    expect(stepDependencies(workflow, "three")).toEqual(["one"]);
    expect(stepDependencies(workflow, "four")).toEqual([]);
  });

  it("validates empty, oversized, duplicate, unknown, self and excess checks", () => {
    expect(validateWorkflow(definition())).toContain("A workflow must have at least one step.");
    expect(
      validateWorkflow(definition(...Array.from({ length: 41 }, (_, i) => step(`s${i}`))))[0],
    ).toContain("at most 40");
    expect(validateWorkflow(definition(step("same"), step("same"))).join(" ")).toContain(
      "duplicated",
    );
    expect(validateWorkflow(definition(step("build", { readsFrom: ["nope"] }))).join(" ")).toBe(
      'Step "build" reads from "nope", which isn\'t a step.',
    );
    expect(
      validateWorkflow(definition(step("build", { readsFrom: ["build"] }))).join(" "),
    ).toContain("reads from itself");
    expect(
      validateWorkflow(
        definition(
          step("build", { checks: Array.from({ length: 9 }, () => ({ kind: "file", path: "x" })) }),
        ),
      ).join(" "),
    ).toContain("more than 8 checks");
  });

  it("names dependency cycles", () => {
    const problems = validateWorkflow(
      definition(step("a", { readsFrom: ["b"] }), step("b", { readsFrom: ["a"] })),
    );
    expect(
      problems.some(
        (problem) => problem.includes("cycle") && problem.includes("a") && problem.includes("b"),
      ),
    ).toBe(true);
  });

  it("starts parallel ready branches and sends gates for approval", () => {
    const workflow = definition(
      step("base"),
      step("left", { readsFrom: ["base"] }),
      step("right", { readsFrom: ["base"] }),
      step("deploy", { readsFrom: ["left"], gate: true }),
    );
    expect(
      nextActions(workflow, [
        run("base", "done"),
        run("left", "queued"),
        run("right", "queued"),
        run("deploy", "queued"),
      ]),
    ).toEqual({ start: ["left", "right"], awaitApproval: [], finished: null });
    expect(
      nextActions(workflow, [
        run("base", "done"),
        run("left", "done"),
        run("right", "queued"),
        run("deploy", "queued"),
      ]),
    ).toEqual({ start: ["right"], awaitApproval: ["deploy"], finished: null });
  });

  it("stops on failure, accepts skipped dependencies and detects completion", () => {
    const workflow = definition(step("a"), step("b"));
    expect(nextActions(workflow, [run("a", "failed"), run("b", "queued")])).toEqual({
      start: [],
      awaitApproval: [],
      finished: "failed",
    });
    expect(nextActions(workflow, [run("a", "skipped"), run("b", "queued")])).toEqual({
      start: ["b"],
      awaitApproval: [],
      finished: null,
    });
    expect(nextActions(workflow, [run("a", "done"), run("b", "skipped")])).toEqual({
      start: [],
      awaitApproval: [],
      finished: "done",
    });
  });

  it("validates loop ordering, crossings, range membership, verdicts and {{last.result}}", () => {
    const fourSteps = definition(step("a"), step("b"), step("c"), step("d"));
    expect(
      validateWorkflow({
        ...fourSteps,
        loops: [
          {
            id: "forward",
            from: "a",
            to: "c",
            maxRounds: 2,
            until: { kind: "step-says-pass" },
          },
        ],
      }).join(" "),
    ).toContain("must jump back to an earlier step");

    expect(
      validateWorkflow({
        ...fourSteps,
        loops: [
          { id: "l1", from: "c", to: "a", maxRounds: 2, until: { kind: "step-says-pass" } },
          { id: "l2", from: "d", to: "b", maxRounds: 2, until: { kind: "step-says-pass" } },
        ],
      }).join(" "),
    ).toContain("cross");

    const nestedAndDisjoint: WorkflowDefinition = {
      ...fourSteps,
      loops: [
        { id: "inner", from: "b", to: "a", maxRounds: 2, until: { kind: "step-says-pass" } },
        { id: "outer", from: "c", to: "a", maxRounds: 2, until: { kind: "checks-pass" } },
      ],
    };
    expect(validateWorkflow(nestedAndDisjoint)).toEqual([]);
    expect([...loopRangeStepIds(nestedAndDisjoint, nestedAndDisjoint.loops![0]!)]).toEqual([
      "a",
      "b",
    ]);

    expect(parseStepVerdict("Great work.\nVERDICT: pass")).toEqual({ verdict: "pass" });
    expect(parseStepVerdict("Needs work.\nVERDICT: revise — tighten copy")).toEqual({
      verdict: "revise",
      reason: "tighten copy",
    });
    expect(parseStepVerdict("No explicit verdict line")).toEqual({ verdict: "pass" });

    expect(
      renderInputValue(
        "Focus: {{input.area}} / Prior: {{last.result}}",
        { area: "Billing" },
        "Fixed checkout button",
      ),
    ).toBe("Focus: Billing / Prior: Fixed checkout button");
    expect(renderInputTemplates("Prev={{last.result}}", {}, "All green")).toBe("Prev=All green");
  });
});
