// @effect-diagnostics nodeBuiltinImport:off - Node built-ins only.
/** Measure fork-owned files, marked seams, and replacement drift against upstream. */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { launchIdentityViolations, oversizedSeamWarning } from "./lib/fork-seam-rules.ts";

const repoRoot = NodePath.dirname(import.meta.dirname);
const forkDocPath = NodePath.join(repoRoot, "FORK.md");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MARKER = /\bfork\(([a-z][\w-]*)\)/;
const REPLACES = /\bfork\(replaces\):\s*(\S+)\s*@\s*([0-9a-f]{7,40})/;

interface Options {
  readonly upstream: string;
  readonly marker: string | null;
  readonly check: boolean;
  readonly drift: boolean;
  readonly write: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  let upstream = "upstream/main";
  let marker: string | null = null;
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const [name, inline] = arg.split("=", 2) as [string, string | undefined];
    if (name === "--upstream" || name === "--marker") {
      const value = inline ?? argv[(i += 1)];
      if (!value) fail(`${name} needs a value.`);
      if (name === "--upstream") upstream = value;
      else marker = value;
    } else flags.add(name);
  }
  return {
    upstream,
    marker,
    check: flags.has("--check"),
    drift: flags.has("--drift"),
    write: flags.has("--write"),
  };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function git(args: readonly string[]): string | null {
  try {
    return NodeChildProcess.execFileSync("git", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).toString("utf8");
  } catch {
    return null;
  }
}

function readText(relativePath: string): string | null {
  const absolutePath = NodePath.join(repoRoot, relativePath);
  try {
    const stat = NodeFS.statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const buffer = NodeFS.readFileSync(absolutePath);
    if (buffer.subarray(0, 8 * 1024).includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

/** Bullet paths listed between `<!-- fork-<name>:start -->` and `<!-- fork-<name>:end -->`. */
function listedPaths(doc: string, name: string): string[] {
  const start = doc.indexOf(`<!-- fork-${name}:start -->`);
  const end = doc.indexOf(`<!-- fork-${name}:end -->`);
  if (start < 0 || end < start) return [];
  return [...doc.slice(start, end).matchAll(/^\s*-\s+`([^`]+)`/gm)].map((match) => match[1]!);
}

const isUnder = (path: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix));

interface Seam {
  readonly path: string;
  readonly line: number;
  readonly feature: string;
  readonly text: string;
}

interface EditedFile {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly seams: number;
  readonly allowed: boolean;
}

interface Replaced {
  readonly path: string;
  readonly original: string;
  readonly base: string;
  readonly missed: readonly string[];
}

const options = parseOptions(process.argv.slice(2));
const forkDoc = readText("FORK.md") ?? "";
const owned = listedPaths(forkDoc, "owned");
const unmarkedAllowed = listedPaths(forkDoc, "unmarked");

const upstreamHead = git(["rev-parse", "--short=10", options.upstream])?.trim() ?? null;
const mergeBase = upstreamHead
  ? (git(["merge-base", "HEAD", options.upstream])?.trim() ?? null)
  : null;
if (mergeBase === null)
  process.stderr.write(`No ${options.upstream}; run \`git fetch upstream\`. Listing seams only.\n`);

// Committed and working-tree changes both count, so the report is right before committing.
const changes = new Map<string, "A" | "M" | "D">();
if (mergeBase !== null) {
  const diff = git(["diff", "--name-status", "--no-renames", "-z", mergeBase]) ?? "";
  const parts = diff.split("\u0000").filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2)
    changes.set(parts[i + 1]!, parts[i]!.charAt(0) as "A" | "M" | "D");
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]) ?? "";
  for (const path of untracked.split("\u0000").filter(Boolean)) changes.set(path, "A");
}
const numstat = new Map<string, { added: number; removed: number }>();
if (mergeBase !== null) {
  for (const line of (git(["diff", "--numstat", "--no-renames", mergeBase]) ?? "").split("\n")) {
    const [added, removed, path] = line.split("\t");
    if (path) numstat.set(path, { added: Number(added) || 0, removed: Number(removed) || 0 });
  }
}

const scanned =
  mergeBase === null
    ? (git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]) ?? "")
        .split("\u0000")
        .filter(Boolean)
    : [...changes].filter(([, kind]) => kind !== "D").map(([path]) => path);

const seams: Seam[] = [];
const replaced: Replaced[] = [];
for (const path of scanned) {
  if (path.endsWith(".md") || path === "scripts/fork-seams.ts") continue;
  const text = readText(path);
  if (text === null) continue;
  const lines = text.split(/\r?\n/);
  const kind = changes.get(path);
  if (kind === "A" || mergeBase === null) {
    const header = lines.slice(0, 15).join("\n").match(REPLACES);
    if (header && kind === "A") {
      const [, original, base] = header as unknown as [string, string, string];
      const missed = (
        git(["log", "--format=%h %as %s", `${base}..${options.upstream}`, "--", original]) ?? ""
      )
        .split("\n")
        .filter(Boolean);
      replaced.push({ path, original, base, missed });
    }
    if (kind === "A") continue;
  }
  lines.forEach((line, index) => {
    const match = line.match(MARKER);
    if (!match || match[1] === "replaces") return;
    if (options.marker !== null && match[1] !== options.marker) return;
    seams.push({ path, line: index + 1, feature: match[1]!, text: line.trim() });
  });
}
seams.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

