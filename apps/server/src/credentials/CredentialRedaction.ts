import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { CredentialUseError, type CredentialCaller } from "@t3tools/contracts";
import * as CredentialStore from "./CredentialStore.ts";
import { credentialRedactor } from "./redactSecrets.ts";

const make = Effect.gen(function* () {
  const store = yield* CredentialStore.CredentialStore;
  const lock = yield* Semaphore.make(1);
  let revision = -1;
  let redact = credentialRedactor([]);
  // Old values can still occur in an in-flight command after a rotation or deletion.
  let known = new Set<string>();
  const includeValues = (values: ReadonlyArray<string>) => {
    const next = new Set(known);
    for (const value of values) if (value.length > 0) next.add(value);
    if (next.size !== known.size) {
      const compiled = credentialRedactor([...next]);
      known = next;
      redact = compiled;
    }
    return redact;
  };
  const matcher = Effect.fn("CredentialRedaction.matcher")(function* () {
    return yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const next = yield* store.revision;
          if (revision === next) return redact;
          const values: string[] = [];
          for (const credential of yield* store.list()) {
            for (const field of credential.fields) {
              if (field.kind === "text") values.push(field.value ?? "");
              else if (field.secret?.set) {
                const bytes = Buffer.from(
                  yield* store.readSecretValue({ id: credential.id, fieldId: field.id }),
                );
                values.push(bytes.toString("utf8"), bytes.toString("base64"));
              }
            }
          }
          includeValues(values);
          revision = next;
          return redact;
        }),
      )
      .pipe(Effect.mapError(() => new CredentialUseError({ reason: "storage-failed" })));
  });
  return {
    matcher,
    include: Effect.fn("CredentialRedaction.include")((values: ReadonlyArray<string>) =>
      lock.withPermits(1)(Effect.sync(() => includeValues(values))),
    ),
    text: Effect.fn("CredentialRedaction.text")(function* (text: string) {
      return (yield* matcher())(text);
    }),
    available: Effect.fn("CredentialRedaction.available")(function* (
      projectId: CredentialCaller["projectId"],
    ) {
      return (yield* store.list()).some(
        (c) => c.policy.projects === "all" || c.policy.projects.includes(projectId),
      );
    }),
  };
});
export class CredentialRedaction extends Context.Service<
  CredentialRedaction,
  Effect.Success<typeof make>
>()("t3/credentials/CredentialRedaction") {}
export const layer = Layer.effect(CredentialRedaction, make);
