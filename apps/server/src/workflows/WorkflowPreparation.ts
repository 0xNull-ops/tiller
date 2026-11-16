import {
  type ModelSelection,
  type WorkflowSubagentsSnapshot,
  type ProjectId,
  type ThreadId,
  WorkflowDefinition,
  type WorkflowMcpInventorySnapshot,
  type WorkflowReadinessContext,
  type WorkflowReadinessSnapshot,
  type WorkflowSlug,
  workflowReadinessSpecification,
} from "@t3tools/contracts";
import { resolveSubagentModels } from "@t3tools/shared/workflowSubagents";
import * as Option from "effect/Option";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowMcpInventory from "./WorkflowMcpInventory.ts";
import * as WorkflowReadiness from "./WorkflowReadiness.ts";
import * as WorkflowStore from "./WorkflowStore.ts";

/** Evidence goes stale on the card; an explicit Run always refreshes it first. */
const OBSERVATION_LIMIT = 500;

export class WorkflowInvalidError extends Schema.TaggedError<WorkflowInvalidError>()(
  "WorkflowInvalidError",
  { workflow: Schema.String, problems: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Workflow "${this.workflow}" can't run: ${this.problems.join(" ")}`;
  }
}

const decodeWorkflowDefinition = Schema.encodeSync(Schema.fromJsonString(WorkflowDefinition));

/** Semantic equality: formatting and key order must not make a pinned definition look edited. */
export const sameDefinition = (left: WorkflowDefinition, right: WorkflowDefinition) =>
  decodeWorkflowDefinition(left) === decodeWorkflowDefinition(right);

type DefinitionReadError =
  | WorkflowStore.WorkflowProjectNotFoundError
  | WorkflowStore.WorkflowNotFoundError
  | WorkflowStore.WorkflowFileError;

/** A saved definition that can't be read, or whose readiness context contradicts it. */
type PreparationError = DefinitionReadError | WorkflowInvalidError;

type Observation = {
  readonly definition: WorkflowDefinition;
  /** Workspace and driver the observation was taken in; evidence never crosses contexts. */
  readonly context: string;
  readonly snapshot: WorkflowReadinessSnapshot;
};

type ResolvedContext = {
  readonly key: string;
  readonly workspaceRoot: string;
  readonly threadId?: ThreadId | undefined;
  readonly model?: ModelSelection | undefined;
};

interface CachedReadinessInput {
  readonly projectId: ProjectId;
  readonly definition: WorkflowDefinition;
  /** Used only when the observation carries no workspace of its own. */
  readonly workspaceRoot: string;
  readonly observed?: WorkflowReadinessSnapshot | undefined;
}

interface PrepareInput {
  readonly subagents?: WorkflowSubagentsSnapshot | undefined;
  readonly projectId: ProjectId;
  readonly definition: WorkflowDefinition;
  readonly contextThreadId: ThreadId;
  readonly stepIds?: ReadonlySet<string> | undefined;
  /** Shared by the child and owner checks of one dispatch in the same workspace and thread. */
  readonly mcpSnapshots?: Map<string | undefined, WorkflowMcpInventorySnapshot | undefined>;
}

type InventoryInput = WorkflowMcpInventory.McpInventoryInput;

interface RecordInventoryInput {
  readonly projectId: ProjectId;
  readonly slug: string;
  readonly definition: WorkflowDefinition;
  readonly contextKey: string;
  readonly context: WorkflowReadinessContext;
}

/**
 * Readiness and MCP inventory for a workflow card and for a run of it: what a saved definition
 * needs, in which workspace and executor, and what the last check saw. Mutations that publish
 * the result stay with the caller; these methods only decide, probe and remember.
 */
