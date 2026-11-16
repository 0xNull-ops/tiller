import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as WorkflowOutputPreviews from "./WorkflowOutputPreviews.ts";
import * as WorkflowUrlCapture from "./WorkflowUrlCapture.ts";

const input = {
  runId: "run-1",
  threadId: ThreadId.make("driver"),
  outputs: {
    site: "https://example.com/?token=private",
    image: "out/a.png",
    other: "file:///etc/passwd",
  },
};
const bytes = new Uint8Array([255, 216, 255, 217]);
const fixture = (capture: WorkflowUrlCapture.WorkflowUrlCapture["Service"]["capture"]) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const serviceLayer = WorkflowOutputPreviews.layer.pipe(
      Layer.provide(Layer.succeed(WorkflowUrlCapture.WorkflowUrlCapture, { capture })),
      Layer.provide(Layer.succeed(ServerConfig.ServerConfig, config)),
    );
    return { config, serviceLayer };
  });
const base = ServerConfig.layerTest("/tmp", { prefix: "t3-output-previews-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it("marks only public URLs and project-relative HTML outputs pending", () => {
  expect(
    WorkflowOutputPreviews.pendingPreviews({
      url: "https://example.com/index.html",
      html: "./out/index.html",
      htm: "out/Report.HTM",
      image: "out/image.png",
      absolute: "/tmp/index.html",
      windows: "C:\\output\\index.html",
      traversal: "out/../index.html",
      backslashTraversal: "out\\..\\index.html",
      remote: "//example.com/index.html",
      file: "file:///tmp/index.html",
      scheme: "custom:output.html",
    }),
  ).toEqual({
    url: { status: "pending" },
    html: { status: "pending" },
    htm: { status: "pending" },
  });
});

it.effect.each(["out/report.html", "out/report.htm", ".t3/workflows/out/run-1/build/report.html"])(
  "captures project-relative %s through attachment assets and caches without rereading the project",
  (output) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const project = path.join(root, "project");
      const cwd = path.join(root, "project-link");
      yield* fs.makeDirectory(path.dirname(path.join(project, output)), { recursive: true });
      yield* fs.symlink(project, cwd);
      const html = "<!doctype html><h1>Local report ✓</h1>";
      yield* fs.writeFileString(path.join(project, "content"), html);
      yield* fs.symlink(path.join(project, "content"), path.join(project, output));
      const calls: Array<readonly [string, string | undefined]> = [];
      const h = yield* fixture((url, contents) =>
        Effect.sync(() => {
          calls.push([url, contents]);
          return bytes;
        }),
      );
      const localInput = { ...input, cwd, outputs: { report: output, alias: output } };
      const first = yield* Effect.gen(function* () {
        const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
        const [a, b] = yield* Effect.all(
          [service.prepare(localInput), service.prepare(localInput)],
          {
            concurrency: 2,
          },
        );
        expect(a).toEqual(b);
        expect(a.report).toEqual(a.alias);
        return a;
      }).pipe(Effect.provide(h.serviceLayer));
      expect(calls).toEqual([[output, html]]);
      expect(first.report?.status).toBe("ready");
      if (first.report?.status === "ready") {
        const image = resolveAttachmentPathById({
          attachmentsDir: h.config.attachmentsDir,
          attachmentId: first.report.attachmentId,
        });
        expect(Array.from(yield* fs.readFile(image!))).toEqual(Array.from(bytes));
      }
      expect(yield* fs.readFileString(path.join(project, output))).toBe(html);
      yield* fs.remove(project, { recursive: true });
      yield* Effect.gen(function* () {
        const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
        expect(yield* service.prepare(localInput)).toEqual(first);
      }).pipe(Effect.provide(h.serviceLayer));
      expect(calls).toHaveLength(1);
    }).pipe(Effect.provide(base)),
);

