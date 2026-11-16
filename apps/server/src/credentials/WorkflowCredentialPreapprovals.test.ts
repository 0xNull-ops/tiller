import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, CredentialId, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialUnlock from "./CredentialUnlock.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";
import * as WorkflowCredentialPreapprovals from "./WorkflowCredentialPreapprovals.ts";

const sessionId = AuthSessionId.make("approver");
const otherSessionId = AuthSessionId.make("stranger");
const projectId = ProjectId.make("project");
const workflow = "release";
const credentialId = CredentialId.make("cred-github");
const otherCredentialId = CredentialId.make("cred-gitlab");

const vault = () =>
  CredentialUnlock.layer.pipe(
    Layer.provideMerge(CredentialStore.layer.pipe(Layer.provideMerge(CredentialHistory.layer))),
    Layer.provide(
      Layer.succeed(CredentialVaultKey.CredentialVaultKey, {
        keyStorage: Effect.succeed("file" as const),
        vaultKey: Effect.succeed(new Uint8Array(32).fill(7)),
      }),
    ),
  );

const layer = () =>
  WorkflowCredentialPreapprovals.layer.pipe(
    Layer.provideMerge(vault()),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-preapproval-test-" })),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("WorkflowCredentialPreapprovals", (it) => {
  it.effect(
    "records exactly the approved ids, per project and workflow, and survives a restart",
    () =>
      Effect.gen(function* () {
        const context = yield* Layer.build(layer());
        const preapprovals = Context.get(
          context,
          WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals,
        );
        const unlock = Context.get(context, CredentialUnlock.CredentialUnlock);
        yield* unlock.setPin({ sessionId, newPin: "7294" });
        assert.isTrue(
          yield* preapprovals.grant(
            { projectId, workflow, credentialIds: [credentialId, credentialId] },
            sessionId,
          ),
        );
        assert.deepEqual(yield* preapprovals.approved({ projectId, workflow }), [credentialId]);
        assert.isTrue(yield* preapprovals.covered({ projectId, workflow, credentialId }));
        assert.isFalse(
          yield* preapprovals.covered({
            projectId,
            workflow,
            credentialId: otherCredentialId,
          }),
        );
        // Another project's or workflow's approval never covers this one.
        assert.deepEqual(
          yield* preapprovals.approved({ projectId: ProjectId.make("other"), workflow }),
          [],
        );
        assert.deepEqual(yield* preapprovals.approved({ projectId, workflow: "other" }), []);

        const restarted = Context.get(
          yield* Layer.build(
            WorkflowCredentialPreapprovals.layer.pipe(Layer.provide(Layer.succeedContext(context))),
          ),
          WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals,
        );
        assert.deepEqual(yield* restarted.approved({ projectId, workflow }), [credentialId]);
      }),
  );

  it.effect("requires an unlocked session to grant, and never grants on a failed one", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(layer());
      const preapprovals = Context.get(
        context,
        WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals,
      );
      const unlock = Context.get(context, CredentialUnlock.CredentialUnlock);
      yield* unlock.setPin({ sessionId, newPin: "7294" });
      assert.isFalse(
        yield* preapprovals.grant(
          { projectId, workflow, credentialIds: [credentialId] },
          otherSessionId,
        ),
      );
      assert.deepEqual(yield* preapprovals.approved({ projectId, workflow }), []);
    }),
  );

  it.effect("revoking removes the approval without needing an unlock", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(layer());
      const preapprovals = Context.get(
        context,
        WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals,
      );
      const unlock = Context.get(context, CredentialUnlock.CredentialUnlock);
      yield* unlock.setPin({ sessionId, newPin: "7294" });
      yield* preapprovals.grant({ projectId, workflow, credentialIds: [credentialId] }, sessionId);
      yield* preapprovals.revoke({ projectId, workflow });
      assert.deepEqual(yield* preapprovals.approved({ projectId, workflow }), []);
      assert.isFalse(yield* preapprovals.covered({ projectId, workflow, credentialId }));
      // Revoking what was never granted is a no-op, so callers need not check first.
      yield* preapprovals.revoke({ projectId, workflow });
    }),
  );

  it.effect("lists what the vault shows, and withdrawing one credential keeps the rest", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(layer());
      const preapprovals = Context.get(
        context,
        WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals,
      );
      const unlock = Context.get(context, CredentialUnlock.CredentialUnlock);
      yield* unlock.setPin({ sessionId, newPin: "7294" });
      yield* preapprovals.grant(
        { projectId, workflow, credentialIds: [credentialId, otherCredentialId] },
        sessionId,
      );

      const [record] = yield* preapprovals.list;
      assert.equal(record?.projectId, projectId);
      assert.equal(record?.workflow, workflow);
      assert.equal(record?.approverSessionId, sessionId);
      assert.deepEqual(record?.credentialIds, [credentialId, otherCredentialId]);

      yield* preapprovals.revokeCredential({ projectId, workflow, credentialId });
      assert.deepEqual(yield* preapprovals.approved({ projectId, workflow }), [otherCredentialId]);
      assert.isFalse(yield* preapprovals.covered({ projectId, workflow, credentialId }));

      // The last id takes the record with it, so nothing empty is left for the vault to list.
      yield* preapprovals.revokeCredential({
        projectId,
        workflow,
        credentialId: otherCredentialId,
      });
      assert.deepEqual(yield* preapprovals.list, []);
    }),
  );

  it.effect("an empty approval clears what an earlier one covered", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(layer());
      const preapprovals = Context.get(
        context,
        WorkflowCredentialPreapprovals.WorkflowCredentialPreapprovals,
      );
      const unlock = Context.get(context, CredentialUnlock.CredentialUnlock);
      yield* unlock.setPin({ sessionId, newPin: "7294" });
      yield* preapprovals.grant({ projectId, workflow, credentialIds: [credentialId] }, sessionId);
      yield* preapprovals.grant({ projectId, workflow, credentialIds: [] }, sessionId);
      assert.deepEqual(yield* preapprovals.approved({ projectId, workflow }), []);
    }),
  );
});
