import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CredentialId, type CredentialCreateInput } from "@t3tools/contracts";
import { parseEnvBundle } from "@t3tools/shared/credentialTemplates";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as CredentialHistory from "./CredentialHistory.ts";
import * as CredentialRedaction from "./CredentialRedaction.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as CredentialVaultKey from "./CredentialVaultKey.ts";

const VAULT_KEY = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));

const layerVaultKey = Layer.succeed(CredentialVaultKey.CredentialVaultKey, {
  keyStorage: Effect.succeed("file" as const),
  vaultKey: Effect.succeed(VAULT_KEY),
});

const layerStore = () =>
  CredentialStore.layer.pipe(
    Layer.provideMerge(CredentialHistory.layer),
    Layer.provide(layerVaultKey),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-credential-store-test-" }),
    ),
  );

const layerStoreWithRedaction = () =>
  CredentialRedaction.layer.pipe(Layer.provideMerge(layerStore()));

const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----";
const base64Of = (text: string) => Buffer.from(text, "utf8").toString("base64");

const appStoreConnect = (
  overrides: Partial<CredentialCreateInput> = {},
): CredentialCreateInput => ({
  templateId: "app-store-connect",
  name: "App Store Connect — Acme",
  plainFields: { "key-id": "KEY123", "issuer-id": "ISSUER" },
  secrets: [{ fieldId: "private-key", base64: base64Of(PRIVATE_KEY), fileName: "AuthKey.p8" }],
  ...overrides,
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("CredentialStore", (it) => {
  it.effect("seals a secret, keeps it out of metadata, and removes it with the credential", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const created = yield* store.create(appStoreConnect());
      assert.equal(created.status, "ready");
      assert.equal(created.name, "App Store Connect — Acme");
      assert.equal(created.useCount, 0);
      const keyId = created.fields.find((field) => field.id === "key-id");
      assert.equal(keyId?.value, "KEY123");
      const privateKey = created.fields.find((field) => field.id === "private-key");
      assert.deepEqual(privateKey?.secret, {
        set: true,
        updatedAt: created.updatedAt,
        fileName: "AuthKey.p8",
        size: Buffer.byteLength(PRIVATE_KEY),
      });
      assert.isUndefined(privateKey?.value);

      // Metadata carries state, never a value.
      const metadata = yield* fileSystem.readFileString(
        path.join(config.stateDir, "credentials", "credentials.json"),
      );
      assert.notInclude(metadata, PRIVATE_KEY);
      assert.notInclude(metadata, "BEGIN PRIVATE KEY");
      assert.notInclude(metadata, base64Of(PRIVATE_KEY));

      // The stored blob is ciphertext, not the key body.
      const blobName = `credential-${created.id}-private-key`;
      const blob = Option.getOrThrow(yield* secretStore.get(blobName));
      assert.notInclude(Buffer.from(blob).toString("utf8"), "BEGIN PRIVATE KEY");

      const value = yield* store.readSecretValue({ id: created.id, fieldId: "private-key" });
      assert.equal(new TextDecoder().decode(value), PRIVATE_KEY);

      yield* store.delete(created.id);
      assert.deepEqual(yield* store.list(), []);
      assert.isTrue(Option.isNone(yield* secretStore.get(blobName)));
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("refuses to open a value that was copied onto another field", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const created = yield* store.create({
        templateId: "custom",
        name: "Two secrets",
        fields: [
          { id: "first", label: "First", kind: "secret", envVar: "FIRST" },
          { id: "second", label: "Second", kind: "secret", envVar: "SECOND" },
        ],
        secrets: [
          { fieldId: "first", value: "first-value" },
          { fieldId: "second", value: "second-value" },
        ],
      });

      const firstBlob = Option.getOrThrow(yield* secretStore.get(`credential-${created.id}-first`));
      // AAD binds a ciphertext to its field, so a swapped blob must not decrypt.
      yield* secretStore.set(`credential-${created.id}-second`, firstBlob);
      const error = yield* Effect.flip(
        store.readSecretValue({ id: created.id, fieldId: "second" }),
      );
      assert.equal(error.reason, "store-failed");
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("derives expired, missing-field, expiring and ready from the record", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const now = yield* DateTime.now;
      const inDays = (days: number) => DateTime.formatIso(DateTime.add(now, { days }));

      const created = yield* store.create(appStoreConnect({ expiresAt: inDays(10) }));
      assert.equal(created.status, "expiring");

      const expired = yield* store.update({ id: created.id, expiresAt: inDays(-1) });
      assert.equal(expired.status, "expired");

      const missing = yield* store.update({
        id: created.id,
        expiresAt: inDays(60),
        plainFields: { "key-id": "" },
      });
      assert.equal(missing.status, "missing-field");

      const ready = yield* store.update({
        id: created.id,
        expiresAt: null,
        plainFields: { "key-id": "KEY123" },
      });
      assert.equal(ready.status, "ready");
      assert.isUndefined(ready.expiresAt);

      const withoutSecret = yield* store.removeSecret({
        id: created.id,
        fieldId: "private-key",
      });
      assert.equal(withoutSecret.status, "missing-field");
      const field = withoutSecret.fields.find((candidate) => candidate.id === "private-key");
      assert.deepEqual(field?.secret, { set: false });
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("reports a missing required field ahead of an upcoming expiry", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const now = yield* DateTime.now;
      const inDays = (days: number) => DateTime.formatIso(DateTime.add(now, { days }));

      const created = yield* store.create(appStoreConnect({ expiresAt: inDays(1) }));
      assert.equal(created.status, "expiring");

      const incomplete = yield* store.update({ id: created.id, plainFields: { "key-id": "" } });
      assert.equal(incomplete.status, "missing-field");
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("rejects a wrong file type, a value on the wrong kind, and an unknown template", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;

      const wrongType = yield* Effect.flip(
        store.create(
          appStoreConnect({
            secrets: [
              { fieldId: "private-key", base64: base64Of("{}"), fileName: "service-account.json" },
            ],
          }),
        ),
      );
      assert.equal(wrongType.reason, "file-type-not-allowed");

      const tooLarge = yield* Effect.flip(
        store.create(
          appStoreConnect({
            secrets: [
              {
                fieldId: "private-key",
                base64: Buffer.alloc(32 * 1024).toString("base64"),
                fileName: "AuthKey.p8",
              },
            ],
          }),
        ),
      );
      assert.equal(tooLarge.reason, "file-too-large");

      const plainForSecret = yield* Effect.flip(
        store.create(
          appStoreConnect({
            plainFields: { "key-id": "KEY123", "issuer-id": "ISSUER", "private-key": "x" },
          }),
        ),
      );
      assert.equal(plainForSecret.reason, "field-not-text");

      const secretForKeyId = yield* Effect.flip(
        store.create(appStoreConnect({ secrets: [{ fieldId: "key-id", value: "x" }] })),
      );
      assert.equal(secretForKeyId.reason, "field-not-secret");

      const unknown = yield* Effect.flip(
        store.create(appStoreConnect({ templateId: "not-a-template" })),
      );
      assert.equal(unknown.reason, "unknown-template");

      const missing = yield* Effect.flip(store.create({ templateId: "github", name: "GitHub" }));
      assert.equal(missing.reason, "missing-field");
      assert.equal(missing.fieldId, "token");

      assert.deepEqual(yield* store.list(), []);
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("turns a pasted .env bundle into secret fields", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const entries = parseEnvBundle("STRIPE_SECRET_KEY=sk_live_123\nAPI_URL=https://example.test");
      const created = yield* store.create({
        templateId: "env-bundle",
        name: "Site .env",
        fields: entries.map((entry) => ({
          id: entry.key,
          label: entry.key,
          kind: "secret" as const,
          envVar: entry.key,
        })),
        secrets: entries.map((entry) => ({ fieldId: entry.key, value: entry.value })),
      });

      assert.equal(created.status, "ready");
      assert.deepEqual(
        created.fields.map((field) => [field.id, field.kind, field.secret?.set]),
        [
          ["STRIPE_SECRET_KEY", "secret", true],
          ["API_URL", "secret", true],
        ],
      );
      const value = yield* store.readSecretValue({ id: created.id, fieldId: "API_URL" });
      assert.equal(new TextDecoder().decode(value), "https://example.test");
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("records each change in the history without ever writing a value", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const history = yield* CredentialHistory.CredentialHistory;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const created = yield* store.create(appStoreConnect());
      yield* store.update({ id: created.id, name: "Renamed" });
      yield* store.update({
        id: created.id,
        policy: { projects: "all", alwaysAsk: false, revealAllowed: false },
      });
      yield* store.setSecret({
        id: created.id,
        fieldId: "private-key",
        base64: base64Of("rotated-key-body"),
        fileName: "AuthKey.p8",
      });
      yield* store.removeSecret({ id: created.id, fieldId: "private-key" });
      yield* store.delete(created.id);

      const page = yield* history.read({ limit: 20 });
      assert.deepEqual(
        page.events.map((event) => event.type),
        ["deleted", "secret-removed", "secret-replaced", "policy-changed", "renamed", "created"],
      );
      assert.equal(page.events.at(-1)?.credentialId, created.id);

      const raw = yield* fileSystem.readFileString(
        path.join(config.stateDir, "credentials", "history.jsonl"),
      );
      assert.notInclude(raw, "rotated-key-body");
      assert.notInclude(raw, PRIVATE_KEY);
      for (const line of raw.trim().split("\n")) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        assert.notProperty(parsed, "value");
        assert.notProperty(parsed, "secret");
      }
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("reports a missing credential instead of inventing one", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const error = yield* Effect.flip(store.get(CredentialId.make("cred-missing")));
      assert.equal(error.reason, "not-found");
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("injects a built-in template's field under another environment variable", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;

      const created = yield* store.create({
        templateId: "github",
        name: "GitHub — deploy",
        fields: [{ id: "token", label: "Token", kind: "secret", envVar: "GH_TOKEN" }],
        secrets: [{ fieldId: "token", value: "ghp_deploy" }],
      });
      assert.deepEqual(
        created.fields.map((field) => [field.id, field.envVar, field.required]),
        [["token", "GH_TOKEN", true]],
      );

      const renamed = yield* store.update({
        id: created.id,
        fields: [{ id: "token", label: "Deploy token", kind: "secret", envVar: "GH_TOKEN" }],
      });
      assert.equal(renamed.fields[0]?.label, "Deploy token");

      // Reset to the template's own name is just another update.
      const reset = yield* store.update({
        id: created.id,
        fields: [{ id: "token", label: "Deploy token", kind: "secret", envVar: "GITHUB_TOKEN" }],
      });
      assert.equal(reset.fields[0]?.envVar, "GITHUB_TOKEN");
      assert.equal(reset.fields[0]?.required, true);
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("refuses a dangerous, malformed or duplicate environment variable name", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;

      for (const envVar of [
        "PATH",
        "HOME",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "NODE_OPTIONS",
      ]) {
        const error = yield* Effect.flip(
          store.create({
            templateId: "github",
            name: "GitHub",
            fields: [{ id: "token", label: "Token", kind: "secret", envVar }],
            secrets: [{ fieldId: "token", value: "ghp_x" }],
          }),
        );
        assert.equal(error.reason, "invalid-env-var", envVar);
        assert.equal(error.fieldId, "token");
      }

      const malformed = yield* Effect.flip(
        store.create({
          templateId: "github",
          name: "GitHub",
          fields: [{ id: "token", label: "Token", kind: "secret", envVar: "GH-TOKEN" }],
          secrets: [{ fieldId: "token", value: "ghp_x" }],
        }),
      );
      assert.equal(malformed.reason, "invalid-env-var");

      const duplicate = yield* Effect.flip(
        store.create({
          templateId: "custom",
          name: "Twice",
          fields: [
            { id: "first", label: "First", kind: "secret", envVar: "SHARED_NAME" },
            { id: "second", label: "Second", kind: "secret", envVar: "SHARED_NAME" },
          ],
          secrets: [
            { fieldId: "first", value: "one" },
            { fieldId: "second", value: "two" },
          ],
        }),
      );
      assert.equal(duplicate.reason, "duplicate-env-var");
      assert.equal(duplicate.fieldId, "second");

      // A fixed template still holds its own field set: no adding, removing or retyping.
      const created = yield* store.create({
        templateId: "github",
        name: "GitHub",
        plainFields: {},
        secrets: [{ fieldId: "token", value: "ghp_x" }],
      });
      const removed = yield* Effect.flip(
        store.update({
          id: created.id,
          fields: [
            { id: "token", label: "Token", kind: "secret", envVar: "GITHUB_TOKEN" },
            { id: "extra", label: "Extra", kind: "secret", envVar: "EXTRA_TOKEN" },
          ],
        }),
      );
      assert.equal(removed.reason, "unknown-field");
      assert.equal(removed.fieldId, "extra");

      const retyped = yield* Effect.flip(
        store.update({
          id: created.id,
          fields: [{ id: "token", label: "Token", kind: "text", envVar: "GITHUB_TOKEN" }],
        }),
      );
      assert.equal(retyped.reason, "invalid-field");
      assert.equal(retyped.fieldId, "token");

      const emptied = yield* Effect.flip(store.update({ id: created.id, fields: [] }));
      assert.equal(emptied.reason, "missing-field");
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("adds, renames, re-requires and removes fields on a custom credential", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const created = yield* store.create({
        templateId: "custom",
        name: "Deploy",
        fields: [
          { id: "first", label: "First", kind: "secret", envVar: "FIRST", required: true },
          { id: "second", label: "Second", kind: "secret", envVar: "SECOND" },
        ],
        secrets: [
          { fieldId: "first", value: "first-value" },
          { fieldId: "second", value: "second-value" },
        ],
      });

      const merged = yield* store.update({
        id: created.id,
        fields: [
          { id: "first", label: "Renamed", kind: "secret", envVar: "FIRST", required: false },
          { id: "third", label: "Third", kind: "text", envVar: "THIRD" },
        ],
      });
      assert.deepEqual(
        merged.fields.map((field) => [field.id, field.label, field.required]),
        [
          ["first", "Renamed", false],
          ["third", "Third", false],
        ],
      );
      assert.equal(merged.fields[1]?.value, "");
      assert.isTrue(Option.isNone(yield* secretStore.get(`credential-${created.id}-second`)));
      assert.equal(
        new TextDecoder().decode(
          yield* store.readSecretValue({ id: created.id, fieldId: "first" }),
        ),
        "first-value",
      );

      const removed = yield* store.update({
        id: created.id,
        fields: [{ id: "third", label: "Third", kind: "text", envVar: "THIRD" }],
      });
      assert.deepEqual(
        removed.fields.map((field) => field.id),
        ["third"],
      );
      assert.isTrue(Option.isNone(yield* secretStore.get(`credential-${created.id}-first`)));
      const gone = yield* Effect.flip(store.readSecretValue({ id: created.id, fieldId: "first" }));
      assert.equal(gone.reason, "unknown-field");

      const history = yield* CredentialHistory.CredentialHistory;
      const page = yield* history.read({ credentialId: created.id, limit: 20 });
      // Newest first: the second edit removed `first`, the first added `third` and dropped `second`.
      const updated = page.events.filter((event) => event.type === "updated");
      assert.deepEqual(
        updated.map((event) => [...(event.fieldIds ?? [])].sort()),
        [["first"], ["first", "second", "third"]],
      );
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect("changes a field's kind only while it holds no value", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;

      const created = yield* store.create({
        templateId: "custom",
        name: "Mixed",
        fields: [
          { id: "set", label: "Set", kind: "secret", envVar: "SET_FIELD" },
          { id: "empty", label: "Empty", kind: "secret", envVar: "EMPTY_FIELD" },
        ],
        secrets: [{ fieldId: "set", value: "held-value" }],
      });

      const blocked = yield* Effect.flip(
        store.update({
          id: created.id,
          fields: [
            { id: "set", label: "Set", kind: "text", envVar: "SET_FIELD" },
            { id: "empty", label: "Empty", kind: "secret", envVar: "EMPTY_FIELD" },
          ],
        }),
      );
      assert.equal(blocked.reason, "field-has-value");
      assert.equal(blocked.fieldId, "set");

      const changed = yield* store.update({
        id: created.id,
        fields: [
          { id: "set", label: "Set", kind: "secret", envVar: "SET_FIELD" },
          { id: "empty", label: "Empty", kind: "secretMultiline", envVar: "EMPTY_FIELD" },
        ],
      });
      assert.deepEqual(
        changed.fields.map((field) => [field.id, field.kind, field.secret?.set]),
        [
          ["set", "secret", true],
          ["empty", "secretMultiline", false],
        ],
      );
    }).pipe(Effect.provide(layerStore())),
  );

  it.effect(
    "refreshes the redaction cache when a field is added, and keeps removed values hidden",
    () =>
      Effect.gen(function* () {
        const store = yield* CredentialStore.CredentialStore;
        const redaction = yield* CredentialRedaction.CredentialRedaction;

        const created = yield* store.create({
          templateId: "custom",
          name: "Two secrets",
          fields: [
            { id: "keep", label: "Keep", kind: "secret", envVar: "KEEP_ME" },
            { id: "drop", label: "Drop", kind: "secret", envVar: "DROP_ME" },
          ],
          secrets: [
            { fieldId: "keep", value: "keep-value-111" },
            { fieldId: "drop", value: "drop-value-222" },
          ],
        });
        assert.include(yield* redaction.text("say drop-value-222"), "[redacted]");
        const before = yield* store.revision;

        yield* store.update({
          id: created.id,
          fields: [{ id: "keep", label: "Keep", kind: "secret", envVar: "KEEP_ME" }],
        });
        assert.isAbove(yield* store.revision, before);

        yield* store.setSecret({
          id: created.id,
          fieldId: "keep",
          value: "fresh-value-333",
        });
        assert.include(yield* redaction.text("say fresh-value-333"), "[redacted]");
        // Old values are kept on purpose: an in-flight command may still print one.
        assert.include(yield* redaction.text("say drop-value-222"), "[redacted]");
      }).pipe(Effect.provide(layerStoreWithRedaction())),
  );

  it.effect("redacts a field read out of a JSON secret file, and not its short leaves", () =>
    Effect.gen(function* () {
      const store = yield* CredentialStore.CredentialStore;
      const redaction = yield* CredentialRedaction.CredentialRedaction;
      const privateKey = PRIVATE_KEY;
      const serviceAccount = JSON.stringify({
        type: "service_account",
        project_id: "demo-project",
        private_key: privateKey,
      });
      yield* store.create({
        templateId: "custom",
        name: "Service account",
        fields: [{ id: "key", label: "Key", kind: "secretFile", envVar: "SERVICE_ACCOUNT" }],
        secrets: [
          { fieldId: "key", base64: base64Of(serviceAccount), fileName: "service-account.json" },
        ],
      });

      // `jq -r .private_key` prints the decoded field, which the whole-file needle can't match.
      assert.equal(yield* redaction.text(`key=${privateKey}`), "key=[redacted]");
      assert.notInclude(yield* redaction.text(privateKey), "MIGTAgEAMBMGByqGSM49");
      // A short leaf from the same file stays ordinary text.
      assert.equal(yield* redaction.text("type is service_account"), "type is service_account");
    }).pipe(Effect.provide(layerStoreWithRedaction())),
  );
});
