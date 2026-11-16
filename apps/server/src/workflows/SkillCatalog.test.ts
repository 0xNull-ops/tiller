import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as SkillCatalog from "./SkillCatalog.ts";

const withCatalog = <A, E>(
  run: (input: {
    readonly fs: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly projectRoot: string;
    readonly home: string;
    readonly writeSkill: (root: string, directory: string, text: string) => Effect.Effect<void>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-skill-project-" });
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-skill-home-" });
    const writeSkill = (root: string, directory: string, text: string) =>
      Effect.gen(function* () {
        const skillDir = path.join(root, directory);
        yield* fs.makeDirectory(skillDir, { recursive: true });
        yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), text);
      }).pipe(Effect.orDie);
    return yield* run({
      fs,
      path,
      projectRoot,
      home,
      writeSkill,
    });
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const catalogLayer = (home: string) =>
  Layer.provideMerge(SkillCatalog.layerWithHome(home), Layer.mergeAll(NodeServices.layer, NodeCrypto.layer));

describe("SkillCatalog", () => {
  it("parses requires forms and quoted values", () => {
    expect(SkillCatalog.parseFrontmatter("---\nrequires: [macos, xcodebuild]\n---")).toMatchObject({
      requires: ["macos", "xcodebuild"],
    });
    expect(SkillCatalog.parseFrontmatter("---\nrequires: macos, xcodebuild\n---")).toMatchObject({
      requires: ["macos", "xcodebuild"],
    });
    expect(
      SkillCatalog.parseFrontmatter('---\nrequires:\n  - macos\n  - "xcodebuild"\n---'),
    ).toMatchObject({ requires: ["macos", "xcodebuild"] });
    expect(
      SkillCatalog.parseFrontmatter("---\nrequires: [\"macos\", 'xcodebuild']\n---"),
    ).toMatchObject({ requires: ["macos", "xcodebuild"] });
  });
  describe("resolve", () => {
    it.effect("honors root priority and frontmatter name over directory name", () =>
      withCatalog(({ projectRoot, home, writeSkill }) =>
        Effect.gen(function* () {
          yield* writeSkill(
            `${projectRoot}/.agents/skills`,
            "folder",
            "---\nname: Shared\ndescription: project\n---\nfirst",
          );
          yield* writeSkill(`${projectRoot}/.claude/skills`, "Shared", "second");
          const catalog = yield* SkillCatalog.SkillCatalog;
          const resolved = yield* catalog.resolve({ projectRoot, name: "shared" });
          expect(resolved.name).toBe("Shared");
          expect(resolved.description).toBe("project");
          expect(resolved.text).toContain("first");
          expect(resolved.path).toContain("folder/SKILL.md");
          expect(home).not.toBe("");
        }).pipe(Effect.provide(catalogLayer(home))),
      ),
    );

    it.effect(
      "uses the directory name, matches case insensitively, and rejects missing or invalid names",
      () =>
        withCatalog(({ projectRoot, home, writeSkill }) =>
          Effect.gen(function* () {
            yield* writeSkill(`${projectRoot}/.agents/skills`, "folder-name", "body");
            const catalog = yield* SkillCatalog.SkillCatalog;
            expect((yield* catalog.resolve({ projectRoot, name: "FOLDER-NAME" })).name).toBe(
              "folder-name",
            );
            expect(
              (yield* Effect.flip(catalog.resolve({ projectRoot, name: "absent" })))._tag,
            ).toBe("SkillNotFoundError");
            expect(
              (yield* Effect.flip(catalog.resolve({ projectRoot, name: "../secret" })))._tag,
            ).toBe("SkillNotFoundError");
          }).pipe(Effect.provide(catalogLayer(home))),
        ),
    );
  });

  it.effect("lists deduplicated names in order and hashes changed text", () =>
    withCatalog(({ projectRoot, home, writeSkill }) =>
      Effect.gen(function* () {
        yield* writeSkill(`${projectRoot}/.agents/skills`, "z-dir", "---\nname: Zulu\n---\none");
        yield* writeSkill(`${projectRoot}/.agents/skills`, "alpha", "---\nname: Alpha\n---\none");
        yield* writeSkill(`${home}/.codex/skills`, "z-other", "---\nname: zULU\n---\nother");
        const catalog = yield* SkillCatalog.SkillCatalog;
        const listed = yield* catalog.list({ projectRoot });
        expect(listed.map((item) => item.name)).toEqual(["Alpha", "Zulu"]);
        expect(listed[1]?.path).toContain("z-dir/SKILL.md");
        const before = yield* catalog.resolve({ projectRoot, name: "Zulu" });
        yield* writeSkill(`${projectRoot}/.agents/skills`, "z-dir", "---\nname: Zulu\n---\ntwo");
        const after = yield* catalog.resolve({ projectRoot, name: "Zulu" });
        expect(after.sha256).not.toBe(before.sha256);
      }).pipe(Effect.provide(catalogLayer(home))),
    ),
  );

  it.effect("reports project and global skill scopes", () =>
    withCatalog(({ projectRoot, home, writeSkill }) =>
      Effect.gen(function* () {
        yield* writeSkill(`${projectRoot}/.agents/skills`, "local", "local");
        yield* writeSkill(`${projectRoot}/.claude/skills`, "claude-local", "local");
        yield* writeSkill(`${home}/.codex/skills`, "global", "global");
        const catalog = yield* SkillCatalog.SkillCatalog;
        expect((yield* catalog.resolve({ projectRoot, name: "local" })).scope).toBe("project");
        expect((yield* catalog.resolve({ projectRoot, name: "claude-local" })).scope).toBe(
          "project",
        );
        expect((yield* catalog.resolve({ projectRoot, name: "global" })).scope).toBe("global");
      }).pipe(Effect.provide(catalogLayer(home))),
    ),
  );
});
