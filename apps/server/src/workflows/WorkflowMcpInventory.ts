import {
  MAX_WORKFLOW_MCP_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_MCP_DETAIL_LENGTH,
  MAX_WORKFLOW_MCP_LIMITATIONS,
  MAX_WORKFLOW_MCP_MESSAGE_LENGTH,
  MAX_WORKFLOW_MCP_NAME_LENGTH,
  MAX_WORKFLOW_MCP_ORIGIN_LENGTH,
  MAX_WORKFLOW_MCP_SERVERS,
  MAX_WORKFLOW_MCP_TOOLS,
  MAX_WORKFLOW_MCP_TOOLS_PER_SERVER,
  MAX_WORKFLOW_MCP_VERSION_LENGTH,
  type ModelSelection,
  type OrchestrationV2ProviderThread,
  type ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ThreadId,
  type WorkflowMcpInventoryScope,
  type WorkflowMcpInventorySnapshot,
  type WorkflowMcpServerInventory,
  type WorkflowSlug,
  type WorkflowRun,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { ProviderAdapterV2SessionRuntime } from "@t3tools/provider-core/server/ProviderAdapter";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { workflowExecutor } from "./workflowDelegation.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowMcpConfigDiscovery from "./WorkflowMcpConfigDiscovery.ts";
import * as WorkflowStore from "./WorkflowStore.ts";

/** A provider runtime query, not a probe: short, bounded and never an agent turn. */
const INVENTORY_TIMEOUT = "8 seconds";
/** File reads and a bounded CLI query, guarded independently of the provider runtime timeout. */
const CONFIG_DISCOVERY_TIMEOUT = "12 seconds";
const FRESHNESS_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const PAGE_LIMIT = 50;
const MAX_PAGES = 5;
export const MCP_INCOMPLETE_LISTING =
  "The MCP listing is incomplete; absence does not prove a server is missing.";

const DRIVER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeAgent: "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
  muse: "Muse",
  pi: "Pi",
  antigravity: "Antigravity",
  nativeCli: "its provider CLI",
};

/** T3 injects its own orchestration server into providers; it is not third-party inventory. */
const isInternalServer = (name: string) =>
  name === "t3-code" || name.startsWith("t3-code-") || name.startsWith("t3-code_");

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const clip = (value: string, max = MAX_WORKFLOW_MCP_DETAIL_LENGTH) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/**
 * Provider strings are untrusted in length. Every source — live runtime, saved configuration or
 * cache — crosses this boundary, because a value past the contract bound would otherwise fail
 * the MCP tool or RPC encode after the handler has already answered, which reaches the agent as
 * Effect's generic internal-error text.
 */
const boundSnapshot = (snapshot: WorkflowMcpInventorySnapshot): WorkflowMcpInventorySnapshot => {
  let remainingTools = MAX_WORKFLOW_MCP_TOOLS;
  return {
    ...snapshot,
    message: clip(snapshot.message, MAX_WORKFLOW_MCP_MESSAGE_LENGTH),
    servers: snapshot.servers.slice(0, MAX_WORKFLOW_MCP_SERVERS).map((server) => {
      const tools = server.tools.slice(
        0,
        Math.max(0, Math.min(MAX_WORKFLOW_MCP_TOOLS_PER_SERVER, remainingTools)),
      );
      remainingTools -= tools.length;
      return {
        ...server,
        name: clip(server.name, MAX_WORKFLOW_MCP_NAME_LENGTH),
        ...(server.title === undefined
          ? {}
          : { title: clip(server.title, MAX_WORKFLOW_MCP_NAME_LENGTH) }),
        ...(server.description === undefined
          ? {}
          : { description: clip(server.description, MAX_WORKFLOW_MCP_DESCRIPTION_LENGTH) }),
        ...(server.version === undefined
          ? {}
          : { version: clip(server.version, MAX_WORKFLOW_MCP_VERSION_LENGTH) }),
        ...(server.origin === undefined
          ? {}
          : { origin: clip(server.origin, MAX_WORKFLOW_MCP_ORIGIN_LENGTH) }),
        ...(server.statusDetail === undefined ? {} : { statusDetail: clip(server.statusDetail) }),
        ...(server.toolsDetail === undefined ? {} : { toolsDetail: clip(server.toolsDetail) }),
        tools: tools.map((tool) => ({
          ...tool,
          name: clip(tool.name, MAX_WORKFLOW_MCP_NAME_LENGTH),
          ...(tool.title === undefined
            ? {}
            : { title: clip(tool.title, MAX_WORKFLOW_MCP_NAME_LENGTH) }),
          ...(tool.description === undefined
            ? {}
            : { description: clip(tool.description, MAX_WORKFLOW_MCP_DESCRIPTION_LENGTH) }),
        })),
        ...(tools.length === server.tools.length ? {} : { toolsTruncated: true }),
      };
    }),
    limitations: snapshot.limitations
      .slice(0, MAX_WORKFLOW_MCP_LIMITATIONS)
      .map((item) => clip(item)),
  };
};

