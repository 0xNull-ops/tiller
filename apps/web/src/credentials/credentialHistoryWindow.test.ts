import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { CredentialHistoryInput, CredentialHistoryPage } from "@t3tools/contracts";
import { credentialHistoryFixture } from "./credentialActivityFixture";
import { readCredentialHistoryWindow } from "./credentialHistoryWindow";

it.effect("reads a run's full history across pages and stops at the time boundary", () =>
  Effect.gen(function* () {
    const calls: CredentialHistoryInput[] = [];
    const pages: CredentialHistoryPage[] = [
      { events: [credentialHistoryFixture], nextCursor: "next" },
      {
        events: [
          { ...credentialHistoryFixture, id: "older-use", at: "2026-10-22T13:00:00Z" },
          { ...credentialHistoryFixture, id: "before-run", at: "2026-10-21T10:00:00Z" },
        ],
        nextCursor: "too-old",
      },
    ];
    const result = yield* readCredentialHistoryWindow(
      (input) => {
        calls.push(input);
        return Effect.succeed(pages[calls.length - 1]!);
      },
      { since: "2026-10-22T12:00:00.000Z" },
    );
    expect(result.events.map((event) => event.id)).toEqual(["history-1", "older-use"]);
    expect(calls.map((input) => input.cursor)).toEqual([undefined, "next"]);
  }),
);
