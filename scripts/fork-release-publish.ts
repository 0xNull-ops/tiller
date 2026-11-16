// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Maintainer release CLI.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";

export const repository = "Antler-Web-Studios/tiller";
export const tap = "Antler-Web-Studios/homebrew-tap";
export type Command = (command: string, args: string[], cwd?: string) => string;
export type ReleaseState = {
  version: string;
  commit: string;
  verified: boolean;
  github: boolean;
  npm: boolean;
  homebrew: boolean;
  tagged: boolean;
};

export function compareVersions(a: string, b: string) {
  const parts = (s: string) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(s))
      throw new Error(`Invalid stable semver: ${s}`);
    return s.split(".").map(BigInt);
  };
  const left = parts(a),
    right = parts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1;
  return 0;
}
export function notesSince(
  since: string | undefined,
  previous: { published_at: string } | undefined,
) {
  return since ?? previous?.published_at ?? "1970-01-01T00:00:00Z";
}
export function resumeState(state: ReleaseState, version: string, commit: string) {
  if (state.version !== version || state.commit !== commit || !state.verified)
    throw new Error("Resume needs verified artifacts from this version and source commit.");
  return state;
}
const NPM_VISIBLE_ATTEMPTS = 30;
const NPM_VISIBLE_DELAY_MS = 10_000;

/** A new version takes a few minutes to appear in npm's registry, longer for a new package. */
const ASSET_DOWNLOAD_ATTEMPTS = 5;

// GitHub can answer 404 for an asset uploaded seconds ago, so the check retries before failing.
export function downloadReleaseAssets(
  run: Command,
  tag: string,
  repository: string,
  dir: string,
  sleep: (ms: number) => void = (ms) =>
    void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
) {
  for (let attempt = 1; ; attempt++) {
    try {
      run("gh", ["release", "download", tag, "-R", repository, "--dir", dir, "--clobber"]);
      return;
    } catch (error) {
      if (attempt >= ASSET_DOWNLOAD_ATTEMPTS) throw error;
      sleep(attempt * 5_000);
    }
  }
}

export function waitForNpmVersion(
  run: Command,
  version: string,
  sleep: (ms: number) => void = (ms) =>
    void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
) {
  for (let attempt = 1; attempt <= NPM_VISIBLE_ATTEMPTS; attempt++) {
    try {
      if (run("npm", ["view", "tiller-app", "version"]).trim() === version) return;
    } catch {
      // A package's first version answers 404 until the registry catches up.
    }
    if (attempt < NPM_VISIBLE_ATTEMPTS) sleep(NPM_VISIBLE_DELAY_MS);
  }
  throw new Error("npm version verification failed");
}

export function publishChannels(
  run: Command,
  state: ReleaseState,
  output: string,
  assets: string[],
  save: () => void,
) {
  const tag = `v${state.version}`;
  if (!state.github) {
    const releases: { tag_name: string; draft: boolean }[] = JSON.parse(
      run("gh", ["api", `repos/${repository}/releases?per_page=100`]),
    );
    const existing = releases.find((r) => r.tag_name === tag);
    if (!existing)
      run("gh", [
        "release",
        "create",
        tag,
        "-R",
        repository,
        "--draft",
        "--title",
        `Tiller ${state.version}`,
        "--notes-file",
        NodePath.join(output, "release-notes.md"),
      ]);
    if (!existing || existing.draft)
      run("gh", [
        "release",
        "upload",
        tag,
        "-R",
        repository,
        "--clobber",
        ...assets.map((a) => NodePath.join(output, a)),
      ]);
    const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tiller-assets-"));
    try {
      downloadReleaseAssets(run, tag, repository, scratch);
      for (const asset of assets) {
        if (
          !NodeFS.readFileSync(NodePath.join(scratch, asset)).equals(
            NodeFS.readFileSync(NodePath.join(output, asset)),
          )
        )
          throw new Error(`Remote asset differs: ${asset}`);
      }
    } finally {
      NodeFS.rmSync(scratch, { recursive: true, force: true });
    }
    if (!existing || existing.draft)
      run("gh", ["release", "edit", tag, "-R", repository, "--draft=false", "--latest"]);
    state.github = true;
    save();
  }
  if (!state.npm) {
    let versions: string[];
    try {
      versions = JSON.parse(run("npm", ["view", "tiller-app", "versions", "--json"]));
    } catch (error) {
      if (typeof error !== "object" || error === null || !("stdout" in error)) throw error;
      const response: { error?: { code?: string } } = JSON.parse(String(error.stdout));
      if (response.error?.code !== "E404") throw error;
      versions = [];
    }
    if (!versions.includes(state.version))
      run("npm", ["publish", NodePath.join(output, "tiller-app.tgz"), "--access", "public"]);
    waitForNpmVersion(run, state.version);
    state.npm = true;
    save();
  }
  if (!state.homebrew) {
    const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tiller-tap-"));
    try {
      run("gh", ["repo", "clone", tap, scratch, "--", "--branch", "main", "--depth", "1"]);
      NodeFS.mkdirSync(NodePath.join(scratch, "Casks"), { recursive: true });
      NodeFS.copyFileSync(
        NodePath.join(output, "tiller.rb"),
        NodePath.join(scratch, "Casks/tiller.rb"),
      );
      if (run("git", ["status", "--porcelain"], scratch).trim()) {
        run("git", ["add", "Casks/tiller.rb"], scratch);
        run(
          "git",
          ["-c", "core.hooksPath=/dev/null", "commit", "-m", `Release Tiller ${state.version}`],
          scratch,
        );
        run("git", ["push", "origin", "HEAD:main"], scratch);
      }
    } finally {
      NodeFS.rmSync(scratch, { recursive: true, force: true });
    }
    state.homebrew = true;
    save();
  }
  if (!state.tagged) {
    const refs = run("git", ["ls-remote", "origin", `refs/tags/${tag}`]).trim();
    if (refs && refs.split(/\s/)[0] !== state.commit)
      throw new Error("Source tag points at a different commit");
    if (!refs) run("git", ["push", "origin", `${state.commit}:refs/tags/${tag}`]);
    state.tagged = true;
    save();
  }
}
export function artifactHashes(output: string, assets: string[]) {
  return Object.fromEntries(
    assets.map((name) => [
      name,
      NodeCrypto.createHash("sha256")
        .update(NodeFS.readFileSync(NodePath.join(output, name)))
        .digest("hex"),
    ]),
  );
}
