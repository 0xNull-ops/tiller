import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as CredentialOsUnlock from "./CredentialOsUnlock.ts";
import type { CredentialOsPresence } from "./CredentialOsPresence.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const environmentA = EnvironmentId.make("env-a");
const environmentB = EnvironmentId.make("env-b");

const presence = (input?: {
  readonly available?: boolean;
  readonly confirm?: boolean;
}): CredentialOsPresence & { readonly prompt: ReturnType<typeof vi.fn> } => ({
  method: "touch-id",
  isAvailable: async () => input?.available ?? true,
  prompt: vi.fn(async () => input?.confirm ?? true),
});

interface SafeStorageFake {
  readonly service: ElectronSafeStorage.ElectronSafeStorage["Service"];
  readonly decryptCalls: { count: number };
}

const safeStorage = (input?: {
  readonly available?: boolean;
  readonly backend?: Option.Option<string>;
  readonly decryptFails?: boolean;
}): SafeStorageFake => {
  const decryptCalls = { count: 0 };
  return {
    decryptCalls,
    service: {
      isEncryptionAvailable: Effect.succeed(input?.available ?? true),
      encryptString: (value) => Effect.succeed(textEncoder.encode(`enc:${value}`)),
      decryptString: (value) => {
        decryptCalls.count += 1;
        const decoded = textDecoder.decode(value);
        if (input?.decryptFails === true || !decoded.startsWith("enc:")) {
          return Effect.fail(
            new ElectronSafeStorage.ElectronSafeStorageDecryptError({
              cause: new Error("undecryptable"),
            }),
          );
        }
        return Effect.succeed(decoded.slice("enc:".length));
      },
      selectedStorageBackend: Effect.succeed(input?.backend ?? Option.none()),
    },
  };
};

const layer = (input: {
  readonly baseDir: string;
  readonly safeStorage: ElectronSafeStorage.ElectronSafeStorage["Service"];
  readonly presence: CredentialOsPresence | null;
}) => {
  const layerEnvironment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: input.baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer), DesktopConfig.layerTest({ T3CODE_HOME: input.baseDir })),
    ),
  );

  return CredentialOsUnlock.layer(input.presence).pipe(
    Layer.provideMerge(layerEnvironment),
    Layer.provideMerge(Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, input.safeStorage)),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
};

const withUnlock = <A, E, R>(
  input: {
    readonly presence: CredentialOsPresence | null;
    readonly safeStorage?: SafeStorageFake;
  },
  effect: (
    storage: SafeStorageFake,
  ) => Effect.Effect<A, E, R | CredentialOsUnlock.CredentialOsUnlock>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-credential-os-unlock-test-",
    });
    const storage = input.safeStorage ?? safeStorage();
    return yield* effect(storage).pipe(
      Effect.provide(layer({ baseDir, safeStorage: storage.service, presence: input.presence })),
    );
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)), Effect.scoped);

const documentPath = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const path = yield* Path.Path;
  return path.join(environment.stateDir, "credential-os-unlock.json");
});

describe("CredentialOsUnlock", () => {
  it.effect("is not offered when the OS has no prompt", () =>
    withUnlock({ presence: null }, () =>
      Effect.gen(function* () {
        const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;
        const status = yield* unlock.status(environmentA);
        assert.isFalse(status.available);
        assert.isFalse(status.enabled);
        assert.isUndefined(status.method);
      }),
    ),
  );

  it.effect("is not offered when Electron has no protected storage", () =>
    withUnlock({ presence: presence(), safeStorage: safeStorage({ available: false }) }, () =>
      Effect.gen(function* () {
        const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;
        const status = yield* unlock.status(environmentA);
        assert.isFalse(status.available);
        const error = yield* unlock.enable(environmentA, "1234").pipe(Effect.flip);
        assert.equal(error.reason, "unavailable");
      }),
    ),
  );

  it.effect("refuses the Linux plain-text backend", () =>
    withUnlock(
      { presence: presence(), safeStorage: safeStorage({ backend: Option.some("basic_text") }) },
      () =>
        Effect.gen(function* () {
          const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;
          const status = yield* unlock.status(environmentA);
          assert.isFalse(status.available);
        }),
    ),
  );

  it.effect("stores one encrypted PIN per environment", () =>
    withUnlock({ presence: presence() }, () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* documentPath;
        const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;

        const enabled = yield* unlock.enable(environmentA, "1234");
        assert.isTrue(enabled.enabled);
        assert.equal(enabled.method, "touch-id");

        const contents = yield* fileSystem.readFileString(path);
        assert.notInclude(contents, "1234");
        assert.include(contents, environmentA);

        const other = yield* unlock.status(environmentB);
        assert.isFalse(other.enabled);

        const disabled = yield* unlock.disable(environmentA);
        assert.isFalse(disabled.enabled);
        assert.notInclude(yield* fileSystem.readFileString(path), environmentA);
      }),
    ),
  );

  it.effect("releases the PIN only after the OS confirms the user", () => {
    const osPresence = presence({ confirm: false });
    return withUnlock({ presence: osPresence }, () =>
      Effect.gen(function* () {
        const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;
        yield* unlock.enable(environmentA, "1234");

        const cancelled = yield* unlock.unlock(environmentA);
        assert.isTrue(Option.isNone(cancelled.pin));
        assert.equal(osPresence.prompt.mock.calls.length, 1);
      }),
    );
  });

  it.effect("returns the stored PIN once the OS confirms", () => {
    const osPresence = presence({ confirm: true });
    return withUnlock({ presence: osPresence }, () =>
      Effect.gen(function* () {
        const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;
        yield* unlock.enable(environmentA, "1234");

        const result = yield* unlock.unlock(environmentA);
        assert.deepEqual(result.pin, Option.some("1234"));
        assert.equal(osPresence.prompt.mock.calls.length, 1);
      }),
    );
  });

  it.effect("does not prompt when the environment has no stored PIN", () => {
    const osPresence = presence({ confirm: true });
    return withUnlock({ presence: osPresence }, () =>
      Effect.gen(function* () {
        const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;
        const result = yield* unlock.unlock(environmentA);
        assert.isTrue(Option.isNone(result.pin));
        assert.equal(osPresence.prompt.mock.calls.length, 0);
      }),
    );
  });

  it.effect("treats an entry it cannot decrypt as not enabled", () =>
    withUnlock({ presence: presence(), safeStorage: safeStorage({ decryptFails: true }) }, () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const path = yield* Path.Path;
        const document = path.join(environment.stateDir, "credential-os-unlock.json");
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          document,
          `${JSON.stringify({ version: 1, environments: { [environmentA]: "bm90LWVuY3J5cHRlZA==" } })}\n`,
        );

        const unlock = yield* CredentialOsUnlock.CredentialOsUnlock;
        const status = yield* unlock.status(environmentA);
        assert.isTrue(status.available);
        assert.isFalse(status.enabled);
      }),
    ),
  );
});
