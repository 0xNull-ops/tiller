import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts";

const firstLayer = (stateDir: string) =>
  WorkflowFirst.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ServerConfig.ServerConfig, {
          stateDir,
        } as ServerConfig.ServerConfig["Service"]),
        NodeServices.layer,
      ),
    ),
  );

it.effect("defaults old threads to off and captures a default only once", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped();
    const first = yield* WorkflowFirst.WorkflowFirst.pipe(Effect.provide(firstLayer(stateDir)));
    const threadId = ThreadId.make("thread:workflow-first");
    const projectId = ProjectId.make("project:workflow-first");
    expect(yield* first.read({ threadId, projectId })).toMatchObject({
      enabled: false,
      revision: 0,
    });
    yield* first.initialize({ threadId, projectId, enabled: true });
    yield* first.initialize({ threadId, projectId, enabled: false });
    expect(yield* first.read({ threadId, projectId })).toMatchObject({
      enabled: true,
      revision: 0,
    });
    expect(
      yield* first.read({ threadId, projectId: ProjectId.make("project:other") }),
    ).toMatchObject({ enabled: false, revision: 0 });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps the newest transition when an older delivery is acknowledged", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped();
    const first = yield* WorkflowFirst.WorkflowFirst.pipe(Effect.provide(firstLayer(stateDir)));
    const threadId = ThreadId.make("thread:workflow-first-race");
    const projectId = ProjectId.make("project:workflow-first-race");
    yield* first.initialize({ threadId, projectId, enabled: false });
    const on = yield* first.set({ threadId, projectId, enabled: true });
    const off = yield* first.set({ threadId, projectId, enabled: false });
    const onAgain = yield* first.set({ threadId, projectId, enabled: true });
    yield* first.acknowledge({ threadId, revision: on.revision });
    expect(yield* first.read({ threadId, projectId })).toMatchObject({
      enabled: true,
      pendingTransition: { enabled: true, revision: onAgain.revision },
    });
    yield* first.acknowledge({ threadId, revision: onAgain.revision });
    expect(yield* first.read({ threadId, projectId })).toMatchObject({
      enabled: true,
      pendingTransition: null,
    });
    const filePath = path.join(stateDir, "workflows", "thread-preferences.json");
    expect((yield* fs.readFileString(filePath)).length).toBeGreaterThan(0);
    expect(off.revision).toBeGreaterThan(on.revision);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("serializes concurrent changes and treats same-value writes as no-ops", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped();
    const first = yield* WorkflowFirst.WorkflowFirst.pipe(Effect.provide(firstLayer(stateDir)));
    const threadId = ThreadId.make("thread:workflow-first-concurrent");
    const projectId = ProjectId.make("project:workflow-first-concurrent");
    yield* first.initialize({ threadId, projectId, enabled: false });

    const filePath = path.join(stateDir, "workflows", "thread-preferences.json");
    const beforeNoOp = yield* fs.stat(filePath);
    const initial = yield* first.set({ threadId, projectId, enabled: false });
    const afterNoOp = yield* fs.stat(filePath);
    expect(initial.revision).toBe(0);
    expect(afterNoOp.ino).toEqual(beforeNoOp.ino);

    const [on, sameValue] = yield* Effect.all(
      [
        first.set({ threadId, projectId, enabled: true }),
        first.set({ threadId, projectId, enabled: true }),
      ],
      { concurrency: "unbounded" },
    );
    expect(on.enabled).toBe(true);
    expect(sameValue.revision).toBe(1);
    expect(yield* first.read({ threadId, projectId })).toMatchObject({
      enabled: true,
      revision: 1,
      pendingTransition: { enabled: true, revision: 1 },
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses to overwrite unreadable workflow-first state", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped();
    const filePath = path.join(stateDir, "workflows", "thread-preferences.json");
    yield* fs.makeDirectory(path.join(stateDir, "workflows"), { recursive: true });
    yield* fs.writeFileString(filePath, "{broken");
    const first = yield* WorkflowFirst.WorkflowFirst.pipe(Effect.provide(firstLayer(stateDir)));
    const threadId = ThreadId.make("thread:workflow-first-corrupt");
    const projectId = ProjectId.make("project:workflow-first-corrupt");

    const failed = yield* first.set({ threadId, projectId, enabled: true }).pipe(Effect.exit);
    expect(failed._tag).toBe("Failure");
    expect(yield* fs.readFileString(filePath)).toBe("{broken");
  }).pipe(Effect.provide(NodeServices.layer)),
);
