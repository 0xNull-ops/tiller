import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  NodeId,
  RunId,
  ThreadId,
  ProjectId,
  WorkflowSlug,
  WsRpcGroup,
  WS_METHODS,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import {
  RpcInstrumentation,
  rpcInstrumentationLayer,
} from "../observability/RpcInstrumentation.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import {
  inventoryProjectId,
  inventoryRunnerLayer,
  inventoryThreadId,
  oversized,
  oversizedInventoryLayer,
} from "./WorkflowMcpInventory.test-fixtures.ts";
import * as WorkflowRunner from "./WorkflowRunner.ts";
import * as WorkflowRpc from "./workflowRpc.ts";

const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("driver");
const root = NodeId.make("root");
const now = DateTime.makeUnsafe("2026-10-20T00:00:00Z");
type Method = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];
const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (
      tag,
    ): tag is Exclude<Method, typeof WS_METHODS.workflowsRead | typeof WS_METHODS.workflowsEdit> =>
      tag !== WS_METHODS.workflowsRead && tag !== WS_METHODS.workflowsEdit,
  ),
).middleware(RpcInstrumentation);
const middleware = Layer.mergeAll(
  rpcInstrumentationLayer,
  RpcAuthorization.layer([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]),
);

it.effect(
  "drafts through the V2 record reader and returns the empty-thread reason to the canvas",
  () => {
    let delegated = true;
    const handlers = WorkflowRpc.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadRecords: (id, fields) =>
              Effect.sync(() => {
                expect(id).toBe(threadId);
                expect(fields).toEqual(["subagents", "nodes", "runs", "messages"]);
                return {
                  thread: { id, projectId, title: "Saved work", deletedAt: null },
                  subagents: delegated
                    ? [
                        {
                          id: NodeId.make("task"),
                          threadId: id,
                          runId: RunId.make("turn"),
                          parentNodeId: root,
                          prompt: "Do the saved work",
                          title: "Build",
                          startedAt: now,
                          updatedAt: now,
                        },
                      ]
                    : [],
                  nodes: [
                    {
                      id: root,
                      rootNodeId: root,
                      parentNodeId: null,
                      kind: "root_turn",
                      startedAt: now,
                    },
                  ],
                  runs: [],
                  messages: [],
                } as never;
              }),
          }),
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            workflowSlugs: () => Effect.succeed([]),
            skillList: () => Effect.succeed([]),
          }),
        ),
      ),
    );
    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.mergeAll(handlers, middleware)),
      );
      const result = yield* client[WS_METHODS.workflowsRead]({
        _tag: "draftFromThread",
        projectId,
        threadId,
      });
      expect(result).toMatchObject({
        _tag: "draftFromThread",
        draft: {
          slug: "saved-work",
          definition: { steps: [{ id: "build", delegation: "subagent" }] },
        },
      });
      delegated = false;
      const error = yield* Effect.flip(
        client[WS_METHODS.workflowsRead]({ _tag: "draftFromThread", projectId, threadId }),
      );
      if (error._tag !== "WorkflowRpcError") throw error;
      expect(error.reason).toBe("This thread hasn't handed any work to subagents yet.");
      const wrongProject = yield* Effect.flip(
        client[WS_METHODS.workflowsRead]({
          _tag: "draftFromThread",
          projectId: ProjectId.make("other"),
          threadId,
        }),
      );
      if (wrongProject._tag !== "WorkflowRpcError") throw wrongProject;
      expect(wrongProject.reason).toContain("belongs to this project");
    });
  },
);

it.effect("routes Workflow-first reads and writes through the required runner instance", () => {
  const calls: Array<unknown> = [];
  const enabled = new Map<string, boolean>();
  return Effect.gen(function* () {
    const thread = ThreadId.make("thread:dogs-research");
    const handlers = WorkflowRpc.mergeInto(Layer.empty).pipe(
      Layer.provide(
        Layer.mergeAll(
          // The one runner instance in context: the RPC layer must use it rather than looking up a
          // second Workflow-first service of its own.
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            workflowFirstRead: (input) =>
              Effect.sync(() => {
                calls.push({ read: input.threadId });
                return { enabled: enabled.get(input.threadId) ?? false } as never;
              }),
            workflowFirstSet: (input) =>
              Effect.sync(() => {
                calls.push({ set: input.threadId, enabled: input.enabled });
                enabled.set(input.threadId, input.enabled);
                return { enabled: input.enabled } as never;
              }),
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        ),
      ),
    );
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );

    expect(
      yield* client[WS_METHODS.workflowsRead]({ _tag: "workflowFirst", threadId: thread }),
    ).toEqual({ _tag: "workflowFirst", enabled: false });
    yield* client[WS_METHODS.workflowsEdit]({
      _tag: "workflowFirstSet",
      threadId: thread,
      enabled: true,
    });
    expect(
      yield* client[WS_METHODS.workflowsRead]({ _tag: "workflowFirst", threadId: thread }),
    ).toEqual({ _tag: "workflowFirst", enabled: true });
    expect(calls).toEqual([{ read: thread }, { set: thread, enabled: true }, { read: thread }]);
  });
});

