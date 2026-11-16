import {
  CredentialApprovalGrant,
  CredentialUseError,
  type Credential,
  type CredentialActivity,
  type CredentialApprovalScope,
  type CredentialCaller,
  type CredentialGrant,
  type CredentialLiveState,
  type CredentialPendingRequest,
  type CredentialRequestInput,
  type CredentialRequestResult,
  type AuthSessionId,
  type CredentialId,
  type ProjectId,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ServerConfig from "../config.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";
import * as WorkflowCredentialPreapprovals from "./WorkflowCredentialPreapprovals.ts";

interface Decision {
  readonly scope: CredentialApprovalScope;
  readonly decision: "allowed" | "policy";
  readonly approverSessionId?: AuthSessionId;
  readonly approvalMethod?: "unlock";
}
type Answer =
  | { readonly type: "allow"; readonly decision: Decision }
  | { readonly type: "deny"; readonly sessionId: AuthSessionId }
  | { readonly type: "saved"; readonly credentialId: CredentialId };
const storageFailed = () => new CredentialUseError({ reason: "storage-failed" });
/** Grants written before the union carry no `kind`, and must stay readable. */
const readGrantSchema = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      ...CredentialApprovalGrant.fields,
      kind: Schema.optionalKey(Schema.Literal("approval")),
    }),
  ),
);
const writeGrantSchema = Schema.fromJsonString(Schema.Array(CredentialApprovalGrant));
const make = Effect.gen(function* () {
  const crypto = yield* SecureRandom.SecureRandom;
  const uuid = crypto.uuidV4().pipe(Effect.mapError(storageFailed));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const unlock = yield* CredentialUnlock.CredentialUnlock;
  const history = yield* CredentialHistory.CredentialHistory;
  const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
  const io = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const directory = path.join(config.stateDir, "credentials");
  const filePath = path.join(directory, "grants.json");
  const raw = yield* fs.readFileString(filePath).pipe(
    Effect.catchIf(
      (e) => e.reason._tag === "NotFound",
      () => Effect.succeed("[]"),
    ),
    Effect.mapError(storageFailed),
  );
  let grants: ReadonlyArray<CredentialApprovalGrant> = (yield* Schema.decodeEffect(readGrantSchema)(
    raw,
  ).pipe(Effect.mapError(storageFailed))).map((grant) => ({ ...grant, kind: "approval" }));
  const lock = yield* Semaphore.make(1);
  const state = yield* SubscriptionRef.make<CredentialLiveState>({
    pending: [],
    active: [],
    historyRevision: 0,
  });
  const waiting = new Map<
    string,
    { request: CredentialPendingRequest; answer: Deferred.Deferred<Answer> }
  >();
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  /**
   * Which approvals a credential can offer. A workflow use can widen from "once" to run or
   * workflow when the run becomes known, even while the request waits for its answer.
   */
  const allowedScopesFor = (
    credential: Credential,
    caller: CredentialCaller,
  ): ReadonlyArray<CredentialApprovalScope> => {
    const workflow = caller.runId !== undefined;
    const knob = caller.credentialApprovals ?? "once-per-run";
    return credential.policy.alwaysAsk || (workflow && knob !== "once-per-run")
      ? ["once"]
      : workflow
        ? ["once", "run", "workflow"]
        : ["once", "thread"];
  };
  const relink = Effect.fn("CredentialApprovals.relink")(function* (
    requestId: string,
    credential: Credential,
    caller: CredentialCaller,
  ) {
    const pending = waiting.get(requestId);
    if (pending?.request.kind !== "use") return;
    const previous = pending.request;
    if (
      previous.caller.runId === caller.runId &&
      previous.caller.stepId === caller.stepId &&
      previous.caller.workflow === caller.workflow &&
      previous.caller.credentialApprovals === caller.credentialApprovals &&
      previous.caller.threadTitle === caller.threadTitle &&
      previous.caller.stepTitle === caller.stepTitle
    )
      return;
    const request = { ...previous, caller, allowedScopes: allowedScopesFor(credential, caller) };
    waiting.set(requestId, { request, answer: pending.answer });
    yield* SubscriptionRef.update(state, (s) => ({
      ...s,
      pending: s.pending.map((item) => (item.id === requestId ? request : item)),
    }));
  });
  const save = Effect.fn("CredentialApprovals.save")(function* (
    next: ReadonlyArray<CredentialApprovalGrant>,
  ) {
    yield* fs
      .makeDirectory(directory, { recursive: true, mode: 0o700 })
      .pipe(Effect.mapError(storageFailed));
    const contents = yield* Schema.encodeEffect(writeGrantSchema)(next).pipe(
      Effect.mapError(storageFailed),
    );
    yield* writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provide(io),
      Effect.mapError(storageFailed),
    );
    yield* fs.chmod(filePath, 0o600).pipe(Effect.mapError(storageFailed));
    grants = next;
    yield* SubscriptionRef.update(state, (s) => ({ ...s, historyRevision: s.historyRevision + 1 }));
  });
  const wait = Effect.fn("CredentialApprovals.wait")(function* (
    request: CredentialPendingRequest,
    refresh?: {
      readonly credential: Credential;
      /** Re-resolved caller context while the request waits; a late step link widens the offer. */
      readonly callers: Stream.Stream<CredentialCaller>;
    },
  ) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const answer = yield* Deferred.make<Answer>();
        yield* Effect.acquireRelease(
          Effect.gen(function* () {
            if (waiting.size >= 100) return yield* new CredentialUseError({ reason: "busy" });
            waiting.set(request.id, { request, answer });
            yield* SubscriptionRef.update(state, (s) => ({
              ...s,
              pending: [...s.pending, request],
            }));
          }),
          () =>
            Effect.gen(function* () {
              waiting.delete(request.id);
              yield* SubscriptionRef.update(state, (s) => ({
                ...s,
                pending: s.pending.filter((p) => p.id !== request.id),
              }));
            }),
        );
        if (refresh !== undefined && request.kind === "use")
          yield* refresh.callers.pipe(
            Stream.runForEach((caller) => relink(request.id, refresh.credential, caller)),
            Effect.forkScoped,
          );
        return yield* Deferred.await(answer).pipe(Effect.timeoutOption("10 minutes"));
      }),
    );
  });
  const authorize = Effect.fn("CredentialApprovals.authorize")(function* (
    credential: Credential,
    activity: CredentialActivity,
    // 6C supplies attachments from the pinned step, never from the agent's input.
    attachedCredentialIds: () => ReadonlyArray<CredentialId> = () => [],
    // Supplied when the caller's workflow context can still change while the request waits.
    callers?: Stream.Stream<CredentialCaller>,
  ) {
    const caller = activity.caller;
    const workflow = caller.runId !== undefined;
    const knob = caller.credentialApprovals ?? "once-per-run";
    if (!credential.policy.alwaysAsk) {
      // The file's knob is only the user's intent. Authority is this machine's grant, which names
      // the exact ids the user approved, so a credential attached afterwards asks instead.
      if (
        workflow &&
        knob === "pre-approved" &&
        caller.workflow !== undefined &&
        attachedCredentialIds().includes(credential.id) &&
        (yield* preapprovals.covered({
          projectId: caller.projectId,
          workflow: caller.workflow,
          credentialId: credential.id,
        }))
      ) {
        return { decision: "policy", scope: "once" } satisfies Decision;
      }
      const grant = grants.find(
        (g) =>
          g.credentialId === credential.id &&
          g.projectId === caller.projectId &&
          (workflow && knob === "once-per-run"
            ? (g.scope === "run" && g.runId === caller.runId) ||
              (g.scope === "workflow" && g.workflow === caller.workflow)
            : !workflow && g.scope === "thread" && g.threadId === caller.threadId),
      );
      if (grant !== undefined)
        return {
          decision: "allowed",
          scope: grant.scope,
          approverSessionId: grant.approverSessionId,
          approvalMethod: "unlock",
        } satisfies Decision;
    }
    const allowedScopes = allowedScopesFor(credential, caller);
    const answered = yield* wait(
      { ...activity, kind: "use", allowedScopes },
      callers === undefined ? undefined : { credential, callers },
    );
    if (Option.isNone(answered)) return yield* new CredentialUseError({ reason: "timed-out" });
    if (answered.value.type !== "allow")
      return yield* new CredentialUseError({
        reason: "not-approved",
        ...(answered.value.type === "deny" ? { approverSessionId: answered.value.sessionId } : {}),
      });
    return answered.value.decision;
  });
  const recordAnswer = Effect.fn("CredentialApprovals.recordAnswer")(function* (
    request: Extract<CredentialPendingRequest, { kind: "use" }>,
    sessionId: AuthSessionId,
    scope?: CredentialApprovalScope,
  ) {
    yield* history.record({
      type: scope === undefined ? "denied" : "approved",
      credentialId: request.credentialId,
      credentialName: request.credentialName,
      sessionId,
      use: {
        ...request.caller,
        mode: request.mode,
        ...(request.commandPreview === undefined ? {} : { commandPreview: request.commandPreview }),
        decision: scope === undefined ? "denied" : "allowed",
        ...(scope === undefined ? {} : { approvalScope: scope }),
        approverSessionId: sessionId,
        approvalMethod: "unlock",
        result: scope === undefined ? "denied" : "ok",
      },
    });
    yield* SubscriptionRef.update(state, (s) => ({ ...s, historyRevision: s.historyRevision + 1 }));
  });
  const approve = Effect.fn("CredentialApprovals.approve")(function* (
    requestId: string,
    scope: CredentialApprovalScope,
    sessionId: AuthSessionId,
  ) {
    yield* unlock.requireUnlocked(sessionId);
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const pending = waiting.get(requestId);
        if (pending?.request.kind !== "use")
          return yield* new CredentialUseError({ reason: "not-found" });
        if (!pending.request.allowedScopes.includes(scope))
          return yield* new CredentialUseError({ reason: "invalid-scope" });
        const caller = pending.request.caller;
        if (scope !== "once") {
          yield* save([
            ...grants,
            {
              kind: "approval",
              id: yield* uuid,
              credentialId: pending.request.credentialId,
              scope,
              projectId: caller.projectId,
              threadId: caller.threadId,
              ...(caller.runId === undefined ? {} : { runId: caller.runId }),
              ...(caller.workflow === undefined ? {} : { workflow: caller.workflow }),
              approverSessionId: sessionId,
              approvalMethod: "unlock",
              createdAt: yield* now,
            },
          ]);
        }
        yield* recordAnswer(pending.request, sessionId, scope);
        waiting.delete(requestId);
        yield* Deferred.succeed(pending.answer, {
          type: "allow",
          decision: {
            decision: "allowed",
            scope,
            approverSessionId: sessionId,
            approvalMethod: "unlock",
          },
        });
      }),
    );
  });
  const deny = Effect.fn("CredentialApprovals.deny")(function* (
    requestId: string,
    sessionId: AuthSessionId,
  ) {
    yield* unlock.requireUnlocked(sessionId);
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const pending = waiting.get(requestId);
        if (pending === undefined) return yield* new CredentialUseError({ reason: "not-found" });
        if (pending.request.kind === "use") yield* recordAnswer(pending.request, sessionId);
        waiting.delete(requestId);
        yield* Deferred.succeed(pending.answer, { type: "deny", sessionId });
      }),
    );
  });
  const request = Effect.fn("CredentialApprovals.request")(function* (
    input: CredentialRequestInput,
    caller: CredentialCaller,
  ): Effect.fn.Return<CredentialRequestResult, CredentialUseError> {
    const answered = yield* wait({
      ...input,
      id: yield* uuid,
      kind: "add",
      caller,
      startedAt: yield* now,
    });
    if (Option.isNone(answered)) return { status: "timed-out" };
    return answered.value.type === "saved"
      ? { status: "saved", credentialId: answered.value.credentialId }
      : { status: "declined" };
  });
  const saved = Effect.fn("CredentialApprovals.saved")(function* (
    requestId: string,
    credential: Credential,
  ) {
    const pending = waiting.get(requestId);
    if (pending?.request.kind !== "add") return;
    if (
      pending.request.templateId !== undefined &&
      pending.request.templateId !== credential.templateId
    )
      return;
    if (pending.request.name !== undefined && pending.request.name !== credential.name) return;
    if (credential.status !== "ready" && credential.status !== "expiring") return;
    if (
      credential.policy.projects !== "all" &&
      !credential.policy.projects.includes(pending.request.caller.projectId)
    )
      return;
    waiting.delete(requestId);
    yield* Deferred.succeed(pending.answer, { type: "saved", credentialId: credential.id });
  });
  return {
    authorize,
    approve,
    deny,
    request,
    saved,
    subscribe: SubscriptionRef.changes(state),
    snapshot: SubscriptionRef.get(state),
    historyChanged: Effect.fn("CredentialApprovals.historyChanged")(() =>
      SubscriptionRef.update(state, (s) => ({ ...s, historyRevision: s.historyRevision + 1 })),
    ),
    /**
     * Everything a Settings → Credentials grant list can withdraw: the per-use approvals this
     * service owns, and one row per credential a workflow pre-approval covers. The pre-approval
     * lives in its own machine-local file, so the vault reads it rather than copying it here.
     */
    grants: Effect.gen(function* () {
      const records = yield* preapprovals.list;
      return [
        ...grants,
        ...records.flatMap((record) =>
          record.credentialIds.map((credentialId): CredentialGrant => ({
            kind: "workflow-preapproval",
            id: `workflow-preapproval:${record.projectId}:${record.workflow}:${credentialId}`,
            credentialId,
            projectId: record.projectId,
            workflow: record.workflow,
            approverSessionId: record.approverSessionId,
            createdAt: record.createdAt,
          })),
        ),
      ];
    }),
    revoke: Effect.fn("CredentialApprovals.revoke")(function* (
      id: string,
      sessionId: AuthSessionId,
    ) {
      yield* unlock.requireUnlocked(sessionId);
      yield* lock.withPermits(1)(Effect.suspend(() => save(grants.filter((g) => g.id !== id))));
    }),
    /**
     * Withdrawing a workflow pre-approval from the vault is the same door as any other grant:
     * the vault must be unlocked, and the workflow's readiness asks for re-approval afterwards.
     */
    revokePreapproval: Effect.fn("CredentialApprovals.revokePreapproval")(function* (
      input: {
        readonly projectId: ProjectId;
        readonly workflow: string;
        readonly credentialId: CredentialId;
      },
      sessionId: AuthSessionId,
    ) {
      yield* unlock.requireUnlocked(sessionId);
      yield* preapprovals.revokeCredential(input);
      yield* SubscriptionRef.update(state, (s) => ({
        ...s,
        historyRevision: s.historyRevision + 1,
      }));
    }),
    /**
     * Withdraws every workflow pre-approval that names a credential. A deleted credential
     * cannot be used, so a grant that still names it would claim authority over something the
     * vault no longer holds. The caller has already unlocked the vault to delete it.
     */
    revokePreapprovalsForCredential: Effect.fn(
      "CredentialApprovals.revokePreapprovalsForCredential",
    )(function* (credentialId: CredentialId) {
      yield* preapprovals.revokeCredentialEverywhere(credentialId);
      yield* SubscriptionRef.update(state, (s) => ({
        ...s,
        historyRevision: s.historyRevision + 1,
      }));
    }),
    start: Effect.fn("CredentialApprovals.start")((activity: CredentialActivity) =>
      SubscriptionRef.update(state, (s) => ({ ...s, active: [...s.active, activity] })),
    ),
    finish: Effect.fn("CredentialApprovals.finish")((id: string) =>
      SubscriptionRef.update(state, (s) => ({ ...s, active: s.active.filter((a) => a.id !== id) })),
    ),
  };
});
export class CredentialApprovals extends Context.Service<
  CredentialApprovals,
  Effect.Success<typeof make>
>()("t3/credentials/CredentialApprovals") {}
export const layer = Layer.effect(CredentialApprovals, make);
