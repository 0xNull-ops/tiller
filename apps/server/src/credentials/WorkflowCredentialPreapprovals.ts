import { AuthSessionId, CredentialId, ProjectId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../config.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";

/**
 * Portable workflow intent grants no authority by itself.
 * This local record names the exact credential ids approved on this machine.
 */
const PreapprovalRecord = Schema.Struct({
  projectId: ProjectId,
  workflow: Schema.String,
  credentialIds: Schema.Array(CredentialId),
  approverSessionId: AuthSessionId,
  createdAt: Schema.String,
});
type PreapprovalRecord = typeof PreapprovalRecord.Type;
const stored = Schema.fromJsonString(Schema.Array(PreapprovalRecord));

const key = (projectId: ProjectId, workflow: string) => `${projectId}\n${workflow}`;

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const unlock = yield* CredentialUnlock.CredentialUnlock;
  const io = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const directory = path.join(config.stateDir, "credentials");
  const filePath = path.join(directory, "workflow-preapprovals.json");
  const raw = yield* fs.readFileString(filePath).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed("[]"),
    ),
    Effect.orDie,
  );
  // A corrupt file must not take the server down; it grants nothing until the user re-approves.
  let records = yield* Schema.decodeEffect(stored)(raw).pipe(
    Effect.orElseSucceed((): ReadonlyArray<PreapprovalRecord> => []),
  );
  const lock = yield* Semaphore.make(1);
  // Readiness caches this grant, so every write names the project whose canvases must re-read it.
  const changes = yield* PubSub.unbounded<ProjectId>();
  const save = Effect.fnUntraced(function* (
    next: ReadonlyArray<PreapprovalRecord>,
    projectIds: ReadonlyArray<ProjectId>,
  ) {
    yield* fs
      .makeDirectory(directory, { recursive: true, mode: 0o700 })
      .pipe(Effect.orElseSucceed(() => undefined));
    const contents = yield* Schema.encodeEffect(stored)(next).pipe(Effect.orDie);
    yield* writeFileStringAtomically({ filePath, contents }).pipe(Effect.provide(io));
    yield* fs.chmod(filePath, 0o600).pipe(Effect.orElseSucceed(() => undefined));
    records = next;
    for (const projectId of projectIds) {
      yield* PubSub.publish(changes, projectId);
    }
  });
  const recordFor = (projectId: ProjectId, workflow: string) =>
    records.find((record) => key(record.projectId, record.workflow) === key(projectId, workflow));
  return {
    /** The exact ids covered for this workflow; empty when nothing was pre-approved here. */
    approved: (input: { readonly projectId: ProjectId; readonly workflow: string }) =>
      Effect.sync(() => recordFor(input.projectId, input.workflow)?.credentialIds ?? []),
    /** True only when this exact credential was approved for this workflow on this machine. */
    covered: (input: {
      readonly projectId: ProjectId;
      readonly workflow: string;
      readonly credentialId: CredentialId;
    }) =>
      Effect.sync(() =>
        (recordFor(input.projectId, input.workflow)?.credentialIds ?? []).includes(
          input.credentialId,
        ),
      ),
    /**
     * Records the ids the user just approved. False means nothing was granted: the vault was
     * locked or the write failed, so the caller refuses the edit rather than claim an approval
     * it never recorded.
     */
    grant: Effect.fn("WorkflowCredentialPreapprovals.grant")(function* (
      input: {
        readonly projectId: ProjectId;
        readonly workflow: string;
        readonly credentialIds: ReadonlyArray<CredentialId>;
      },
      sessionId: AuthSessionId,
    ) {
      const unlocked = yield* unlock.requireUnlocked(sessionId).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (!unlocked) return false;
      const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      return yield* lock
        .withPermits(1)(
          save(
            [
              ...records.filter(
                (record) =>
                  key(record.projectId, record.workflow) !== key(input.projectId, input.workflow),
              ),
              ...(input.credentialIds.length === 0
                ? []
                : [
                    {
                      projectId: input.projectId,
                      workflow: input.workflow,
                      credentialIds: [...new Set(input.credentialIds)],
                      approverSessionId: sessionId,
                      createdAt,
                    },
                  ]),
            ],
            [input.projectId],
          ).pipe(Effect.as(true)),
        )
        .pipe(Effect.orElseSucceed(() => false));
    }),
    /** Removing authority needs no unlock, and is a no-op when nothing was granted. */
    revoke: (input: { readonly projectId: ProjectId; readonly workflow: string }) =>
      lock
        .withPermits(1)(
          Effect.suspend(() => {
            const next = records.filter(
              (record) =>
                key(record.projectId, record.workflow) !== key(input.projectId, input.workflow),
            );
            return next.length === records.length ? Effect.void : save(next, [input.projectId]);
          }),
        )
        .pipe(Effect.orDie),
    /**
     * Withdraws one credential from a workflow's coverage, keeping the rest. The last id takes
     * the record with it, so an empty grant never lingers in the file. The vault gates this
     * behind an unlock; a workflow's own paths call `revoke` instead.
     */
    revokeCredential: (input: {
      readonly projectId: ProjectId;
      readonly workflow: string;
      readonly credentialId: CredentialId;
    }) =>
      lock
        .withPermits(1)(
          Effect.suspend(() => {
            const record = recordFor(input.projectId, input.workflow);
            if (record === undefined || !record.credentialIds.includes(input.credentialId))
              return Effect.void;
            const credentialIds = record.credentialIds.filter((id) => id !== input.credentialId);
            const next =
              credentialIds.length === 0
                ? records.filter(
                    (candidate) =>
                      key(candidate.projectId, candidate.workflow) !==
                      key(input.projectId, input.workflow),
                  )
                : records.map((candidate) =>
                    key(candidate.projectId, candidate.workflow) ===
                    key(input.projectId, input.workflow)
                      ? { ...candidate, credentialIds }
                      : candidate,
                  );
            return save(next, [input.projectId]);
          }),
        )
        .pipe(Effect.orDie),
    /**
     * Withdraws one credential from every workflow's coverage on this machine. A record that
     * covered nothing else goes with it, so an empty grant never lingers in the file.
     */
    revokeCredentialEverywhere: Effect.fn(
      "WorkflowCredentialPreapprovals.revokeCredentialEverywhere",
    )(function* (credentialId: CredentialId) {
      yield* lock
        .withPermits(1)(
          Effect.suspend(() => {
            const affected = records.filter((record) =>
              record.credentialIds.includes(credentialId),
            );
            if (affected.length === 0) return Effect.void;
            const next = records
              .map((record) => ({
                ...record,
                credentialIds: record.credentialIds.filter((id) => id !== credentialId),
              }))
              .filter((record) => record.credentialIds.length > 0);
            return save(
              next,
              affected.map((record) => record.projectId),
            );
          }),
        )
        .pipe(Effect.orDie);
    }),
    /** Every recorded approval, so the vault can list and withdraw them. */
    list: Effect.sync((): ReadonlyArray<PreapprovalRecord> => [...records]),
    /** Published after every write; readiness re-reads the project it names. */
    changes: Stream.fromPubSub(changes),
  };
});

export class WorkflowCredentialPreapprovals extends Context.Service<
  WorkflowCredentialPreapprovals,
  Effect.Success<typeof make>
>()("t3/credentials/WorkflowCredentialPreapprovals") {}
export const layer = Layer.effect(WorkflowCredentialPreapprovals, make);
