import type { WorkflowStepCheck } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { layoutRunGraph } from "./runGraphLayout";
import { workflowRunFixture as run } from "./workflowTestFixture";

describe("buildWorkflowRunGraph", () => {
  it("routes the three-step join through rendered outputs into Publish's gate", () => {
    const graph = buildWorkflowRunGraph(null, {
      version: 3,
      name: "Three steps",
      steps: [
        { id: "capture", skill: "capture", checks: [{ kind: "file", path: "capture.md" }] },
        { id: "summarize", skill: "summarize", readsFrom: ["capture"], checks: [] },
        {
          id: "publish",
          skill: "publish",
          gate: true,
          readsFrom: ["capture", "summarize"],
          checks: [{ kind: "file", path: "published.md" }],
        },
      ],
    });
    const prefix = "draft:Three steps";
    expect(graph.edges.map(({ from, to }) => [from, to])).toEqual([
      [prefix, `${prefix}:capture`],
      [`${prefix}:capture`, `${prefix}:check:capture`],
      [`${prefix}:check:capture`, `${prefix}:summarize`],
      [`${prefix}:check:capture`, `${prefix}:approval:publish`],
      [`${prefix}:summarize`, `${prefix}:approval:publish`],
      [`${prefix}:approval:publish`, `${prefix}:publish`],
      [`${prefix}:publish`, `${prefix}:check:publish`],
    ]);
    const nodes = new Set(graph.nodes.map(({ id }) => id));
    for (const { from, to } of graph.edges) {
      expect(nodes.has(from)).toBe(true);
      expect(nodes.has(to)).toBe(true);
    }
  });

  it("uses the nested workflow card as output without creating a phantom Check", () => {
    const graph = buildWorkflowRunGraph(null, {
      version: 3,
      name: "Nested",
      steps: [
        { id: "consume", skill: "consume", readsFrom: ["child"], gate: true },
        { id: "child", kind: "workflow", workflow: "child", readsFrom: [] },
      ],
    });
    expect(graph.nodes.some((node) => node.kind === "check")).toBe(false);
    expect(graph.edges.map(({ from, to }) => [from, to])).toContainEqual([
      "draft:Nested:child",
      "draft:Nested:approval:consume",
    ]);
  });

  it("shows explicit and default dependencies, status, skill, attempts and thread links", () => {
    const graph = buildWorkflowRunGraph(run);
    expect(graph.nodes.map((node) => [node.kind, node.status])).toEqual([
      ["workflow", "running"],
      ["step", "done"],
      ["step", "running"],
      ["step", "waiting"],
      ["step", "pending"],
    ]);
    expect(graph.nodes[2]).toMatchObject({
      detail: "build · attempt 2",
      childThreadId: "build-thread",
    });
    expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      [run.id, `${run.id}:research`],
      [`${run.id}:research`, `${run.id}:build`],
      [run.id, `${run.id}:images`],
      [`${run.id}:build`, `${run.id}:deploy`],
      [`${run.id}:images`, `${run.id}:deploy`],
    ]);
    expect(layoutRunGraph(graph).positions.size).toBe(5);
  });
  it("keeps failed, skipped and resume states visible when a run stops", () => {
    const graph = buildWorkflowRunGraph({
      ...run,
      status: "stopped",
      steps: run.steps.map((step, i) => ({
        ...step,
        status: i === 0 ? "failed" : i === 1 ? "skipped" : "waiting",
        waitingFor: "resume",
      })),
    });
    expect(graph.nodes.map((node) => node.status)).toEqual([
      "cancelled",
      "failed",
      "skipped",
      "waiting",
      "waiting",
    ]);
  });
  it("draws the saved definition in edit mode with matching states from the last run", () => {
    const saved = {
      ...run.definition,
      name: "Launch site v2",
      steps: [...run.definition.steps, { id: "new", skill: "copy", title: "Copy" }],
    };
    const graph = buildWorkflowRunGraph(run, saved);
    expect(graph.nodes[0]).toMatchObject({ title: "Launch site v2" });
    expect(graph.nodes.find((node) => node.id.endsWith(":research"))).toMatchObject({
      status: "done",
    });
    expect(graph.nodes.find((node) => node.id.endsWith(":new"))).toMatchObject({
      status: "pending",
    });
  });
  it("draws an unrun definition as a draft and marks missing skills and ready steps", () => {
    const graph = buildWorkflowRunGraph(
      { ...run, steps: run.steps.map((step) => ({ ...step, status: "ready" as const })) },
      run.definition,
      ["build"],
    );
    expect(graph.nodes[0]).toMatchObject({ detail: "launch", status: "running" });
    expect(graph.nodes[1]).toMatchObject({ status: "idle" });
    expect(graph.nodes[2]?.detail).toContain("skill missing");
    const draft = buildWorkflowRunGraph(null, run.definition);
    expect(draft.nodes[0]).toMatchObject({ detail: "Draft", status: "idle" });
    expect(draft.nodes).toHaveLength(run.definition.steps.length + 1);
  });

  it("derives a visible approval node around each gated executable step", () => {
    const definition = {
      ...run.definition,
      steps: run.definition.steps.map((step) =>
        step.id === "images" ? { ...step, gate: true } : step,
      ),
    };
    const graph = buildWorkflowRunGraph(run, definition);
    const gate = graph.nodes.find((node) => node.kind === "approval")!;
    expect(gate).toMatchObject({
      approvalFor: "images",
      detail: "Waiting for approval",
      status: "waiting",
      childThreadId: null,
    });
    expect(graph.edges.map(({ from, to }) => [from, to])).toContainEqual([
      "run-one:approval:images",
      "run-one:images",
    ]);
    expect(graph.edges.map(({ from, to }) => [from, to])).toContainEqual([
      "run-one",
      "run-one:approval:images",
    ]);
    expect(graph.nodes.find((node) => node.id === "run-one:images")).toMatchObject({
      kind: "step",
      workflowStepId: "images",
      status: "pending",
    });

    const draft = buildWorkflowRunGraph(null, definition);
    expect(draft.nodes.find((node) => node.kind === "approval")).toMatchObject({
      detail: "Required · Draft",
      status: "idle",
    });
  });

  it("derives one Check after a checked Skill and routes its dependencies through that card", () => {
    const definition = {
      ...run.definition,
      steps: run.definition.steps.map((step) =>
        step.id === "build"
          ? { ...step, checks: [{ kind: "command" as const, command: "pnpm build" }] }
          : step,
      ),
    };
    const graph = buildWorkflowRunGraph(run, definition);
    const check = graph.nodes.find((node) => node.kind === "check")!;
    expect(check).toMatchObject({
      id: "run-one:check:build",
      checkFor: "build",
      status: "pending",
      detail: "Pending",
    });
    expect(graph.edges.map(({ from, to }) => [from, to])).toContainEqual([
      "run-one:build",
      "run-one:check:build",
    ]);
    expect(graph.edges.map(({ from, to }) => [from, to])).toContainEqual([
      "run-one:check:build",
      "run-one:deploy",
    ]);
    expect(graph.nodes.find((node) => node.id === "run-one:build")).toMatchObject({
      kind: "step",
      workflowStepId: "build",
      childThreadId: "build-thread",
    });
    const forwardDependency = buildWorkflowRunGraph(null, {
      ...definition,
      steps: [
        { id: "consume", skill: "consume", readsFrom: ["build"] },
        definition.steps.find((step) => step.id === "build")!,
      ],
    });
    expect(forwardDependency.edges.map(({ from, to }) => [from, to])).toContainEqual([
      "draft:Launch site:check:build",
      "draft:Launch site:consume",
    ]);
  });

  it("shows only reported results as failure or verified success, and keeps stop/ended honest", () => {
    const configuredChecks: WorkflowStepCheck[] = [
      { kind: "command", command: "pnpm build" },
      { kind: "file", path: "dist/index.html" },
    ];
    const definition = {
      ...run.definition,
      steps: run.definition.steps.map((step) =>
        step.id === "build" ? { ...step, checks: configuredChecks } : step,
      ),
    };
    const check = (step: (typeof run.steps)[number], status: typeof run.status = "running") =>
      buildWorkflowRunGraph(
        {
          ...run,
          status,
          steps: run.steps.map((entry) => (entry.stepId === "build" ? step : entry)),
        },
        definition,
      ).nodes.find((node) => node.kind === "check")!;
    const failures = [
      { check: configuredChecks[0]!, ok: false, message: "build failed" },
      { check: configuredChecks[1]!, ok: true, message: "file found" },
    ];
    expect(
      check({ ...run.steps[1]!, status: "ready", attempts: 2, checks: failures }),
    ).toMatchObject({
      status: "failed",
      detail: "1 failed · attempt 2",
    });
    const failedGraph = buildWorkflowRunGraph(
      {
        ...run,
        steps: run.steps.map((step) =>
          step.stepId === "build"
            ? {
                ...step,
                status: "ready",
                checks: failures,
              }
            : step,
        ),
      },
      definition,
    );
    expect(failedGraph.nodes.find((node) => node.workflowStepId === "build")).toMatchObject({
      status: "failed",
      worker: "Checks failed",
      detail: "build · attempt 2",
    });
    expect(
      check({
        ...run.steps[1]!,
        status: "done",
        checks: failures.map((result) => ({ ...result, ok: true })),
      }),
    ).toMatchObject({ status: "done", detail: "Passed · 2 checks" });
    expect(check({ ...run.steps[1]!, status: "done", checks: [] }, "done")).toMatchObject({
      status: "cancelled",
      detail: "Ended · results unverified",
    });
    expect(check({ ...run.steps[1]!, status: "running", checks: failures })).toMatchObject({
      status: "pending",
      detail: "Pending",
    });
    const checking = Object.assign({}, run.steps[1], {
      checking: { token: "attempt-token", startedAt: "2026-10-19T12:00:00.000Z" },
    }) as (typeof run.steps)[number];
    expect(check(checking)).toMatchObject({ status: "running", detail: "Checking · attempt 2" });
    const validatingGraph = buildWorkflowRunGraph(
      { ...run, steps: run.steps.map((step) => (step.stepId === "build" ? checking : step)) },
      definition,
    );
    expect(validatingGraph.nodes.find((node) => node.workflowStepId === "build")).toMatchObject({
      status: "running",
      detail: "build · validating · attempt 2",
      worker: "Validating",
    });
    expect(
      check({
        ...run.steps[1]!,
        status: "waiting",
        waitingFor: "resume",
        checks: failures.map((result) => ({ ...result, ok: true })),
      }),
    ).toMatchObject({
      status: "done",
      detail: "Passed · 2 checks",
    });
    expect(check({ ...run.steps[1]!, status: "ready", checks: failures }, "stopped")).toMatchObject(
      {
        status: "cancelled",
        detail: "Stopped",
      },
    );
  });

  it("marks an approval gate blocked until its dependencies finish", () => {
    const definition = {
      ...run.definition,
      steps: run.definition.steps.map((step) =>
        step.id === "deploy" ? { ...step, gate: true } : step,
      ),
    };
    const graph = buildWorkflowRunGraph(run, definition);
    expect(
      graph.nodes.find((node) => node.kind === "approval" && node.approvalFor === "deploy"),
    ).toMatchObject({ status: "blocked", detail: "Blocked by earlier steps" });
  });

  it("keeps a downstream approval blocked when a checked producer lacks verified results", () => {
    const definition = {
      ...run.definition,
      steps: [
        {
          id: "build",
          skill: "build",
          checks: [{ kind: "command" as const, command: "pnpm build" }],
        },
        { id: "deploy", skill: "deploy", gate: true, readsFrom: ["build"] },
      ],
    };
    const graph = buildWorkflowRunGraph(
      {
        ...run,
        steps: [
          {
            ...run.steps[1]!,
            stepId: "build",
            status: "done",
            checks: [
              {
                check: { kind: "command", command: "pnpm build" },
                ok: false,
                message: "build failed",
              },
            ],
          },
          { ...run.steps[3]!, stepId: "deploy", status: "queued" },
        ],
      },
      definition,
    );
    expect(graph.nodes.find((node) => node.kind === "approval")).toMatchObject({
      status: "blocked",
      detail: "Blocked by earlier steps",
    });
    expect(graph.edges.map(({ from, to }) => [from, to])).toContainEqual([
      "run-one:check:build",
      "run-one:approval:deploy",
    ]);
  });

  it("keeps approvals visible after failures and stops without claiming skipped steps were approved", () => {
    const definition = {
      ...run.definition,
      steps: run.definition.steps.map((step) =>
        step.id === "images" ? { ...step, gate: true } : step,
      ),
    };
    const gateFor = (
      stepStatus: (typeof run.steps)[number]["status"],
      waitingFor?: (typeof run.steps)[number]["waitingFor"],
      runStatus: typeof run.status = "running",
    ) =>
      buildWorkflowRunGraph(
        {
          ...run,
          status: runStatus,
          definition,
          steps: run.steps.map((step) => {
            if (step.stepId !== "images") return step;
            return waitingFor === undefined
              ? { ...step, status: stepStatus }
              : { ...step, status: stepStatus, waitingFor };
          }),
        },
        definition,
      ).nodes.find((node) => node.kind === "approval")!;
    expect(gateFor("ready").status).toBe("done");
    expect(gateFor("running").status).toBe("done");
    expect(gateFor("done").status).toBe("done");
    expect(gateFor("failed", undefined, "failed")).toMatchObject({
      status: "done",
      detail: "Approved",
    });
    expect(gateFor("waiting", "resume").status).toBe("done");
    expect(gateFor("skipped", undefined, "stopped")).toMatchObject({
      status: "cancelled",
      detail: "Run stopped",
    });
    expect(gateFor("done", undefined, "stopped").status).toBe("done");
    expect(gateFor("skipped")).toMatchObject({ status: "skipped", detail: "Step skipped" });
    expect(gateFor("waiting", "approval", "failed")).toMatchObject({
      status: "cancelled",
      detail: "Run ended",
    });
  });

  it("emits feedback edges for loops and annotates step nodes with round and exhausted state", () => {
    const loopDef = {
      ...run.definition,
      loops: [
        {
          id: "deploy-to-build",
          from: "deploy",
          to: "build",
          maxRounds: 3,
          until: { kind: "step-says-pass" as const },
        },
      ],
    };
    const draftGraph = buildWorkflowRunGraph(null, loopDef);
    const draftFeedback = draftGraph.edges.find((edge) => edge.kind === "feedback");
    expect(draftFeedback).toMatchObject({
      id: "loop:deploy-to-build",
      kind: "feedback",
      from: "draft:Launch site:deploy",
      to: "draft:Launch site:build",
      loopId: "deploy-to-build",
      label: "↺ up to 3× · until deploy passes",
      maxRounds: 3,
    });

    const liveGraph = buildWorkflowRunGraph(
      {
        ...run,
        steps: run.steps.map((step) =>
          step.stepId === "build" || step.stepId === "deploy" ? { ...step, round: 2 } : step,
        ),
      },
      loopDef,
    );
    expect(liveGraph.nodes.find((node) => node.workflowStepId === "build")).toMatchObject({
      round: 2,
      maxRounds: 3,
    });
    expect(liveGraph.edges.find((edge) => edge.kind === "feedback")?.label).toBe("↺ round 2/3");
    expect(layoutRunGraph(liveGraph).positions.size).toBe(5);

    const nestedDef: typeof run.definition = {
      version: 3,
      name: "Nested QA",
      loops: [
        {
          id: "inner",
          from: "review",
          to: "draft",
          maxRounds: 2,
          until: { kind: "step-says-pass" },
        },
        {
          id: "outer",
          from: "qa",
          to: "draft",
          maxRounds: 3,
          until: { kind: "step-says-pass" },
        },
      ],
      steps: [
        { id: "draft", skill: "draft" },
        { id: "review", skill: "review" },
        { id: "qa", skill: "qa" },
      ],
    };
    const nestedGraph = buildWorkflowRunGraph(
      {
        ...run,
        definition: nestedDef,
        loopRounds: { inner: 1, outer: 3 },
        steps: [
          { stepId: "draft", status: "done", threadId: null, attempts: 1, round: 1 },
          { stepId: "review", status: "done", threadId: null, attempts: 1, round: 1 },
          { stepId: "qa", status: "running", threadId: null, attempts: 1, round: 3 },
        ],
      },
      nestedDef,
    );
    expect(nestedGraph.nodes.find((node) => node.workflowStepId === "draft")).toMatchObject({
      round: 1,
      maxRounds: 2,
    });
    expect(nestedGraph.nodes.find((node) => node.workflowStepId === "review")).toMatchObject({
      round: 1,
      maxRounds: 2,
    });
    expect(nestedGraph.nodes.find((node) => node.workflowStepId === "qa")).toMatchObject({
      round: 3,
      maxRounds: 3,
    });
  });
});
