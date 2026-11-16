import { SkillInstallRequests } from "./pending.ts";
import { WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import { RpcInstrumentation } from "../../observability/RpcInstrumentation.ts";
import { SkillsShService } from "./SkillsShService.ts";

const tags = [
  WS_METHODS.skillsShAudit,
  WS_METHODS.skillsShDismiss,
  WS_METHODS.skillsShPending,
  WS_METHODS.skillsShSearch,
  WS_METHODS.skillsShPreview,
  WS_METHODS.skillsShInstall,
  WS_METHODS.skillsShUninstall,
  WS_METHODS.skillsShListInstalled,
  WS_METHODS.skillsShCheckUpdates,
] as const;
type Tag = (typeof tags)[number];
type Method = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];
const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (tag): tag is Exclude<Method, Tag> => !tags.includes(tag as Tag),
  ),
).middleware(RpcInstrumentation);
export const mergeInto = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.merge(
    layer,
    group.toLayer(
      Effect.gen(function* () {
        const service = yield* SkillsShService;
        const requests = yield* SkillInstallRequests;
        return group.of({
          [WS_METHODS.skillsShAudit]: (input) => service.audit(input.id),
          [WS_METHODS.skillsShDismiss]: (input) => requests.dismiss(input.requestId),
          [WS_METHODS.skillsShPending]: () => requests.list,
          [WS_METHODS.skillsShSearch]: (input) => service.search(input.query, input.limit),
          [WS_METHODS.skillsShPreview]: (input) => service.preview(input.id),
          [WS_METHODS.skillsShInstall]: (input) =>
            service.install(input).pipe(Effect.tap(() => requests.complete(input.id, input.sha))),
          [WS_METHODS.skillsShUninstall]: (input) => service.uninstall(input.name, input),
          [WS_METHODS.skillsShListInstalled]: service.listInstalled,
          [WS_METHODS.skillsShCheckUpdates]: service.checkUpdates,
        });
      }),
    ),
  );
