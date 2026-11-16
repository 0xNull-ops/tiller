// @effect-diagnostics nodeBuiltinImport:off - Cache keys use a digest so URLs and their query tokens never enter sidecars.
import * as NodeCrypto from "node:crypto";

import { WorkflowOutputPreview, type ThreadId, type WorkflowStepRun } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createAttachmentId, parseAttachmentUuid } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as WorkflowUrlCapture from "./WorkflowUrlCapture.ts";

type Previews = NonNullable<WorkflowStepRun["outputPreviews"]>;
const unavailable = { status: "unavailable" } as const;
const decodePreview = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkflowOutputPreview));
const encodePreview = Schema.encodeSync(Schema.fromJsonString(WorkflowOutputPreview));
const encodeKey = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const MAX_HTML_BYTES = 5 * 1024 * 1024;
/**
 * Previews cover project-relative HTML wherever the step's skill, note or checks put it, such as
 * `out/report.html` or the `.t3/workflows/out/...` default. Absolute paths and `..` escapes stay
 * unpreviewed: an agent may write anywhere, but T3 only reads inside the project.
 */
const isLocalHtml = (value: string) =>
  /\.html?$/i.test(value) &&
  URL.parse(value) === null &&
  !/^[\\/]|^[a-z][a-z\d+.-]*:/i.test(value) &&
  !value.split(/[\\/]/).includes("..");

export const pendingPreviews = (outputs: Readonly<Record<string, string>>): Previews =>
  Object.fromEntries(
    Object.entries(outputs).flatMap(([key, value]) => {
      const url = URL.parse(value);
      return (url && ["http:", "https:"].includes(url.protocol)) || isLocalHtml(value)
        ? [[key, { status: "pending" as const }]]
        : [];
    }),
  );

export class WorkflowOutputPreviews extends Context.Service<
  WorkflowOutputPreviews,
  {
    readonly prepare: (input: {
      readonly runId: string;
      readonly threadId: ThreadId;
      readonly outputs: Readonly<Record<string, string>>;
      readonly cwd?: string;
      readonly force?: boolean;
    }) => Effect.Effect<Previews>;
  }
>()("t3/workflows/WorkflowOutputPreviews") {}

