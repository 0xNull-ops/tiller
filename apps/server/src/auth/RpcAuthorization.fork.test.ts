import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  ProjectId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import { RPC_REQUIRED_SCOPES } from "./RpcAuthorization.ts";
import * as RpcAuthorization from "./RpcAuthorization.ts";

describe("credential authorization", () => {
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof WS_METHODS.credentialsList> =>
        tag !== WS_METHODS.credentialsList,
    ),
  );

  it.effect.each([
    { scopes: [AuthTerminalOperateScope], allowed: true },
    { scopes: [AuthOrchestrationOperateScope, AuthTerminalReadScope], allowed: false },
    { scopes: [], allowed: false },
  ])("checks stored scopes $scopes for credential listing", ({ scopes, allowed }) =>
    Effect.gen(function* () {
      let handled = 0;
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.credentialsList, () =>
              Effect.sync(() => {
                handled++;
                return { credentials: [] };
              }),
            ),
            RpcAuthorization.layer(scopes),
          ),
        ),
      );
      if (allowed)
        expect(yield* client[WS_METHODS.credentialsList]({})).toEqual({ credentials: [] });
      else
        expect(yield* client[WS_METHODS.credentialsList]({}).pipe(Effect.flip)).toMatchObject({
          _tag: "EnvironmentAuthorizationError",
          requiredPermission: "credentials:manage",
          message: "The authenticated token is missing required scope: credentials:manage.",
        });
      expect(handled).toBe(allowed ? 1 : 0);
    }).pipe(Effect.scoped),
  );
});

describe("workflow template authorization", () => {
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (
        tag,
      ): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof WS_METHODS.workflowTemplateUse> =>
        tag !== WS_METHODS.workflowTemplateUse,
    ),
  );
  it.effect.each([
    { scopes: [AuthSettingsWriteScope], allowed: true },
    { scopes: [AuthOrchestrationOperateScope], allowed: false },
    { scopes: [], allowed: false },
  ])("requires settings:write to copy a template ($allowed)", ({ scopes, allowed }) =>
    Effect.gen(function* () {
      let handled = 0;
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.workflowTemplateUse, () =>
              Effect.sync(() => {
                handled++;
                return { slug: "copy", path: ".t3/workflows/copy.json" };
              }),
            ),
            RpcAuthorization.layer(scopes),
          ),
        ),
      );
      const input = {
        templateId: "landing-page-in-an-afternoon",
        projectId: ProjectId.make("project"),
      };
      if (allowed)
        expect(yield* client[WS_METHODS.workflowTemplateUse](input)).toMatchObject({
          slug: "copy",
        });
      else
        expect(
          yield* client[WS_METHODS.workflowTemplateUse](input).pipe(Effect.flip),
        ).toMatchObject({
          _tag: "EnvironmentAuthorizationError",
          requiredPermission: "settings:write",
        });
      expect(handled).toBe(allowed ? 1 : 0);
    }).pipe(Effect.scoped),
  );
});
