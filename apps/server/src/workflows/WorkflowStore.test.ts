import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  type WorkflowDefinition,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as WorkflowStore from "./WorkflowStore.ts";

const projectId = ProjectId.make("layout-project");
const definition: WorkflowDefinition = {
  version: 3,
  name: "Layout",
  notes: [{ id: "remember", text: "Keep the note", x: 5, y: -6 }],
  steps: [
    {
      id: "build",
      skill: "build",
      gate: true,
      checks: [{ kind: "file", path: "out.txt" }],
      attachments: [
        { id: "node", kind: "requirement", requirement: "node" },
        { id: "resource-1f0f", kind: "credential", templateId: "github" },
      ],
    },
  ],
};
const point = { x: -10, y: 20 };
const validLayout = {
  build: point,
  "gate:build": point,
  "checks:build": point,
  "resource:build:node": point,
  "credential:build:resource-1f0f": point,
};
const staleLayout = {
  ...validLayout,
  absent: point,
  "gate:absent": point,
  "checks:absent": point,
  "resource:build:removed": point,
  "credential:build:resource-removed": point,
};

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-layout-store-" });
  const directory = path.join(root, ".t3", "workflows");
  yield* fs.makeDirectory(directory, { recursive: true });
  const file = path.join(directory, "layout.json");
  const layer = WorkflowStore.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(root, path.join(root, "state")),
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: root } as never),
        }),
      ),
    ),
  );
  return { fs, file, layer };
});

it.effect(
  "ignores stale layout on reads without rewriting disk, then prunes it on the next save",
  () =>
    Effect.gen(function* () {
      const { fs, file, layer } = yield* setup;
      const raw = JSON.stringify({
        ...definition,
        layout: { ...staleLayout, "future:build": point },
      });
      yield* fs.writeFileString(file, raw);
      yield* Effect.gen(function* () {
        const store = yield* WorkflowStore.WorkflowStore;
        expect((yield* store.readDefinition({ projectId, slug: "layout" })).layout).toEqual(
          validLayout,
        );
        expect((yield* store.listDefinitions(projectId))[0]?.definition?.layout).toEqual(
          validLayout,
        );
        expect(yield* fs.readFileString(file)).toBe(raw);
        yield* store.writeDefinition({
          projectId,
          slug: "layout",
          definition: { ...definition, layout: staleLayout },
        });
        expect(JSON.parse(yield* fs.readFileString(file))).toEqual({
          ...definition,
          layout: validLayout,
        });
        yield* store.writeDefinition({
          projectId,
          slug: "layout",
          definition: {
            ...definition,
            layout: staleLayout,
            steps: [{ id: "build", skill: "build", gate: false, checks: [], attachments: [] }],
          },
        });
        expect(JSON.parse(yield* fs.readFileString(file)).layout).toEqual({ build: point });
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "keeps v1/v2 files readable and upgrades intentional saves without requiring layout",
  () =>
    Effect.gen(function* () {
      const { fs, file, layer } = yield* setup;
      yield* Effect.gen(function* () {
        const store = yield* WorkflowStore.WorkflowStore;
        for (const version of [1, 2] as const) {
          const old = { ...definition, version };
          const raw = JSON.stringify(old);
          yield* fs.writeFileString(file, raw);
          const read = yield* store.readDefinition({ projectId, slug: "layout" });
          expect(read).toEqual({ ...old, version: 3 });
          expect(read).not.toHaveProperty("layout");
          expect(yield* fs.readFileString(file)).toBe(raw);
          yield* store.writeDefinition({ projectId, slug: "layout", definition: old });
          expect(JSON.parse(yield* fs.readFileString(file))).toEqual({ ...old, version: 3 });
        }
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("preserves stale layout in historical run snapshots on write, read and list", () =>
  Effect.gen(function* () {
    const { layer } = yield* setup;
    yield* Effect.gen(function* () {
      const store = yield* WorkflowStore.WorkflowStore;
      const run = {
        id: "historical",
        projectId,
        workflow: "layout",
        driverThreadId: ThreadId.make("driver"),
        status: "stopped" as const,
        startedAt: "2026-10-22T00:00:00.000Z",
        definition: { ...definition, layout: staleLayout },
        skills: [],
        steps: [],
      };
      yield* store.writeRun(run);
      expect((yield* store.readRun(run.id)).definition).toEqual(run.definition);
      expect((yield* store.listRuns)[0]?.definition).toEqual(run.definition);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reads a v3 legacy model as subagent models and writes only the new field", () =>
  Effect.gen(function* () {
    const { fs, file, layer } = yield* setup;
    const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
    const raw = JSON.stringify({ ...definition, model });
    yield* fs.writeFileString(file, raw);
    yield* Effect.gen(function* () {
      const store = yield* WorkflowStore.WorkflowStore;
      const read = yield* store.readDefinition({ projectId, slug: "layout" });
      expect(read.subagentModels).toEqual([model]);
      expect(read).not.toHaveProperty("model");
      expect((yield* store.listDefinitions(projectId))[0]?.definition?.subagentModels).toEqual([
        model,
      ]);
      expect(yield* fs.readFileString(file)).toBe(raw);
      yield* store.writeDefinition({ projectId, slug: "layout", definition: read });
      const saved = JSON.parse(yield* fs.readFileString(file));
      expect(saved.subagentModels).toEqual([model]);
      expect(saved).not.toHaveProperty("model");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
