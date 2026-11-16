import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandAvailability } from "@t3tools/shared/shell";
import {
  ProjectId,
  ProviderDriverKind,
  type ServerProvider,
  ProviderInstanceId,
  ThreadId,
  WorkflowMcpInventorySnapshot as InventorySchema,
  type WorkflowDefinition,
  type WorkflowMcpInventorySnapshot,
  type WorkflowMcpConnectionState,
  type WorkflowReadinessEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowMcpConfigDiscovery from "./WorkflowMcpConfigDiscovery.ts";
import * as WorkflowMcpInventory from "./WorkflowMcpInventory.ts";
import { oversized, oversizedInventoryLayer } from "./WorkflowMcpInventory.test-fixtures.ts";
import * as WorkflowStore from "./WorkflowStore.ts";
import * as WorkflowReadiness from "./WorkflowReadiness.ts";
import * as ProcessRunner from "../processRunner.ts";

const projectId = ProjectId.make("project-1");
const workflow = "launch";
const threadId = ThreadId.make("driver");
const sessionId = "session-1";
const root = "/workspace/launch";
const encodeInventory = Schema.encodeEffect(InventorySchema);

const definition = (stepModel?: {
  instanceId: ProviderInstanceId;
  model: string;
}): WorkflowDefinition => ({
  version: 3,
  name: "Launch",
  ...(stepModel === undefined ? {} : { model: stepModel }),
  steps: [{ id: "deploy", kind: "skill", skill: "deploy" }],
});

const codexServer = (overrides: Record<string, unknown> = {}) => ({
  name: "linear",
  title: "Linear",
  description: "Issues and projects",
  version: "1.2.0",
  transport: "http" as const,
  origin: "https://mcp.linear.app",
  status: "connected" as const,
  auth: "signed-in" as const,
  toolsStatus: "available" as const,
  tools: [
    {
      name: "create_issue",
      title: "Create issue",
      description: "Create one issue",
      readOnly: false,
    },
  ],
  ...overrides,
});

type Runtime = {
  readonly instanceId: ProviderInstanceId;
  readonly mcpInventory?: {
    readonly list: (input: { readonly cursor?: string; readonly limit?: number }) => Effect.Effect<
      {
        servers: ReadonlyArray<Record<string, unknown>>;
        nextCursor?: string;
        unavailableReason?: string;
      },
      { message: string }
    >;
  };
};

type Options = {
  readonly snapshots?: ReadonlyArray<ServerProvider>;
  readonly definition?: WorkflowDefinition;
  readonly thread?: {
    readonly instanceId: ProviderInstanceId;
    readonly model?: string;
    readonly worktreePath?: string;
    readonly projectId?: ProjectId;
    readonly providerThreads?: ReadonlyArray<{
      readonly providerInstanceId: ProviderInstanceId;
      readonly providerSessionId: string | null;
      readonly status?: string;
      readonly ownerNodeId?: string | null;
      readonly driver?: string;
    }>;
  };
  readonly runtime?: Runtime;
  readonly driverKind?: string;
  readonly displayName?: string;
  readonly unavailable?: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly driver: string;
    readonly displayName?: string;
  }>;
  readonly changes?: Stream.Stream<void>;
  readonly configDiscovery?: WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscovery["Service"]["discover"];
};

const layer = (options: Options = {}) => {
  const threads = Layer.succeed(ThreadManagementService.ThreadManagementService, {
    getProjectThreadRecords: ({ projectId: requestedProjectId }: { projectId: ProjectId }) =>
      options.thread === undefined
        ? Effect.die("unexpected thread lookup")
        : requestedProjectId !== (options.thread.projectId ?? projectId)
          ? Effect.fail(
              new ThreadManagementService.ThreadManagementThreadNotFoundError({
                projectId: requestedProjectId,
                threadId,
              }),
            )
          : Effect.succeed({
              thread: {
                id: threadId,
                projectId: options.thread.projectId ?? projectId,
                modelSelection:
                  options.thread.model === undefined
                    ? undefined
                    : {
                        instanceId: options.thread.instanceId,
                        model: options.thread.model,
                      },
                worktreePath: options.thread.worktreePath ?? null,
              },
              providerThreads: options.thread.providerThreads ?? [],
            } as never),
  } as never);
  const providers = Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
    getInstance: (instanceId: ProviderInstanceId) =>
      Effect.succeed(
        (options.driverKind === undefined
          ? undefined
          : {
              instanceId,
              driverKind: options.driverKind,
              displayName: options.displayName ?? null,
            }) as never,
      ),
    listInstances: Effect.succeed([]),
    listUnavailable: Effect.succeed(options.unavailable ?? []),
    streamChanges: options.changes ?? Stream.never,
    subscribeChanges: Effect.die("unused"),
  } as never);
  const sessions = Layer.succeed(ProviderSessionManager.ProviderSessionManagerV2, {
    get: (id: string) =>
      Effect.succeed(
        options.runtime === undefined || id !== sessionId
          ? ({ _tag: "None" } as never)
          : ({ _tag: "Some", value: options.runtime } as never),
      ),
    isLive: () => Effect.succeed(true),
  } as never);
  return WorkflowMcpInventory.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(WorkflowStore.WorkflowStore, {
        readDefinition: () => Effect.succeed(options.definition ?? definition()),
        projectRoot: () => Effect.succeed(root),
      } as never),
    ),
    Layer.provide(
      options.snapshots === undefined
        ? Layer.empty
        : Layer.mock(ProviderRegistry.ProviderRegistry)({
            getProviders: Effect.succeed(options.snapshots),
          }),
    ),
    Layer.provideMerge(threads),
    Layer.provideMerge(providers),
    Layer.provideMerge(sessions),
    Layer.provideMerge(
      Layer.succeed(WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscovery, {
        discover:
          options.configDiscovery ??
          (() =>
            Effect.succeed({
              kind: "unavailable",
              reason: "No saved provider configuration is available in this test.",
            } as const)),
      }),
    ),
  );
};

