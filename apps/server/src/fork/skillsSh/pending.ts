import type { SkillsShPreview } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

type Preview = typeof SkillsShPreview.Type;
export class SkillInstallRequests extends Context.Service<
  SkillInstallRequests,
  {
    readonly dismiss: (requestId: string) => Effect.Effect<void>;
    readonly complete: (id: string, sha: string) => Effect.Effect<void>;
    readonly add: (preview: Preview) => Effect.Effect<string>;
    readonly list: Effect.Effect<readonly { requestId: string; preview: Preview }[]>;
  }
>()("t3/fork/skillsSh/pending/SkillInstallRequests") {}
export const layer = Layer.effect(
  SkillInstallRequests,
  Effect.gen(function* () {
    const crypto = yield* SecureRandom.SecureRandom;
    const requests = new Map<string, { preview: Preview; expires: number }>();
    return SkillInstallRequests.of({
      dismiss: Effect.fn("SkillInstallRequests.dismiss")(function* (requestId: string) {
        requests.delete(requestId);
        return yield* Effect.void;
      }),
      complete: Effect.fn("SkillInstallRequests.complete")(function* (id: string, sha: string) {
        for (const [key, request] of requests)
          if (request.preview.id === id && request.preview.sha === sha) requests.delete(key);
        return yield* Effect.void;
      }),
      add: Effect.fn("SkillInstallRequests.add")(function* (preview: Preview) {
        const requestId = yield* crypto.uuidV4().pipe(Effect.orDie);
        if (requests.size >= 50) requests.delete(requests.keys().next().value!);
        requests.set(requestId, { preview, expires: (yield* Clock.currentTimeMillis) + 600_000 });
        return requestId;
      }),
      list: Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        for (const [id, request] of requests) if (request.expires <= now) requests.delete(id);
        return [...requests].map(([requestId, request]) => ({
          requestId,
          preview: request.preview,
        }));
      }),
    });
  }),
);
