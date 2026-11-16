import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthCredentialsManageScope,
  AuthSessionId,
  CredentialId,
  ProjectId,
  WS_METHODS,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { rpcInstrumentationLayer } from "../observability/RpcInstrumentation.ts";
import * as CredentialApprovals from "./CredentialApprovals.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialRpc from "./credentialRpc.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";
import * as WorkflowCredentialPreapprovals from "./WorkflowCredentialPreapprovals.ts";

const session = AuthSessionId.make("session-a");

const layerVaultKey = Layer.succeed(CredentialVaultKey.CredentialVaultKey, {
  keyStorage: Effect.succeed("file" as const),
  vaultKey: Effect.succeed(Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1))),
});

const layerVault = () =>
  CredentialUnlock.layer.pipe(
    Layer.provideMerge(CredentialStore.layer.pipe(Layer.provideMerge(CredentialHistory.layer))),
  );

const layerServices = () => {
  const vault = layerVault();
  const preapprovals = WorkflowCredentialPreapprovals.layer.pipe(Layer.provideMerge(vault));
  return Layer.mergeAll(CredentialApprovals.layer).pipe(
    Layer.provideMerge(preapprovals),
    Layer.provide(layerVaultKey),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-credential-rpc-test-" }),
    ),
  );
};

/**
 * The client and every call it makes share one layer scope. Building the client on its own would
 * close the temp state directory as soon as `makeClient` returned.
 */
const layerClient = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  Layer.mergeAll(
    CredentialRpc.layer(session),
    RpcAuthorization.layer(scopes),
    rpcInstrumentationLayer,
  ).pipe(Layer.provideMerge(layerServices()));

const makeClient = () => RpcTest.makeClient(CredentialRpc.credentialGroup);