it.effect("refuses missing, oversized, non-file and escaping HTML and caches failures", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const cwd = path.join(root, "project");
    const outside = path.join(root, "project-outside");
    yield* fs.makeDirectory(cwd);
    yield* fs.makeDirectory(outside);
    yield* fs.writeFileString(path.join(outside, "secret.html"), "private");
    yield* fs.symlink(path.join(outside, "secret.html"), path.join(cwd, "escape.html"));
    yield* fs.symlink(outside, path.join(cwd, "escape"));
    yield* fs.makeDirectory(path.join(cwd, "directory.html"));
    yield* fs.writeFile(path.join(cwd, "huge.html"), new Uint8Array(5 * 1024 * 1024 + 1));
    let captures = 0;
    const h = yield* fixture(() =>
      Effect.sync(() => {
        captures += 1;
        return bytes;
      }),
    );
    const outputs = {
      missing: "missing.html",
      directory: "directory.html",
      huge: "huge.html",
      escape: "escape.html",
      ancestor: "escape/secret.html",
    };
    const expected = Object.fromEntries(
      Object.keys(outputs).map((key) => [key, { status: "unavailable" }]),
    );
    yield* Effect.gen(function* () {
      const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
      expect(yield* service.prepare({ ...input, cwd, outputs })).toEqual(expected);
      expect(yield* service.prepare({ ...input, outputs: { missingCwd: "out.html" } })).toEqual({
        missingCwd: { status: "unavailable" },
      });
    }).pipe(Effect.provide(h.serviceLayer));
    yield* fs.remove(cwd, { recursive: true });
    yield* fs.makeDirectory(path.join(cwd, "escape"), { recursive: true });
    for (const output of Object.values(outputs)) {
      yield* fs.writeFileString(path.join(cwd, output), "<h1>Now available</h1>");
    }
    yield* Effect.gen(function* () {
      const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
      expect(yield* service.prepare({ ...input, cwd, outputs })).toEqual(expected);
    }).pipe(Effect.provide(h.serviceLayer));
    expect(captures).toBe(0);
  }).pipe(Effect.provide(base)),
);

it.effect("bounds HTML reads even when the file grows after stat", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(path.join(cwd, "small"), "small");
    const small = yield* fs.stat(path.join(cwd, "small"));
    yield* fs.writeFile(path.join(cwd, "growing.html"), new Uint8Array(5 * 1024 * 1024 + 1));
    let captures = 0;
    const h = yield* fixture(() =>
      Effect.sync(() => {
        captures += 1;
        return bytes;
      }),
    );
    const layer = h.serviceLayer.pipe(
      Layer.provide(
        Layer.succeed(FileSystem.FileSystem, {
          ...fs,
          stat: (file) => fs.stat(file).pipe(Effect.map((info) => ({ ...info, size: small.size }))),
        }),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
      expect(
        yield* service.prepare({ ...input, cwd, outputs: { report: "growing.html" } }),
      ).toEqual({ report: { status: "unavailable" } });
    }).pipe(Effect.provide(layer));
    expect(captures).toBe(0);
  }).pipe(Effect.provide(base)),
);

it.effect(
  "deduplicates concurrent requests, caches across restarts and serves valid attachment IDs",
  () =>
    Effect.gen(function* () {
      let captures = 0;
      const h = yield* fixture(() =>
        Effect.sync(() => {
          captures += 1;
          return bytes;
        }),
      );
      const first = yield* Effect.gen(function* () {
        const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
        const [a, b] = yield* Effect.all([service.prepare(input), service.prepare(input)], {
          concurrency: 2,
        });
        expect(a).toEqual(b);
        return a;
      }).pipe(Effect.provide(h.serviceLayer));
      const second = yield* Effect.gen(function* () {
        const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
        const aliases = yield* service.prepare({
          ...input,
          outputs: { ...input.outputs, alias: input.outputs.site },
        });
        expect(aliases.alias).toEqual(aliases.site);
        const { alias: _alias, ...original } = aliases;
        return original;
      }).pipe(Effect.provide(h.serviceLayer));
      expect(captures).toBe(1);
      expect(second).toEqual(first);
      expect(first).not.toHaveProperty("image");
      expect(first).not.toHaveProperty("other");
      const preview = first.site;
      expect(preview?.status).toBe("ready");
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      if (preview?.status === "ready") {
        const imagePath = resolveAttachmentPathById({
          attachmentsDir: h.config.attachmentsDir,
          attachmentId: preview.attachmentId,
        });
        expect(imagePath).not.toBeNull();
        expect(Array.from(yield* fs.readFile(imagePath!))).toEqual(Array.from(bytes));
      }
      const sidecars = yield* fs.readDirectory(
        path.join(h.config.stateDir, "workflow-output-previews"),
      );
      expect(sidecars).toHaveLength(1);
      const text = yield* fs.readFileString(
        path.join(h.config.stateDir, "workflow-output-previews", sidecars[0]!),
      );
      expect(text).not.toContain("private");
      expect(text).not.toContain("example.com");
      expect(text).not.toContain("base64");
    }).pipe(Effect.provide(base)),
);

