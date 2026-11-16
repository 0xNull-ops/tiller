import * as Digest from "effect/crypto/Digest";
import * as NodeOS from "node:os";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class SkillNotFoundError extends Schema.TaggedError<SkillNotFoundError>()(
  "SkillNotFoundError",
  { skillName: Schema.String },
) {
  override get message(): string {
    return `No skill named "${this.skillName}" was found.`;
  }
}

export class SkillReadError extends Schema.TaggedError<SkillReadError>()("SkillReadError", {
  skillName: Schema.String,
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to read skill "${this.skillName}" at ${this.path}.`;
  }
}

export interface ResolvedSkill {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly sha256: string;
  readonly description: string | null;
  /** Project skills live under the project root; global ones in the user's home. */
  readonly scope: "project" | "global";
  /** From `requires:`: an OS (macos, linux, windows) or commands that must be on PATH. */
  readonly requires: ReadonlyArray<string>;
}

export class SkillCatalog extends Context.Service<
  SkillCatalog,
  {
    readonly resolve: (input: {
      readonly projectRoot: string;
      readonly name: string;
    }) => Effect.Effect<ResolvedSkill, SkillNotFoundError | SkillReadError>;
    readonly list: (input: {
      readonly projectRoot: string;
    }) => Effect.Effect<ReadonlyArray<Omit<ResolvedSkill, "text">>>;
  }
>()("t3/workflows/SkillCatalog") {}

const isValidName = (name: string) =>
  /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";

const unquote = (value: string) => value.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");

export const parseFrontmatter = (text: string) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const fields: { name?: string; description?: string; requires: string[] } = { requires: [] };
  const block = match?.[1];
  if (block === undefined) return fields;
  let inRequiresList = false;
  for (const line of block.split(/\r?\n/)) {
    // `requires:` takes `[a, b]`, `a, b`, or a following `- a` list.
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (inRequiresList && item?.[1] !== undefined) {
      fields.requires.push(unquote(item[1]));
      continue;
    }
    inRequiresList = false;
    const field = /^(name|description|requires):\s*(.*)$/.exec(line);
    if (!field) continue;
    const rawValue = field[2];
    if (rawValue === undefined) continue;
    if (field[1] === "requires") {
      const list = rawValue.trim().replace(/^\[([\s\S]*)\]$/, "$1");
      if (list === "") inRequiresList = true;
      else fields.requires.push(...list.split(",").map(unquote));
      continue;
    }
    const value = unquote(rawValue);
    if (field[1] === "name") fields.name = value;
    else fields.description = value;
  }
  fields.requires = fields.requires.filter((value) => value.length > 0);
  return fields;
};

const makeForHome = Effect.fn("SkillCatalog.makeForHome")(function* (home: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Digest.Digest;
  const roots = (projectRoot: string) =>
    [
      { dir: path.join(projectRoot, ".agents", "skills"), scope: "project" as const },
      { dir: path.join(projectRoot, ".claude", "skills"), scope: "project" as const },
      { dir: path.join(home, ".agents", "skills"), scope: "global" as const },
      { dir: path.join(home, ".claude", "skills"), scope: "global" as const },
      { dir: path.join(home, ".codex", "skills"), scope: "global" as const },
    ] as const;
  type Root = ReturnType<typeof roots>[number];

  const readAt = ({ dir: root, scope }: Root, directory: string) => {
    const filePath = path.join(root, directory, "SKILL.md");
    return fileSystem.readFileString(filePath).pipe(
      Effect.flatMap((text) =>
        crypto.digest(Digest.sha256, new TextEncoder().encode(text)).pipe(
          Effect.map((digest) => {
            const metadata = parseFrontmatter(text);
            return {
              name: metadata.name || directory,
              path: filePath,
              text,
              sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
              description: metadata.description ?? null,
              scope,
              requires: metadata.requires,
            } satisfies ResolvedSkill;
          }),
        ),
      ),
      Effect.mapError(
        (cause) => new SkillReadError({ skillName: directory, path: filePath, cause }),
      ),
    );
  };

  const listDirectories = (root: string) =>
    fileSystem.readDirectory(root).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.map((entries) => entries.toSorted()),
    );

  // An unreadable or broken skill elsewhere must not hide the ones that work.
  const scanRoot = (root: Root) =>
    listDirectories(root.dir).pipe(
      Effect.flatMap((directories) =>
        Effect.forEach(directories, (directory) => readAt(root, directory).pipe(Effect.option)),
      ),
      Effect.map((entries) =>
        entries.filter((entry) => entry._tag === "Some").map((entry) => entry.value),
      ),
    );

  const isNotFound = (error: SkillReadError) =>
    typeof error.cause === "object" &&
    error.cause !== null &&
    "reason" in error.cause &&
    (error.cause as { reason?: { _tag?: string } }).reason?._tag === "NotFound";

  const matches = (skill: ResolvedSkill, name: string) =>
    skill.name.toLocaleLowerCase() === name.toLocaleLowerCase();

  const resolve: SkillCatalog["Service"]["resolve"] = Effect.fn("SkillCatalog.resolve")(function* ({
    projectRoot,
    name,
  }) {
    if (!isValidName(name)) return yield* new SkillNotFoundError({ skillName: name });
    for (const root of roots(projectRoot)) {
      // Most skills live in a folder of their own name, so try that before reading the rest. The
      // exact listing match matters on case-insensitive disks, where any spelling would open it.
      const directories = yield* listDirectories(root.dir);
      if (directories.includes(name)) {
        const direct = yield* readAt(root, name).pipe(
          Effect.catchTags({
            SkillReadError: (error) =>
              isNotFound(error) ? Effect.succeed(null) : Effect.fail(error),
          }),
        );
        if (direct !== null && matches(direct, name)) return direct;
      }
      for (const skill of yield* scanRoot(root)) {
        if (matches(skill, name)) return skill;
      }
    }
    return yield* new SkillNotFoundError({ skillName: name });
  });

  const list: SkillCatalog["Service"]["list"] = Effect.fn("SkillCatalog.list")(function* ({
    projectRoot,
  }) {
    const byName = new Map<string, Omit<ResolvedSkill, "text">>();
    for (const root of roots(projectRoot)) {
      for (const skill of yield* scanRoot(root)) {
        const key = skill.name.toLocaleLowerCase();
        if (!byName.has(key)) {
          const { text: _text, ...item } = skill;
          byName.set(key, item);
        }
      }
    }
    return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  });

  return SkillCatalog.of({ resolve, list });
});

// Injecting home keeps catalog tests isolated from the developer's installed skills.
export const layerWithHome = (home: string) => Layer.effect(SkillCatalog, makeForHome(home));
export const layer = Layer.effect(
  SkillCatalog,
  Effect.sync(() => NodeOS.homedir()).pipe(Effect.flatMap(makeForHome)),
);
