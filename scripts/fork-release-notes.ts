#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Fork release tooling runs directly in Node.
import * as NodeChildProcess from "node:child_process";

// Sync, launch and tooling work means nothing to users, and the release page is public.
const INTERNAL_TITLE =
  /^(?:sync:|(?:ci|chore|test|docs|build)\b|\w+\((?:sync|launch|ci|release)\)!?:)/i;
const INTERNAL_WORDS = /\b(?:fork|upstream|T3|seams?|RPCs?)\b/i;

export function releaseNotes(prs: readonly { title: string }[]): string {
  const lines = prs
    .filter(({ title }) => !INTERNAL_TITLE.test(title) && !INTERNAL_WORDS.test(title))
    .map(({ title }) =>
      title
        .replace(/^\w+(?:\([^)]*\))?!?:\s*/, "")
        .replace(/\s*\(#\d+\)/g, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/#\d+/g, "")
        .trim(),
    )
    .filter(Boolean)
    .map((title) => `- ${title.charAt(0).toUpperCase()}${title.slice(1)}`);
  return [...lines, ""].join("\n");
}

export function draftNotes(since: string): string {
  const prs: { title: string }[] = JSON.parse(
    NodeChildProcess.execFileSync(
      "gh",
      [
        "pr",
        "list",
        "-R",
        "0xNull-ops/tiller",
        "--state",
        "merged",
        "--search",
        `merged:>${since} base:main`,
        "--limit",
        "1000",
        "--json",
        "title",
      ],
      { encoding: "utf8" },
    ),
  );
  if (prs.length === 1000)
    throw new Error("Release notes query reached its limit; narrow --since.");
  return releaseNotes(prs);
}

if (import.meta.main) {
  const since = process.argv[2];
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since))
    throw new Error("Usage: node scripts/fork-release-notes.ts YYYY-MM-DD");
  process.stdout.write(draftNotes(since));
}
