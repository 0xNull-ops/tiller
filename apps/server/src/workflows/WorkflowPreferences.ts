import {
  DEFAULT_MAX_SUBAGENT_MODELS,
  WorkflowPreferences as WorkflowPreferencesSchema,
  type WorkflowPreferences as WorkflowPreferencesValue,
  type WorkflowSkillInfo,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

const DEFAULT_PREFERENCES: WorkflowPreferencesValue = {
  pinnedSkills: [],
  pinnedWorkflows: [],
  showBuiltinWorkflows: true,
  hiddenBuiltins: [],
  maxSubagentModels: DEFAULT_MAX_SUBAGENT_MODELS,
  workflowFirstForNewThreads: false,
};
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkflowPreferencesSchema));
const encodeJson = Schema.encodeEffect(fromJsonStringPretty(WorkflowPreferencesSchema));

export class WorkflowPreferencesWriteError extends Schema.TaggedError<WorkflowPreferencesWriteError>()(
  "WorkflowPreferencesWriteError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to save workflow preferences.";
  }
}

const normalizePins = (names: ReadonlyArray<string>) => {
  const seen = new Set<string>();
  return names.flatMap((name) => {
    const trimmed = name.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
};

export const markPinnedSkills = (
  skills: ReadonlyArray<WorkflowSkillInfo>,
  pinnedNames: ReadonlyArray<string>,
): ReadonlyArray<WorkflowSkillInfo> => {
  const pinned = new Set(pinnedNames.map((name) => name.toLocaleLowerCase()));
  return skills.map((skill) =>
    pinned.has(skill.name.toLocaleLowerCase()) ? { ...skill, pinned: true } : skill,
  );
};

export class WorkflowPreferences extends Context.Service<
  WorkflowPreferences,
  {
    readonly read: Effect.Effect<WorkflowPreferencesValue>;
    readonly setWorkflowPinned: (
      pin: WorkflowPreferencesValue["pinnedWorkflows"][number],
      pinned: boolean,
    ) => Effect.Effect<void, WorkflowPreferencesWriteError>;
    readonly setGallery: (
      input: Partial<
        Pick<
          WorkflowPreferencesValue,
          "pinnedWorkflows" | "showBuiltinWorkflows" | "hiddenBuiltins"
        >
      >,
    ) => Effect.Effect<void, WorkflowPreferencesWriteError>;
    readonly setPinned: (
      name: string,
      pinned: boolean,
    ) => Effect.Effect<void, WorkflowPreferencesWriteError>;
    readonly setMaxSubagentModels: (
      maxSubagentModels: WorkflowPreferencesValue["maxSubagentModels"],
    ) => Effect.Effect<void, WorkflowPreferencesWriteError>;
    readonly setWorkflowFirstForNewThreads: (
      enabled: boolean,
    ) => Effect.Effect<void, WorkflowPreferencesWriteError>;
  }
>()("t3/workflows/WorkflowPreferences") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const writeLock = yield* Semaphore.make(1);
  const preferencesDirectory = path.join(config.stateDir, "workflows");
  const filePath = path.join(preferencesDirectory, "preferences.json");

  const read: WorkflowPreferences["Service"]["read"] = Effect.gen(function* () {
    const raw = yield* fileSystem.readFileString(filePath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.logWarning("workflow.preferences-read-failed", {
                path: filePath,
                reason: cause.reason._tag,
              }).pipe(Effect.as(null)),
      }),
    );
    if (raw === null) return DEFAULT_PREFERENCES;
    const parsed = yield* decodeJson(raw).pipe(
      Effect.catch(() =>
        Effect.logWarning("workflow.preferences-invalid", { path: filePath }).pipe(Effect.as(null)),
      ),
    );
    if (parsed === null) return DEFAULT_PREFERENCES;
    return { ...parsed, pinnedSkills: normalizePins(parsed.pinnedSkills) };
  }).pipe(Effect.withSpan("WorkflowPreferences.read"));

  const write = (preferences: WorkflowPreferencesValue) =>
    encodeJson(preferences).pipe(
      Effect.flatMap((contents) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(preferencesDirectory, { recursive: true });
          yield* writeFileStringAtomically({ filePath, contents: `${contents}\n` }).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          );
        }),
      ),
      Effect.mapError((cause) => new WorkflowPreferencesWriteError({ path: filePath, cause })),
    );

  const setGallery: WorkflowPreferences["Service"]["setGallery"] = Effect.fn(
    "WorkflowPreferences.setGallery",
  )(function* (input) {
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const preferences = yield* read;
        yield* write({ ...preferences, ...input });
      }),
    );
  });
  const setWorkflowPinned: WorkflowPreferences["Service"]["setWorkflowPinned"] = Effect.fn(
    "WorkflowPreferences.setWorkflowPinned",
  )(function* (pin, pinned) {
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const preferences = yield* read;
        const remaining = preferences.pinnedWorkflows.filter(
          (item) => item.projectId !== pin.projectId || item.workflow !== pin.workflow,
        );
        yield* write({ ...preferences, pinnedWorkflows: pinned ? [...remaining, pin] : remaining });
      }),
    );
  });
  const setPinned: WorkflowPreferences["Service"]["setPinned"] = Effect.fn(
    "WorkflowPreferences.setPinned",
  )(function* (name, pinned) {
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const preferences = yield* read;
        const key = name.trim().toLocaleLowerCase();
        const matching = preferences.pinnedSkills.filter(
          (item) => item.toLocaleLowerCase() !== key,
        );
        yield* write({
          ...preferences,
          pinnedSkills: normalizePins(pinned ? [...matching, name] : matching),
        });
      }),
    );
  });

  const setMaxSubagentModels: WorkflowPreferences["Service"]["setMaxSubagentModels"] = Effect.fn(
    "WorkflowPreferences.setMaxSubagentModels",
  )(function* (maxSubagentModels) {
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const preferences = yield* read;
        yield* write({ ...preferences, maxSubagentModels });
      }),
    );
  });

  const setWorkflowFirstForNewThreads: WorkflowPreferences["Service"]["setWorkflowFirstForNewThreads"] =
    Effect.fn("WorkflowPreferences.setWorkflowFirstForNewThreads")(function* (enabled) {
      yield* writeLock.withPermits(1)(
        Effect.gen(function* () {
          const preferences = yield* read;
          if (preferences.workflowFirstForNewThreads === enabled) return;
          yield* write({ ...preferences, workflowFirstForNewThreads: enabled });
        }),
      );
    });

  return WorkflowPreferences.of({
    read,
    setPinned,
    setGallery,
    setWorkflowPinned,
    setMaxSubagentModels,
    setWorkflowFirstForNewThreads,
  });
});

export const layer = Layer.effect(WorkflowPreferences, make);