const inspect = (
  input: Partial<WorkflowMcpInventory.McpInventoryInspectInput> = {},
): Effect.Effect<WorkflowMcpInventorySnapshot, never, WorkflowMcpInventory.WorkflowMcpInventory> =>
  Effect.gen(function* () {
    const service = yield* WorkflowMcpInventory.WorkflowMcpInventory;
    return yield* service
      .inspect({
        projectId,
        workflow,
        ...(input as object),
      } as WorkflowMcpInventory.McpInventoryInspectInput)
      .pipe(
        Effect.orElseSucceed(
          () =>
            ({
              status: "error",
              message: "unexpected store error",
              scope: { modelScoped: false, workspaceRoot: root },
              servers: [],
              cached: false,
              stale: false,
              excludedInternal: 0,
              limitations: [],
            }) as WorkflowMcpInventorySnapshot,
        ),
      );
  });

const inspectRaw = (input: Partial<WorkflowMcpInventory.McpInventoryInspectInput>) =>
  Effect.gen(function* () {
    const service = yield* WorkflowMcpInventory.WorkflowMcpInventory;
    return yield* service.inspect({
      projectId,
      workflow,
      ...(input as object),
    } as WorkflowMcpInventory.McpInventoryInspectInput);
  });

const thread = (instanceId = ProviderInstanceId.make("codex-work")) => ({
  instanceId,
  model: "gpt-5-codex",
  providerThreads: [
    {
      providerInstanceId: instanceId,
      providerSessionId: sessionId,
      status: "active",
      ownerNodeId: null,
      driver: "codex",
    },
  ],
});

const runtime = (
  list: NonNullable<Runtime["mcpInventory"]>["list"],
  instanceId = ProviderInstanceId.make("codex-work"),
): Runtime => ({
  instanceId,
  mcpInventory: { list },
});

const page = (servers: ReadonlyArray<Record<string, unknown>>, nextCursor?: string) => () =>
  Effect.succeed({
    servers,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });

