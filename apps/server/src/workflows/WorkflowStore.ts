import {
  upgradeWorkflowDefinition,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowSlug,
  workflowChecksCardKey,
  workflowCredentialCardKey,
  workflowGateCardKey,
  workflowLayoutSlug,
  workflowResourceCardKey,
  type ProjectId,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";

/** Workflows live in their project, beside the code they work on, so git versions and shares them. */
const WORKFLOWS_DIR = ".t3/workflows";

const decodeDefinitionJson = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkflowDefinition));
const encodeDefinitionJson = Schema.encodeEffect(fromJsonStringPretty(WorkflowDefinition));
const decodeRunJson = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkflowRun));
const encodeRunJson = Schema.encodeEffect(Schema.fromJsonString(WorkflowRun));
const PinnedSkillTexts = Schema.Record(Schema.String, Schema.String);
const decodePinnedSkillTextsJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PinnedSkillTexts),
);
const encodePinnedSkillTextsJson = Schema.encodeEffect(Schema.fromJsonString(PinnedSkillTexts));
/**
 * Draft card positions follow the current graph; pinned run definitions are never pruned. A save
 * drops positions for cards that no longer exist and the field itself when nothing is left.
 */
const pruneLayout = (definition: WorkflowDefinition): WorkflowDefinition => {
  if (definition.layout === undefined) return definition;
  const keys = new Set<string>();
  for (const step of definition.steps) {
    keys.add(step.id);
    if (step.gate) keys.add(workflowGateCardKey(step.id));
    if (step.kind !== "workflow" && step.checks?.length) keys.add(workflowChecksCardKey(step.id));
    for (const attachment of step.attachments ?? []) {
      // Credentials draw a satellite of their own, not a resource card.
      keys.add(
        attachment.kind === "credential"
          ? workflowCredentialCardKey(step.id, workflowLayoutSlug(attachment.id))
          : workflowResourceCardKey(step.id, attachment.id),
      );
    }
  }
  const entries = Object.entries(definition.layout).filter(([key]) => keys.has(key));
  if (entries.length > 0 && entries.length === Object.keys(definition.layout).length)
    return definition;
  if (entries.length > 0) return { ...definition, layout: Object.fromEntries(entries) };
  const { layout: _layout, ...rest } = definition;
  return rest;
};

const isWorkflowSlug = Schema.is(WorkflowSlug);
const isRunId = (id: string) => /^[A-Za-z0-9_-]{1,80}$/.test(id);

export class WorkflowProjectNotFoundError extends Schema.TaggedError<WorkflowProjectNotFoundError>()(
  "WorkflowProjectNotFoundError",
  { projectId: Schema.String },
) {
  override get message(): string {
    return `Project ${this.projectId} was not found.`;
  }
}

export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>()(
  "WorkflowNotFoundError",
  { workflow: Schema.String },
) {
  override get message(): string {
    return `No workflow named "${this.workflow}" exists in this project.`;
  }
}

export class WorkflowRunNotFoundError extends Schema.TaggedError<WorkflowRunNotFoundError>()(
  "WorkflowRunNotFoundError",
  { runId: Schema.String },
) {
  override get message(): string {
    return `Workflow run ${this.runId} was not found.`;
  }
}

