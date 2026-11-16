import {
  CredentialUseError,
  credentialEnvVarProblem,
  type Credential,
  type CredentialActivity,
  type CredentialAgentListing,
  type CredentialCaller as CredentialCallerInfo,
  type CredentialExecInput,
  type CredentialExecResult,
  type CredentialFileInput,
  type CredentialFileResult,
  type CredentialId,
  type CredentialRequestInput,
  type CredentialUseRecord,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { credentialTemplate, credentialTemplateField } from "@t3tools/shared/credentialTemplates";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as WorkflowRunner from "../workflows/WorkflowRunner.ts";
import { redactedOutputHead } from "./redactSecrets.ts";
import * as CredentialApprovals from "./CredentialApprovals.ts";
import * as CredentialCaller from "./CredentialCaller.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialRedaction from "./CredentialRedaction.ts";
import * as CredentialStore from "./CredentialStore.ts";

const storageError = () => new CredentialUseError({ reason: "storage-failed" });
/** The longest extension a materialized file carries, so the name stays short and predictable. */
const MAX_FILE_EXTENSION_LENGTH = 10;

/**
 * The extension after the last dot of the name the user uploaded, or nothing when the name has
 * no dot. The vault keeps that name, so it is the truth about what the file is.
 */
const uploadedExtension = (fileName: string | undefined): string | undefined => {
  if (fileName === undefined) return undefined;
  const name = fileName.trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? undefined : name.slice(dot + 1);
};

/**
 * A short lowercase token, so an extension can never carry a path separator or a character a
 * shell would read. An extension that sanitizes to nothing is no extension at all.
 */
const safeExtension = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_FILE_EXTENSION_LENGTH);
  return cleaned === "" ? undefined : cleaned;
};

/**
 * The name a secretFile field is materialized under. Tools dispatch on the extension, so a file
 * without one breaks them: the uploaded name's extension comes first, and a field that declares
 * accepted extensions falls back to the first one it accepts.
 */
const materializedFileName = (
  credential: Credential,
  field: Credential["fields"][number],
): string => {
  const declared = field.extensions ?? [];
  const template = credentialTemplate(credential.templateId);
  const templateField =
    template === undefined ? undefined : credentialTemplateField(template, field.id);
  const extension =
    safeExtension(uploadedExtension(field.secret?.fileName)) ??
    [...declared, ...(templateField?.extensions ?? [])]
      .map(safeExtension)
      .find((candidate) => candidate !== undefined);
  return extension === undefined ? field.id : `${field.id}.${extension}`;
};