describe("workflow MCP inventory", () => {
  it.effect("returns the provider's authoritative inventory and excludes T3's own server", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({
        refresh: true,
        contextThreadId: threadId,
      });
      expect(snapshot.status).toBe("available");
      expect(snapshot.scope).toMatchObject({
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        model: { model: "gpt-5-codex" },
        modelScoped: false,
        workspaceRoot: root,
        providerSessionId: sessionId,
        source: "live",
      });
      expect(snapshot.servers).toEqual([
        {
          name: "linear",
          title: "Linear",
          description: "Issues and projects",
          version: "1.2.0",
          transport: "http",
          origin: "https://mcp.linear.app",
          status: "connected",
          auth: "signed-in",
          toolsStatus: "available",
          tools: [
            {
              name: "create_issue",
              title: "Create issue",
              description: "Create one issue",
              readOnly: false,
            },
          ],
        },
      ]);
      expect(snapshot.excludedInternal).toBe(1);
      expect(snapshot.cached).toBe(false);
      expect(snapshot.stale).toBe(false);
      expect(snapshot.limitations).toContain(
        "MCP connections belong to the provider session, not to the selected model.",
      );
    }).pipe(
      Effect.provide(
        layer({
          definition: definition({
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          }),
          thread: thread(),
          driverKind: "codex",
          displayName: "Work Codex",
          configDiscovery: () => Effect.die("unexpected configuration fallback"),
          runtime: runtime(
            page([
              codexServer(),
              { name: "t3-code", status: "connected", tools: [], toolsStatus: "available" },
            ]),
          ),
        }),
      ),
    ),
  );

  it.effect("reports a disconnected server's tools as unavailable, never verified empty", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.servers[0]).toMatchObject({
        name: "linear",
        status: "failed",
        toolsStatus: "unavailable",
        tools: [],
      });
    }).pipe(
      Effect.provide(
        layer({
          thread: thread(),
          runtime: runtime(
            page([
              codexServer({
                status: "failed",
                auth: "unknown",
                toolsStatus: "unavailable",
                tools: [],
              }),
            ]),
          ),
        }),
      ),
    ),
  );

  it.effect("keeps needs-auth distinct from failure and online", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.servers[0]).toMatchObject({
        status: "needs-auth",
        auth: "needs-auth",
        toolsStatus: "unavailable",
      });
    }).pipe(
      Effect.provide(
        layer({
          thread: thread(),
          runtime: runtime(
            page([
              codexServer({
                status: "needs-auth",
                auth: "needs-auth",
                toolsStatus: "unavailable",
                tools: [],
              }),
            ]),
          ),
        }),
      ),
    ),
  );

  it.effect("follows provider pagination and caps the result", () => {
    let requests = 0;
    return Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(requests).toBe(2);
      expect(snapshot.servers.map((server) => server.name)).toEqual(["one", "two"]);
    }).pipe(
      Effect.provide(
        layer({
          thread: thread(),
          runtime: runtime((input) => {
            requests += 1;
            return input.cursor === undefined
              ? Effect.succeed({ servers: [codexServer({ name: "one" })], nextCursor: "next" })
              : Effect.succeed({ servers: [codexServer({ name: "two" })] });
          }),
        }),
      ),
    );
  });

  it.effect("is unsupported when the provider has no inventory API", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("unsupported");
      expect(snapshot.servers).toEqual([]);
      expect(snapshot.message).toContain("Cursor");
    }).pipe(
      Effect.provide(
        layer({
          thread: {
            ...thread(ProviderInstanceId.make("cursor-work")),
            providerThreads: [
              {
                providerInstanceId: ProviderInstanceId.make("cursor-work"),
                providerSessionId: sessionId,
                status: "active",
                ownerNodeId: null,
                driver: "cursor",
              },
            ],
          },
          driverKind: "cursor",
          displayName: "Cursor Work",
          runtime: { instanceId: ProviderInstanceId.make("cursor-work") },
          configDiscovery: () =>
            Effect.succeed({
              kind: "unsupported" as const,
              reason:
                "Cursor has no read-only MCP configuration source in T3, so its servers can't be listed without a running session.",
            }),
        }),
      ),
    ),
  );

  it.effect(
    "stays unsupported for a provider with no inventory API even when it isn't running",
    () =>
      Effect.gen(function* () {
        const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
        expect(snapshot.status).toBe("unsupported");
        expect(snapshot.servers).toEqual([]);
        expect(snapshot.message).toContain("Cursor");
      }).pipe(
        Effect.provide(
          layer({
            driverKind: "cursor",
            displayName: "Cursor Work",
            thread: {
              instanceId: ProviderInstanceId.make("cursor-work"),
              model: "cursor-fast",
            },
            configDiscovery: () =>
              Effect.succeed({
                kind: "unsupported",
                reason:
                  "Cursor has no read-only MCP configuration source in T3, so its servers can't be listed without a running session.",
              } as const),
          }),
        ),
      ),
  );

  it.effect("discovers configured servers when the selected provider has no live session", () => {
    const calls: Array<WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscoveryInput> = [];
    return Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("available");
      expect(snapshot.servers).toMatchObject([
        {
          name: "linear",
          status: "unknown",
          toolsStatus: "unavailable",
          tools: [],
        },
      ]);
      expect(snapshot.scope.providerSessionId).toBeUndefined();
      expect(snapshot.scope.source).toBe("configured");
      expect(snapshot.limitations).toContain(
        "The provider session is idle or released, so T3 read its saved configuration instead.",
      );
      expect(calls).toEqual([
        {
          instanceId: ProviderInstanceId.make("codex-work"),
          driverKind: "codex",
          label: "Work Codex",
          workspaceRoot: root,
        },
      ]);
    }).pipe(
      Effect.provide(
        layer({
          driverKind: "codex",
          displayName: "Work Codex",
          thread: {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
            providerThreads: [
              {
                providerInstanceId: ProviderInstanceId.make("codex-work"),
                providerSessionId: sessionId,
                status: "idle",
                ownerNodeId: null,
                driver: "codex",
              },
            ],
          },
          configDiscovery: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return {
                kind: "configured" as const,
                servers: [
                  {
                    name: "linear",
                    status: "unknown" as const,
                    toolsStatus: "unavailable" as const,
                    tools: [],
                    toolsDetail: "Tools are only listed while Codex runs for this instance.",
                  },
                ],
                limitations: ["Configuration only."],
              };
            }),
        }),
      ),
    );
  });

  it.effect("uses the workflow's provider without a context thread", () => {
    const calls: Array<ProviderInstanceId> = [];
    return Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true });
      expect(snapshot.status).toBe("available");
      expect(snapshot.scope.threadId).toBeUndefined();
      expect(snapshot.servers.map((server) => server.name)).toEqual(["linear"]);
      expect(calls).toEqual([ProviderInstanceId.make("codex-work")]);
    }).pipe(
      Effect.provide(
        layer({
          definition: definition({
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          }),
          driverKind: "codex",
          displayName: "Work Codex",
          configDiscovery: (input) =>
            Effect.sync(() => {
              calls.push(input.instanceId);
              return {
                kind: "configured" as const,
                servers: [
                  {
                    name: "linear",
                    status: "unknown" as const,
                    toolsStatus: "unavailable" as const,
                    tools: [],
                    toolsDetail: "Tools are only listed while Codex runs for this instance.",
                  },
                ],
                limitations: [],
              };
            }),
        }),
      ),
    );
  });

  it.effect("asks saved configuration even when no registry entry can name the driver", () => {
    const calls: Array<WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscoveryInput> = [];
    return Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true });
      expect(snapshot.status).toBe("available");
      expect(snapshot.scope.driverKind).toBeUndefined();
      expect(snapshot.scope.source).toBe("configured");
      expect(snapshot.servers.map((server) => server.name)).toEqual(["linear"]);
      expect(calls).toEqual([
        {
          instanceId: ProviderInstanceId.make("codex-work"),
          label: "codex-work",
          workspaceRoot: root,
        },
      ]);
    }).pipe(
      Effect.provide(
        layer({
          definition: definition({
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          }),
          configDiscovery: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return {
                kind: "configured" as const,
                servers: [
                  {
                    name: "linear",
                    status: "unknown" as const,
                    toolsStatus: "unavailable" as const,
                    tools: [],
                    toolsDetail: "Tools are only listed while Codex runs for this instance.",
                  },
                ],
                limitations: [],
              };
            }),
        }),
      ),
    );
  });

  it.effect("keeps a registered instance's driver when it failed to start", () => {
    const calls: Array<WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscoveryInput> = [];
    return Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("available");
      expect(snapshot.scope).toMatchObject({
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        driverKind: "codex",
        providerLabel: "Work Codex",
        source: "configured",
      });
      expect(calls[0]).toMatchObject({ driverKind: "codex", label: "Work Codex" });
    }).pipe(
      Effect.provide(
        layer({
          thread: {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          },
          unavailable: [
            {
              instanceId: ProviderInstanceId.make("codex-work"),
              driver: "codex",
              displayName: "Work Codex",
            },
          ],
          configDiscovery: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return { kind: "configured" as const, servers: [], limitations: [] };
            }),
        }),
      ),
    );
  });

  it.effect("does not read configuration on a cached read", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const cached = yield* inspect({ contextThreadId: threadId });
      expect(cached.status).toBe("not-checked");
      expect(calls).toBe(0);
      yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(calls).toBe(1);
      const served = yield* inspect({ contextThreadId: threadId });
      expect(served.cached).toBe(true);
      expect(calls).toBe(1);
    }).pipe(
      Effect.provide(
        layer({
          driverKind: "codex",
          displayName: "Work Codex",
          thread: {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          },
          configDiscovery: () =>
            Effect.sync(() => {
              calls += 1;
              return {
                kind: "configured" as const,
                servers: [],
                limitations: [],
              };
            }),
        }),
      ),
    );
  });

  it.effect("falls back to configuration when a live runtime exposes no inventory capability", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("available");
      expect(snapshot.servers.map((server) => server.name)).toEqual(["linear"]);
      expect(snapshot.limitations).toContain(
        "This provider runtime didn't expose a live MCP inventory.",
      );
    }).pipe(
      Effect.provide(
        layer({
          thread: thread(),
          driverKind: "codex",
          displayName: "Work Codex",
          runtime: { instanceId: ProviderInstanceId.make("codex-work") },
          configDiscovery: () =>
            Effect.succeed({
              kind: "configured" as const,
              servers: [
                {
                  name: "linear",
                  status: "unknown" as const,
                  toolsStatus: "unavailable" as const,
                  tools: [],
                  toolsDetail: "Tools are only listed while Codex runs for this instance.",
                },
              ],
              limitations: [],
            }),
        }),
      ),
    ),
  );

  it.effect("falls back to configuration when a live capability reports itself unavailable", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("available");
      expect(snapshot.servers.map((server) => server.name)).toEqual(["linear"]);
      expect(snapshot.limitations).toContain("Claude Code isn't running for this session.");
    }).pipe(
      Effect.provide(
        layer({
          driverKind: "claudeAgent",
          displayName: "Claude Work",
          thread: {
            ...thread(ProviderInstanceId.make("claude-work")),
            providerThreads: [
              {
                providerInstanceId: ProviderInstanceId.make("claude-work"),
                providerSessionId: sessionId,
                status: "idle",
                ownerNodeId: null,
                driver: "claudeAgent",
              },
            ],
          },
          runtime: {
            instanceId: ProviderInstanceId.make("claude-work"),
            mcpInventory: {
              list: () =>
                Effect.succeed({
                  servers: [],
                  unavailableReason: "Claude Code isn't running for this session.",
                }),
            },
          },
          configDiscovery: () =>
            Effect.succeed({
              kind: "configured" as const,
              servers: [
                {
                  name: "linear",
                  status: "unknown" as const,
                  toolsStatus: "unavailable" as const,
                  tools: [],
                  toolsDetail: "Tools are only listed while Claude Code runs for this instance.",
                },
              ],
              limitations: [],
            }),
        }),
      ),
    ),
  );

  it.effect("times out a hanging configuration discovery", () => {
    let started: Deferred.Deferred<void> | undefined;
    return Effect.gen(function* () {
      started = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(inspect({ refresh: true, contextThreadId: threadId }));
      yield* Deferred.await(started);
      yield* TestClock.adjust("13 seconds");
      const snapshot = yield* Fiber.join(fiber);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("timed out");
    }).pipe(
      Effect.provide(
        layer({
          driverKind: "codex",
          displayName: "Work Codex",
          thread: {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          },
          configDiscovery: () =>
            Effect.gen(function* () {
              if (started !== undefined) yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }),
        }),
      ),
    );
  });

  it.effect("reports a configuration discovery timeout as an error", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("timed out");
    }).pipe(
      Effect.provide(
        layer({
          driverKind: "codex",
          displayName: "Work Codex",
          thread: {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          },
          configDiscovery: () =>
            Effect.succeed({
              kind: "error",
              reason: "Work Codex's configuration query timed out.",
            }),
        }),
      ),
    ),
  );

  it.effect("keeps a configuration failure distinct from an unsupported provider", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("error");
      expect(snapshot.servers).toEqual([]);
      expect(snapshot.message).not.toContain("offline");
    }).pipe(
      Effect.provide(
        layer({
          driverKind: "codex",
          displayName: "Work Codex",
          thread: {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5-codex",
          },
          configDiscovery: () =>
            Effect.succeed({
              kind: "error",
              reason: "The provider's inventory command exited with code 7.",
            }),
        }),
      ),
    ),
  );

  it.effect("never borrows another provider's live session while reading configuration", () => {
    const calls: Array<ProviderInstanceId> = [];
    return Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("available");
      expect(snapshot.limitations).toContain(
        "The context thread uses another provider, so T3 read this provider's configuration without borrowing that thread's connections.",
      );
      expect(calls).toEqual([ProviderInstanceId.make("claude-work")]);
    }).pipe(
      Effect.provide(
        layer({
          definition: definition({
            instanceId: ProviderInstanceId.make("claude-work"),
            model: "claude-sonnet",
          }),
          driverKind: "claudeAgent",
          displayName: "Claude Work",
          runtime: {
            instanceId: ProviderInstanceId.make("claude-work"),
            mcpInventory: { list: page([codexServer()]) },
          },
          thread: thread(ProviderInstanceId.make("codex-work")),
          configDiscovery: (input) =>
            Effect.sync(() => {
              calls.push(input.instanceId);
              return {
                kind: "configured" as const,
                servers: [],
                limitations: [],
              };
            }),
        }),
      ),
    );
  });

  it.effect("serves cache, marks it stale, and Refresh asks again", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const cached = yield* inspect({ refresh: false, contextThreadId: threadId });
      expect(cached.status).toBe("not-checked");
      expect(cached.cached).toBe(false);
      expect(calls).toBe(0);

      const first = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(first.cached).toBe(false);
      expect(calls).toBe(1);

      const second = yield* inspect({ refresh: false, contextThreadId: threadId });
      expect(second.status).toBe("available");
      expect(second.cached).toBe(true);
      expect(second.stale).toBe(false);
      expect(calls).toBe(1);

      yield* TestClock.adjust("61 seconds");
      const stale = yield* inspect({ refresh: false, contextThreadId: threadId });
      expect(stale.cached).toBe(true);
      expect(stale.stale).toBe(true);
      expect(calls).toBe(1);

      yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(calls).toBe(2);
    }).pipe(
      Effect.provide(
        layer({
          thread: thread(),
          runtime: runtime(() =>
            Effect.sync(() => {
              calls += 1;
              return { servers: [codexServer()] };
            }),
          ),
        }),
      ),
    );
  });

  it.effect("single-flights concurrent refreshes for the same selection", () => {
    let calls = 0;
    let started: Deferred.Deferred<void> | undefined;
    let gate: Deferred.Deferred<void> | undefined;
    return Effect.gen(function* () {
      started = yield* Deferred.make<void>();
      gate = yield* Deferred.make<void>();
      const request = inspect({ refresh: true, contextThreadId: threadId });
      const first = yield* Effect.forkChild(request);
      yield* Deferred.await(started);
      const second = yield* Effect.forkChild(request);
      // Let the second request reach the single-flight map before the provider answers.
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gate, undefined);
      const [left, right] = [yield* Fiber.join(first), yield* Fiber.join(second)];
      expect(left.status).toBe("available");
      expect(right.status).toBe("available");
      expect(calls).toBe(1);
      expect(left.checkedAt).toBe(right.checkedAt);
    }).pipe(
      Effect.provide(
        layer({
          thread: thread(),
          runtime: runtime(() =>
            Effect.gen(function* () {
              calls += 1;
              if (started !== undefined) yield* Deferred.succeed(started, undefined);
              if (gate !== undefined) yield* Deferred.await(gate);
              return { servers: [codexServer()] };
            }),
          ),
        }),
      ),
    );
  });

  it.effect("drops cached snapshots when the provider instances change", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<void>();
      yield* Effect.gen(function* () {
        yield* inspect({ refresh: true, contextThreadId: threadId });
        const cached = yield* inspect({ refresh: false, contextThreadId: threadId });
        expect(cached.status).toBe("available");
        yield* Queue.offer(queue, undefined);
        yield* Effect.yieldNow;
        const after = yield* inspect({ refresh: false, contextThreadId: threadId });
        expect(after.status).toBe("not-checked");
      }).pipe(
        Effect.provide(
          layer({
            thread: thread(),
            changes: Stream.fromQueue(queue),
            runtime: runtime(page([codexServer()])),
          }),
        ),
      );
    }),
  );

  it.effect("never queries a provider without a selected provider", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("unavailable");
      expect(snapshot.scope.providerInstanceId).toBeUndefined();
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layer({
          thread: {
            instanceId: ProviderInstanceId.make("codex-work"),
            providerThreads: [],
          },
          runtime: runtime(() =>
            Effect.sync(() => {
              calls += 1;
              return { servers: [] };
            }),
          ),
        }),
      ),
    );
  });

  it.effect("uses the step model over the workflow and thread model", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({
        refresh: true,
        contextThreadId: threadId,
        stepId: "deploy",
      });
      expect(snapshot.scope).toMatchObject({
        providerInstanceId: ProviderInstanceId.make("claude-work"),
        model: { model: "claude-opus" },
      });
    }).pipe(
      Effect.provide(
        layer({
          definition: {
            version: 3,
            name: "Launch",
            model: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5-codex" },
            steps: [
              {
                id: "deploy",
                kind: "skill",
                skill: "deploy",
                model: {
                  instanceId: ProviderInstanceId.make("claude-work"),
                  model: "claude-opus",
                },
              },
            ],
          },
          driverKind: "claudeAgent",
          displayName: "Claude Work",
          thread: {
            instanceId: ProviderInstanceId.make("claude-work"),
            model: "claude-opus",
            providerThreads: [
              {
                providerInstanceId: ProviderInstanceId.make("claude-work"),
                providerSessionId: sessionId,
                status: "idle",
                ownerNodeId: null,
                driver: "claudeAgent",
              },
            ],
          },
          runtime: {
            instanceId: ProviderInstanceId.make("claude-work"),
            mcpInventory: { list: page([codexServer()]) },
          },
        }),
      ),
    ),
  );

  it.effect("rejects an unknown step instead of using the workflow provider", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const result = yield* Effect.result(
        inspectRaw({ refresh: true, stepId: "missing", contextThreadId: threadId }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "WorkflowMcpInventoryStepNotFoundError",
          stepId: "missing",
        });
      }
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layer({
          thread: thread(),
          runtime: runtime(() =>
            Effect.sync(() => {
              calls += 1;
              return { servers: [codexServer()] };
            }),
          ),
        }),
      ),
    );
  });

  it.effect("rejects context threads from another project", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const result = yield* Effect.result(inspectRaw({ refresh: true, contextThreadId: threadId }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "ThreadManagementThreadNotFoundError",
          projectId,
          threadId,
        });
      }
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layer({
          thread: { ...thread(), projectId: ProjectId.make("other-project") },
          runtime: runtime(() =>
            Effect.sync(() => {
              calls += 1;
              return { servers: [codexServer()] };
            }),
          ),
        }),
      ),
    );
  });

  it.effect("does not use a subagent session as the thread's MCP inventory", () =>
    Effect.gen(function* () {
      const snapshot = yield* inspect({ refresh: true, contextThreadId: threadId });
      expect(snapshot.status).toBe("unavailable");
      expect(snapshot.servers).toEqual([]);
    }).pipe(
      Effect.provide(
        layer({
          thread: {
            ...thread(),
            providerThreads: [
              {
                providerInstanceId: ProviderInstanceId.make("codex-work"),
                providerSessionId: sessionId,
                status: "active",
                ownerNodeId: "subagent-node",
                driver: "codex",
              },
            ],
          },
          runtime: runtime(page([codexServer()])),
        }),
      ),
    ),
  );

  it.effect("does not cache a refresh completed after provider registry invalidation", () =>
    Effect.gen(function* () {
      const changed = yield* Queue.unbounded<void>();
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const request = Effect.gen(function* () {
        const inProgress = yield* Effect.forkChild(
          inspect({ refresh: true, contextThreadId: threadId }),
        );
        yield* Deferred.await(started);
        yield* Queue.offer(changed, undefined);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        expect((yield* Fiber.join(inProgress)).status).toBe("available");
        expect((yield* inspect({ contextThreadId: threadId })).status).toBe("not-checked");
      });
      yield* request.pipe(
        Effect.provide(
          layer({
            thread: thread(),
            changes: Stream.fromQueue(changed),
            runtime: runtime(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(gate);
                return { servers: [codexServer()] };
              }),
            ),
          }),
        ),
      );
    }),
  );
});

