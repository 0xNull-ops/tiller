import type {
  CredentialHistoryEvent,
  CredentialHistoryInput,
  CredentialHistoryPage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/** Walk only the requested time window; a busy vault can exceed a single history page. */
export const readCredentialHistoryWindow = Effect.fn("credentials.readHistoryWindow")(function* <
  E,
  R,
>(
  read: (input: CredentialHistoryInput) => Effect.Effect<CredentialHistoryPage, E, R>,
  input: { readonly since: string; readonly credentialId?: CredentialHistoryInput["credentialId"] },
) {
  const events: CredentialHistoryEvent[] = [];
  const since = Date.parse(input.since);
  let cursor: string | undefined;
  const seen = new Set<string>();
  while (true) {
    const page = yield* read({
      limit: 200,
      ...(input.credentialId ? { credentialId: input.credentialId } : {}),
      ...(cursor ? { cursor } : {}),
    });
    events.push(...page.events.filter((event) => Date.parse(event.at) >= since));
    if (
      !page.nextCursor ||
      seen.has(page.nextCursor) ||
      page.events.some((event) => Date.parse(event.at) < since)
    )
      break;
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { events };
});