/** The workflow fields a use record keeps; empty when the caller has no run. */
const workflowRecordFields = (caller: CredentialCallerInfo) => ({
  ...(caller.workflow === undefined ? {} : { workflow: caller.workflow }),
  ...(caller.runId === undefined ? {} : { runId: caller.runId }),
  ...(caller.stepId === undefined ? {} : { stepId: caller.stepId }),
  ...(caller.stepTitle === undefined ? {} : { stepTitle: caller.stepTitle }),
});
const redactedCaller = (
  caller: CredentialCallerInfo,
  redact: (text: string) => string,
): CredentialCallerInfo => ({
  ...caller,
  threadTitle: redact(caller.threadTitle),
  ...(caller.stepTitle === undefined ? {} : { stepTitle: redact(caller.stepTitle) }),
});
const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const store = yield* CredentialStore.CredentialStore;
  const approvals = yield* CredentialApprovals.CredentialApprovals;
  const identity = yield* CredentialCaller.CredentialCallerResolver;
  const redaction = yield* CredentialRedaction.CredentialRedaction;
  const history = yield* CredentialHistory.CredentialHistory;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const runner = yield* WorkflowRunner.WorkflowRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* SecureRandom.SecureRandom;
  const lifetime = yield* Scope.Scope;
  const root = path.join(config.stateDir, "credential-use");
  // Materialized files belong to this server lifetime, never a previous crashed process.
  yield* fs.remove(root, { recursive: true, force: true }).pipe(Effect.mapError(storageError));
  yield* fs
    .makeDirectory(root, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError(storageError));
  yield* fs.chmod(root, 0o700).pipe(Effect.mapError(storageError));
  const remove = (dir: string) =>
    fs.remove(dir, { recursive: true, force: true }).pipe(Effect.orDie);
  const resolve = Effect.fn("CredentialUse.resolve")(function* (
    name: string,
    threadId: ThreadId,
    hint?: CredentialCaller.CredentialCallerHint,
  ) {
    const context = yield* identity.resolve(threadId, hint);
    const credentials = yield* store.list().pipe(Effect.mapError(storageError));
    const matches = credentials.filter((c) => c.id === name || c.name === name);
    if (matches.length !== 1) return yield* new CredentialUseError({ reason: "not-found" });
    const credential = matches[0]!;
    if (
      credential.policy.projects !== "all" &&
      !credential.policy.projects.includes(context.caller.projectId)
    )
      return yield* new CredentialUseError({ reason: "project-restricted" });
    if (credential.status === "expired" || credential.status === "missing-field")
      return yield* new CredentialUseError({ reason: "not-ready" });
    return { ...context, credential };
  });
  const materialize = Effect.fn("CredentialUse.materialize")(function* (
    credential: Credential,
    dir: string,
  ) {
    yield* fs.chmod(dir, 0o700).pipe(Effect.mapError(storageError));
    const values: string[] = [];
    const env: Record<string, string> = {};
    const paths: Record<string, string> = {};
    const plainFields: Record<string, string> = {};
    const skippedEnvVars: string[] = [];
    for (const field of credential.fields) {
      // Saved before the reserved-name check existed, so writes can no longer produce this name.
      if (credentialEnvVarProblem(field.envVar) !== null) {
        skippedEnvVars.push(field.envVar);
        continue;
      }
      if (field.kind === "text") {
        values.push(field.value ?? "");
        env[field.envVar] = field.value ?? "";
        plainFields[field.envVar] = field.value ?? "";
      } else if (field.secret?.set) {
        const bytes = yield* store
          .readSecretValue({ id: credential.id, fieldId: field.id })
          .pipe(Effect.mapError(storageError));
        values.push(Buffer.from(bytes).toString("utf8"), Buffer.from(bytes).toString("base64"));
        if (field.kind === "secretFile") {
          const filePath = path.join(dir, materializedFileName(credential, field));
          yield* fs
            .writeFile(filePath, bytes, { mode: 0o600, flag: "wx" })
            .pipe(Effect.mapError(storageError));
          paths[field.envVar] = filePath;
          env[field.envVar] = filePath;
        } else env[field.envVar] = Buffer.from(bytes).toString("utf8");
      }
    }
    // A rotation can race materialization; protect the exact bytes handed to this command too.
    return {
      env,
      paths,
      plainFields,
      skippedEnvVars,
      redact: yield* redaction.include(values),
    };
  });
  const directory = fs
    .makeTempDirectory({ directory: root, prefix: "use-" })
    .pipe(Effect.mapError(storageError));
  /**
   * The pinned run's attached credentials, for the workflow's pre-approved knob. An unsupported
   * or unreadable run resolves nothing, so the request asks instead of approving silently.
   */
  const attachedIdsFor = (
    caller: CredentialCallerInfo,
  ): Effect.Effect<ReadonlyArray<CredentialId>> =>
    caller.runId === undefined
      ? Effect.succeed([])
      : runner
          .attachedCredentialIds({
            runId: caller.runId,
            ...(caller.stepId === undefined ? {} : { stepId: caller.stepId }),
          })
          .pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause as Cause.Cause<never>)
                : Effect.succeed([]),
            ),
          );
  const use = Effect.fn("CredentialUse.use")(function* <
    A extends CredentialExecResult | CredentialFileResult,
  >(
    name: string,
    threadId: ThreadId,
    mode: "exec" | "file",
    command: string | undefined,
    operation: (
      credential: Credential,
      context: Effect.Success<ReturnType<typeof resolve>>,
      activity: CredentialActivity,
    ) => Effect.Effect<A, CredentialUseError>,
    hint?: CredentialCaller.CredentialCallerHint,
  ) {
    const context = yield* resolve(name, threadId, hint);
    if (mode === "file" && context.caller.runId === undefined)
      return yield* new CredentialUseError({ reason: "run-required" });
    const redact = yield* redaction.matcher();
    const activity: CredentialActivity = {
      id: yield* crypto.uuidV4().pipe(Effect.mapError(storageError)),
      credentialId: context.credential.id,
      credentialName: redact(context.credential.name),
      templateId: context.credential.templateId,
      ...(context.credential.icon === undefined ? {} : { icon: context.credential.icon }),
      caller: redactedCaller(context.caller, redact),
      mode,
      ...(command === undefined ? {} : { commandPreview: redact(command).slice(0, 500) }),
      startedAt: yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    };
    // The step thread is linked only after its agent starts, so a caller with no run yet can gain
    // one while this request waits; re-resolve on every run change so the offer can widen.
    const callerChanges =
      context.caller.runId !== undefined
        ? undefined
        : runner.subscribeRuns({ projectId: context.caller.projectId }).pipe(
            Stream.mapEffect(() =>
              identity.resolve(threadId, hint).pipe(
                Effect.map((next) => redactedCaller(next.caller, redact)),
                Effect.option,
              ),
            ),
            Stream.filterMap((next) =>
              Option.isSome(next) ? Result.succeed(next.value) : Result.failVoid,
            ),
          );
    let record: CredentialUseRecord = {
      ...activity.caller,
      mode,
      startedAt: activity.startedAt,
      ...(activity.commandPreview === undefined ? {} : { commandPreview: activity.commandPreview }),
      fieldIds: context.credential.fields
        .filter((f) => (f.kind === "text" ? f.value !== undefined : f.secret?.set))
        .map((f) => f.id),
      decision: "denied",
      result: "denied",
    };
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const attachedIds = yield* attachedIdsFor(context.caller);
        const decision = yield* approvals
          .authorize(context.credential, activity, () => attachedIds, callerChanges)
          .pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (error.approverSessionId !== undefined)
                  record = {
                    ...record,
                    approverSessionId: error.approverSessionId,
                    approvalMethod: "unlock",
                  };
              }),
            ),
          );
        record = { ...record, ...decision, approvalScope: decision.scope, result: "error" };
        // Approval may have waited ten minutes. Recheck expiry, project policy and identity before use.
        const current = yield* resolve(context.credential.id, threadId, hint);
        const fingerprint = (c: Credential) =>
          JSON.stringify([c.fields, c.policy, c.expiresAt, c.name]);
        // A run that appeared while the request waited is the step link arriving, not a move to
        // another run; a run the caller already had must not change under the approval.
        const runMoved =
          context.caller.runId !== undefined && current.caller.runId !== context.caller.runId;
        if (fingerprint(current.credential) !== fingerprint(context.credential) || runMoved)
          return yield* new CredentialUseError({ reason: "not-approved" });
        record = { ...workflowRecordFields(redactedCaller(current.caller, redact)), ...record };
        const started = { ...activity, caller: redactedCaller(current.caller, redact) };
        yield* approvals.start(started);
        yield* store.markUsed(current.credential.id).pipe(Effect.mapError(storageError));
        const output = yield* operation(current.credential, current, started);
        record = {
          ...record,
          result: "exitCode" in output && output.exitCode !== 0 ? "error" : "ok",
          ...("exitCode" in output ? { exitCode: output.exitCode } : {}),
        };
        return output;
      }),
    ).pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (Exit.isFailure(exit) && record.decision !== "denied")
            record = { ...record, result: "error" };
          // The link can land after the use too; fill in the run it belongs to before recording.
          const final = yield* identity.resolve(threadId, hint).pipe(Effect.option);
          if (Option.isSome(final))
            record = {
              ...workflowRecordFields(redactedCaller(final.value.caller, redact)),
              ...record,
            };

          yield* history
            .record({
              type: "used",
              credentialId: activity.credentialId,
              credentialName: activity.credentialName,
              use: record,
            })
            .pipe(Effect.orDie);
          yield* approvals.historyChanged();
          if (mode !== "file" || Exit.isFailure(exit)) yield* approvals.finish(activity.id);
        }),
      ),
    );
  });
  const exec = Effect.fn("CredentialUse.exec")(function* (
    input: CredentialExecInput,
    threadId: ThreadId,
  ) {
    return yield* use(
      input.credential,
      threadId,
      "exec",
      input.command,
      (credential, context) =>
        Effect.scoped(
          Effect.gen(function* () {
            const dir = yield* Effect.acquireRelease(directory, remove);
            const {
              env,
              redact: originalRedact,
              skippedEnvVars,
            } = yield* materialize(credential, dir);
            // Send the script on stdin: even a literal value pasted into it cannot enter process argv.
            const output = yield* processRunner
              .run({
                command: platform === "win32" ? "cmd.exe" : "/bin/sh",
                args: platform === "win32" ? ["/d", "/q"] : ["-s"],
                stdin: input.command,
                cwd: input.cwd === undefined ? context.cwd : path.resolve(context.cwd, input.cwd),
                env,
                timeout: `${input.timeoutSec ?? 60} seconds`,
                maxOutputBytes: 256 * 1024,
                outputMode: "truncate",
                timeoutBehavior: "timedOutResult",
              })
              .pipe(Effect.mapError(() => new CredentialUseError({ reason: "execution-failed" })));
            const redact = yield* redaction.matcher();
            return {
              exitCode: output.code === null ? null : Number(output.code),
              stdout: redactedOutputHead(
                output.stdout,
                output.stdoutTruncated,
                originalRedact,
                redact,
              ),
              stderr: output.timedOut
                ? "Command timed out."
                : redactedOutputHead(output.stderr, output.stderrTruncated, originalRedact, redact),
              truncated: output.stdoutTruncated || output.stderrTruncated,
              skippedEnvVars,
            };
          }),
        ),
      { runId: input.runId, stepId: input.stepId },
    );
  });
  const file = Effect.fn("CredentialUse.file")(function* (
    input: CredentialFileInput,
    threadId: ThreadId,
  ) {
    return yield* use(
      input.credential,
      threadId,
      "file",
      undefined,
      (credential, context, activity) =>
        Effect.gen(function* () {
          const fileScope = yield* Scope.fork(lifetime);
          yield* Scope.addFinalizer(fileScope, approvals.finish(activity.id));
          return yield* Effect.gen(function* () {
            const dir = yield* Effect.acquireRelease(directory, remove);
            const materialized = yield* materialize(credential, dir);
            const runEnded = runner.subscribeRuns({ projectId: context.caller.projectId }).pipe(
              Stream.filter(
                (s) =>
                  !s.runs.some(
                    (r) =>
                      r.id === context.caller.runId &&
                      (r.status === "running" || r.status === "waiting"),
                  ),
              ),
              Stream.take(1),
              Stream.runDrain,
            );
            yield* runEnded.pipe(
              Effect.timeoutOrElse({ duration: "1 hour", orElse: () => Effect.void }),
              Effect.ensuring(Scope.close(fileScope, Exit.void)),
              Effect.forkIn(lifetime),
            );
            return {
              paths: materialized.paths,
              plainFields: materialized.plainFields,
              skippedEnvVars: materialized.skippedEnvVars,
            };
          }).pipe(
            Scope.provide(fileScope),
            Effect.onExit((exit) =>
              Exit.isFailure(exit) ? Scope.close(fileScope, Exit.void) : Effect.void,
            ),
          );
        }),
      { runId: input.runId, stepId: input.stepId },
    );
  });
  return {
    exec,
    file,
    list: Effect.fn("CredentialUse.list")(function* (
      threadId: ThreadId,
    ): Effect.fn.Return<CredentialAgentListing, CredentialUseError> {
      const { caller } = yield* identity.resolve(threadId);
      return (yield* store.list().pipe(Effect.mapError(storageError))).map((c) => ({
        id: c.id,
        name: c.name,
        templateId: c.templateId,
        status: c.status,
        policy: c.policy,
        usable:
          (c.policy.projects === "all" || c.policy.projects.includes(caller.projectId)) &&
          c.status !== "expired" &&
          c.status !== "missing-field",
        fields: c.fields.map((f) => ({
          id: f.id,
          kind: f.kind,
          envVar: f.envVar,
          set: f.kind === "text" ? (f.value ?? "") !== "" : f.secret?.set === true,
        })),
      }));
    }),
    request: Effect.fn("CredentialUse.request")(function* (
      input: CredentialRequestInput,
      threadId: ThreadId,
    ) {
      const { caller } = yield* identity.resolve(threadId);
      const redact = yield* redaction.matcher();
      return yield* approvals.request(
        {
          ...input,
          reason: redact(input.reason),
          ...(input.name === undefined ? {} : { name: redact(input.name) }),
        },
        {
          ...caller,
          threadTitle: redact(caller.threadTitle),
          ...(caller.stepTitle === undefined ? {} : { stepTitle: redact(caller.stepTitle) }),
        },
      );
    }),
  };
});
export class CredentialUse extends Context.Service<CredentialUse, Effect.Success<typeof make>>()(
  "t3/credentials/CredentialUse",
) {}
export const layer = Layer.effect(CredentialUse, make);