const readinessLayer = (options: Options) =>
  WorkflowReadiness.layer.pipe(
    Layer.provideMerge(layer(options)),
    Layer.provide(NodeServices.layer),
    Layer.provide(Layer.succeed(CommandAvailability, () => Effect.succeed(false))),
    Layer.provide(
      Layer.succeed(ProcessRunner.ProcessRunner, {
        run: () => Effect.die("MCP readiness must not run a command"),
      }),
    ),
  );
const mcpDefinition = (): WorkflowDefinition => ({
  ...definition({ instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5-codex" }),
  steps: [
    {
      id: "deploy",
      kind: "skill",
      skill: "deploy",
      attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }],
    },
  ],
});
const readMcp = (refresh = false, def = mcpDefinition()) =>
  Effect.gen(function* () {
    const readiness = yield* WorkflowReadiness.WorkflowReadiness;
    const input = { projectId, workspaceRoot: root, contextThreadId: threadId, definition: def };
    return yield* refresh ? readiness.probe(input) : readiness.cached(input);
  });

describe("MCP readiness inventory evidence", () => {
  const mappings: Array<[WorkflowMcpConnectionState, WorkflowReadinessEntry["status"], string]> = [
    ["connected", "available", "Connected per live Work Codex session at"],
    ["needs-auth", "missing", "Needs sign-in per live Work Codex session at"],
    ["failed", "error", "Not available: failed"],
    ["disabled", "error", "Not available: disabled"],
    ["connecting", "unknown", "connecting per live"],
    ["not-started", "unknown", "not-started per live"],
    ["unknown", "unknown", "unknown per live"],
  ];
  it.effect.each(mappings)("maps live %s to advisory readiness", ([state, status, message]) =>
    Effect.gen(function* () {
      const snapshot = yield* readMcp(true);
      expect(snapshot.entries[0]).toMatchObject({ status, providerInstanceId: "codex-work" });
      expect(snapshot.entries[0]?.message).toContain(message);
      if (state === "connected")
        expect(snapshot.entries[0]?.message).toMatch(
          /^Connected per live Work Codex session at .*; T3 doesn't verify what the server can access \(files, sign-ins\)\.$/,
        );
      expect(snapshot.entries[0]?.checkedAt).toBeDefined();
      expect(snapshot.blocksRun).toBe(false);
    }).pipe(
      Effect.provide(
        readinessLayer({
          thread: thread(),
          driverKind: "codex",
          displayName: "Work Codex",
          runtime: {
            instanceId: ProviderInstanceId.make("codex-work"),
            mcpInventory: {
              list: () => Effect.succeed({ servers: [codexServer({ status: state })] }),
            },
          },
        }),
      ),
    ),
  );

  it.effect.each([false, true])(
    "marks absence from a successful list missing (configured=%s)",
    (configured) =>
      Effect.gen(function* () {
        const snapshot = yield* readMcp(true);
        expect(snapshot.entries[0]?.status).toBe("missing");
        expect(snapshot.entries[0]?.message).toContain(
          `absent from Work Codex's ${configured ? "configured" : "live"} MCP listing`,
        );
        expect(snapshot.blocksRun).toBe(false);
      }).pipe(
        Effect.provide(
          readinessLayer({
            thread: thread(),
            driverKind: "codex",
            displayName: "Work Codex",
            ...(configured
              ? {
                  configDiscovery: () =>
                    Effect.succeed({ kind: "configured", servers: [], limitations: [] }),
                }
              : {
                  runtime: {
                    instanceId: ProviderInstanceId.make("codex-work"),
                    mcpInventory: { list: () => Effect.succeed({ servers: [] }) },
                  },
                }),
          }),
        ),
      ),
  );

  it.effect("keeps configured servers unverified even if their configuration disables them", () =>
    Effect.gen(function* () {
      const snapshot = yield* readMcp(true);
      expect(snapshot.entries[0]?.status).toBe("unknown");
      expect(snapshot.entries[0]?.message).toContain(
        "Configured in Work Codex, not verified (no live session)",
      );
      expect(snapshot.blocksRun).toBe(false);
    }).pipe(
      Effect.provide(
        readinessLayer({
          thread: thread(),
          driverKind: "codex",
          displayName: "Work Codex",
          configDiscovery: () =>
            Effect.succeed({
              kind: "configured",
              servers: [codexServer({ status: "disabled" })],
              limitations: [],
            }),
        }),
      ),
    ),
  );

  it.effect.each(["unsupported", "unavailable", "error"] as const)(
    "keeps inventory %s unknown with its reason",
    (kind) =>
      Effect.gen(function* () {
        const snapshot = yield* readMcp(true);
        expect(snapshot.entries[0]).toMatchObject({
          status: "unknown",
          message: "Provider inventory could not be read.",
        });
        expect(snapshot.blocksRun).toBe(false);
      }).pipe(
        Effect.provide(
          readinessLayer({
            thread: thread(),
            driverKind: "codex",
            configDiscovery: () =>
              Effect.succeed({ kind, reason: "Provider inventory could not be read." }),
          }),
        ),
      ),
  );

  it.effect(
    "shares picker evidence across cards and models, never queries on cheap reads, and marks stale",
    () => {
      let queries = 0;
      return Effect.gen(function* () {
        expect((yield* readMcp()).entries[0]?.status).toBe("unknown");
        expect(queries).toBe(0);
        yield* inspectRaw({ refresh: true, contextThreadId: threadId, stepId: "deploy" });
        expect(queries).toBe(1);
        const bound = mcpDefinition();
        const first = bound.steps[0]!;
        const cards = {
          ...bound,
          steps: [
            {
              ...first,
              attachments: [
                ...first.attachments!,
                {
                  id: "bound",
                  kind: "mcp-connection" as const,
                  server: "linear",
                  providerInstanceId: ProviderInstanceId.make("codex-work"),
                },
              ],
            },
            { ...first, id: "second" },
          ],
        };
        const cached = yield* readMcp(false, cards);
        expect(cached.entries.map((entry) => entry.status)).toEqual([
          "available",
          "available",
          "available",
        ]);
        expect(queries).toBe(1);
        yield* TestClock.adjust("61 seconds");
        expect((yield* readMcp()).entries[0]?.stale).toBe(true);
        expect(queries).toBe(1);
        yield* readMcp(true, cards);
        expect(queries).toBe(2);
        expect((yield* readMcp()).entries[0]?.stale).toBeUndefined();
      }).pipe(
        Effect.provide(
          readinessLayer({
            definition: mcpDefinition(),
            thread: thread(),
            driverKind: "codex",
            runtime: {
              instanceId: ProviderInstanceId.make("codex-work"),
              mcpInventory: {
                list: () =>
                  Effect.sync(() => {
                    queries += 1;
                    return { servers: [codexServer()] };
                  }),
              },
            },
          }),
        ),
      );
    },
  );

  it.effect(
    "uses the attachment's bound instance without borrowing the step's live provider",
    () => {
      const discovered: string[] = [];
      const bound = mcpDefinition();
      const first = bound.steps[0]!;
      const cards = {
        ...bound,
        steps: [
          {
            ...first,
            attachments: [
              {
                id: "linear",
                kind: "mcp-connection" as const,
                server: "linear",
                providerInstanceId: ProviderInstanceId.make("claude-work"),
              },
            ],
          },
        ],
      };
      return Effect.gen(function* () {
        const snapshot = yield* readMcp(true, cards);
        expect(snapshot.entries[0]).toMatchObject({
          status: "unknown",
          providerInstanceId: "claude-work",
        });
        expect(snapshot.entries[0]?.message).toContain("Configured in Claude Work, not verified");
        expect(discovered).toEqual(["claude-work"]);
      }).pipe(
        Effect.provide(
          readinessLayer({
            thread: thread(),
            driverKind: "claudeAgent",
            displayName: "Claude Work",
            runtime: {
              instanceId: ProviderInstanceId.make("codex-work"),
              mcpInventory: {
                list: () => Effect.die("must not borrow Codex's session"),
              },
            },
            configDiscovery: (input) =>
              Effect.sync(() => {
                discovered.push(input.instanceId);
                return { kind: "configured", servers: [codexServer()], limitations: [] };
              }),
          }),
        ),
      );
    },
  );
  it.effect.each(["failed-page", "page-limit", "configured-limit"] as const)(
    "keeps an absent server unknown when the listing is incomplete (%s)",
    (reason) => {
      let pages = 0;
      return Effect.gen(function* () {
        const snapshot = yield* readMcp(true);
        expect(snapshot.entries[0]).toMatchObject({
          status: "unknown",
          message: WorkflowMcpInventory.MCP_INCOMPLETE_LISTING,
        });
        expect(snapshot.blocksRun).toBe(false);
        expect(pages).toBe(reason === "configured-limit" ? 0 : reason === "failed-page" ? 2 : 5);
      }).pipe(
        Effect.provide(
          readinessLayer({
            thread: thread(),
            driverKind: "codex",
            ...(reason === "configured-limit"
              ? {
                  configDiscovery: () =>
                    Effect.succeed({
                      kind: "configured",
                      limitations: [],
                      servers: Array.from({ length: 201 }, (_, index) =>
                        codexServer({ name: `other-${index}` }),
                      ),
                    }),
                }
              : {
                  runtime: {
                    instanceId: ProviderInstanceId.make("codex-work"),
                    mcpInventory: {
                      list: () =>
                        Effect.suspend(() => {
                          pages += 1;
                          return pages === 2 && reason === "failed-page"
                            ? Effect.fail({ message: "query failed" })
                            : Effect.succeed({
                                servers: [codexServer({ name: `other-${pages}` })],
                                nextCursor: String(pages),
                              });
                        }),
                    },
                  },
                }),
          }),
        ),
      );
    },
  );
});