const seamCount = new Map<string, number>();
for (const seam of seams) seamCount.set(seam.path, (seamCount.get(seam.path) ?? 0) + 1);

const edited: EditedFile[] = [...changes]
  .filter(([, kind]) => kind === "M")
  .map(([path]) => ({
    path,
    ...(numstat.get(path) ?? { added: 0, removed: 0 }),
    seams: seamCount.get(path) ?? 0,
    allowed: unmarkedAllowed.includes(path),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));
const unmarked = edited.filter((file) => file.seams === 0 && !file.allowed);
const deleted = [...changes].filter(([, kind]) => kind === "D").map(([path]) => path);
const addedFiles = [...changes].filter(([, kind]) => kind === "A").map(([path]) => path);
const strays = addedFiles.filter((path) => !isUnder(path, owned) && path !== "FORK.md");

const out: string[] = [];
const pad = (value: string, width: number) => value.padEnd(width);
if (mergeBase !== null) {
  const behind = git(["rev-list", "--count", `HEAD..${options.upstream}`])?.trim() ?? "?";
  out.push(
    `Upstream ${options.upstream} @ ${upstreamHead}: ${behind === "0" ? "in sync" : `${behind} commits not merged yet`}.`,
    "",
    `Upstream files we edit: ${edited.length}`,
  );
  const width = Math.max(10, ...edited.map((file) => file.path.length)) + 2;
  for (const file of edited) {
    const note =
      file.seams > 0 ? `${file.seams} marked` : file.allowed ? "unmarked, allowed" : "UNMARKED";
    out.push(`  ${pad(file.path, width)}+${file.added} -${file.removed}  ${note}`);
  }
  if (deleted.length > 0) out.push(`Upstream files we delete: ${deleted.join(", ")}`);
  out.push(
    "",
    `Files only the fork has: ${addedFiles.length}` +
      (strays.length > 0 ? `; ${strays.length} outside the owned folders in FORK.md:` : ""),
    ...strays.map((path) => `  ${path}`),
  );
  out.push("", `Replaced upstream files: ${replaced.length}`);
  for (const file of replaced) {
    out.push(
      `  ${file.path} replaces ${file.original} @ ${file.base}: ${file.missed.length === 0 ? "up to date" : `${file.missed.length} upstream commits not ported`}`,
    );
    if (options.drift) out.push(...file.missed.map((commit) => `      ${commit}`));
  }
  out.push("");
}
out.push(...seams.map((seam) => `${seam.path}:${seam.line}: ${seam.text}`));
out.push(`${seams.length} seams in ${seamCount.size} files`);
const oversized = oversizedSeamWarning(edited);
if (oversized.length > 0) out.push("", ...oversized);
if (unmarked.length > 0)
  out.push(
    "",
    `Edited upstream files without a fork(...) marker: ${unmarked.map((file) => file.path).join(", ")}`,
    "Mark the edit, or list the file under fork-unmarked in FORK.md with a reason.",
  );
process.stdout.write(`${out.join("\n")}\n`);

if (options.write) {
  if (!forkDoc) fail("FORK.md not found.");
  const start = "<!-- fork-inventory:start -->";
  const end = "<!-- fork-inventory:end -->";
  const from = forkDoc.indexOf(start);
  const to = forkDoc.indexOf(end);
  if (from < 0 || to < from) fail(`FORK.md needs ${start} and ${end}.`);
  const rows = edited.map((file) => {
    const features = [
      ...new Set(seams.filter((seam) => seam.path === file.path).map((seam) => seam.feature)),
    ];
    return `| \`${file.path}\` | +${file.added} −${file.removed} | ${file.seams > 0 ? `${file.seams} (${features.join(", ")})` : "none, allowed"} |`;
  });
  const inventory = [
    start,
    "",
    `_Generated by \`node scripts/fork-seams.ts --write\` against \`${options.upstream}\` @ \`${upstreamHead ?? "?"}\`. Don't edit by hand._`,
    "",
    `**${edited.length} upstream files edited, ${seams.length} seams. ${addedFiles.length} fork-only files. ${replaced.length} replaced files.**`,
    "",
    "| Upstream file | Lines vs upstream | Markers |",
    "|---|---|---|",
    ...rows,
    "",
    ...(replaced.length > 0
      ? [
          "| Replaced file | Replaces | Base | Upstream commits not ported |",
          "|---|---|---|---|",
          ...replaced.map(
            (file) =>
              `| \`${file.path}\` | \`${file.original}\` | \`${file.base}\` | ${file.missed.length} |`,
          ),
          "",
        ]
      : []),
    end,
  ].join("\n");
  NodeFS.writeFileSync(
    forkDocPath,
    forkDoc.slice(0, from) + inventory + forkDoc.slice(to + end.length),
  );
  process.stdout.write("FORK.md inventory updated.\n");
}

if (options.check && unmarked.length > 0) process.exit(1);

if (options.check) {
  const violations = (git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]) ?? "")
    .split("\u0000")
    .filter(Boolean)
    .flatMap((path) => launchIdentityViolations(path, readText(path) ?? ""));
  if (violations.length > 0) {
    process.stderr.write(`Launch identity violations:\n${violations.join("\n")}\n`);
    process.exitCode = 1;
  }
}
