import * as FileSystem from "effect/FileSystem";
import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";
import { make } from "./SkillsShService.ts";

const dependencies = Layer.mergeAll(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer), FetchHttpClient.layer);
it.effect("rejects unsafe uninstall names before accessing the filesystem", () =>
  Effect.gen(function* () {
    const service = yield* make;
    for (const name of ["../outside", "/absolute", "nested/skill", "back\\slash"]) {
      const result = yield* service.uninstall(name, {}).pipe(Effect.flip);
      expect(result.message).toBe("Invalid skill name");
    }
    const missingProject = yield* service
      .uninstall("skill", { scope: "project" })
      .pipe(Effect.flip);
    expect(missingProject.message).toBe("Absolute project path required");
  }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "resolves nested skills, pins installs, tracks replacements and refuses untracked deletion",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const project = yield* fs.makeTempDirectoryScoped();
      const sha = "a".repeat(40);
      const markdown = "---\nname: fixture\n---\nUseful skill";
      let mode = "normal";
      let revision = sha;
      const urls: string[] = [];
      const fetcher: typeof globalThis.fetch = async (input, options) => {
        expect(new Headers(options?.headers).get("user-agent")).toMatch(
          /^Tiller\/[^ ]+ \(\+https:\/\/tiller.shipr.app\)$/,
        );
        const url = String(input);
        urls.push(url);
        if (mode === "denied") return new Response("", { status: 403 });
        if (mode === "noaudit") return new Response("", { status: 404 });
        if (url.includes("/api/search"))
          return Response.json({
            skills: [
              {
                id: "acme/repo/fixture",
                source: "acme/repo",
                name: "fixture",
                skillId: "fixture",
                installs: 42,
                future: true,
              },
            ],
            count: 1,
            searchType: "test",
            extra: true,
          });
        if (url.includes("/api/v1/")) return Response.json([]);
        if (url.includes("/git/trees/"))
          return Response.json({
            truncated: false,
            tree:
              mode === "traversal"
                ? [{ path: "../SKILL.md", type: "blob", mode: "100644", size: 1 }]
                : mode === "files"
                  ? Array.from({ length: 201 }, (_, i) => ({
                      path: i === 0 ? "SKILL.md" : `file-${i}`,
                      type: "blob",
                      mode: "100644",
                      size: 1,
                    }))
                  : [
                      { path: "other/SKILL.md", type: "blob", mode: "100644", size: 30 },
                      {
                        path: "nested/fixture/SKILL.md",
                        type: "blob",
                        mode: "100644",
                        size: markdown.length,
                      },
                      {
                        path: "nested/fixture/scripts/task.py",
                        type: "blob",
                        mode: "100644",
                        size: 4,
                      },
                    ],
          });
        if (url.includes("/compare/"))
          return Response.json({
            files: [
              { filename: "nested/fixture/scripts/task.py", status: "modified" },
              { filename: "unrelated.txt", status: "removed" },
            ],
          });
        if (url.includes("/commits/")) return Response.json({ sha: revision });
        if (url.includes("raw.githubusercontent.com"))
          return new Response(
            url.endsWith("other/SKILL.md")
              ? "---\nname: other\n---"
              : url.endsWith(".py")
                ? mode === "bytes"
                  ? new Uint8Array(5 * 1024 * 1024 + 1)
                  : "pass"
                : markdown,
          );
        return Response.json({ default_branch: "main" });
      };
      const service = yield* make.pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetcher),
      );
      expect((yield* service.search("fixture")).skills[0]?.name).toBe("fixture");
      yield* service.search("fixture", 60);
      expect(urls.at(-1)).toContain("limit=60");
      yield* service.search("fixture", 999);
      expect(urls.at(-1)).toContain("limit=500");
      const preview = yield* service.preview("acme/repo/fixture");
      expect(preview.folder).toBe("nested/fixture");
      expect(urls.some((url) => url.endsWith("/other/SKILL.md"))).toBe(false);
      const before = urls.length;
      yield* service.preview(preview.id);
      expect(urls).toHaveLength(before);
      const input = { id: preview.id, sha, scope: "project" as const, project };
      yield* service.install(input);
      expect(yield* fs.readFileString(project + "/.agents/skills/fixture/scripts/task.py")).toBe(
        "pass",
      );
      expect((yield* service.listInstalled(input))[0]).toMatchObject({
        sha,
        id: preview.id,
        name: "fixture",
      });
      expect((yield* service.install(input).pipe(Effect.flip)).message).toContain("already exists");
      yield* service.install({ ...input, name: "fixture-2" });
      yield* service.install({ ...input, replace: true });
      expect(
        (yield* service.install({ ...input, sha: "changed" }).pipe(Effect.flip)).message,
      ).toContain("Preview again");
      yield* fs.makeDirectory(project + "/.agents/skills/handmade");
      expect((yield* service.uninstall("handmade", input).pipe(Effect.flip)).message).toContain(
        "not tracked",
      );
      yield* service.uninstall("fixture", input);
      expect(yield* fs.exists(project + "/.agents/skills/fixture")).toBe(false);
      expect((yield* service.listInstalled(input)).map((entry) => entry.name)).toEqual([
        "fixture-2",
      ]);
      mode = "bytes";
      expect(
        (yield* service.install({ ...input, name: "too-large" }).pipe(Effect.flip)).message,
      ).toContain("5 MB");
      expect(yield* fs.exists(project + "/.agents/skills/too-large")).toBe(false);
      expect(
        (yield* fs.readDirectory(project + "/.agents/skills")).some((name) =>
          name.startsWith(".install-"),
        ),
      ).toBe(false);
      mode = "traversal";
      expect((yield* service.preview(preview.id, true).pipe(Effect.flip)).message).toContain(
        "Unsafe repository path",
      );
      mode = "files";
      expect((yield* service.preview(preview.id, true).pipe(Effect.flip)).message).toContain(
        "200 files",
      );
      mode = "normal";
      revision = "b".repeat(40);
      const updates = yield* service.checkUpdates(input);
      expect(updates[0]?.summary).toContain("0 added, 0 removed, 1 changed");
      expect(updates[0]?.preview.sha).toBe(revision);
      urls.length = 0;
      yield* service.audit("acme/repo/another");
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("skills.sh/api/v1/skills/audit/");
      mode = "noaudit";
      expect(yield* service.audit("acme/repo/unreviewed")).toBe(null);
      mode = "denied";
      expect((yield* service.preview(preview.id, true).pipe(Effect.flip)).message).toContain("403");
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