it.effect("clips every oversized provider field before caching or encoding a snapshot", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowMcpInventory.WorkflowMcpInventory;
    const input = { projectId, workflow, contextThreadId: threadId };
    const fresh = yield* service.inspect({ ...input, refresh: true });
    yield* encodeInventory(fresh);
    const clipped = (value: string, max: number) => `${value.slice(0, max - 1)}…`;
    const server = fresh.servers[0];
    expect(server).toMatchObject({
      name: clipped(oversized, 200),
      title: clipped(oversized, 200),
      description: clipped(oversized, 300),
      version: clipped(oversized, 120),
      origin: clipped(oversized, 300),
      statusDetail: clipped(oversized, 240),
      toolsDetail: clipped(oversized, 240),
      toolsTruncated: true,
    });
    expect(server?.tools).toHaveLength(100);
    expect(server?.tools[0]).toMatchObject({
      name: clipped(`0-${oversized}`, 200),
      title: clipped(oversized, 200),
      description: clipped(oversized, 300),
    });
    // The provider's display name lands in the sentence, so the sentence is clipped too.
    expect(fresh.message).toHaveLength(400);
    expect(fresh.message.endsWith("…")).toBe(true);
    const cached = yield* service.inspect({ ...input, refresh: false });
    yield* encodeInventory(cached);
    expect(cached.cached).toBe(true);
    expect(cached.servers).toEqual(fresh.servers);
  }).pipe(Effect.provide(oversizedInventoryLayer)),
);