export class WorkflowFileError extends Schema.TaggedError<WorkflowFileError>()(
  "WorkflowFileError",
  {
    operation: Schema.Literals(["read", "decode", "write", "list"]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.operation === "decode"
      ? `${this.path} is not a valid workflow file.`
      : `Failed to ${this.operation} ${this.path}.`;
  }
}

export interface WorkflowListing {
  readonly slug: string;
  readonly definition: WorkflowDefinition | null;
  /** Set when the file exists but can't be read or decoded. */
  readonly problem: string | null;
}

export class WorkflowStore extends Context.Service<
  WorkflowStore,
  {
    readonly projectIds: Effect.Effect<ReadonlyArray<ProjectId>, WorkflowFileError>;
    readonly writeSkill: (input: {
      readonly projectId: ProjectId;
      readonly name: string;
      readonly content: string;
      readonly overwrite?: boolean;
    }) => Effect.Effect<{ path: string }, WorkflowProjectNotFoundError | WorkflowFileError>;
    /** Copies a skill's folder into the project's .agents/skills/<name>. Never overwrites. */
    readonly copySkill: (input: {
      readonly projectId: ProjectId;
      readonly name: string;
      readonly sourceDirectory: string;
    }) => Effect.Effect<{ path: string }, WorkflowProjectNotFoundError | WorkflowFileError>;
    /** Rewrites a SKILL.md the catalog already found. Callers pass only catalog paths. */
    readonly rewriteSkillFile: (input: {
      readonly path: string;
      readonly content: string;
    }) => Effect.Effect<void, WorkflowFileError>;
    readonly deleteDefinition: (input: {
      readonly projectId: ProjectId;
      readonly slug: WorkflowSlug;
    }) => Effect.Effect<void, WorkflowProjectNotFoundError | WorkflowFileError>;
    readonly projectRoot: (
      projectId: ProjectId,
    ) => Effect.Effect<string, WorkflowProjectNotFoundError | WorkflowFileError>;
    readonly listDefinitions: (
      projectId: ProjectId,
    ) => Effect.Effect<
      ReadonlyArray<WorkflowListing>,
      WorkflowProjectNotFoundError | WorkflowFileError
    >;
    readonly readDefinition: (input: {
      readonly projectId: ProjectId;
      readonly slug: string;
    }) => Effect.Effect<
      WorkflowDefinition,
      WorkflowProjectNotFoundError | WorkflowNotFoundError | WorkflowFileError
    >;
    readonly writeDefinition: (input: {
      readonly projectId: ProjectId;
      readonly slug: WorkflowSlug;
      readonly definition: WorkflowDefinition;
    }) => Effect.Effect<string, WorkflowProjectNotFoundError | WorkflowFileError>;
    readonly readRun: (
      runId: string,
    ) => Effect.Effect<WorkflowRun, WorkflowRunNotFoundError | WorkflowFileError>;
    readonly writeRun: (run: WorkflowRun) => Effect.Effect<void, WorkflowFileError>;
    readonly listRuns: Effect.Effect<ReadonlyArray<WorkflowRun>, WorkflowFileError>;
    /** Pinned skill text, by skill name. Kept beside the run so the wire-facing run stays small. */
    readonly readSkillTexts: (
      runId: string,
    ) => Effect.Effect<
      Readonly<Record<string, string>>,
      WorkflowRunNotFoundError | WorkflowFileError
    >;
    readonly writeSkillTexts: (
      runId: string,
      texts: Readonly<Record<string, string>>,
    ) => Effect.Effect<void, WorkflowFileError>;
  }
>()("t3/workflows/WorkflowStore") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectService.ProjectService;
  const runsDir = path.join(config.stateDir, "workflow-runs");

  const writeAtomically = <E>(filePath: string, contents: Effect.Effect<string, E>) =>
    contents.pipe(
      Effect.flatMap((text) => writeFileStringAtomically({ filePath, contents: `${text}\n` })),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) => new WorkflowFileError({ operation: "write", path: filePath, cause }),
      ),
    );

  const readOptional = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : Effect.fail(new WorkflowFileError({ operation: "read", path: filePath, cause })),
      }),
    );

  const projectRoot: WorkflowStore["Service"]["projectRoot"] = (projectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError(
        (cause) =>
          new WorkflowFileError({ operation: "read", path: `project ${projectId}`, cause }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new WorkflowProjectNotFoundError({ projectId })),
          onSome: (project) => Effect.succeed(project.workspaceRoot),
        }),
      ),
    );

  const definitionPath = (root: string, slug: string) =>
    path.join(root, WORKFLOWS_DIR, `${slug}.json`);

  const readDefinitionAt = Effect.fn("WorkflowStore.readDefinitionAt")(function* (
    filePath: string,
  ) {
    const raw = yield* readOptional(filePath);
    if (Option.isNone(raw)) return Option.none<WorkflowDefinition>();
    return yield* decodeDefinitionJson(raw.value).pipe(
      Effect.map((definition) => pruneLayout(upgradeWorkflowDefinition(definition))),
      Effect.asSome,
      Effect.mapError(
        (cause) => new WorkflowFileError({ operation: "decode", path: filePath, cause }),
      ),
    );
  });

  const listDefinitions: WorkflowStore["Service"]["listDefinitions"] = Effect.fn(
    "WorkflowStore.listDefinitions",
  )(function* (projectId) {
    const root = yield* projectRoot(projectId);
    const dir = path.join(root, WORKFLOWS_DIR);
    const entries = yield* fileSystem.readDirectory(dir).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed<ReadonlyArray<string>>([])
            : Effect.fail(new WorkflowFileError({ operation: "list", path: dir, cause })),
      }),
    );
    const slugs = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -".json".length))
      .filter(isWorkflowSlug)
      .toSorted();
    return yield* Effect.forEach(slugs, (slug) =>
      readDefinitionAt(definitionPath(root, slug)).pipe(
        Effect.map((definition): WorkflowListing => ({
          slug,
          definition: Option.getOrNull(definition),
          problem: null,
        })),
        Effect.catchTags({
          WorkflowFileError: (error) =>
            Effect.succeed<WorkflowListing>({ slug, definition: null, problem: error.message }),
        }),
      ),
    );
  });

  const readDefinition: WorkflowStore["Service"]["readDefinition"] = Effect.fn(
    "WorkflowStore.readDefinition",
  )(function* (input) {
    if (!isWorkflowSlug(input.slug)) {
      return yield* new WorkflowNotFoundError({ workflow: input.slug });
    }
    const root = yield* projectRoot(input.projectId);
    const definition = yield* readDefinitionAt(definitionPath(root, input.slug));
    if (Option.isNone(definition)) {
      return yield* new WorkflowNotFoundError({ workflow: input.slug });
    }
    return definition.value;
  });

  const writeDefinition: WorkflowStore["Service"]["writeDefinition"] = Effect.fn(
    "WorkflowStore.writeDefinition",
  )(function* (input) {
    const root = yield* projectRoot(input.projectId);
    const filePath = definitionPath(root, input.slug);
    // Every intentional save persists v3; older versions stay readable but are never written back.
    yield* writeAtomically(
      filePath,
      encodeDefinitionJson(pruneLayout(upgradeWorkflowDefinition(input.definition))),
    );
    return path.relative(root, filePath);
  });

  const runPath = (runId: string) => path.join(runsDir, `${runId}.json`);
  const skillTextsPath = (runId: string) => path.join(runsDir, `${runId}.skills.json`);

  const readRun: WorkflowStore["Service"]["readRun"] = Effect.fn("WorkflowStore.readRun")(
    function* (runId) {
      if (!isRunId(runId)) return yield* new WorkflowRunNotFoundError({ runId });
      const filePath = runPath(runId);
      const raw = yield* readOptional(filePath);
      if (Option.isNone(raw)) return yield* new WorkflowRunNotFoundError({ runId });
      return yield* decodeRunJson(raw.value).pipe(
        Effect.mapError(
          (cause) => new WorkflowFileError({ operation: "decode", path: filePath, cause }),
        ),
      );
    },
  );

  const writeRun: WorkflowStore["Service"]["writeRun"] = (run) =>
    writeAtomically(runPath(run.id), encodeRunJson(run));

  const listRuns: WorkflowStore["Service"]["listRuns"] = Effect.gen(function* () {
    const entries = yield* fileSystem.readDirectory(runsDir).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed<ReadonlyArray<string>>([])
            : Effect.fail(new WorkflowFileError({ operation: "list", path: runsDir, cause })),
      }),
    );
    const runIds = entries
      .filter((entry) => entry.endsWith(".json") && !entry.endsWith(".skills.json"))
      .map((entry) => entry.slice(0, -".json".length))
      .filter(isRunId);
    const runs = yield* Effect.forEach(runIds, (runId) =>
      readRun(runId).pipe(
        Effect.asSome,
        // A run file that can't be read is skipped rather than hiding every other run.
        Effect.catch((error) =>
          Effect.logDebug("workflow-run.skipped", { runId, error: error._tag }).pipe(
            Effect.as(Option.none<WorkflowRun>()),
          ),
        ),
      ),
    );
    return runs.flatMap((run) => (Option.isSome(run) ? [run.value] : []));
  });

  const readSkillTexts: WorkflowStore["Service"]["readSkillTexts"] = Effect.fn(
    "WorkflowStore.readSkillTexts",
  )(function* (runId) {
    if (!isRunId(runId)) return yield* new WorkflowRunNotFoundError({ runId });
    const filePath = skillTextsPath(runId);
    const raw = yield* readOptional(filePath);
    if (Option.isNone(raw)) return yield* new WorkflowRunNotFoundError({ runId });
    return yield* decodePinnedSkillTextsJson(raw.value).pipe(
      Effect.mapError(
        (cause) => new WorkflowFileError({ operation: "decode", path: filePath, cause }),
      ),
    );
  });

  const writeSkillTexts: WorkflowStore["Service"]["writeSkillTexts"] = (runId, texts) =>
    writeAtomically(skillTextsPath(runId), encodePinnedSkillTextsJson(texts));

  const projectIds = projects.listShells().pipe(
    Effect.map((items) => items.map((item) => item.id)),
    Effect.mapError(
      (cause) => new WorkflowFileError({ operation: "list", path: "projects", cause }),
    ),
  );
  /** The project's .agents/skills/<name>, after checking no link on the way leaves the project. */
  const projectSkillDirectory = Effect.fnUntraced(function* (projectId: ProjectId, name: string) {
    const root = yield* projectRoot(projectId);
    const directory = path.join(root, ".agents", "skills", name);
    const target = path.join(directory, "SKILL.md");
    if (!isWorkflowSlug(name))
      return yield* new WorkflowFileError({
        operation: "write",
        path: target,
        cause: "Skill name must be a slug.",
      });
    // Resolve existing ancestors before creating directories: a skill may link to a shared install.
    const realRoot = yield* fileSystem
      .realPath(root)
      .pipe(
        Effect.mapError(
          (cause) => new WorkflowFileError({ operation: "write", path: target, cause }),
        ),
      );
    for (const candidate of [
      path.join(root, ".agents"),
      path.join(root, ".agents", "skills"),
      directory,
      target,
    ]) {
      const real = yield* fileSystem.realPath(candidate).pipe(
        Effect.asSome,
        Effect.catchTags({
          PlatformError: (cause) =>
            cause.reason._tag === "NotFound"
              ? fileSystem.readLink(candidate).pipe(
                  Effect.option,
                  Effect.flatMap((link) =>
                    Option.isNone(link)
                      ? Effect.succeedNone
                      : Effect.fail(
                          new WorkflowFileError({ operation: "write", path: target, cause }),
                        ),
                  ),
                )
              : Effect.fail(new WorkflowFileError({ operation: "write", path: target, cause })),
        }),
      );
      if (
        Option.isSome(real) &&
        real.value !== realRoot &&
        !real.value.startsWith(`${realRoot}${path.sep}`)
      )
        return yield* new WorkflowFileError({
          operation: "write",
          path: target,
          cause: "Refusing to overwrite a skill outside the project.",
        });
    }
    return { root, directory, target };
  });

  const writeSkill: WorkflowStore["Service"]["writeSkill"] = Effect.fn("WorkflowStore.writeSkill")(
    function* (input) {
      const { root, target } = yield* projectSkillDirectory(input.projectId, input.name);
      if (input.overwrite === false) {
        const exists = yield* fileSystem
          .exists(target)
          .pipe(
            Effect.mapError(
              (cause) => new WorkflowFileError({ operation: "read", path: target, cause }),
            ),
          );
        if (exists) return { path: path.relative(root, target) };
      }
      yield* writeAtomically(target, Effect.succeed(input.content));
      return { path: path.relative(root, target) };
    },
  );

  const copySkill: WorkflowStore["Service"]["copySkill"] = Effect.fn("WorkflowStore.copySkill")(
    function* (input) {
      const { root, directory, target } = yield* projectSkillDirectory(input.projectId, input.name);
      const fail = (cause: unknown) =>
        new WorkflowFileError({ operation: "write", path: directory, cause });
      if (yield* fileSystem.exists(directory).pipe(Effect.mapError(fail)))
        return yield* fail("The project already has a skill folder with this name.");
      yield* fileSystem
        .makeDirectory(path.dirname(directory), { recursive: true })
        .pipe(
          Effect.andThen(fileSystem.copy(input.sourceDirectory, directory)),
          Effect.mapError(fail),
        );
      return { path: path.relative(root, target) };
    },
  );

  const rewriteSkillFile: WorkflowStore["Service"]["rewriteSkillFile"] = (input) =>
    writeAtomically(input.path, Effect.succeed(input.content));

  const deleteDefinition: WorkflowStore["Service"]["deleteDefinition"] = Effect.fn(
    "WorkflowStore.deleteDefinition",
  )(function* (input) {
    const filePath = definitionPath(yield* projectRoot(input.projectId), input.slug);
    yield* fileSystem
      .remove(filePath, { force: true })
      .pipe(
        Effect.mapError(
          (cause) => new WorkflowFileError({ operation: "write", path: filePath, cause }),
        ),
      );
  });

  return WorkflowStore.of({
    projectIds,
    writeSkill,
    copySkill,
    rewriteSkillFile,
    deleteDefinition,
    projectRoot,
    listDefinitions,
    readDefinition,
    writeDefinition,
    readRun,
    writeRun,
    listRuns,
    readSkillTexts,
    writeSkillTexts,
  });
});

export const layer = Layer.effect(WorkflowStore, make);