it.effect("caches failure markers and bounds capture concurrency across runs", () =>
  Effect.gen(function* () {
    let captures = 0;
    let active = 0;
    let maximum = 0;
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const h = yield* fixture(() =>
      Effect.gen(function* () {
        captures += 1;
        active += 1;
        maximum = Math.max(maximum, active);
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        active -= 1;
        return yield* new WorkflowUrlCapture.WorkflowUrlCaptureError({
          cause: new Error("unavailable"),
        });
      }),
    );
    yield* Effect.gen(function* () {
      const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
      const first = yield* service.prepare(input).pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const second = yield* service.prepare({ ...input, runId: "run-2" }).pipe(Effect.forkScoped);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(first)).toEqual({ site: { status: "unavailable" } });
      expect(yield* Fiber.join(second)).toEqual({ site: { status: "unavailable" } });
      expect(yield* service.prepare(input)).toEqual({ site: { status: "unavailable" } });
    }).pipe(Effect.provide(h.serviceLayer));
    yield* Effect.gen(function* () {
      const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
      expect(yield* service.prepare(input)).toEqual({ site: { status: "unavailable" } });
    }).pipe(Effect.provide(h.serviceLayer));
    expect(captures).toBe(2);
    expect(maximum).toBe(1);
  }).pipe(Effect.provide(base)),
);

it.effect.each(["interrupt", "timeout", "html interrupt", "html timeout"])(
  "persists interrupted attempts and releases capture (%s)",
  (stop) =>
    Effect.gen(function* () {
      let captures = 0;
      const started = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      const h = yield* fixture(() =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            captures += 1;
          }).pipe(Effect.andThen(Deferred.succeed(started, undefined))),
          () => Effect.never,
          () => Deferred.succeed(closed, undefined),
        ),
      );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(path.join(cwd, "report.html"), "<h1>Report</h1>");
      const attemptInput = stop.startsWith("html")
        ? { ...input, cwd, outputs: { site: "report.html" } }
        : input;
      yield* Effect.gen(function* () {
        const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
        const pending = yield* service.prepare(attemptInput).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        if (stop.endsWith("interrupt")) yield* Fiber.interrupt(pending);
        else {
          yield* TestClock.adjust("26 seconds");
          expect(yield* Fiber.join(pending)).toEqual({ site: { status: "unavailable" } });
        }
        yield* Deferred.await(closed);
      }).pipe(Effect.provide(h.serviceLayer));
      yield* Effect.gen(function* () {
        const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
        expect(yield* service.prepare(attemptInput)).toEqual({ site: { status: "unavailable" } });
      }).pipe(Effect.provide(h.serviceLayer));
      expect(captures).toBe(1);
    }).pipe(Effect.provide(base)),
);

it.effect(
  "copies .t3/workflows/out HTML written at an enclosing repo root into a subfolder project cwd and retries on force",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoRoot = yield* fs.makeTempDirectoryScoped();
      const subproject = path.join(repoRoot, "apps", "server");
      const output = ".t3/workflows/out/wf-1/test/carrot-mascot.html";
      const html = "<!doctype html><canvas id='c'></canvas>";
      yield* fs.makeDirectory(path.join(repoRoot, ".git"), { recursive: true });
      yield* fs.makeDirectory(subproject, { recursive: true });
      let captures = 0;
      const h = yield* fixture((_url, contents) =>
        Effect.sync(() => {
          captures += 1;
          expect(contents).toBe(html);
          return bytes;
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* WorkflowOutputPreviews.WorkflowOutputPreviews;
        expect(
          yield* service.prepare({
            ...input,
            cwd: subproject,
            outputs: { html: output },
          }),
        ).toEqual({ html: { status: "unavailable" } });
        yield* fs.makeDirectory(path.dirname(path.join(repoRoot, output)), { recursive: true });
        yield* fs.writeFileString(path.join(repoRoot, output), html);
        const refreshed = yield* service.prepare({
          ...input,
          cwd: subproject,
          outputs: { html: output },
          force: true,
        });
        expect(refreshed.html?.status).toBe("ready");
      }).pipe(Effect.provide(h.serviceLayer));
      expect(captures).toBe(1);
      expect(yield* fs.readFileString(path.join(subproject, output))).toBe(html);
    }).pipe(Effect.provide(base)),
);