it.effect(
  "chooses live usable subagent models for inventory and honours a supplied run snapshot",
  () => {
    const preferred = { instanceId: ProviderInstanceId.make("codex-work"), model: "preferred" };
    const driver = { instanceId: ProviderInstanceId.make("driver"), model: "driver-model" };
    const provider: ServerProvider = {
      instanceId: preferred.instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-10-23T00:00:00.000Z",
      models: [{ slug: preferred.model, name: "Preferred", isCustom: false, capabilities: null }],
      slashCommands: [],
      skills: [],
    };
    const saved = {
      ...definition(),
      subagentModels: [{ ...preferred, model: "missing" }, preferred],
    };
    const pinned = { ...preferred, instanceId: ProviderInstanceId.make("pinned") };
    return Effect.gen(function* () {
      for (const [run, expected] of [
        [undefined, preferred],
        [
          {
            definition: saved,
            subagents: {
              usable: [{ ...pinned, driver: provider.driver, label: "Pinned" }],
              missing: [],
              fallback: false,
            },
          },
          pinned,
        ],
        [{ definition: saved, subagents: { usable: [], missing: [], fallback: true } }, driver],
      ] as const) {
        const snapshot = yield* inspectRaw({ contextThreadId: threadId, run, refresh: false });
        expect(snapshot.scope.model).toMatchObject(expected);
      }
    }).pipe(Effect.provide(layer({ definition: saved, snapshots: [provider], thread: driver })));
  },
);
