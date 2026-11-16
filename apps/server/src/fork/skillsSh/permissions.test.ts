import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Authorization from "../../auth/RpcAuthorization.ts";

const tags = [WS_METHODS.skillsShInstall, WS_METHODS.skillsShUninstall] as const;
type Tag = (typeof tags)[number];
type Method = import("effect/rpc/RpcGroup").Rpcs<typeof WsRpcGroup>["_tag"];
const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (tag): tag is Exclude<Method, Tag> => !tags.includes(tag as Tag),
  ),
);
it.effect("denies skill mutations to read-only connections and permits settings writers", () =>
  Effect.gen(function* () {
    let writes = 0;
    const entry = {
      id: "owner/repo/skill",
      name: "skill",
      source: "owner/repo",
      sha: "abc",
      installedAt: "",
      scope: "global" as const,
    };
    const handlers = group.toLayer({
      [WS_METHODS.skillsShInstall]: () =>
        Effect.sync(() => {
          writes++;
          return entry;
        }),
      [WS_METHODS.skillsShUninstall]: () =>
        Effect.sync(() => {
          writes++;
        }),
    });
    const reader = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, Authorization.layer([AuthOrchestrationReadScope]))),
    );
    expect(
      yield* reader[WS_METHODS.skillsShInstall]({ id: entry.id, sha: entry.sha }).pipe(Effect.flip),
    ).toMatchObject({ requiredPermission: AuthSettingsWriteScope });
    expect(
      yield* reader[WS_METHODS.skillsShUninstall]({ name: entry.name }).pipe(Effect.flip),
    ).toMatchObject({ requiredPermission: AuthSettingsWriteScope });
    expect(writes).toBe(0);
    const writer = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(Layer.mergeAll(handlers, Authorization.layer([AuthSettingsWriteScope]))),
    );
    yield* writer[WS_METHODS.skillsShInstall]({ id: entry.id, sha: entry.sha });
    yield* writer[WS_METHODS.skillsShUninstall]({ name: entry.name });
    expect(writes).toBe(2);
  }).pipe(Effect.scoped),
);