const SECRET = "ghp_superSecretTokenValue123";
const ROTATED = "ghp_rotatedTokenValue456";

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("credential RPC", (it) => {
  it.effect(
    "lets a terminal grant watch and answer approvals, as it reaches the keychain anyway",
    () =>
      Effect.gen(function* () {
        const rpc = yield* makeClient();
        assert.deepEqual(
          Option.getOrThrow(yield* rpc[WS_METHODS.credentialsSubscribe]({}).pipe(Stream.runHead)),
          { pending: [], active: [], historyRevision: 0 },
        );
        const error = yield* rpc[WS_METHODS.credentialsApprove]({
          requestId: "request",
          scope: "once",
        }).pipe(Effect.flip);
        assert.notEqual(error._tag, "EnvironmentAuthorizationError");
      }).pipe(Effect.provide(layerClient(["terminal:operate"]))),
  );
  it.effect("streams the initial live snapshot with the manage grant", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      assert.deepEqual(
        Option.getOrThrow(yield* rpc[WS_METHODS.credentialsSubscribe]({}).pipe(Stream.runHead)),
        { pending: [], active: [], historyRevision: 0 },
      );
    }).pipe(Effect.provide(layerClient([AuthCredentialsManageScope]))),
  );
  it.effect("refuses every credential call without the manage grant", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      const id = CredentialId.make("cred-1");

      const calls = [
        Effect.flip(rpc[WS_METHODS.credentialsStatus]({})),
        Effect.flip(rpc[WS_METHODS.credentialsList]({})),
        Effect.flip(rpc[WS_METHODS.credentialsGet]({ id })),
        Effect.flip(rpc[WS_METHODS.credentialsCreate]({ templateId: "github", name: "GitHub" })),
        Effect.flip(rpc[WS_METHODS.credentialsUpdate]({ id })),
        Effect.flip(rpc[WS_METHODS.credentialsSetSecret]({ id, fieldId: "token" })),
        Effect.flip(rpc[WS_METHODS.credentialsRemoveSecret]({ id, fieldId: "token" })),
        Effect.flip(rpc[WS_METHODS.credentialsDelete]({ id })),
        Effect.flip(rpc[WS_METHODS.credentialsHistory]({ limit: 1 })),
        Effect.flip(rpc[WS_METHODS.credentialsPinSet]({ newPin: "1234" })),
        Effect.flip(rpc[WS_METHODS.credentialsUnlock]({ pin: "1234" })),
        Effect.flip(rpc[WS_METHODS.credentialsLock]({})),
        Effect.flip(rpc[WS_METHODS.credentialsApprove]({ requestId: "pending", scope: "once" })),
        Effect.flip(rpc[WS_METHODS.credentialsDeny]({ requestId: "pending" })),
        Effect.flip(rpc[WS_METHODS.credentialsGrants]({})),
        Effect.flip(rpc[WS_METHODS.credentialsRevokeGrant]({ kind: "approval", grantId: "grant" })),
        Effect.flip(rpc[WS_METHODS.credentialsSubscribe]({}).pipe(Stream.runHead)),
      ];
      for (const call of calls) {
        const error = yield* call;
        assert.equal((error as { _tag: string })._tag, "EnvironmentAuthorizationError");
        assert.equal(
          (error as { requiredPermission: string }).requiredPermission,
          AuthCredentialsManageScope,
        );
      }
    }).pipe(Effect.provide(layerClient([]))),
  );
  it.effect("asks for a PIN before the first credential write", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      const error = yield* Effect.flip(
        rpc[WS_METHODS.credentialsCreate]({ templateId: "github", name: "GitHub" }),
      );
      assert.equal(error._tag, "CredentialPinRequiredError");
      assert.deepEqual(yield* rpc[WS_METHODS.credentialsList]({}), { credentials: [] });
    }).pipe(Effect.provide(layerClient([AuthCredentialsManageScope]))),
  );

  it.effect("lists and reads without an unlock, but writes only after one", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      yield* rpc[WS_METHODS.credentialsPinSet]({ newPin: "1234" });
      const created = yield* rpc[WS_METHODS.credentialsCreate]({
        templateId: "github",
        name: "GitHub",
        secrets: [{ fieldId: "token", value: SECRET }],
      });
      yield* rpc[WS_METHODS.credentialsLock]({});

      const listed = yield* rpc[WS_METHODS.credentialsList]({});
      assert.equal(listed.credentials.length, 1);
      assert.equal((yield* rpc[WS_METHODS.credentialsGet]({ id: created.id })).id, created.id);
      // The PIN event and the create; the history is scope-only, no unlock needed.
      const history = yield* rpc[WS_METHODS.credentialsHistory]({
        limit: 5,
        credentialId: created.id,
      });
      assert.deepEqual(
        history.events.map((event) => event.type),
        ["created"],
      );

      const denied = yield* Effect.flip(
        rpc[WS_METHODS.credentialsSetSecret]({
          id: created.id,
          fieldId: "token",
          value: ROTATED,
        }),
      );
      assert.equal(denied._tag, "CredentialAccessError");
      assert.equal((denied as { reason: string }).reason, "unlock-required");

      // Plain fields can redirect where a secret goes, so an edit needs the unlock too.
      const renameDenied = yield* Effect.flip(
        rpc[WS_METHODS.credentialsUpdate]({ id: created.id, name: "Renamed" }),
      );
      assert.equal((renameDenied as { reason: string }).reason, "unlock-required");

      yield* rpc[WS_METHODS.credentialsUnlock]({ pin: "1234" });
      const renamed = yield* rpc[WS_METHODS.credentialsUpdate]({ id: created.id, name: "Renamed" });
      assert.equal(renamed.name, "Renamed");
      const rotated = yield* rpc[WS_METHODS.credentialsSetSecret]({
        id: created.id,
        fieldId: "token",
        value: ROTATED,
      });
      assert.equal(rotated.fields[0]?.secret?.set, true);
    }).pipe(Effect.provide(layerClient([AuthCredentialsManageScope]))),
  );

  it.effect("never returns a secret value in any response", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      yield* rpc[WS_METHODS.credentialsPinSet]({ newPin: "1234" });

      const created = yield* rpc[WS_METHODS.credentialsCreate]({
        templateId: "app-store-connect",
        name: "App Store Connect",
        plainFields: { "key-id": "KEY123", "issuer-id": "ISSUER" },
        secrets: [
          {
            fieldId: "private-key",
            base64: Buffer.from(SECRET, "utf8").toString("base64"),
            fileName: "AuthKey.p8",
          },
        ],
      });

      const responses: Array<unknown> = [
        created,
        yield* rpc[WS_METHODS.credentialsStatus]({}),
        yield* rpc[WS_METHODS.credentialsList]({}),
        yield* rpc[WS_METHODS.credentialsGet]({ id: created.id }),
        yield* rpc[WS_METHODS.credentialsUpdate]({ id: created.id, notes: "rotated weekly" }),
        yield* rpc[WS_METHODS.credentialsSetSecret]({
          id: created.id,
          fieldId: "private-key",
          base64: Buffer.from(ROTATED, "utf8").toString("base64"),
          fileName: "AuthKey.p8",
        }),
        yield* rpc[WS_METHODS.credentialsHistory]({ limit: 20 }),
        yield* rpc[WS_METHODS.credentialsRemoveSecret]({
          id: created.id,
          fieldId: "private-key",
        }),
        yield* rpc[WS_METHODS.credentialsUnlock]({ pin: "1234" }),
        yield* rpc[WS_METHODS.credentialsLock]({}),
      ];
      // Locking above is part of the checked responses; deleting needs the vault open again.
      yield* rpc[WS_METHODS.credentialsUnlock]({ pin: "1234" });
      yield* rpc[WS_METHODS.credentialsDelete]({ id: created.id });

      const encoded = [
        ...responses.map((response) => JSON.stringify(response)),
        JSON.stringify(yield* rpc[WS_METHODS.credentialsList]({})),
      ].join("\n");
      for (const value of [SECRET, ROTATED]) {
        assert.notInclude(encoded, value);
        assert.notInclude(encoded, Buffer.from(value, "utf8").toString("base64"));
      }
      // The metadata still says a value is stored, and which file it came from.
      const field = created.fields.find((candidate) => candidate.id === "private-key");
      assert.deepEqual(field?.secret, {
        set: true,
        updatedAt: created.updatedAt,
        fileName: "AuthKey.p8",
        size: SECRET.length,
      });
    }).pipe(Effect.provide(layerClient([AuthCredentialsManageScope]))),
  );

  it.effect("lists and revokes a workflow pre-approval like any other grant", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
      const projectId = ProjectId.make("project-1");
      yield* rpc[WS_METHODS.credentialsPinSet]({ newPin: "1234" });
      const created = yield* rpc[WS_METHODS.credentialsCreate]({
        templateId: "github",
        name: "Release GitHub",
        secrets: [{ fieldId: "token", value: SECRET }],
      });
      assert.isTrue(
        yield* preapprovals.grant(
          { projectId, workflow: "release", credentialIds: [created.id] },
          session,
        ),
      );

      const granted = yield* rpc[WS_METHODS.credentialsGrants]({});
      assert.lengthOf(granted, 1);
      assert.deepEqual(granted[0], {
        kind: "workflow-preapproval",
        id: `workflow-preapproval:${projectId}:release:${created.id}`,
        credentialId: created.id,
        projectId,
        workflow: "release",
        approverSessionId: session,
        createdAt: (yield* preapprovals.list)[0]!.createdAt,
      });

      // Withdrawing authority is the same door as any other grant: the vault must be open.
      yield* rpc[WS_METHODS.credentialsLock]({});
      const denied = yield* Effect.flip(
        rpc[WS_METHODS.credentialsRevokeGrant]({
          kind: "workflow-preapproval",
          projectId,
          workflow: "release",
          credentialId: created.id,
        }),
      );
      assert.equal((denied as { reason?: string }).reason, "unlock-required");
      assert.lengthOf(yield* rpc[WS_METHODS.credentialsGrants]({}), 1);

      yield* rpc[WS_METHODS.credentialsUnlock]({ pin: "1234" });
      yield* rpc[WS_METHODS.credentialsRevokeGrant]({
        kind: "workflow-preapproval",
        projectId,
        workflow: "release",
        credentialId: created.id,
      });
      assert.deepEqual(yield* rpc[WS_METHODS.credentialsGrants]({}), []);
      assert.isFalse(
        yield* preapprovals.covered({ projectId, workflow: "release", credentialId: created.id }),
      );
    }).pipe(Effect.provide(layerClient([AuthCredentialsManageScope]))),
  );

  it.effect("reports the vault state for the calling session", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      yield* rpc[WS_METHODS.credentialsPinSet]({ newPin: "1234" });
      const status = yield* rpc[WS_METHODS.credentialsStatus]({});
      assert.isTrue(status.pinSet);
      assert.isString(status.unlockedUntil);
      assert.equal(status.keyStorage, "file");
    }).pipe(Effect.provide(layerClient([AuthCredentialsManageScope]))),
  );

  it.effect("drops the workflow pre-approvals of a deleted credential", () =>
    Effect.gen(function* () {
      const rpc = yield* makeClient();
      const preapprovals = yield* WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals;
      const projectId = ProjectId.make("project-1");
      yield* rpc[WS_METHODS.credentialsPinSet]({ newPin: "1234" });
      const deleted = yield* rpc[WS_METHODS.credentialsCreate]({
        templateId: "github",
        name: "Deleted GitHub",
        secrets: [{ fieldId: "token", value: SECRET }],
      });
      const kept = yield* rpc[WS_METHODS.credentialsCreate]({
        templateId: "github",
        name: "Kept GitHub",
        secrets: [{ fieldId: "token", value: ROTATED }],
      });
      assert.isTrue(
        yield* preapprovals.grant(
          { projectId, workflow: "release", credentialIds: [deleted.id, kept.id] },
          session,
        ),
      );
      assert.isTrue(
        yield* preapprovals.grant(
          { projectId, workflow: "deploy", credentialIds: [deleted.id] },
          session,
        ),
      );

      yield* rpc[WS_METHODS.credentialsDelete]({ id: deleted.id });

      // The record that covered another credential keeps it; the one that covered only the
      // deleted credential goes with it.
      const records = yield* preapprovals.list;
      assert.lengthOf(records, 1);
      assert.deepEqual(records[0]?.credentialIds, [kept.id]);
      assert.isFalse(
        yield* preapprovals.covered({ projectId, workflow: "release", credentialId: deleted.id }),
      );
      assert.isFalse(
        yield* preapprovals.covered({ projectId, workflow: "deploy", credentialId: deleted.id }),
      );
      assert.deepEqual(yield* rpc[WS_METHODS.credentialsGrants]({}), [
        {
          kind: "workflow-preapproval",
          id: `workflow-preapproval:${projectId}:release:${kept.id}`,
          credentialId: kept.id,
          projectId,
          workflow: "release",
          approverSessionId: session,
          createdAt: records[0]!.createdAt,
        },
      ]);
    }).pipe(Effect.provide(layerClient([AuthCredentialsManageScope]))),
  );
});
