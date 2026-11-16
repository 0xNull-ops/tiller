import { ThreadId, ProjectId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

const Transition = Schema.Struct({ enabled: Schema.Boolean, revision: Schema.Number });
const Entry = Schema.Struct({
  projectId: ProjectId,
  enabled: Schema.Boolean,
  revision: Schema.Number,
  pendingTransition: Schema.NullOr(Transition),
});
const Entries = Schema.Record(Schema.String, Entry);
export type WorkflowFirstEntry = typeof Entry.Type;
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Entries));
const encode = Schema.encodeEffect(Schema.fromJsonString(Entries));

export class WorkflowFirst extends Context.Service<
  WorkflowFirst,
  {
    readonly read: (input: {
      threadId: ThreadId;
      projectId: ProjectId;
    }) => Effect.Effect<WorkflowFirstEntry>;
    readonly initialize: (input: {
      threadId: ThreadId;
      projectId: ProjectId;
      enabled: boolean;
    }) => Effect.Effect<void>;
    readonly set: (input: {
      threadId: ThreadId;
      projectId: ProjectId;
      enabled: boolean;
    }) => Effect.Effect<WorkflowFirstEntry>;
    readonly acknowledge: (input: { threadId: ThreadId; revision: number }) => Effect.Effect<void>;
    readonly snapshot: (
      threadId: ThreadId,
    ) => Effect.Effect<{ initial: boolean; transition: string | null; revision: number }>;
  }
>()("t3/workflows/WorkflowFirst") {}

const make = Effect.fn("WorkflowFirst.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "workflows");
  const filePath = path.join(directory, "thread-preferences.json");
  const readAll = Effect.gen(function* () {
    const raw = yield* fs.readFileString(filePath).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.die(error),
      }),
    );
    return yield* decode(raw).pipe(
      Effect.map((entries) => entries as Record<string, WorkflowFirstEntry>),
      Effect.orElseSucceed(() => null),
    );
  });
  const writeAll = Effect.fn("WorkflowFirst.writeAll")(function* (
    entries: Record<string, WorkflowFirstEntry>,
  ) {
    const contents = yield* encode(entries);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* writeFileStringAtomically({ filePath, contents: `${contents}\n` }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
  }, Effect.orDie);
  const read: WorkflowFirst["Service"]["read"] = Effect.fn("WorkflowFirst.read")(function* ({
    threadId,
    projectId,
  }) {
    const entries = yield* readAll;
    const entry = entries?.[threadId];
    return entry?.projectId === projectId
      ? entry
      : { projectId, enabled: false, revision: 0, pendingTransition: null };
  });
  const initialize: WorkflowFirst["Service"]["initialize"] = Effect.fn("WorkflowFirst.initialize")(
    function* ({ threadId, projectId, enabled }) {
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const stored = yield* readAll;
          if (stored === null)
            return yield* Effect.die("Workflow-first state is corrupt; refusing to overwrite it.");
          const entries: Record<string, WorkflowFirstEntry> = { ...stored };
          if (entries[threadId]) return;
          entries[threadId] = { projectId, enabled, revision: 0, pendingTransition: null };
          yield* writeAll(entries);
        }),
      );
    },
  );
  const set: WorkflowFirst["Service"]["set"] = Effect.fn("WorkflowFirst.set")(function* ({
    threadId,
    projectId,
    enabled,
  }) {
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const stored = yield* readAll;
        if (stored === null)
          return yield* Effect.die("Workflow-first state is corrupt; refusing to overwrite it.");
        const entries: Record<string, WorkflowFirstEntry> = { ...stored };
        const previous = entries[threadId];
        if (!previous || previous.projectId !== projectId) {
          entries[threadId] = {
            projectId,
            enabled,
            revision: 1,
            pendingTransition: { enabled, revision: 1 },
          };
        } else if (previous.enabled === enabled) {
          return previous;
        } else if (previous.enabled !== enabled) {
          const revision = previous.revision + 1;
          entries[threadId] = {
            ...previous,
            enabled,
            revision,
            pendingTransition: { enabled, revision },
          };
        }
        yield* writeAll(entries);
        return entries[threadId]!;
      }),
    );
  });
  const acknowledge: WorkflowFirst["Service"]["acknowledge"] = Effect.fn(
    "WorkflowFirst.acknowledge",
  )(function* ({ threadId, revision }) {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const stored = yield* readAll;
        if (stored === null)
          return yield* Effect.die("Workflow-first state is corrupt; refusing to overwrite it.");
        const entries: Record<string, WorkflowFirstEntry> = { ...stored };
        const entry = entries[threadId];
        if (!entry || entry.pendingTransition?.revision !== revision) return;
        entries[threadId] = { ...entry, pendingTransition: null };
        yield* writeAll(entries);
      }),
    );
  });
  const snapshot: WorkflowFirst["Service"]["snapshot"] = Effect.fn("WorkflowFirst.snapshot")(
    function* (threadId) {
      const entries = yield* readAll;
      const entry = entries?.[threadId];
      return {
        initial: entry?.enabled ?? false,
        transition: entry?.pendingTransition
          ? entry.pendingTransition.enabled
            ? "on"
            : "off"
          : null,
        revision: entry?.pendingTransition?.revision ?? 0,
      };
    },
  );
  return WorkflowFirst.of({ read, initialize, set, acknowledge, snapshot });
});

export const layer = Layer.effect(WorkflowFirst, make());
