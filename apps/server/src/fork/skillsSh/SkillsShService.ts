import packageJson from "../../../package.json" with { type: "json" };
import { SkillsShEntry, SkillsShError, SkillsShPreview, SkillsShSearch } from "@t3tools/contracts";
import * as NodeOS from "node:os";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/http";

const decodeEntries = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(SkillsShEntry)),
);

type Entry = typeof SkillsShEntry.Type;
type Preview = typeof SkillsShPreview.Type;
type Location = {
  readonly scope?: "global" | "project" | undefined;
  readonly project?: string | undefined;
};
type Install = Location & {
  readonly id: string;
  readonly sha: string;
  readonly name?: string | undefined;
  readonly replace?: boolean | undefined;
};
const limit = 5 * 1024 * 1024;
const validName = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(name);
const validPath = (path: string) =>
  !path.includes("\\") &&
  !path.includes(":") &&
  path.split("/").every((p) => p !== "" && p !== "." && p !== "..");
const isSkillsError = Schema.is(SkillsShError);
const failure = (message: string) => new SkillsShError({ message });
const Repo = Schema.Struct({ default_branch: Schema.String });
const Commit = Schema.Struct({ sha: Schema.String });
const Tree = Schema.Struct({
  truncated: Schema.Boolean,
  tree: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      type: Schema.String,
      mode: Schema.String,
      size: Schema.optional(Schema.Number),
    }),
  ),
});

const decodeRepo = Schema.decodeUnknownEffect(Schema.fromJsonString(Repo));
const decodeCommit = Schema.decodeUnknownEffect(Schema.fromJsonString(Commit));
const decodeTree = Schema.decodeUnknownEffect(Schema.fromJsonString(Tree));
const decodeSkillsShSearch = Schema.decodeUnknownEffect(Schema.fromJsonString(SkillsShSearch));
const decodeComparison = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      files: Schema.Array(Schema.Struct({ filename: Schema.String, status: Schema.String })),
    }),
  ),
);
const decodeUnknown = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeEntries = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(SkillsShEntry)));
export class SkillsShService extends Context.Service<
  SkillsShService,
  {
    readonly search: (
      query: string,
      limit?: number,
    ) => Effect.Effect<typeof SkillsShSearch.Type, SkillsShError>;
    readonly audit: (id: string) => Effect.Effect<unknown, SkillsShError>;
    readonly preview: (id: string, fresh?: boolean) => Effect.Effect<Preview, SkillsShError>;
    readonly install: (input: Install) => Effect.Effect<Entry, SkillsShError>;
    readonly uninstall: (name: string, location: Location) => Effect.Effect<void, SkillsShError>;
    readonly listInstalled: (location: Location) => Effect.Effect<readonly Entry[], SkillsShError>;
    readonly checkUpdates: (
      location: Location,
    ) => Effect.Effect<
      readonly { entry: Entry; preview: Preview; summary: string }[],
      SkillsShError
    >;
  }
