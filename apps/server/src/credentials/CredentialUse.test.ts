import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  CredentialId,
  ProjectId,
  ThreadId,
  type CredentialCaller,
  type CredentialPolicy,
  type WorkflowsSnapshot,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as WorkflowRunner from "../workflows/WorkflowRunner.ts";
import * as CredentialApprovals from "./CredentialApprovals.ts";
import * as CredentialCallerResolver from "./CredentialCaller.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialRedaction from "./CredentialRedaction.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";
import * as CredentialUse from "./CredentialUse.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";
import * as WorkflowCredentialPreapprovals from "./WorkflowCredentialPreapprovals.ts";

const sessionId = AuthSessionId.make("approver");
const threadId = ThreadId.make("thread-main");
const projectId = ProjectId.make("project");
const token = "value/a+private token";
const fileValue = "-----BEGIN KEY-----\nlineWithPrivateKey123\n-----END KEY-----";
const baseCaller: CredentialCaller = {
  threadId,
  projectId,
  threadTitle: "Release",
  provider: "codex",
  model: "gpt-6.1-sol",
  agentRole: "main",
};
const output: ProcessRunner.ProcessRunOutput = {
  stdout: "done",
  stderr: "",
  code: 0 as ProcessRunner.ProcessRunOutput["code"],
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
};
const fixture = Effect.fn("CredentialUseTest.fixture")(function* (
  options: {
    caller?: CredentialCaller;
    run?: ProcessRunner.ProcessRunner["Service"]["run"];
    policy?: CredentialPolicy;
    /** What the run's pinned step resolves to; "created" is this fixture's own credential. */
    attached?: ReadonlyArray<CredentialId> | "created";
  } = {},
) {
  let caller = options.caller ?? baseCaller;
  const runChanges = yield* Queue.unbounded<WorkflowsSnapshot>();
  const calls: ProcessRunner.ProcessRunInput[] = [];
  const vault = CredentialUnlock.layer.pipe(
    Layer.provideMerge(CredentialStore.layer.pipe(Layer.provideMerge(CredentialHistory.layer))),
    Layer.provide(
      Layer.succeed(CredentialVaultKey.CredentialVaultKey, {
        keyStorage: Effect.succeed("file" as const),
        vaultKey: Effect.succeed(new Uint8Array(32).fill(7)),
      }),
    ),
  );
  // Pre-approvals share the vault, and the approvals service reads them, so it comes first.
  const preapprovalLayer = WorkflowCredentialPreapprovals.layer.pipe(Layer.provideMerge(vault));
  const services = Layer.mergeAll(CredentialApprovals.layer, CredentialRedaction.layer).pipe(
    Layer.provideMerge(preapprovalLayer),
  );
  // Resolved by the workflow runner from the pinned step; assigned once the credential exists.
  let attachedIds: ReadonlyArray<CredentialId> = [];
  const layer = CredentialUse.layer.pipe(
    Layer.provideMerge(services),
    Layer.provide(Layer.succeed(HostProcess.Platform, "darwin")),
    Layer.provide(
      Layer.succeed(CredentialCallerResolver.CredentialCallerResolver, {
        resolve: () => Effect.succeed({ caller, cwd: process.cwd() }),
      }),
    ),
    Layer.provide(
      Layer.mock(WorkflowRunner.WorkflowRunner)({
        subscribeRuns: () => Stream.fromQueue(runChanges),
        attachedCredentialIds: () => Effect.succeed(attachedIds),
      }),
    ),
    Layer.provide(
      Layer.succeed(ProcessRunner.ProcessRunner, {
        run: (input) =>
          Effect.sync(() => calls.push(input)).pipe(
            Effect.andThen(options.run?.(input) ?? Effect.succeed(output)),
          ),
      }),
    ),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-credential-use-test-" }),
    ),
  );
  const context = yield* Layer.build(layer);
  const store = Context.get(context, CredentialStore.CredentialStore);
  const unlock = Context.get(context, CredentialUnlock.CredentialUnlock);
  const approvals = Context.get(context, CredentialApprovals.CredentialApprovals);
  const preapprovals = Context.get(
    context,
    WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals,
  );
  const use = Context.get(context, CredentialUse.CredentialUse);
  const history = Context.get(context, CredentialHistory.CredentialHistory);
  const config = Context.get(context, ServerConfig.ServerConfig);
  const fs = yield* FileSystem.FileSystem;
  const credential = yield* store.create({
    templateId: "custom",
    name: "Deploy",
    fields: [
      { id: "token", label: "Token", kind: "secret", envVar: "DEPLOY_TOKEN", required: true },
      { id: "key", label: "Key", kind: "secretFile", envVar: "KEY_PATH", required: true },
      { id: "url", label: "URL", kind: "text", envVar: "DEPLOY_URL", required: true },
    ],
    plainFields: { url: "https://private.example" },
    secrets: [
      { fieldId: "token", value: token },
      { fieldId: "key", base64: Buffer.from(fileValue).toString("base64") },
    ],
    policy: options.policy ?? { projects: "all", alwaysAsk: false, revealAllowed: false },
  });
  yield* unlock.setPin({ sessionId, newPin: "7294" });
  attachedIds =
    options.attached === undefined
      ? []
      : options.attached === "created"
        ? [credential.id]
        : options.attached;
  const pending = approvals.subscribe.pipe(
    Stream.filter((s) => s.pending.length > 0),
    Stream.map((s) => s.pending[0]!),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
  const exec = () =>
    use.exec({ credential: credential.id, command: 'deploy --key "$KEY_PATH"' }, threadId);
  const approve = Effect.fn("CredentialUseTest.approve")(function* (
    scope: "once" | "run" | "workflow" | "thread" = "once",
  ) {
    const request = yield* pending;
    yield* approvals.approve(request.id, scope, sessionId);
  });
  return {
    context,
    runChanges,
    use,
    store,
    unlock,
    approvals,
    preapprovals,
    history,
    credential,
    calls,
    pending,
    exec,
    approve,
    fs,
    root: `${config.stateDir}/credential-use`,
    vaultPath: `${config.stateDir}/credentials/credentials.json`,
    setCaller: (next: CredentialCaller) => {
      caller = next;
    },
  };
});
const workflowCaller = (runId = "run-1"): CredentialCaller => ({
  ...baseCaller,
  workflow: "release",
  runId,
  stepId: "upload",
  credentialApprovals: "once-per-run",
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("CredentialUse", (it) => {
  it.effect("never spawns an unapproved request, times out, and records denial", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      yield* f.pending;
      assert.lengthOf(f.calls, 0);
      yield* TestClock.adjust("10 minutes");
      const result = yield* Fiber.join(running);
      assert.isTrue(result._tag === "Failure" && result.failure.reason === "timed-out");
      assert.lengthOf(f.calls, 0);
      const events = yield* f.history.read({ limit: 10 });
      assert.equal(events.events[0]?.use?.result, "denied");
      assert.deepEqual((yield* f.approvals.snapshot).pending, []);
    }),
  );
  it.effect("withholds a legacy field whose env name is reserved and reports only its name", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      // Written before the reserved-name check: rename the URL field to PATH on disk.
      const document = JSON.parse(yield* f.fs.readFileString(f.vaultPath)) as {
        credentials: Array<{ fields: Array<{ id: string; envVar: string }> }>;
      };
      for (const field of document.credentials[0]!.fields) {
        if (field.id === "url") field.envVar = "PATH";
      }
      yield* f.fs.writeFileString(f.vaultPath, JSON.stringify(document));
      const running = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve();
      const result = yield* Fiber.join(running);
      assert.deepEqual(result.skippedEnvVars, ["PATH"]);
      assert.isUndefined(f.calls[0]?.env?.PATH);
      assert.equal(f.calls[0]?.env?.DEPLOY_TOKEN, token);
    }),
  );
  it.effect("reports a legacy reserved env name in file mode as well", () =>
    Effect.gen(function* () {
      const f = yield* fixture({ caller: workflowCaller() });
      // Written before the reserved-name check: rename the URL field to PATH on disk.
      const document = JSON.parse(yield* f.fs.readFileString(f.vaultPath)) as {
        credentials: Array<{ fields: Array<{ id: string; envVar: string }> }>;
      };
      for (const field of document.credentials[0]!.fields) {
        if (field.id === "url") field.envVar = "PATH";
      }
      yield* f.fs.writeFileString(f.vaultPath, JSON.stringify(document));
      const materializing = yield* f.use
        .file({ credential: f.credential.id }, threadId)
        .pipe(Effect.forkScoped);
      yield* f.approve("run");
      const files = yield* Fiber.join(materializing);
      assert.deepEqual(files.skippedEnvVars, ["PATH"]);
      assert.notProperty(files.plainFields, "PATH");
      assert.isTrue(yield* f.fs.exists(files.paths.KEY_PATH!));
    }),
  );
  it.effect("records denied requests without materializing or spawning", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      const result = yield* Fiber.join(running);
      assert.isTrue(result._tag === "Failure" && result.failure.reason === "not-approved");
      assert.lengthOf(f.calls, 0);
      assert.deepEqual(yield* f.fs.readDirectory(f.root), []);
      assert.equal((yield* f.history.read({ limit: 1 })).events[0]?.use?.decision, "denied");
    }),
  );
  it.effect("requires the approving and denying session to be unlocked", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      const lockedSession = AuthSessionId.make("other-session");
      assert.equal(
        (yield* f.approvals.approve(request.id, "once", lockedSession).pipe(Effect.flip))._tag,
        "CredentialAccessError",
      );
      assert.equal(
        (yield* f.approvals.deny(request.id, lockedSession).pipe(Effect.flip))._tag,
        "CredentialAccessError",
      );
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
    }),
  );
  it.effect("reuses run grants within one run, never across runs, and permits revocation", () =>
    Effect.gen(function* () {
      const f = yield* fixture({ caller: workflowCaller() });
      const first = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve("run");
      yield* Fiber.join(first);
      yield* f.exec();
      assert.lengthOf(f.calls, 2);
      const grants = yield* f.approvals.grants;
      const grant = grants[0];
      assert.equal(grant?.kind === "approval" ? grant.scope : undefined, "run");
      f.setCaller(workflowCaller("run-2"));
      const second = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(second);
      assert.lengthOf(f.calls, 2);
      yield* f.approvals.revoke(grants[0]!.id, sessionId);
      assert.deepEqual(yield* f.approvals.grants, []);
    }),
  );
  it.effect("always-ask overrides a previously issued grant", () =>
    Effect.gen(function* () {
      const f = yield* fixture({ caller: workflowCaller() });
      const first = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve("run");
      yield* Fiber.join(first);
      yield* f.store.update({
        id: f.credential.id,
        policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
      });
      const next = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      assert.isTrue(request.kind === "use");
      if (request.kind === "use") assert.deepEqual(request.allowedScopes, ["once"]);
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(next);
      assert.lengthOf(f.calls, 1);
    }),
  );
  it.effect("thread grants only apply to their thread", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const first = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve("thread");
      yield* Fiber.join(first);
      yield* f.exec();
      f.setCaller({ ...baseCaller, threadId: ThreadId.make("other") });
      const next = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(next);
      assert.lengthOf(f.calls, 2);
    }),
  );
  it.effect.each(["success", "failure", "interruption"] as const)(
    "uses private env and files and removes temp directory after %s",
    (result) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<ProcessRunner.ProcessRunInput>();
        const finish = yield* Deferred.make<void>();
        const f = yield* fixture({
          run: (input) =>
            Deferred.succeed(started, input).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.andThen(
                result === "failure"
                  ? Effect.fail(
                      new ProcessRunner.ProcessSpawnError({
                        command: "/bin/sh",
                        argumentCount: 1,
                        cause: token,
                      }),
                    )
                  : Effect.succeed({
                      ...output,
                      stdout: `${token}\n${Buffer.from(token).toString("base64")}\n${encodeURIComponent(token)}\n${fileValue}\nhttps://private.example`,
                    }),
              ),
            ),
        });
        const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
        yield* f.approve();
        const input = yield* Deferred.await(started);
        assert.equal(input.env?.DEPLOY_TOKEN, token);
        const filePath = input.env?.KEY_PATH ?? "";
        assert.equal(yield* f.fs.readFileString(filePath), fileValue);
        assert.equal((yield* f.fs.stat(filePath)).mode & 0o777, 0o600);
        const dir = filePath.slice(0, filePath.lastIndexOf("/"));
        assert.equal((yield* f.fs.stat(dir)).mode & 0o777, 0o700);
        assert.notInclude(JSON.stringify(input.args), token);
        assert.lengthOf((yield* f.approvals.snapshot).active, 1);
        if (result === "interruption") yield* Fiber.interrupt(running);
        else {
          yield* Deferred.succeed(finish, undefined);
          const actual = yield* Fiber.join(running);
          assert.notInclude(JSON.stringify(actual), token);
          assert.notInclude(JSON.stringify(actual), "lineWithPrivateKey123");
        }
        assert.isFalse(yield* f.fs.exists(dir));
        assert.deepEqual((yield* f.approvals.snapshot).active, []);
        assert.equal((yield* f.store.get(f.credential.id)).useCount, 1);
        const events = yield* f.history.read({ limit: 10 });
        assert.equal(events.events[0]?.type, "used");
        assert.notInclude(JSON.stringify(events), token);
      }),
  );
  it.effect("gives a secret file the extension a tool dispatches on", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<ProcessRunner.ProcessRunInput>();
      const finish = yield* Deferred.make<void>();
      const f = yield* fixture({
        run: (input) =>
          Deferred.succeed(started, input).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.andThen(Effect.succeed(output)),
          ),
      });
      const credential = yield* f.store.create({
        templateId: "google-service-account",
        name: "Google",
        secrets: [
          {
            fieldId: "json",
            base64: Buffer.from('{"type":"service_account"}').toString("base64"),
            fileName: "service-account.json",
          },
        ],
        policy: { projects: "all", alwaysAsk: false, revealAllowed: false },
      });
      const running = yield* f.use
        .exec(
          {
            credential: credential.id,
            command:
              'gcloud auth activate-service-account --key-file "$GOOGLE_APPLICATION_CREDENTIALS"',
          },
          threadId,
        )
        .pipe(Effect.forkScoped);
      yield* f.approve();
      const input = yield* Deferred.await(started);
      const filePath = input.env?.GOOGLE_APPLICATION_CREDENTIALS ?? "";
      assert.isTrue(filePath.endsWith("/json.json"), filePath);
      assert.equal(yield* f.fs.readFileString(filePath), '{"type":"service_account"}');
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(running);
      // The file tool materializes the same field, so it names the file the same way.
      f.setCaller(workflowCaller());
      const materializing = yield* f.use
        .file({ credential: credential.id }, threadId)
        .pipe(Effect.forkScoped);
      yield* f.approve("run");
      const files = yield* Fiber.join(materializing);
      const materialized = files.paths.GOOGLE_APPLICATION_CREDENTIALS ?? "";
      assert.isTrue(materialized.endsWith("/json.json"), materialized);
      assert.isTrue(yield* f.fs.exists(materialized));
    }),
  );
  it.effect("falls back to the extension the field accepts when the name has none", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const credential = yield* f.store.create({
        templateId: "google-service-account",
        name: "Google",
        secrets: [
          {
            fieldId: "json",
            base64: Buffer.from('{"type":"service_account"}').toString("base64"),
            fileName: "service-account.json",
          },
        ],
        policy: { projects: "all", alwaysAsk: false, revealAllowed: false },
      });
      // A vault written before the name was kept: only the accepted extension is left.
      const document = JSON.parse(yield* f.fs.readFileString(f.vaultPath)) as {
        credentials: Array<{
          name: string;
          fields: Array<{ id: string; secret?: { fileName?: string } }>;
        }>;
      };
      const google = document.credentials.find((record) => record.name === "Google");
      assert.isDefined(google);
      for (const field of google!.fields) {
        if (field.secret !== undefined) delete field.secret.fileName;
      }
      yield* f.fs.writeFileString(f.vaultPath, JSON.stringify(document));
      const stored = yield* f.store.get(credential.id);
      assert.isUndefined(stored.fields[0]?.secret?.fileName);
      const running = yield* f.use
        .exec(
          {
            credential: credential.id,
            command:
              'gcloud auth activate-service-account --key-file "$GOOGLE_APPLICATION_CREDENTIALS"',
          },
          threadId,
        )
        .pipe(Effect.forkScoped);
      yield* f.approve();
      yield* Fiber.join(running);
      const filePath = f.calls[0]?.env?.GOOGLE_APPLICATION_CREDENTIALS ?? "";
      assert.isTrue(filePath.endsWith("/json.json"), filePath);
    }),
  );
  it.effect("gives a secret file no extension when its own has none to keep", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<ProcessRunner.ProcessRunInput>();
      const finish = yield* Deferred.make<void>();
      const f = yield* fixture({
        run: (input) =>
          Deferred.succeed(started, input).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.andThen(Effect.succeed(output)),
          ),
      });
      const credential = yield* f.store.create({
        templateId: "custom",
        name: "Odd",
        fields: [
          { id: "key", label: "Key", kind: "secretFile", envVar: "ODD_KEY_PATH", required: true },
        ],
        secrets: [
          { fieldId: "key", base64: Buffer.from("odd").toString("base64"), fileName: "key.!!!" },
        ],
        policy: { projects: "all", alwaysAsk: false, revealAllowed: false },
      });
      const running = yield* f.use
        .exec({ credential: credential.id, command: 'deploy --key "$ODD_KEY_PATH"' }, threadId)
        .pipe(Effect.forkScoped);
      yield* f.approve();
      const input = yield* Deferred.await(started);
      const filePath = input.env?.ODD_KEY_PATH ?? "";
      assert.isTrue(filePath.endsWith("/key"), filePath);
      assert.equal(yield* f.fs.readFileString(filePath), "odd");
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(running);
    }),
  );
  it.effect("enforces project restrictions and never lists field values", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        policy: { projects: [ProjectId.make("elsewhere")], alwaysAsk: false, revealAllowed: false },
      });
      assert.equal((yield* f.exec().pipe(Effect.flip)).reason, "project-restricted");
      assert.lengthOf(f.calls, 0);
      const listing = yield* f.use.list(threadId);
      assert.isFalse(listing[0]?.usable);
      assert.notInclude(JSON.stringify(listing), token);
      assert.notInclude(JSON.stringify(listing), "https://private.example");
      assert.notInclude(JSON.stringify(listing), "value");
    }),
  );
  it.effect(
    "requires a run for file mode, keeps files only until TTL, and returns no text secrets",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        assert.equal(
          (yield* f.use.file({ credential: f.credential.id }, threadId).pipe(Effect.flip)).reason,
          "run-required",
        );
        f.setCaller(workflowCaller());
        const materializing = yield* f.use
          .file({ credential: f.credential.id }, threadId)
          .pipe(Effect.forkScoped);
        yield* f.approve("run");
        const files = yield* Fiber.join(materializing);
        assert.notInclude(JSON.stringify(files), token);
        assert.equal(files.plainFields.DEPLOY_URL, "https://private.example");
        const filePath = files.paths.KEY_PATH!;
        assert.isTrue(yield* f.fs.exists(filePath));
        yield* TestClock.adjust("1 hour");
        yield* f.approvals.subscribe.pipe(
          Stream.filter((s) => s.active.length === 0),
          Stream.take(1),
          Stream.runDrain,
        );
        assert.isFalse(yield* f.fs.exists(filePath));
      }),
  );
  it.effect("request waits for a matching save, decline or timeout", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        caller: { ...baseCaller, threadTitle: `Release ${token}`, stepTitle: `Upload ${token}` },
      });
      const requesting = yield* f.use
        .request({ name: "Deploy", templateId: "custom", reason: `Need deploy ${token}` }, threadId)
        .pipe(Effect.forkScoped);
      const request = yield* f.pending;
      assert.equal(request.kind, "add");
      assert.notInclude(JSON.stringify(request), token);
      yield* f.approvals.saved(request.id, f.credential);
      assert.deepEqual(yield* Fiber.join(requesting), {
        status: "saved",
        credentialId: f.credential.id,
      });
    }),
  );
  it.effect("reloads persisted grants and isolates workflow grants by project", () =>
    Effect.gen(function* () {
      const f = yield* fixture({ caller: workflowCaller() });
      const first = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve("workflow");
      yield* Fiber.join(first);
      const reloaded = yield* Layer.build(
        CredentialApprovals.layer.pipe(Layer.provide(Layer.succeedContext(f.context))),
      );
      assert.deepEqual(
        yield* Context.get(reloaded, CredentialApprovals.CredentialApprovals).grants,
        yield* f.approvals.grants,
      );
      f.setCaller(workflowCaller("run-2"));
      yield* f.exec();
      f.setCaller({ ...workflowCaller("run-3"), projectId: ProjectId.make("other-project") });
      const next = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(next);
      assert.lengthOf(f.calls, 2);
    }),
  );
  it.effect.each(["ask", "pre-approved"] as const)(
    "%s asks despite a run grant when no credentials are attached",
    (credentialApprovals) =>
      Effect.gen(function* () {
        const f = yield* fixture({ caller: workflowCaller() });
        const first = yield* f.exec().pipe(Effect.forkScoped);
        yield* f.approve("run");
        yield* Fiber.join(first);
        f.setCaller({ ...workflowCaller(), credentialApprovals });
        const next = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
        const request = yield* f.pending;
        if (request.kind === "use") assert.deepEqual(request.allowedScopes, ["once"]);
        assert.include(yield* f.approvals.approve(request.id, "run", sessionId).pipe(Effect.flip), {
          reason: "invalid-scope",
        });
        yield* f.approvals.deny(request.id, sessionId);
        yield* Fiber.join(next);
        assert.lengthOf(f.calls, 1);
      }),
  );
  it.effect("pre-approved covers a credential attached to the running step", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        caller: { ...workflowCaller(), credentialApprovals: "pre-approved" },
        attached: "created",
      });
      yield* f.preapprovals.grant(
        { projectId, workflow: "release", credentialIds: [f.credential.id] },
        sessionId,
      );
      yield* f.exec();
      assert.lengthOf(f.calls, 1);
      const events = yield* f.history.read({ limit: 10 });
      assert.equal(events.events[0]?.use?.decision, "policy");
      assert.deepEqual((yield* f.approvals.snapshot).pending, []);
    }),
  );
  it.effect("pre-approved asks when this machine never approved the attached credential", () =>
    Effect.gen(function* () {
      // The workflow file's knob alone authorizes nothing; readiness says so and the vault asks.
      const f = yield* fixture({
        caller: { ...workflowCaller(), credentialApprovals: "pre-approved" },
        attached: "created",
      });
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      if (request.kind === "use") assert.deepEqual(request.allowedScopes, ["once"]);
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
      assert.lengthOf(f.calls, 0);
    }),
  );
  it.effect("pre-approved asks for a credential attached after the approval", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        caller: { ...workflowCaller(), credentialApprovals: "pre-approved" },
        attached: "created",
      });
      // The user approved a different credential for this workflow, so this one is still new.
      yield* f.preapprovals.grant(
        { projectId, workflow: "release", credentialIds: [CredentialId.make("cred-approved")] },
        sessionId,
      );
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
      assert.lengthOf(f.calls, 0);
    }),
  );
  it.effect("withdrawing the pre-approval makes the next use ask", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        caller: { ...workflowCaller(), credentialApprovals: "pre-approved" },
        attached: "created",
      });
      yield* f.preapprovals.grant(
        { projectId, workflow: "release", credentialIds: [f.credential.id] },
        sessionId,
      );
      yield* f.exec();
      assert.lengthOf(f.calls, 1);

      // Withdrawn from the vault, the same workflow and credential must ask like any other.
      yield* f.preapprovals.revokeCredential({
        projectId,
        workflow: "release",
        credentialId: f.credential.id,
      });
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      if (request.kind === "use") assert.deepEqual(request.allowedScopes, ["once"]);
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
      assert.lengthOf(f.calls, 1);
    }),
  );
  it.effect("pre-approved asks when another workflow or project holds the grant", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        caller: { ...workflowCaller(), credentialApprovals: "pre-approved" },
        attached: "created",
      });
      yield* f.preapprovals.grant(
        { projectId, workflow: "another-workflow", credentialIds: [f.credential.id] },
        sessionId,
      );
      yield* f.preapprovals.grant(
        {
          projectId: ProjectId.make("another-project"),
          workflow: "release",
          credentialIds: [f.credential.id],
        },
        sessionId,
      );
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
      assert.lengthOf(f.calls, 0);
    }),
  );
  it.effect.each(["ask", "once-per-run"] as const)(
    "%s still asks for a credential attached to the running step",
    (credentialApprovals) =>
      Effect.gen(function* () {
        const f = yield* fixture({
          caller: { ...workflowCaller(), credentialApprovals },
          attached: "created",
        });
        const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
        const request = yield* f.pending;
        yield* f.approvals.deny(request.id, sessionId);
        yield* Fiber.join(running);
        assert.lengthOf(f.calls, 0);
      }),
  );
  it.effect("always-ask wins over pre-approved for an attached credential", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        caller: { ...workflowCaller(), credentialApprovals: "pre-approved" },
        attached: "created",
        policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
      });
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      if (request.kind === "use") assert.deepEqual(request.allowedScopes, ["once"]);
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
      assert.lengthOf(f.calls, 0);
    }),
  );
  it.effect("pre-approved asks when an attached credential is not the one being used", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        caller: { ...workflowCaller(), credentialApprovals: "pre-approved" },
        attached: [CredentialId.make("cred-other")],
      });
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
      assert.lengthOf(f.calls, 0);
    }),
  );

  it.effect("cleans interrupted requests and removes files when their run ends", () =>
    Effect.gen(function* () {
      const f = yield* fixture({ caller: workflowCaller() });
      const waiting = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.pending;
      yield* Fiber.interrupt(waiting);
      assert.deepEqual((yield* f.approvals.snapshot).pending, []);
      const materializing = yield* f.use
        .file({ credential: f.credential.id }, threadId)
        .pipe(Effect.forkScoped);
      yield* f.approve("once");
      const files = yield* Fiber.join(materializing);
      assert.isTrue(yield* f.fs.exists(files.paths.KEY_PATH!));
      yield* Queue.offer(f.runChanges, { workflows: [], runs: [] });
      yield* f.approvals.subscribe.pipe(
        Stream.filter((s) => s.active.length === 0),
        Stream.take(1),
        Stream.runDrain,
      );
      assert.isFalse(yield* f.fs.exists(files.paths.KEY_PATH!));
    }),
  );
  it.effect("withholds truncated output and rejects expired or incomplete credentials", () =>
    Effect.gen(function* () {
      const f = yield* fixture({
        run: () => Effect.succeed({ ...output, stdout: token.slice(0, 8), stdoutTruncated: true }),
      });
      const first = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve();
      assert.equal((yield* Fiber.join(first)).stdout, "[output truncated]");
      yield* f.store.update({ id: f.credential.id, expiresAt: "1960-01-01T00:00:00.000Z" });
      assert.equal((yield* f.exec().pipe(Effect.flip)).reason, "not-ready");
      yield* f.store.update({ id: f.credential.id, expiresAt: null });
      yield* f.store.removeSecret({ id: f.credential.id, fieldId: "token" });
      assert.equal((yield* f.exec().pipe(Effect.flip)).reason, "not-ready");
      assert.lengthOf(f.calls, 1);
    }),
  );
  it.effect.each(["declined", "timed-out"] as const)("add request can be %s", (answer) =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const requesting = yield* f.use
        .request({ reason: "Need a token" }, threadId)
        .pipe(Effect.forkScoped);
      const request = yield* f.pending;
      if (answer === "declined") yield* f.approvals.deny(request.id, sessionId);
      else yield* TestClock.adjust("10 minutes");
      assert.deepEqual(yield* Fiber.join(requesting), { status: answer });
    }),
  );
  it.effect("reuses the compiled matcher across uses and rebuilds after values change", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const redaction = Context.get(f.context, CredentialRedaction.CredentialRedaction);
      const original = yield* redaction.matcher();
      const first = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve();
      yield* Fiber.join(first);
      assert.strictEqual(yield* redaction.matcher(), original);
      yield* f.store.setSecret({
        id: f.credential.id,
        fieldId: "token",
        value: "replacementToken123",
      });
      const next = yield* redaction.matcher();
      assert.notStrictEqual(next, original);
      assert.equal(next("replacementToken123"), "[redacted]");
    }),
  );
  it.effect("offers run approval when the step is linked while the request waits", () =>
    Effect.gen(function* () {
      const finish = yield* Deferred.make<ProcessRunner.ProcessRunOutput>();
      const f = yield* fixture({ run: () => Deferred.await(finish) });
      const running = yield* f.exec().pipe(Effect.forkScoped);
      const request = yield* f.pending;
      assert.equal(request.kind, "use");
      if (request.kind === "use") assert.deepEqual(request.allowedScopes, ["once", "thread"]);

      const widened = yield* f.approvals.subscribe.pipe(
        Stream.filter((state) =>
          state.pending.some((item) => item.kind === "use" && item.allowedScopes.includes("run")),
        ),
        Stream.runHead,
        Effect.forkScoped,
      );
      // The driver's workflow_step_start links the delegated thread only after the request began.
      f.setCaller(workflowCaller());
      yield* Queue.offer(f.runChanges, { workflows: [], runs: [] });
      const linked = Option.getOrThrow(yield* Fiber.join(widened)).pending[0]!;
      assert.equal(linked.caller.runId, "run-1");
      assert.equal(linked.caller.stepId, "upload");

      yield* f.approvals.approve(linked.id, "run", sessionId);
      yield* Deferred.succeed(finish, output);
      yield* Fiber.join(running);
      const used = (yield* f.history.read({ limit: 10 })).events.find(
        (event) => event.type === "used",
      );
      assert.equal(used?.use?.runId, "run-1");
      assert.equal(used?.use?.stepId, "upload");
      assert.equal(used?.use?.workflow, "release");
      assert.equal(used?.use?.approvalScope, "run");
    }),
  );
  it.effect("fills a run into the used event when the link lands after the use starts", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<ProcessRunner.ProcessRunOutput>();
      const f = yield* fixture({
        run: () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))),
      });
      const running = yield* f.exec().pipe(Effect.forkScoped);
      yield* f.approve("once");
      yield* Deferred.await(started);
      // No run change is published: the finish re-resolution alone must notice the link.
      f.setCaller(workflowCaller());
      yield* Deferred.succeed(finish, output);
      yield* Fiber.join(running);
      const used = (yield* f.history.read({ limit: 10 })).events.find(
        (event) => event.type === "used",
      );
      assert.equal(used?.use?.runId, "run-1");
      assert.equal(used?.use?.stepId, "upload");
      assert.equal(used?.use?.workflow, "release");
      assert.equal(used?.use?.result, "ok");
    }),
  );
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("Credential decisions", (it) => {
  it.effect("broadcasts grant creation and revocation and records answers before execution", () =>
    Effect.gen(function* () {
      const finish = yield* Deferred.make<ProcessRunner.ProcessRunOutput>();
      const f = yield* fixture({ caller: workflowCaller(), run: () => Deferred.await(finish) });
      const running = yield* f.exec().pipe(Effect.forkScoped);
      const request = yield* f.pending;
      const before = (yield* f.approvals.snapshot).historyRevision;
      const changed = yield* f.approvals.subscribe.pipe(
        Stream.filter((state) => state.historyRevision > before),
        Stream.runHead,
        Effect.forkScoped,
      );
      yield* f.approvals.approve(request.id, "run", sessionId);
      assert.isTrue(Option.isSome(yield* Fiber.join(changed)));
      const approved = (yield* f.history.read({ limit: 10 })).events.find(
        (event) => event.type === "approved",
      );
      assert.equal(approved?.use?.approvalScope, "run");
      assert.equal(approved?.use?.approvalMethod, "unlock");
      assert.equal(approved?.use?.approverSessionId, sessionId);
      assert.equal(approved?.use?.threadId, threadId);
      assert.equal(approved?.use?.provider, "codex");
      assert.isFalse(
        (yield* f.history.read({ limit: 10 })).events.some((event) => event.type === "used"),
      );
      const revision = (yield* f.approvals.snapshot).historyRevision;
      const revoked = yield* f.approvals.subscribe.pipe(
        Stream.filter((state) => state.historyRevision > revision),
        Stream.runHead,
        Effect.forkScoped,
      );
      yield* f.approvals.revoke((yield* f.approvals.grants)[0]!.id, sessionId);
      assert.isTrue(Option.isSome(yield* Fiber.join(revoked)));
      assert.deepEqual(yield* f.approvals.grants, []);
      yield* Deferred.succeed(finish, output);
      yield* Fiber.join(running);
      assert.equal((yield* f.history.read({ limit: 1 })).events[0]?.use?.approvalScope, "run");
    }),
  );
  it.effect("writes a standalone denial with caller identity and session", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const running = yield* f.exec().pipe(Effect.result, Effect.forkScoped);
      const request = yield* f.pending;
      yield* f.approvals.deny(request.id, sessionId);
      yield* Fiber.join(running);
      const denied = (yield* f.history.read({ limit: 10 })).events.find(
        (event) => event.type === "denied",
      );
      assert.equal(denied?.use?.threadId, threadId);
      assert.equal(denied?.sessionId, sessionId);
      assert.equal(denied?.use?.decision, "denied");
      assert.equal(denied?.use?.approvalMethod, "unlock");
    }),
  );
});