export interface McpInventoryInput {
  /** Supplied by the runner when the context thread is driving this workflow. */
  readonly run?: Pick<WorkflowRun, "definition" | "subagents"> | undefined;
  readonly projectId: ProjectId;
  readonly workflow: WorkflowSlug | string;
  /** Only this step's effective model. Absent uses the workflow's or the context thread's. */
  readonly stepId?: WorkflowSlug | string | undefined;
  /** The visible thread whose workspace and live provider session give the read meaning. */
  readonly contextThreadId?: ThreadId | undefined;
}

export interface McpInventoryInspectInput extends McpInventoryInput {
  /** False serves only the cache; true queries the provider (single-flight). */
  readonly refresh: boolean;
}

/** Pinned readiness context: never re-read a saved definition during Run preparation. */
export interface McpInventoryObserveInput {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly selection?: Pick<ModelSelection, "instanceId" | "model"> | undefined;
  readonly contextThreadId?: ThreadId | undefined;
  readonly refresh: boolean;
}

export class WorkflowMcpInventoryStepNotFoundError extends Schema.TaggedError<WorkflowMcpInventoryStepNotFoundError>()(
  "WorkflowMcpInventoryStepNotFoundError",
  { workflow: Schema.String, stepId: Schema.String },
) {
  override get message(): string {
    return `Workflow "${this.workflow}" has no step "${this.stepId}".`;
  }
}

export class WorkflowMcpInventory extends Context.Service<
  WorkflowMcpInventory,
  {
    /** Cached read or explicit provider query. Never invokes a tool or changes configuration. */
    readonly inspect: (
      input: McpInventoryInspectInput,
    ) => Effect.Effect<
      WorkflowMcpInventorySnapshot,
      | WorkflowStore.WorkflowProjectNotFoundError
      | WorkflowStore.WorkflowNotFoundError
      | WorkflowStore.WorkflowFileError
      | WorkflowMcpInventoryStepNotFoundError
      | ThreadManagementService.ThreadManagementError
    >;
    /** Shares the picker's cache for an already resolved attachment executor. */
    readonly observe: (
      input: McpInventoryObserveInput,
    ) => Effect.Effect<WorkflowMcpInventorySnapshot, ThreadManagementService.ThreadManagementError>;
    /** Drops cached snapshots, such as after a provider instance or workspace change. */
    readonly forget: (projectId?: ProjectId) => Effect.Effect<void>;
  }
>()("t3/workflows/WorkflowMcpInventory") {}

type Resolved = {
  readonly selection: Pick<ModelSelection, "instanceId" | "model"> | undefined;
  readonly workspaceRoot: string;
  readonly threadId: ThreadId | undefined;
  readonly providerThread: OrchestrationV2ProviderThread | undefined;
  readonly threadSelection: ModelSelection | undefined;
};

type CacheEntry = {
  readonly snapshot: WorkflowMcpInventorySnapshot;
  readonly expiresAtMs: number;
  readonly generation: string;
};

type InFlightEntry = {
  readonly generation: string;
  readonly deferred: Deferred.Deferred<WorkflowMcpInventorySnapshot>;
};

