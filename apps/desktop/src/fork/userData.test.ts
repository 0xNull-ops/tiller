import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolveUserDataPath } from "../app/DesktopUserData.ts";

it.effect("isolates a launch check's profile from a running installed app", () =>
  Effect.gen(function* () {
    const profile = yield* resolveUserDataPath({
      appDataDirectory: "/normal",
      isDevelopment: false,
      platform: "darwin",
    });
    assert.equal(profile, "/isolated/launch-profile");
  }).pipe(
    Effect.provide(
      Layer.merge(
        NodeServices.layer,
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: { TILLER_DESKTOP_USER_DATA_DIR: "/isolated/launch-profile" },
          }),
        ),
      ),
    ),
  ),
);