it.effect("runs the canvas probe through the runner and returns its readiness", () => {
  const calls: Array<unknown> = [];
  const handlers = WorkflowRpc.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(WorkflowRunner.WorkflowRunner)({
          probe: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return {
                entries: [
                  {
                    stepId: WorkflowSlug.make("build"),
                    attachmentId: WorkflowSlug.make("vercel"),
                    kind: "service-login" as const,
                    status: "available" as const,
                    message: "Vercel is signed in on this server.",
                  },
                ],
                blocksRun: false,
              };
            }),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );
    const result = yield* client[WS_METHODS.workflowsEdit]({
      _tag: "probe",
      projectId,
      workflow: WorkflowSlug.make("launch-site"),
      stepIds: [WorkflowSlug.make("build")],
    });
    expect(calls).toEqual([{ projectId, slug: "launch-site", stepIds: ["build"] }]);
    expect(result.readiness).toMatchObject({
      blocksRun: false,
      entries: [{ status: "available" }],
    });
  });
});

it.effect("round-trips workflow preferences and pins through the workflow RPC", () => {
  let preferences = {
    pinnedSkills: [] as string[],
    pinnedWorkflows: [],
    showBuiltinWorkflows: true,
    hiddenBuiltins: [],
    maxSubagentModels: 4,
    workflowFirstForNewThreads: false,
  };
  const handlers = WorkflowRpc.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(WorkflowRunner.WorkflowRunner)({
          preferencesRead: Effect.sync(() => preferences),
          setSkillPinned: (name, pinned) =>
            Effect.sync(() => {
              preferences = {
                ...preferences,
                pinnedSkills: pinned
                  ? [
                      ...preferences.pinnedSkills.filter(
                        (item) => item.toLowerCase() !== name.toLowerCase(),
                      ),
                      name,
                    ]
                  : preferences.pinnedSkills.filter(
                      (item) => item.toLowerCase() !== name.toLowerCase(),
                    ),
              };
            }),
          setMaxSubagentModels: (maxSubagentModels) =>
            Effect.sync(() => {
              preferences = { ...preferences, maxSubagentModels };
            }),
          skillList: () =>
            Effect.sync(() => [
              {
                name: "frontend-design",
                description: "Visual design",
                path: "/skills/frontend-design/SKILL.md",
                scope: "global" as const,
                requires: [],
                pinned: preferences.pinnedSkills.some(
                  (name) => name.toLowerCase() === "frontend-design",
                ),
              },
            ]),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );
    yield* client[WS_METHODS.workflowsEdit]({
      _tag: "skillPinSet",
      name: "Frontend-Design",
      pinned: true,
    });
    const skills = yield* client[WS_METHODS.workflowsRead]({ _tag: "skills", projectId });
    expect(skills).toMatchObject({
      _tag: "skills",
      skills: [{ name: "frontend-design", pinned: true }],
    });
    yield* client[WS_METHODS.workflowsEdit]({ _tag: "preferencesSet", maxSubagentModels: 7 });
    const result = yield* client[WS_METHODS.workflowsRead]({ _tag: "preferences" });
    expect(result).toEqual({
      _tag: "preferences",
      preferences: {
        pinnedSkills: ["Frontend-Design"],
        pinnedWorkflows: [],
        showBuiltinWorkflows: true,
        hiddenBuiltins: [],
        maxSubagentModels: 7,
        workflowFirstForNewThreads: false,
      },
    });
  });
});

const mcpInventorySnapshot = (status: "available" | "not-checked" = "available") =>
  ({
    status,
    message: status === "available" ? "Codex reported 1 MCP connection." : "Not checked yet.",
    scope: {
      providerInstanceId: "codex-work",
      driverKind: "codex",
      modelScoped: false,
      workspaceRoot: "/repo",
    },
    servers:
      status === "available"
        ? [
            {
              name: "linear",
              status: "connected" as const,
              toolsStatus: "available" as const,
              tools: [{ name: "create_issue" }],
            },
          ]
        : [],
    cached: status === "available",
    stale: false,
    excludedInternal: 0,
    limitations: [],
  }) as never;