export class WorkflowPreparation extends Context.Service<
  WorkflowPreparation,
  {
    /** Static checks and unexpired cached observations. Never spawns a probe. */
    readonly cached: (input: CachedReadinessInput) => Effect.Effect<WorkflowReadinessSnapshot>;
    /** A card's readiness: the accepted observation for this definition, refreshed against the cache. */
    readonly card: (input: {
      readonly projectId: ProjectId;
      readonly slug: string;
      readonly definition: WorkflowDefinition;
      readonly workspaceRoot: string;
    }) => Effect.Effect<WorkflowReadinessSnapshot>;
    /** The canvas's cheap readiness read for one saved workflow. */
    readonly readiness: (input: {
      readonly projectId: ProjectId;
      readonly slug: string;
    }) => Effect.Effect<WorkflowReadinessSnapshot, DefinitionReadError>;
    /** Resolve environment choices before entering the run mutation lock. */
    readonly subagents: (
      definition: WorkflowDefinition,
    ) => Effect.Effect<WorkflowSubagentsSnapshot | undefined>;
    /** Run-start checks: bounded probes, outside the caller's mutation lock, in the driver's workspace. */
    readonly prepare: (
      input: PrepareInput,
    ) => Effect.Effect<WorkflowReadinessSnapshot, PreparationError>;
    /** Bounded probes for an explicit check, outside the caller's mutation lock. */
    readonly probeResources: (input: {
      readonly projectId: ProjectId;
      readonly slug: string;
      readonly stepIds?: ReadonlyArray<WorkflowSlug> | undefined;
      readonly contextThreadId?: ThreadId | undefined;
    }) => Effect.Effect<
      {
        readonly definition: WorkflowDefinition;
        readonly contextKey: string;
        readonly snapshot: WorkflowReadinessSnapshot;
      },
      PreparationError
    >;
    /**
     * Keeps a finished probe as the card's evidence. Call under the caller's mutation lock:
     * false means the saved definition changed while the probe ran, and nothing was kept.
     */
    readonly recordProbe: (input: {
      readonly projectId: ProjectId;
      readonly slug: string;
      readonly definition: WorkflowDefinition;
      readonly contextKey: string;
      readonly snapshot: WorkflowReadinessSnapshot;
    }) => Effect.Effect<boolean, DefinitionReadError>;
    /** Cheap cached MCP inventory for a step's effective provider. Never queries the provider. */
    readonly inventory: (
      input: InventoryInput,
    ) => Effect.Effect<
      WorkflowMcpInventorySnapshot,
      | DefinitionReadError
      | WorkflowMcpInventory.WorkflowMcpInventoryStepNotFoundError
      | ThreadManagementService.ThreadManagementError
    >;
    /** Explicitly asks the step's effective provider for its live MCP connections, outside the lock. */
    readonly refreshInventory: (input: InventoryInput) => Effect.Effect<
      {
        readonly definition: WorkflowDefinition;
        readonly contextKey: string;
        readonly context: WorkflowReadinessContext;
        readonly snapshot: WorkflowMcpInventorySnapshot;
      },
      | DefinitionReadError
      | WorkflowInvalidError
      | WorkflowMcpInventory.WorkflowMcpInventoryStepNotFoundError
      | ThreadManagementService.ThreadManagementError
    >;
    /**
     * Publishes a fresh inventory as the card's context. Call under the caller's mutation lock;
     * a changed definition keeps its cards but drops the evidence.
     */
    readonly recordInventory: (
      input: RecordInventoryInput,
    ) => Effect.Effect<void, DefinitionReadError>;
  }
>()("t3/workflows/WorkflowPreparation") {}