type ResolvedProvider = {
  readonly driverKind: unknown;
  readonly displayName?: string | undefined;
};

const errorSnapshot = (
  scope: WorkflowMcpInventoryScope,
  status: WorkflowMcpInventorySnapshot["status"],
  message: string,
  limitations: ReadonlyArray<string> = [],
): WorkflowMcpInventorySnapshot => ({
  status,
  message,
  scope,
  servers: [],
  cached: false,
  stale: false,
  excludedInternal: 0,
  limitations,
});

const make = Effect.gen(function* () {
  const store = yield* WorkflowStore.WorkflowStore;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  const providers = yield* Effect.serviceOption(ProviderInstanceRegistry.ProviderInstanceRegistry);
  const sessions = yield* Effect.serviceOption(ProviderSessionManager.ProviderSessionManagerV2);
  const configDiscovery = yield* Effect.serviceOption(
    WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscovery,
  );
  const cache = yield* Ref.make(new Map<string, CacheEntry>());
  const inFlight = yield* Ref.make(new Map<string, InFlightEntry>());
  const generation = yield* Ref.make(0);
  const projectGenerations = yield* Ref.make(new Map<ProjectId, number>());
  const generationFor = Effect.fn("WorkflowMcpInventory.generationFor")(function* (
    projectId: ProjectId,
  ) {
    const global = yield* Ref.get(generation);
    const project = (yield* Ref.get(projectGenerations)).get(projectId) ?? 0;
    return `${global}:${project}`;
  });
  const invalidate = Effect.gen(function* () {
    yield* Ref.update(generation, (value) => value + 1);
    yield* Ref.set(cache, new Map());
    yield* Ref.set(inFlight, new Map());
  });
  // A provider instance added, removed or reconfigured makes every cached connection list
  // suspect. This is a subscription, not a poll.
  if (Option.isSome(providers)) {
    yield* providers.value.streamChanges.pipe(
      Stream.runForEach(() => invalidate),
      Effect.forkScoped,
    );
  }

  const providerOf = Effect.fnUntraced(function* (instanceId: ProviderInstanceId | undefined) {
    if (instanceId === undefined) return undefined;
    if (Option.isNone(providers)) return undefined;
    const live = yield* providers.value
      .getInstance(instanceId)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (live !== undefined) return live;
    // A registered instance that failed to start still pins its driver and label, which is
    // enough to read its saved configuration instead of guessing from the id.
    const unavailable = yield* providers.value.listUnavailable.pipe(
      Effect.orElseSucceed(() => [] as const),
    );
    const snapshot = unavailable.find((candidate) => candidate.instanceId === instanceId);
    return snapshot === undefined
      ? undefined
      : { driverKind: snapshot.driver, displayName: snapshot.displayName };
  });

  /**
   * Resolves the inventory identity. Models and steps share instance/session evidence; a
   * different provider instance is never borrowed from another session.
   */
  const resolve = Effect.fnUntraced(function* (input: McpInventoryInput) {
    const definition =
      input.run?.definition ??
      (yield* store.readDefinition({
        projectId: input.projectId,
        slug: input.workflow,
      }));
    const step =
      input.stepId === undefined
        ? undefined
        : definition.steps.find((candidate) => candidate.id === input.stepId);
    if (input.stepId !== undefined && step === undefined) {
      return yield* new WorkflowMcpInventoryStepNotFoundError({
        workflow: input.workflow,
        stepId: input.stepId,
      });
    }
    let threadSelection: ModelSelection | undefined;
    let workspaceRoot = yield* store.projectRoot(input.projectId);
    let providerThreads: ReadonlyArray<OrchestrationV2ProviderThread> = [];
    if (input.contextThreadId !== undefined) {
      const records = yield* threads.getProjectThreadRecords(
        { projectId: input.projectId, threadId: input.contextThreadId },
        ["providerThreads"],
      );
      threadSelection = records.thread.modelSelection as ModelSelection | undefined;
      workspaceRoot = records.thread.worktreePath ?? workspaceRoot;
      providerThreads = records.providerThreads;
    }
    const selection = workflowExecutor({
      definition,
      step,
      driver: threadSelection,
      subagents: input.run?.subagents,
      providers: Option.isSome(registry) ? yield* registry.value.getProviders : undefined,
    });
    return yield* resolveObservation(
      {
        projectId: input.projectId,
        workspaceRoot,
        selection,
        contextThreadId: input.contextThreadId,
        refresh: false,
      },
      { providerThreads, threadSelection },
    );
  });

  // Readiness supplies the pinned executor/workspace; only session records come from the thread.
  const resolveObservation = Effect.fnUntraced(function* (
    input: McpInventoryObserveInput,
    records?: {
      providerThreads: ReadonlyArray<OrchestrationV2ProviderThread>;
      threadSelection: ModelSelection | undefined;
    },
  ) {
    if (records === undefined && input.contextThreadId !== undefined) {
      const current = yield* threads.getProjectThreadRecords(
        { projectId: input.projectId, threadId: input.contextThreadId },
        ["providerThreads"],
      );
      records = {
        providerThreads: current.providerThreads,
        threadSelection: current.thread.modelSelection as ModelSelection | undefined,
      };
    }
    const selection = input.selection;
    const providerThread = records?.providerThreads
      .filter((candidate) => candidate.providerInstanceId === selection?.instanceId)
      .filter((candidate) => candidate.ownerNodeId === null)
      .sort((left, right) => {
        const rank = (thread: OrchestrationV2ProviderThread) =>
          thread.status === "active" ? 0 : thread.status === "idle" ? 1 : 2;
        return rank(left) - rank(right);
      })[0];
    return {
      selection,
      workspaceRoot: input.workspaceRoot,
      threadId: input.contextThreadId,
      providerThread,
      threadSelection: records?.threadSelection,
    } satisfies Resolved;
  });

  const scopeFor = (
    resolved: Resolved,
    provider: ResolvedProvider | undefined,
  ): WorkflowMcpInventoryScope => {
    const driverKind =
      provider === undefined
        ? resolved.providerThread?.driver
        : (provider.driverKind as ProviderDriverKind);
    const label =
      provider?.displayName ??
      (driverKind === undefined ? undefined : DRIVER_LABELS[String(driverKind)]);
    return {
      ...(resolved.selection === undefined
        ? {}
        : { providerInstanceId: resolved.selection.instanceId }),
      ...(driverKind === undefined ? {} : { driverKind }),
      ...(label === undefined ? {} : { providerLabel: label }),
      ...(resolved.selection === undefined || resolved.selection.model === ""
        ? {}
        : { model: resolved.selection }),
      // Codex, Claude and OpenCode scope MCP connections to a session or directory. A model
      // switch re-reads the same list; saying otherwise would invent a different scope.
      modelScoped: false,
      workspaceRoot: resolved.workspaceRoot,
      ...(resolved.threadId === undefined ? {} : { threadId: resolved.threadId }),
      ...(resolved.providerThread?.providerSessionId == null
        ? {}
        : { providerSessionId: resolved.providerThread.providerSessionId }),
    };
  };

  const keyFor = (projectId: ProjectId, resolved: Resolved) =>
    [
      projectId,
      resolved.workspaceRoot,
      resolved.selection?.instanceId ?? "",
      resolved.providerThread?.providerSessionId ?? "",
      resolved.threadId ?? "",
    ].join("\u0000");

  const normalisePage = (servers: ReadonlyArray<WorkflowMcpServerInventory>) => {
    const kept: Array<WorkflowMcpServerInventory> = [];
    let excludedInternal = 0;
    let truncated = false;
    const seen = new Set<string>();
    for (const server of servers) {
      if (isInternalServer(server.name)) {
        excludedInternal += 1;
        continue;
      }
      if (seen.has(server.name)) continue;
      if (kept.length >= MAX_WORKFLOW_MCP_SERVERS) {
        truncated = true;
        break;
      }
      seen.add(server.name);
      kept.push(server);
    }
    return { servers: kept, excludedInternal, truncated };
  };

  /**
   * A selected instance can answer without a live thread: its own configuration names the MCP
   * servers. That is names only; connection status and tools stay unknown, never inferred online.
   */
  const configFallback = Effect.fnUntraced(function* (
    resolved: Resolved,
    scope: WorkflowMcpInventoryScope,
    provider: ResolvedProvider | undefined,
    limitations: ReadonlyArray<string>,
  ) {
    const instanceId = resolved.selection?.instanceId;
    const label = scope.providerLabel ?? (instanceId === undefined ? "the provider" : instanceId);
    // Configuration is instance/workspace evidence, not a live session's. Dropping the id keeps
    // a released session from looking like the source of the list.
    const { providerSessionId: _releasedProviderSessionId, ...configScope } = scope;
    if (instanceId === undefined) {
      return errorSnapshot(
        configScope,
        "unavailable",
        "No provider is selected for this step, workflow or thread, so MCP connections can't be read.",
        limitations,
      );
    }
    if (Option.isNone(configDiscovery)) {
      return errorSnapshot(
        configScope,
        "unavailable",
        "T3 can't read provider configuration in this process, so MCP connections can't be listed.",
        limitations,
      );
    }
    const driverKind =
      provider === undefined
        ? scope.driverKind
        : (provider.driverKind as ProviderDriverKind | undefined);
    const result = yield* configDiscovery.value
      .discover({
        instanceId,
        // The saved provider entry pins the driver; this is only the caller's best guess.
        ...(driverKind === undefined ? {} : { driverKind }),
        label,
        workspaceRoot: resolved.workspaceRoot,
      })
      .pipe(
        Effect.timeoutOption(CONFIG_DISCOVERY_TIMEOUT),
        Effect.map((value): WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscoveryResult =>
          Option.isNone(value)
            ? {
                kind: "error",
                reason: `${label}'s configuration query timed out.`,
              }
            : value.value,
        ),
      );
    if (result.kind === "unsupported") {
      return errorSnapshot(configScope, "unsupported", result.reason, limitations);
    }
    if (result.kind === "unavailable") {
      return errorSnapshot(configScope, "unavailable", result.reason, limitations);
    }
    if (result.kind === "error") {
      return errorSnapshot(configScope, "error", result.reason, limitations);
    }
    const normalised = normalisePage(result.servers);
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const count = normalised.servers.length;
    const message =
      count === 0
        ? `${label}'s readable configuration lists no MCP servers.`
        : `${label} lists ${count} configured MCP server${count === 1 ? "" : "s"}. Connection status and tools stay unknown until ${label} runs.`;
    return {
      status: "available" as const,
      message,
      scope: { ...configScope, source: "configured" as const },
      servers: normalised.servers,
      checkedAt,
      cached: false,
      stale: false,
      excludedInternal: normalised.excludedInternal,
      limitations: [
        ...(normalised.truncated ? [MCP_INCOMPLETE_LISTING] : []),
        ...limitations,
        ...result.limitations,
      ],
    } satisfies WorkflowMcpInventorySnapshot;
  });

  const query = Effect.fnUntraced(function* (
    resolved: Resolved,
    scope: WorkflowMcpInventoryScope,
    provider: ResolvedProvider | undefined,
  ) {
    const instanceId = resolved.selection?.instanceId;
    const label = scope.providerLabel ?? (instanceId === undefined ? "the provider" : instanceId);
    const limitations = ["Provider configuration changes are only visible after Refresh."];
    if (scope.model !== undefined) {
      limitations.push(
        "MCP connections belong to the provider session, not to the selected model.",
      );
    }
    if (instanceId === undefined) {
      return errorSnapshot(
        scope,
        "unavailable",
        "No provider is selected for this step, workflow or thread, so MCP connections can't be read.",
        limitations,
      );
    }

    const providerThread = resolved.providerThread;
    let live: ProviderAdapterV2SessionRuntime | undefined;
    let ignoredLiveSession = false;
    if (providerThread !== undefined && providerThread.providerInstanceId !== instanceId) {
      // A provider thread from another instance is never evidence for this one.
      ignoredLiveSession = true;
    }
    if (
      ignoredLiveSession === false &&
      providerThread?.providerSessionId != null &&
      Option.isSome(sessions)
    ) {
      const runtime = yield* sessions.value
        .get(providerThread.providerSessionId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isSome(runtime)) {
        if (runtime.value.instanceId === instanceId) live = runtime.value;
        else ignoredLiveSession = true;
      }
    }

    if (live !== undefined && providerThread !== undefined) {
      if (live.mcpInventory === undefined) {
        return yield* configFallback(resolved, scope, provider, [
          ...limitations,
          "This provider runtime didn't expose a live MCP inventory.",
        ]);
      }
      const collected: Array<WorkflowMcpServerInventory> = [];
      let cursor: string | undefined;
      let unavailable: string | undefined;
      let incomplete = false;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = yield* live.mcpInventory
          .list({
            providerThread,
            limit: PAGE_LIMIT,
            ...(cursor === undefined ? {} : { cursor }),
          })
          .pipe(
            Effect.timeout(INVENTORY_TIMEOUT),
            Effect.map((value) => ({ kind: "page" as const, value })),
            Effect.orElseSucceed(() => ({
              kind: "failed" as const,
              message: "The provider didn't answer its MCP inventory query.",
            })),
          );
        if (result.kind === "failed") {
          if (collected.length > 0) {
            incomplete = true;
            break;
          }
          return errorSnapshot(scope, "error", result.message, limitations);
        }
        if (result.value.unavailableReason !== undefined) {
          unavailable = result.value.unavailableReason;
          break;
        }
        collected.push(...result.value.servers);
        if (result.value.nextCursor === undefined) break;
        if (result.value.nextCursor === cursor || page === MAX_PAGES - 1) {
          incomplete = true;
          break;
        }
        cursor = result.value.nextCursor;
      }
      if (unavailable !== undefined) {
        // Claude and OpenCode report "not running" through the live capability itself. The
        // saved configuration can still name the servers, so ask it rather than stopping here.
        return yield* configFallback(resolved, scope, provider, [
          ...limitations.filter(
            (limitation) => !limitation.startsWith("Provider configuration changes"),
          ),
          oneLine(unavailable),
        ]);
      }
      const normalised = normalisePage(collected);
      const checkedAt = DateTime.formatIso(yield* DateTime.now);
      const message =
        normalised.servers.length === 0
          ? `${label} reported no MCP connections.`
          : `${label} reported ${normalised.servers.length} MCP connection${normalised.servers.length === 1 ? "" : "s"}.`;
      return {
        status: "available" as const,
        message,
        scope: { ...scope, source: "live" as const },
        servers: normalised.servers,
        checkedAt,
        cached: false,
        stale: false,
        excludedInternal: normalised.excludedInternal,
        limitations: [
          ...(incomplete || normalised.truncated ? [MCP_INCOMPLETE_LISTING] : []),
          ...limitations,
        ],
      } satisfies WorkflowMcpInventorySnapshot;
    }

    const fallbackLimitations = [...limitations];
    if (
      resolved.threadSelection !== undefined &&
      resolved.threadSelection.instanceId !== instanceId
    ) {
      fallbackLimitations.push(
        "The context thread uses another provider, so T3 read this provider's configuration without borrowing that thread's connections.",
      );
    }
    if (ignoredLiveSession) {
      fallbackLimitations.push(
        "T3 ignored a live session that belongs to another provider instead of borrowing it.",
      );
    }
    if (providerThread?.providerSessionId != null && !ignoredLiveSession) {
      fallbackLimitations.push(
        "The provider session is idle or released, so T3 read its saved configuration instead.",
      );
    }
    return yield* configFallback(resolved, scope, provider, fallbackLimitations);
  });

  const read = Effect.fn("WorkflowMcpInventory.read")(function* (
    input: { projectId: ProjectId; refresh: boolean },
    resolved: Resolved,
  ) {
    const provider = yield* providerOf(resolved.selection?.instanceId);
    const scope = scopeFor(resolved, provider);
    const key = keyFor(input.projectId, resolved);

    if (!input.refresh) {
      const currentGeneration = yield* generationFor(input.projectId);
      const entry = (yield* Ref.get(cache)).get(key);
      if (entry === undefined || entry.generation !== currentGeneration) {
        return errorSnapshot(
          scope,
          "not-checked",
          "MCP connections haven't been loaded for this selection yet. Refresh asks the selected provider for its configured servers.",
          [
            ...(scope.model === undefined
              ? []
              : ["MCP connections belong to the provider session, not to the selected model."]),
            "Provider configuration changes are only visible after Refresh.",
          ],
        );
      }
      const nowMs = yield* Clock.currentTimeMillis;
      return {
        ...entry.snapshot,
        scope: { ...entry.snapshot.scope, model: scope.model },
        cached: true,
        stale: nowMs >= entry.expiresAtMs,
      };
    }

    const currentGeneration = yield* generationFor(input.projectId);
    const existing = (yield* Ref.get(inFlight)).get(key);
    if (existing !== undefined && existing.generation === currentGeneration) {
      return yield* Deferred.await(existing.deferred);
    }
    const deferred = yield* Deferred.make<WorkflowMcpInventorySnapshot>();
    const flight = { generation: currentGeneration, deferred } satisfies InFlightEntry;
    yield* Ref.update(inFlight, (map) => new Map(map).set(key, flight));
    // The query is bounded; finishing it even if the caller cancels keeps every waiter on this
    // single-flight entry from waiting forever for a provider answer.
    const snapshot = yield* Effect.uninterruptible(query(resolved, scope, provider)).pipe(
      Effect.map(boundSnapshot),
      Effect.ensuring(
        Ref.update(inFlight, (map) => {
          const next = new Map(map);
          if (next.get(key)?.deferred === deferred) next.delete(key);
          return next;
        }),
      ),
    );
    const nowMs = yield* Clock.currentTimeMillis;
    if ((yield* generationFor(input.projectId)) === currentGeneration) {
      yield* Ref.update(cache, (map) => {
        const next = new Map(map);
        next.set(key, {
          snapshot,
          expiresAtMs: nowMs + FRESHNESS_MS,
          generation: currentGeneration,
        });
        for (const [candidate, entry] of next) {
          if (nowMs - entry.expiresAtMs > CACHE_MAX_AGE_MS) next.delete(candidate);
        }
        while (next.size > CACHE_MAX_ENTRIES) {
          const oldest = [...next.entries()].sort(
            ([, left], [, right]) => left.expiresAtMs - right.expiresAtMs,
          )[0];
          if (oldest === undefined) break;
          next.delete(oldest[0]);
        }
        return next;
      });
    }
    yield* Deferred.succeed(deferred, snapshot);
    return snapshot;
  }, Effect.map(boundSnapshot));

  return WorkflowMcpInventory.of({
    inspect: Effect.fn("WorkflowMcpInventory.inspect")(function* (input: McpInventoryInspectInput) {
      return yield* read(input, yield* resolve(input));
    }),
    observe: Effect.fn("WorkflowMcpInventory.observe")(function* (input: McpInventoryObserveInput) {
      return yield* read(input, yield* resolveObservation(input));
    }),
    forget: Effect.fn("WorkflowMcpInventory.forget")(function* (projectId?: ProjectId) {
      if (projectId === undefined) {
        yield* invalidate;
        return;
      }
      const prefix = `${projectId}\u0000`;
      yield* Ref.update(projectGenerations, (map) => {
        const next = new Map(map);
        next.set(projectId, (next.get(projectId) ?? 0) + 1);
        return next;
      });
      yield* Ref.update(cache, (map) => {
        const next = new Map(map);
        for (const key of next.keys()) if (key.startsWith(prefix)) next.delete(key);
        return next;
      });
      yield* Ref.update(inFlight, (map) => {
        const next = new Map(map);
        for (const key of next.keys()) if (key.startsWith(prefix)) next.delete(key);
        return next;
      });
    }),
  });
});

export const layer = Layer.effect(WorkflowMcpInventory, make);