it.effect("reads the cached MCP inventory through the runner", () => {
  const calls: Array<unknown> = [];
  const handlers = WorkflowRpc.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(WorkflowRunner.WorkflowRunner)({
          mcpInventory: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return mcpInventorySnapshot("not-checked");
            }),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );
    const result = yield* client[WS_METHODS.workflowsRead]({
      _tag: "mcpInventory",
      projectId,
      workflow: WorkflowSlug.make("launch-site"),
      stepId: WorkflowSlug.make("deploy"),
      contextThreadId: threadId,
    });
    expect(calls).toEqual([
      {
        projectId,
        workflow: "launch-site",
        stepId: "deploy",
        contextThreadId: threadId,
      },
    ]);
    expect(result).toMatchObject({
      _tag: "mcpInventory",
      inventory: { status: "not-checked", cached: false },
    });
  });
});

it.effect("refreshes MCP inventory through the same runner edit path", () => {
  const calls: Array<unknown> = [];
  const handlers = WorkflowRpc.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(WorkflowRunner.WorkflowRunner)({
          refreshMcpInventory: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return mcpInventorySnapshot();
            }),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );
    const result = yield* client[WS_METHODS.workflowsEdit]({
      _tag: "mcpInventoryRefresh",
      projectId,
      workflow: WorkflowSlug.make("launch-site"),
      stepId: WorkflowSlug.make("deploy"),
      contextThreadId: threadId,
    });
    expect(calls).toEqual([
      {
        projectId,
        workflow: "launch-site",
        stepId: "deploy",
        contextThreadId: threadId,
      },
    ]);
    expect(result.mcpInventory).toMatchObject({
      status: "available",
      servers: [{ name: "linear", status: "connected" }],
    });
  });
});

it.effect("returns clipped MCP inventory over the workflows RPC channel", () => {
  const handlers = WorkflowRpc.layer.pipe(
    Layer.provide(inventoryRunnerLayer.pipe(Layer.provideMerge(oversizedInventoryLayer))),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );
    const result = yield* client[WS_METHODS.workflowsEdit]({
      _tag: "mcpInventoryRefresh",
      projectId: inventoryProjectId,
      workflow: WorkflowSlug.make("launch"),
      contextThreadId: inventoryThreadId,
    });
    const inventory = result.mcpInventory;
    if (inventory === undefined) throw new Error("Expected an MCP inventory result");
    const server = inventory.servers[0];
    expect(server).toMatchObject({
      name: `${oversized.slice(0, 199)}…`,
      description: `${oversized.slice(0, 299)}…`,
      toolsTruncated: true,
    });
    expect(server?.tools).toHaveLength(100);
  });
});

it.effect("sets and clears layout through the workflow edit RPC", () => {
  const calls: Array<unknown> = [];
  const handlers = WorkflowRpc.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(WorkflowRunner.WorkflowRunner)({
          layoutSet: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return {} as never;
            }),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );
    const positions = { build: { x: 100, y: -50 } };
    expect(
      yield* client[WS_METHODS.workflowsEdit]({
        _tag: "layoutSet",
        projectId,
        workflow: "launch-site",
        positions,
      }),
    ).toEqual({});
    expect(
      yield* client[WS_METHODS.workflowsEdit]({
        _tag: "layoutSet",
        projectId,
        workflow: "launch-site",
        positions: {},
        reset: true,
      }),
    ).toEqual({});
    expect(calls).toEqual([
      { projectId, slug: "launch-site", positions, reset: undefined },
      { projectId, slug: "launch-site", positions: {}, reset: true },
    ]);
  });
});

it.effect("keeps a workflow through the one workflow edit path", () => {
  const calls: Array<unknown> = [];
  const handlers = WorkflowRpc.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(WorkflowRunner.WorkflowRunner)({
          keep: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return {} as never;
            }),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, middleware)),
    );
    // Twice, because keeping an already kept workflow must succeed the same way.
    for (let attempt = 0; attempt < 2; attempt += 1)
      expect(
        yield* client[WS_METHODS.workflowsEdit]({
          _tag: "keep",
          projectId,
          workflow: "launch-site",
        }),
      ).toEqual({});
    expect(calls).toEqual([
      { projectId, slug: "launch-site" },
      { projectId, slug: "launch-site" },
    ]);
  });
});
