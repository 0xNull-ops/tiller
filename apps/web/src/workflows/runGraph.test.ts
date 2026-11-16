import {
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Run,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { buildRunGraph } from "./runGraph";

const at = DateTime.makeUnsafe("2026-10-01T12:00:00.000Z");
const threadId = ThreadId.make("thread");
const providerInstanceId = ProviderInstanceId.make("codex");

function run(id: string, ordinal: number): OrchestrationV2Run {
  return {
    id: RunId.make(id),
    threadId,
    ordinal,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    providerThreadId: null,
    userMessageId: MessageId.make(`message-${id}`),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: at,
    startedAt: at,
    completedAt: at,
    checkpointId: null,
    contextHandoffId: null,
  };
}

function subagent(
  id: string,
  overrides: Partial<OrchestrationV2Subagent> = {},
): OrchestrationV2Subagent {
  return {
    id: NodeId.make(id),
    threadId,
    runId: RunId.make("one"),
    parentNodeId: NodeId.make("parent"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId,
    providerThreadId: null,
    childThreadId: ThreadId.make(`child-${id}`),
    nativeTaskRef: null,
    prompt: "Do the work",
    title: id,
    model: "gpt-5",
    status: "completed",
    result: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    ...overrides,
  };
}

describe("buildRunGraph", () => {
  it("returns an empty graph without subagents", () => {
    expect(buildRunGraph(null)).toEqual({ nodes: [], edges: [] });
    expect(buildRunGraph({ runs: [run("one", 1)], subagents: [] })).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("groups tasks under occupied turns and leaves null and unknown runs as sources", () => {
    const graph = buildRunGraph({
      runs: [run("two", 2), run("empty", 3), run("one", 1)],
      subagents: [
        subagent("b", { runId: RunId.make("two") }),
        subagent("a"),
        subagent("orphan", { runId: null }),
        subagent("unknown", { runId: RunId.make("missing") }),
      ],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "turn:one",
      "turn:two",
      "a",
      "b",
      "orphan",
      "unknown",
    ]);
    expect(graph.edges.map(({ from, to }) => [from, to])).toEqual([
      ["turn:one", "a"],
      ["turn:two", "b"],
    ]);
    expect(graph.nodes.find((node) => node.id === "a")).toMatchObject({
      kind: "task",
      detail: "gpt-5",
      childThreadId: "child-a",
    });
  });

  it("chains phases in index order and attaches phased and unphased agents", () => {
    const graph = buildRunGraph({
      runs: [run("one", 1)],
      subagents: [
        subagent("workflow", {
          status: "running",
          workflow: {
            phases: [
              { index: 2, title: "Ship" },
              { index: 0, title: "Plan" },
              { index: 3, title: "Later" },
            ],
            agents: [
              { index: 4, label: "Free", state: "running" },
              { index: 2, label: "Builder", state: "running", phaseIndex: 2 },
              { index: 1, label: "Reviewer", state: "failed", phaseIndex: 0 },
              { index: 0, label: "Planner", state: "completed", phaseIndex: 0, model: "small" },
            ],
          },
        }),
      ],
    });
    expect(graph.edges.map(({ from, to }) => [from, to])).toEqual([
      ["turn:one", "workflow"],
      ["workflow", "workflow:phase:0"],
      ["workflow:phase:0", "workflow:agent:0"],
      ["workflow:phase:0", "workflow:agent:1"],
      ["workflow:phase:0", "workflow:phase:2"],
      ["workflow:phase:2", "workflow:agent:2"],
      ["workflow:phase:2", "workflow:phase:3"],
      ["workflow", "workflow:agent:4"],
    ]);
    expect(graph.nodes.filter((node) => node.kind === "phase")).toMatchObject([
      { title: "Plan", detail: "2/2", status: "done" },
      { title: "Ship", detail: "0/1", status: "running" },
      { title: "Later", detail: null, status: "pending" },
    ]);
    expect(graph.nodes.find((node) => node.id === "workflow:agent:0")).toMatchObject({
      kind: "agent",
      detail: "small",
      status: "done",
    });
  });

  it.each([
    ["pending", "pending", "running"],
    ["running", "running", "running"],
    ["waiting", "waiting", "running"],
    ["idle", "idle", "done"],
    ["completed", "done", "done"],
    ["failed", "failed", "failed"],
    ["cancelled", "cancelled", "done"],
    ["interrupted", "cancelled", "done"],
  ] as const)("maps %s and derives its turn status", (status, expected, turnStatus) => {
    const graph = buildRunGraph({
      runs: [run("one", 1)],
      subagents: [subagent("task", { status })],
    });
    expect(graph.nodes.map((node) => node.status)).toEqual([turnStatus, expected]);
  });

  it("prioritizes active children over failed children", () => {
    const graph = buildRunGraph({
      runs: [run("one", 1)],
      subagents: [
        subagent("failed", { status: "failed" }),
        subagent("waiting", { status: "waiting" }),
      ],
    });
    expect(graph.nodes[0]?.status).toBe("running");
  });

  it("orders by first seen time and id independently of projection array order", () => {
    const runs = [run("two", 2), run("one", 1)];
    const subagents = [
      subagent("z", { startedAt: DateTime.makeUnsafe("2026-09-01T00:00:00Z") }),
      subagent("b"),
      subagent("a"),
    ];
    const graph = buildRunGraph({ runs, subagents });
    expect(graph.nodes.map((node) => node.id)).toEqual(["turn:one", "z", "a", "b"]);
    expect(buildRunGraph({ runs: runs.toReversed(), subagents: subagents.toReversed() })).toEqual(
      graph,
    );
  });
});
