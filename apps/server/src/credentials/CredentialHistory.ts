import {
  CredentialError,
  CredentialHistoryEvent,
  type CredentialHistoryInput,
  type CredentialHistoryPage,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

/** One line is a few hundred bytes, so this holds tens of thousands of events. */
export const CREDENTIAL_HISTORY_MAX_BYTES = 5 * 1024 * 1024;

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(CredentialHistoryEvent));
const encodeEvent = Schema.encodeEffect(Schema.fromJsonString(CredentialHistoryEvent));

const historyError = (cause: unknown) => new CredentialError({ reason: "history-failed", cause });

export type CredentialHistoryEntry = Omit<CredentialHistoryEvent, "id" | "at">;

export class CredentialHistory extends Context.Service<
  CredentialHistory,
  {
    /**
     * Never fails: a full disk on the history file must not block an edit the user asked for,
     * and the alternative (failing after the metadata was written) would make a retry lie.
     */
    readonly record: (entry: CredentialHistoryEntry) => Effect.Effect<void>;
    readonly read: (
      input: CredentialHistoryInput,
    ) => Effect.Effect<CredentialHistoryPage, CredentialError>;
  }
>()("t3/credentials/CredentialHistory") {}

const make = Effect.fn("CredentialHistory.make")(function* (options: {
  readonly maxBytes: number;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* SecureRandom.SecureRandom;

  const directory = path.join(config.stateDir, "credentials");
  const currentPath = path.join(directory, "history.jsonl");
  const rotatedPath = path.join(directory, "history.1.jsonl");

  const readLines = Effect.fn("CredentialHistory.readLines")(function* (file: string) {
    return yield* fileSystem.readFileString(file).pipe(
      Effect.map((text) =>
        text
          .split("\n")
          .flatMap((line) => (line.trim() === "" ? [] : [line]))
          .flatMap((line) => {
            const decoded = decodeEvent(line);
            return decoded._tag === "Some" ? [decoded.value] : [];
          }),
      ),
      // A missing file is an empty history, not a failure.
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed([] as ReadonlyArray<CredentialHistoryEvent>),
      ),
      Effect.mapError(historyError),
    );
  });

  const appendLine = Effect.fn("CredentialHistory.append")(function* (
    entry: CredentialHistoryEntry,
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    const id = yield* crypto.uuidV4().pipe(Effect.mapError(historyError));
    const line = `${yield* encodeEvent({ ...entry, id, at }).pipe(Effect.mapError(historyError))}\n`;

    yield* fileSystem
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(historyError));

    const size = yield* fileSystem.stat(currentPath).pipe(
      Effect.map((info) => info.size),
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(0),
      ),
      Effect.mapError(historyError),
    );
    // One backup file is the whole bound: rotation is a rename, so it never rewrites history.
    if (size >= options.maxBytes) {
      yield* fileSystem.rename(currentPath, rotatedPath).pipe(Effect.mapError(historyError));
    }

    yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(currentPath, { flag: "a", mode: 0o600 });
        yield* file.writeAll(new TextEncoder().encode(line));
        yield* file.sync;
      }),
    ).pipe(Effect.mapError(historyError));
    yield* fileSystem.chmod(currentPath, 0o600).pipe(Effect.mapError(historyError));
  });

  const record: CredentialHistory["Service"]["record"] = (entry) =>
    appendLine(entry).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not append to the credential history", { cause }),
      ),
    );

  const read: CredentialHistory["Service"]["read"] = Effect.fn("CredentialHistory.read")(
    function* (input) {
      const [rotated, current] = yield* Effect.all([
        readLines(rotatedPath),
        readLines(currentPath),
      ]);
      // Each file is oldest-first, and the current file is newer than the rotated one, so
      // reversing each separately keeps the merged list strictly newest-first.
      const newestFirst = current.toReversed().concat(rotated.toReversed());
      const matching =
        input.credentialId === undefined
          ? newestFirst
          : newestFirst.filter((event) => event.credentialId === input.credentialId);
      // A cursor whose event rotated out starts a fresh page rather than failing: the client
      // dedupes by event id.
      const cursorIndex =
        input.cursor === undefined ? -1 : matching.findIndex((event) => event.id === input.cursor);
      const start = cursorIndex + 1;
      const events = matching.slice(start, start + input.limit);
      const last = events.at(-1);
      return {
        events,
        ...(matching.length > start + input.limit && last !== undefined
          ? { nextCursor: last.id }
          : {}),
      };
    },
  );

  return CredentialHistory.of({ record, read });
});

export const layerWithMaxBytes = (maxBytes: number) =>
  Layer.effect(CredentialHistory, make({ maxBytes }));

export const layer = layerWithMaxBytes(CREDENTIAL_HISTORY_MAX_BYTES);
