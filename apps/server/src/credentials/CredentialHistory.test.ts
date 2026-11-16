import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CredentialId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as CredentialHistory from "./CredentialHistory.ts";

const layerHistory = (maxBytes?: number) =>
  CredentialHistory.layerWithMaxBytes(
    maxBytes ?? CredentialHistory.CREDENTIAL_HISTORY_MAX_BYTES,
  ).pipe(
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-credential-history-test-" }),
    ),
  );

const first = CredentialId.make("cred-first");
const second = CredentialId.make("cred-second");

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("CredentialHistory", (it) => {
  it.effect("returns pages newest first and continues from the cursor", () =>
    Effect.gen(function* () {
      const history = yield* CredentialHistory.CredentialHistory;
      for (const type of ["created", "renamed", "updated"] as const) {
        yield* history.record({ type, credentialId: first, credentialName: "Acme" });
      }

      const page = yield* history.read({ limit: 2 });
      assert.deepEqual(
        page.events.map((event) => event.type),
        ["updated", "renamed"],
      );
      assert.isDefined(page.nextCursor);

      const next = yield* history.read({ limit: 2, cursor: page.nextCursor });
      assert.deepEqual(
        next.events.map((event) => event.type),
        ["created"],
      );
      assert.isUndefined(next.nextCursor);
    }).pipe(Effect.provide(layerHistory())),
  );

  it.effect("filters by credential and leaves other credentials out", () =>
    Effect.gen(function* () {
      const history = yield* CredentialHistory.CredentialHistory;
      yield* history.record({ type: "created", credentialId: first, credentialName: "Acme" });
      yield* history.record({ type: "created", credentialId: second, credentialName: "Beta" });
      yield* history.record({ type: "deleted", credentialId: first, credentialName: "Acme" });

      const page = yield* history.read({ limit: 10, credentialId: first });
      assert.deepEqual(
        page.events.map((event) => event.type),
        ["deleted", "created"],
      );
      assert.equal((yield* history.read({ limit: 10 })).events.length, 3);
    }).pipe(Effect.provide(layerHistory())),
  );

  it.effect("rotates at the size limit and still reads across the rotation", () =>
    Effect.gen(function* () {
      const history = yield* CredentialHistory.CredentialHistory;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(config.stateDir, "credentials");

      for (let index = 0; index < 12; index += 1) {
        yield* history.record({
          type: "updated",
          credentialId: first,
          credentialName: `Credential number ${index}`,
        });
      }

      const rotated = yield* fileSystem.stat(path.join(directory, "history.1.jsonl"));
      assert.isAbove(Number(rotated.size), 0);
      // The limit is checked before each append, so the current file holds at most one more line.
      const currentSize = Number(
        (yield* fileSystem.stat(path.join(directory, "history.jsonl"))).size,
      );
      assert.isBelow(currentSize, 400 + 200);

      const page = yield* history.read({ limit: 100 });
      assert.equal(page.events[0]?.credentialName, "Credential number 11");
      // One backup is the whole bound: the oldest events are gone, not the newest.
      assert.isBelow(page.events.length, 12);
      assert.isAbove(page.events.length, 2);
    }).pipe(Effect.provide(layerHistory(400))),
  );

  it.effect("skips a corrupt line instead of losing the rest of the history", () =>
    Effect.gen(function* () {
      const history = yield* CredentialHistory.CredentialHistory;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(config.stateDir, "credentials", "history.jsonl");

      yield* history.record({ type: "created", credentialId: first, credentialName: "Acme" });
      yield* fileSystem.writeFileString(file, '{"not":"an event"}\n', { flag: "a" });
      yield* history.record({ type: "deleted", credentialId: first, credentialName: "Acme" });

      const page = yield* history.read({ limit: 10 });
      assert.deepEqual(
        page.events.map((event) => event.type),
        ["deleted", "created"],
      );
    }).pipe(Effect.provide(layerHistory())),
  );

  it.effect("does not fail a mutation when the history file cannot be written", () =>
    Effect.gen(function* () {
      const history = yield* CredentialHistory.CredentialHistory;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(config.stateDir, "credentials", "history.jsonl");

      yield* history.record({ type: "created", credentialId: first, credentialName: "Acme" });
      // A read-only history file makes the next append fail; the caller must not see that.
      yield* fileSystem.chmod(file, 0o400);
      yield* history.record({ type: "deleted", credentialId: first, credentialName: "Acme" });
      yield* fileSystem.chmod(file, 0o600);

      assert.deepEqual(
        (yield* history.read({ limit: 10 })).events.map((event) => event.type),
        ["created"],
      );
    }).pipe(Effect.provide(layerHistory())),
  );
});