const isWorkflowOutRelativePath = (output: string) =>
  output
    .replace(/^\.[\\/]/, "")
    .replaceAll("\\", "/")
    .startsWith(".t3/workflows/out/");

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const capture = yield* WorkflowUrlCapture.WorkflowUrlCapture;
  // One isolated browser at a time across all runs, without holding the runner's state lock.
  const gate = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "workflow-output-previews");
  const materializeAncestorWorkflowOutput = Effect.fnUntraced(function* (
    root: string,
    output: string,
  ) {
    if (!isWorkflowOutRelativePath(output)) return;
    const target = path.resolve(root, output);
    if (yield* fs.exists(target)) return;
    // Subagents working in a package subfolder of a monorepo sometimes write `.t3/workflows/out/...`
    // relative to the enclosing git root; copy that artifact into the project's own `.t3/workflows/out/`.
    let current = root;
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
      const hasRepoMarker =
        (yield* fs.exists(path.join(current, ".git"))) ||
        (yield* fs.exists(path.join(current, ".t3", "workflows")));
      if (!hasRepoMarker) continue;
      const candidate = path.resolve(current, output);
      if (!(yield* fs.exists(candidate))) continue;
      const info = yield* fs.stat(candidate).pipe(Effect.option);
      if (
        Option.isNone(info) ||
        info.value.type !== "File" ||
        info.value.size > BigInt(MAX_HTML_BYTES)
      )
        continue;
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.copyFile(candidate, target);
      return;
    }
  });
  const readHtml = Effect.fn("WorkflowOutputPreviews.readHtml")(function* (
    cwd: string | undefined,
    output: string,
  ) {
    if (cwd === undefined || !isLocalHtml(output) || path.isAbsolute(output)) return undefined;
    const root = yield* fs.realPath(cwd);
    yield* materializeAncestorWorkflowOutput(root, output).pipe(Effect.ignore);
    const file = yield* fs.realPath(path.resolve(root, output));
    const relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
      return undefined;
    const info = yield* fs.stat(file);
    if (info.type !== "File" || info.size > BigInt(MAX_HTML_BYTES)) return undefined;
    // Bound the read as well as the stat: an agent can still be updating the output.
    const chunks = yield* fs
      .stream(file, { bytesToRead: MAX_HTML_BYTES + 1 })
      .pipe(Stream.runCollect);
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (size > MAX_HTML_BYTES) return undefined;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(bytes);
  });
  const save = Effect.fn("WorkflowOutputPreviews.save")(
    (filePath: string, preview: WorkflowOutputPreview) =>
      writeFileStringAtomically({ filePath, contents: encodePreview(preview) }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      ),
  );
  const prepare: WorkflowOutputPreviews["Service"]["prepare"] = Effect.fn(
    "WorkflowOutputPreviews.prepare",
  )(function* (input) {
    const entries = yield* Effect.forEach(Object.keys(pendingPreviews(input.outputs)), (key) =>
      gate.withPermit(
        Effect.gen(function* () {
          const digest = NodeCrypto.createHash("sha256")
            .update(encodeKey([input.runId, input.outputs[key]!]))
            .digest("hex");
          const filePath = path.join(directory, `${digest}.json`);
          const cached = yield* fs.readFileString(filePath).pipe(
            Effect.asSome,
            Effect.catchTags({
              PlatformError: (cause) =>
                cause.reason._tag === "NotFound" ? Effect.succeedNone : Effect.fail(cause),
            }),
          );
          if (Option.isSome(cached)) {
            const decoded = yield* decodePreview(cached.value).pipe(Effect.option);
            if (Option.isSome(decoded) && decoded.value.status === "ready") {
              const attachmentId = decoded.value.attachmentId;
              const image =
                parseAttachmentUuid(attachmentId) === null
                  ? null
                  : resolveAttachmentRelativePath({
                      attachmentsDir: config.attachmentsDir,
                      relativePath: `${attachmentId}.jpg`,
                    });
              if (image !== null && (yield* fs.exists(image))) return decoded.value;
              if (!input.force) return unavailable;
            } else if (!input.force) {
              return unavailable;
            }
          }
          // Persist the attempt before opening Chrome. An interrupted/crashed attempt is not retried on restart.
          yield* save(filePath, unavailable);
          const attachmentId = createAttachmentId(input.threadId, "jpg");
          const image =
            attachmentId === null
              ? null
              : resolveAttachmentRelativePath({
                  attachmentsDir: config.attachmentsDir,
                  relativePath: `${attachmentId}.jpg`,
                });
          if (attachmentId === null || image === null) return unavailable;
          const output = input.outputs[key]!;
          const html = isLocalHtml(output) ? yield* readHtml(input.cwd, output) : undefined;
          if (isLocalHtml(output) && html === undefined) return unavailable;
          const bytes = yield* (
            html === undefined ? capture.capture(output) : capture.capture(output, html)
          ).pipe(Effect.timeout("25 seconds"));
          const preview = { status: "ready", attachmentId } as const;
          yield* fs.writeFile(image, bytes).pipe(
            Effect.uninterruptible,
            Effect.andThen(save(filePath, preview)),
            Effect.onError(() => fs.remove(image, { force: true }).pipe(Effect.ignore)),
          );
          return preview;
        }).pipe(
          Effect.orElseSucceed(() => unavailable),
          Effect.map((preview) => [key, preview] as const),
        ),
      ),
    );
    return Object.fromEntries(entries);
  });
  return WorkflowOutputPreviews.of({ prepare });
});

export const layer = Layer.effect(WorkflowOutputPreviews, make);