>()("t3/fork/skillsSh/SkillsShService") {}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* SecureRandom.SecureRandom;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const mutex = yield* Semaphore.make(1);
  const cache = new Map<string, { expires: number; value: unknown }>();
  const ua = `Tiller/${packageJson.version} (+https://tiller.shipr.app)`;
  const request = Effect.fn("SkillsSh.request")(
    function* (url: string) {
      const response = yield* http.execute(
        HttpClientRequest.get(url).pipe(HttpClientRequest.setHeader("user-agent", ua)),
      );
      if (response.status < 200 || response.status >= 300)
        return yield* failure(
          response.status === 403 || response.status === 429
            ? `Request denied or public API rate limit reached (${response.status}). Retry later.`
            : `Request failed (${response.status})`,
        );
      return yield* response.arrayBuffer;
    },
    Effect.timeout("15 seconds"),
    Effect.mapError((cause) =>
      isSkillsError(cause) ? cause : failure("skills.sh or GitHub isn't reachable. Retry."),
    ),
  );
  const json = Effect.fn("SkillsSh.json")(
    function* <A>(url: string, decode: (text: string) => Effect.Effect<A, Schema.SchemaError>) {
      const body = yield* request(url);
      return yield* decode(new TextDecoder().decode(body));
    },
    Effect.mapError((cause) =>
      isSkillsError(cause) ? cause : failure("Invalid response from skills.sh or GitHub"),
    ),
  );
  const cached = Effect.fn("SkillsSh.cached")(function* <A>(
    key: string,
    load: Effect.Effect<A, SkillsShError>,
    fresh = false,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const hit = cache.get(key);
    if (!fresh && hit && hit.expires > now) return hit.value as A;
    const value = yield* load;
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + 600_000, value });
    return value;
  });
  const search = Effect.fn("SkillsSh.search")(function* (query: string, count = 20) {
    return yield* cached(
      `search:${query}:${count}`,
      json(
        `https://skills.sh/api/search?q=${encodeURIComponent(query || "design")}&limit=${Math.max(1, Math.min(500, Math.floor(count)))}`,
        decodeSkillsShSearch,
      ),
    );
  });
  const audit = Effect.fn("SkillsSh.audit")(function* (id: string) {
    if (!/^[\w.-]+\/[\w.-]+\/[\w-]+$/.test(id) || id.startsWith("site/"))
      return yield* failure("Unsupported skill source");
    const [owner, repo, name] = id.split("/");
    return yield* cached(
      `audit:${id}`,
      json(
        `https://skills.sh/api/v1/skills/audit/${encodeURIComponent(owner + "/" + repo)}/${name}`,
        decodeUnknown,
      ).pipe(
        Effect.catchIf(
          (error) => error.message === "Request failed (404)",
          () => Effect.succeed(null),
        ),
      ),
    );
  });
  const preview = Effect.fn("SkillsSh.preview")(function* (id: string, fresh = false) {
    if (!/^[\w.-]+\/[\w.-]+\/[\w-]+$/.test(id) || id.startsWith("site/"))
      return yield* failure("Open this source on skills.sh; only GitHub sources can be installed.");
    const [owner, repo, name] = id.split("/") as [string, string, string];
    if (!validName(name)) return yield* failure("Invalid skill name");
    return yield* cached(
      `preview:${id}`,
      Effect.gen(function* () {
        const source = `${owner}/${repo}`;
        const info = yield* json(`https://api.github.com/repos/${source}`, decodeRepo);
        const { sha } = yield* json(
          `https://api.github.com/repos/${source}/commits/${encodeURIComponent(info.default_branch)}`,
          decodeCommit,
        );
        if (!/^[a-f0-9]{40}$/.test(sha)) return yield* failure("Invalid GitHub commit");
        const tree = yield* json(
          `https://api.github.com/repos/${source}/git/trees/${sha}?recursive=1`,
          decodeTree,
        );
        if (tree.truncated) return yield* failure("Repository tree is too large");
        if (tree.tree.some((f) => !validPath(f.path)))
          return yield* failure("Unsafe repository path");
        const raw = (file: string) =>
          `https://raw.githubusercontent.com/${source}/${sha}/${file.split("/").map(encodeURIComponent).join("/")}`;
        let folder: string | undefined;
        let markdown = "";
        for (const file of tree.tree
          .filter(
            (f) => f.type === "blob" && (f.path === "SKILL.md" || f.path.endsWith("/SKILL.md")),
          )
          .sort(
            (a, b) =>
              Number(b.path.split("/").at(-2) === name) - Number(a.path.split("/").at(-2) === name),
          )) {
          if ((file.size ?? 0) > limit) continue;
          const text = new TextDecoder().decode(yield* request(raw(file.path)));
          const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
          const found = frontmatter?.match(/^name:\s*["']?([^\r\n"']+?)["']?\s*$/m)?.[1];
          if (found === name) {
            folder = file.path === "SKILL.md" ? "" : file.path.slice(0, -9);
            markdown = text;
            break;
          }
        }
        if (folder === undefined) return yield* failure("Skill folder not found");
        const selected = tree.tree.filter(
          (f) => f.type === "blob" && (!folder || f.path.startsWith(folder + "/")),
        );
        if (selected.some((f) => f.mode !== "100644" && f.mode !== "100755"))
          return yield* failure("Skill contains unsupported links");
        const files = selected.map((f) => ({
          path: folder ? f.path.slice(folder.length + 1) : f.path,
          size: f.size ?? 0,
        }));
        if (files.length > 200 || files.reduce((n, f) => n + f.size, 0) > limit)
          return yield* failure("Skill exceeds 200 files or 5 MB");
        const auditResult = yield* audit(id).pipe(Effect.orElseSucceed(() => null));
        return {
          id,
          source,
          name,
          sha,
          folder,
          markdown,
          files,
          audit: auditResult,
          sourceUrl: `https://github.com/${source}/tree/${sha}/${folder}`,
        };
      }),
      fresh,
    );
  });
  const agents = (location: Location) => {
    if (location.scope === "project" && (!location.project || !path.isAbsolute(location.project)))
      throw failure("Absolute project path required");
    return path.join(
      location.scope === "project" ? location.project! : NodeOS.homedir(),
      ".agents",
    );
  };
  const assertRoot = Effect.fn("SkillsSh.assertRoot")(function* (root: string) {
    const parent = yield* fs.realPath(path.dirname(root));
    const canonical = path.join(parent, ".agents");
    for (const candidate of [root, path.join(root, "skills")]) {
      if (yield* fs.exists(candidate)) {
        const actual = yield* fs.realPath(candidate);
        const expected = candidate === root ? canonical : path.join(canonical, "skills");
        if (actual !== expected) return yield* failure("Skill storage must not be a symbolic link");
      }
    }
  });
  const readEntries = Effect.fn("SkillsSh.readEntries")(function* (root: string) {
    yield* assertRoot(root);
    const file = path.join(root, ".tiller-skills.json");
    if (!(yield* fs.exists(file))) return [];
    return yield* decodeEntries(yield* fs.readFileString(file));
  });
  const lock = Effect.fn("SkillsSh.lock")(function* (root: string, entries: readonly Entry[]) {
    const temp = path.join(root, `.lock-${yield* crypto.uuidV4()}`);
    yield* fs.writeFileString(temp, yield* encodeEntries(entries));
    yield* fs.rename(temp, path.join(root, ".tiller-skills.json"));
  });
  const mapError = (cause: unknown) =>
    isSkillsError(cause) ? cause : failure("Unable to access installed skills");
  const listInstalled = Effect.fn("SkillsSh.listInstalled")(function* (location: Location) {
    return yield* readEntries(yield* Effect.try({ try: () => agents(location), catch: mapError }));
  }, Effect.mapError(mapError));
  const install = Effect.fn("SkillsSh.install")(
    function* (input: Install) {
      const p = yield* preview(input.id);
      if (input.sha !== p.sha)
        return yield* failure("Source changed. Preview again before installing.");
      const name = input.name ?? p.name;
      if (!validName(name)) return yield* failure("Invalid skill name");
      const root = yield* Effect.try({ try: () => agents(input), catch: mapError });
      yield* assertRoot(root);
      yield* fs.makeDirectory(path.join(root, "skills"), { recursive: true });
      const entries = yield* readEntries(root);
      const target = path.join(root, "skills", name);
      const exists = yield* fs.exists(target);
      if (exists && !input.replace) return yield* failure(`A skill named ${name} already exists`);
      if (exists && !entries.some((e) => e.name === name))
        return yield* failure("Cannot replace an untracked skill; choose another name");
      const temp = path.join(root, "skills", `.install-${yield* crypto.uuidV4()}`);
      const backup = temp + "-backup";
      yield* fs.makeDirectory(temp);
      let moved = false;
      let published = false;
      return yield* Effect.gen(function* () {
        let bytes = 0;
        for (const file of p.files) {
          if (!validPath(file.path)) return yield* failure("Unsafe skill path");
          const body = yield* request(
            `https://raw.githubusercontent.com/${p.source}/${p.sha}/${[p.folder, file.path].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/")}`,
          );
          bytes += body.byteLength;
          if (bytes > limit) return yield* failure("Skill exceeds 5 MB");
          const destination = path.join(temp, file.path);
          yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
          yield* fs.writeFile(destination, new Uint8Array(body));
        }
        const entry: Entry = {
          name,
          id: p.id,
          source: p.source,
          sha: p.sha,
          installedAt: DateTime.formatIso(yield* DateTime.now),
          scope: input.scope ?? "global",
        };
        if (exists) {
          yield* fs.rename(target, backup);
          moved = true;
        }
        yield* fs.rename(temp, target);
        published = true;
        yield* lock(root, [...entries.filter((e) => e.name !== name), entry]);
        return entry;
      }).pipe(
        Effect.onError(() =>
          Effect.gen(function* () {
            if (published) yield* fs.remove(target, { recursive: true, force: true });
            if (moved) yield* fs.rename(backup, target);
          }).pipe(Effect.orDie),
        ),
        Effect.ensuring(fs.remove(temp, { recursive: true, force: true }).pipe(Effect.orDie)),
        Effect.tap(() => fs.remove(backup, { recursive: true, force: true })),
      );
    },
    mutex.withPermits(1),
    Effect.mapError(mapError),
  );
  const uninstall = Effect.fn("SkillsSh.uninstall")(
    function* (name: string, location: Location) {
      if (!validName(name)) return yield* failure("Invalid skill name");
      const root = yield* Effect.try({ try: () => agents(location), catch: mapError });
      const entries = yield* readEntries(root);
      if (!entries.some((e) => e.name === name))
        return yield* failure("Skill is not tracked in the Tiller lockfile");
      const target = path.join(root, "skills", name);
      const backup = target + `-remove-${yield* crypto.uuidV4()}`;
      yield* fs.rename(target, backup);
      yield* lock(
        root,
        entries.filter((e) => e.name !== name),
      ).pipe(Effect.onError(() => fs.rename(backup, target).pipe(Effect.orDie)));
      yield* fs.remove(backup, { recursive: true, force: true });
    },
    mutex.withPermits(1),
    Effect.mapError(mapError),
  );
  const checkUpdates = Effect.fn("SkillsSh.checkUpdates")(function* (location: Location) {
    const entries = yield* listInstalled(location);
    return yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const latest = yield* preview(entry.id, true);
        if (latest.sha === entry.sha) return { entry, preview: latest, summary: "Up to date" };
        const comparison = yield* json(
          `https://api.github.com/repos/${entry.source}/compare/${entry.sha}...${latest.sha}`,
          decodeComparison,
        );
        const files = comparison.files.filter(
          (file) => !latest.folder || file.filename.startsWith(latest.folder + "/"),
        );
        const added = files.filter((file) => file.status === "added").length;
        const removed = files.filter((file) => file.status === "removed").length;
        return {
          entry,
          preview: latest,
          summary: `${added} added, ${removed} removed, ${files.length - added - removed} changed (GitHub comparison, up to 300 files)`,
        };
      }),
    );
  });
  return SkillsShService.of({
    search,
    audit,
    preview,
    install,
    uninstall,
    listInstalled,
    checkUpdates,
  });
});
export const layer = Layer.effect(SkillsShService, make);