const make = Effect.gen(function* () {
  const providers = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  const subagents = Effect.fn("WorkflowPreparation.subagents")(function* (
    definition: WorkflowDefinition,
  ) {
    if (definition.subagentModels === undefined) return undefined;
    return resolveSubagentModels(
      definition.subagentModels,
      Option.isSome(providers) ? yield* providers.value.getProviders : [],
    );
  });
  const store = yield* WorkflowStore.WorkflowStore;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const readinessService = yield* WorkflowReadiness.WorkflowReadiness;
  const inventory = yield* WorkflowMcpInventory.WorkflowMcpInventory;

  const observations = new Map<string, Observation>();
  const key = (projectId: ProjectId, slug: string) => `${projectId}\n${slug}`;
  const threadRead = (threadId: ThreadId) =>
    threads.getThreadProjection(threadId).pipe(
      Effect.mapError(
        (cause) =>
          new WorkflowStore.WorkflowFileError({
            operation: "read",
            path: `thread ${threadId}`,
            cause,
          }),
      ),
    );
  const remember = (observationKey: string, observation: Observation) => {
    observations.set(observationKey, observation);
    while (observations.size > OBSERVATION_LIMIT)
      observations.delete(observations.keys().next().value!);
  };

  /**
   * The workspace and executor a check runs in. `workflow` names the definition in the
   * mismatch message; a card read and a Run name it differently, and both messages are visible.
   */
  const resolveContext = Effect.fn("WorkflowPreparation.resolveContext")(function* (
    projectId: ProjectId,
    contextThreadId: ThreadId | undefined,
    workflow: string,
  ): Effect.fn.Return<ResolvedContext, DefinitionReadError | WorkflowInvalidError> {
    if (contextThreadId === undefined) {
      const workspaceRoot = yield* store.projectRoot(projectId);
      return { key: [workspaceRoot, "", ""].join("\u0000"), workspaceRoot };
    }
    const projection = yield* threadRead(contextThreadId);
    if (projection.thread.projectId !== projectId)
      return yield* new WorkflowInvalidError({
        workflow,
        problems: ["The readiness context belongs to a different project."],
      });
    const workspaceRoot = projection.thread.worktreePath ?? (yield* store.projectRoot(projectId));
    // Older thread records may not carry a selection; the workflow or step can still pin one.
    const model = projection.thread.modelSelection as ModelSelection | undefined;
    return {
      key: [workspaceRoot, model?.instanceId ?? "", model?.model ?? ""].join("\u0000"),
      workspaceRoot,
      threadId: contextThreadId,
      ...(model === undefined ? {} : { model }),
    };
  });

  const cached = Effect.fnUntraced(function* (
    input: CachedReadinessInput,
  ): Effect.fn.Return<WorkflowReadinessSnapshot> {
    const context = input.observed?.context;
    const current = yield* readinessService.cached({
      projectId: input.projectId,
      definition: input.definition,
      workspaceRoot: context?.workspaceRoot ?? input.workspaceRoot,
      contextThreadId: context?.threadId,
      driver: context?.model,
    });
    if (input.observed === undefined || input.observed.entries.length === 0) return current;
    // Provider inventory and vault metadata are cheap, so they are always read live; probe
    // evidence for commands and logins keeps its freshness window.
    const live = new Map(
      current.entries
        .filter((entry) => entry.kind === "mcp-connection" || entry.kind === "credential")
        .map((entry) => [`${entry.stepId}\n${entry.attachmentId}`, entry]),
    );
    const nowMs = yield* Clock.currentTimeMillis;
    return {
      ...input.observed,
      entries: input.observed.entries.map(
        (entry) =>
          live.get(`${entry.stepId}\n${entry.attachmentId}`) ??
          (entry.expiresAt !== undefined && Date.parse(entry.expiresAt) <= nowMs
            ? { ...entry, stale: true }
            : entry),
      ),
    };
  });

  const card = Effect.fnUntraced(function* (input: {
    projectId: ProjectId;
    slug: string;
    definition: WorkflowDefinition;
    workspaceRoot: string;
  }): Effect.fn.Return<WorkflowReadinessSnapshot> {
    const observationKey = key(input.projectId, input.slug);
    const observation = observations.get(observationKey);
    const observed =
      observation === undefined
        ? undefined
        : sameDefinition(observation.definition, input.definition)
          ? observation.snapshot
          : { ...observation.snapshot, entries: [] };
    const visible = yield* cached({
      projectId: input.projectId,
      definition: input.definition,
      workspaceRoot: input.workspaceRoot,
      ...(observed === undefined ? {} : { observed }),
    });
    // An edit invalidates card evidence, but retains the explicitly selected workspace.
    if (observation !== undefined)
      observations.set(observationKey, {
        ...observation,
        definition: input.definition,
        snapshot: visible,
      });
    return visible;
  });

  const readiness = Effect.fn("WorkflowPreparation.readiness")(function* (input: {
    projectId: ProjectId;
    slug: string;
  }): Effect.fn.Return<WorkflowReadinessSnapshot, DefinitionReadError> {
    const definition = yield* store.readDefinition(input);
    const workspaceRoot = yield* store.projectRoot(input.projectId);
    const observed = observations.get(key(input.projectId, input.slug));
    return yield* cached({
      projectId: input.projectId,
      definition,
      workspaceRoot,
      ...(observed !== undefined && sameDefinition(observed.definition, definition)
        ? { observed: observed.snapshot }
        : {}),
    });
  });

  const prepare = Effect.fn("WorkflowPreparation.prepare")(function* (
    input: PrepareInput,
  ): Effect.fn.Return<WorkflowReadinessSnapshot, PreparationError> {
    const context = yield* resolveContext(
      input.projectId,
      input.contextThreadId,
      input.definition.name,
    );
    const snapshot = yield* readinessService.probe({
      projectId: input.projectId,
      definition: input.definition,
      workspaceRoot: context.workspaceRoot,
      contextThreadId: input.contextThreadId,
      subagents: input.subagents,
      ...(input.mcpSnapshots === undefined ? {} : { mcpSnapshots: input.mcpSnapshots }),
      ...(input.stepIds === undefined ? {} : { stepIds: input.stepIds }),
      ...(context.model === undefined
        ? {}
        : { driver: { instanceId: context.model.instanceId, model: context.model.model } }),
    });
    return {
      ...snapshot,
      context: {
        threadId: input.contextThreadId,
        workspaceRoot: context.workspaceRoot,
        ...(context.model === undefined ? {} : { model: context.model }),
        specification: workflowReadinessSpecification(input.definition),
      },
    } satisfies WorkflowReadinessSnapshot;
  });

  const probeResources = Effect.fn("WorkflowPreparation.probeResources")(function* (input: {
    projectId: ProjectId;
    slug: string;
    stepIds?: ReadonlyArray<WorkflowSlug> | undefined;
    contextThreadId?: ThreadId | undefined;
  }): Effect.fn.Return<
    {
      readonly definition: WorkflowDefinition;
      readonly contextKey: string;
      readonly snapshot: WorkflowReadinessSnapshot;
    },
    PreparationError
  > {
    const definition = yield* store.readDefinition(input);
    const unknown = (input.stepIds ?? []).filter(
      (id) => !definition.steps.some((step) => step.id === id),
    );
    if (unknown.length)
      return yield* new WorkflowInvalidError({
        workflow: input.slug,
        problems: [`The saved workflow has no step "${unknown[0]}".`],
      });
    const stepIds = input.stepIds === undefined ? undefined : new Set(input.stepIds);
    const contextThreadId = input.contextThreadId;
    const context = yield* resolveContext(input.projectId, contextThreadId, "workflow");
    const snapshot =
      contextThreadId !== undefined
        ? yield* prepare({
            projectId: input.projectId,
            definition,
            contextThreadId,
            ...(stepIds === undefined ? {} : { stepIds }),
          })
        : yield* readinessService.probe({
            projectId: input.projectId,
            definition,
            workspaceRoot: context.workspaceRoot,
            ...(stepIds === undefined ? {} : { stepIds }),
          });
    return { definition, contextKey: context.key, snapshot };
  });

  const recordProbe = Effect.fn("WorkflowPreparation.recordProbe")(function* (input: {
    projectId: ProjectId;
    slug: string;
    definition: WorkflowDefinition;
    contextKey: string;
    snapshot: WorkflowReadinessSnapshot;
  }): Effect.fn.Return<boolean, DefinitionReadError> {
    const current = yield* store.readDefinition(input);
    // A probe can finish after a draft edit. Never publish evidence for the old definition.
    if (!sameDefinition(current, input.definition)) return false;
    const observationKey = key(input.projectId, input.slug);
    const previous = observations.get(observationKey);
    const sameContext =
      previous !== undefined &&
      sameDefinition(previous.definition, input.definition) &&
      previous.context === input.contextKey;
    const freshKeys = new Set(
      input.snapshot.entries.map((entry) => `${entry.stepId}\n${entry.attachmentId}`),
    );
    const retained = sameContext
      ? previous.snapshot.entries.filter(
          (entry) => !freshKeys.has(`${entry.stepId}\n${entry.attachmentId}`),
        )
      : [];
    const knownKeys = new Set([
      ...freshKeys,
      ...retained.map((entry) => `${entry.stepId}\n${entry.attachmentId}`),
    ]);
    const workspaceRoot =
      input.snapshot.entries[0]?.workspaceRoot ?? (yield* store.projectRoot(input.projectId));
    const untested = input.definition.steps.flatMap((step) =>
      (step.attachments ?? [])
        .filter((attachment) => !knownKeys.has(`${step.id}\n${attachment.id}`))
        .map((attachment) => ({
          stepId: step.id as WorkflowSlug,
          attachmentId: attachment.id,
          kind: attachment.kind,
          status: "unknown" as const,
          message: "This attachment hasn't been checked in the current readiness context.",
          workspaceRoot,
        })),
    );
    const entries = [...retained, ...input.snapshot.entries, ...untested];
    remember(observationKey, {
      definition: input.definition,
      context: input.contextKey,
      snapshot: {
        ...input.snapshot,
        entries,
        blocksRun: entries.some(
          (entry) =>
            entry.kind !== "mcp-connection" &&
            entry.kind !== "credential" &&
            (entry.status === "missing" || entry.status === "error" || entry.status === "unknown"),
        ),
      },
    });
    return true;
  });

  const refreshInventory = Effect.fn("WorkflowPreparation.refreshInventory")(function* (
    input: InventoryInput,
  ): Effect.fn.Return<
    {
      readonly definition: WorkflowDefinition;
      readonly contextKey: string;
      readonly context: WorkflowReadinessContext;
      readonly snapshot: WorkflowMcpInventorySnapshot;
    },
    | DefinitionReadError
    | WorkflowInvalidError
    | WorkflowMcpInventory.WorkflowMcpInventoryStepNotFoundError
    | ThreadManagementService.ThreadManagementError
  > {
    const definition =
      input.run?.definition ??
      (yield* store.readDefinition({
        projectId: input.projectId,
        slug: input.workflow,
      }));
    const snapshot = yield* inventory.inspect({ ...input, refresh: true });
    const projection =
      input.contextThreadId === undefined ? undefined : yield* threadRead(input.contextThreadId);
    const driver = projection?.thread.modelSelection as ModelSelection | undefined;
    const resolved = yield* resolveContext(input.projectId, input.contextThreadId, "workflow");
    const context = {
      workspaceRoot: snapshot.scope.workspaceRoot,
      ...(input.contextThreadId === undefined ? {} : { threadId: input.contextThreadId }),
      ...(driver === undefined ? {} : { model: driver }),
      specification: workflowReadinessSpecification(definition),
    };
    return { definition, contextKey: resolved.key, context, snapshot };
  });

  const recordInventory = Effect.fn("WorkflowPreparation.recordInventory")(function* (
    input: RecordInventoryInput,
  ): Effect.fn.Return<void, DefinitionReadError> {
    const current = yield* store.readDefinition(input);
    if (!sameDefinition(current, input.definition)) return;
    const observationKey = key(input.projectId, input.slug);
    const previous = observations.get(observationKey);
    remember(observationKey, {
      definition: input.definition,
      context: input.contextKey,
      snapshot:
        previous !== undefined &&
        previous.context === input.contextKey &&
        sameDefinition(previous.definition, input.definition)
          ? { ...previous.snapshot, context: input.context }
          : { entries: [], blocksRun: false, context: input.context },
    });
  });

  return WorkflowPreparation.of({
    cached,
    subagents,
    card,
    readiness,
    prepare,
    probeResources,
    recordProbe,
    inventory: Effect.fn("WorkflowPreparation.inventory")((input) =>
      inventory.inspect({ ...input, refresh: false }),
    ),
    refreshInventory,
    recordInventory,
  });
});

export const layer = Layer.effect(WorkflowPreparation, make);
