#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalFetch:off - Fork release tooling runs directly in Node.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeReadlinePromises from "node:readline/promises";
import {
  artifactHashes,
  compareVersions,
  notesSince,
  publishChannels,
  resumeState,
  waitForNpmVersion,
  type ReleaseState,
} from "./fork-release-publish.ts";
import {
  checkReleaseTree,
  requireReleaseCheckout,
  releaseTestArgs,
  releaseSmokeArgs,
} from "./fork-release-checks.ts";
import * as NodeOS from "node:os";
import { buildReleaseSea } from "./fork-release-sea.ts";
import { loadRepoEnv } from "./lib/public-config.ts";
import { draftNotes } from "./fork-release-notes.ts";

export const releaseRepository = "Antler-Web-Studios/tiller";
export const signingIdentity = "Developer ID Application: Antler Web Studios LLC (KF334LFC4D)";

export function releaseOptions(args: string[]) {
  const options = {
    dryRun: false,
    noPublish: false,
    resume: false,
    allowBranch: false,
    version: "",
    since: undefined as string | undefined,
    notesFile: undefined as string | undefined,
  };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i]!.split("=", 2);
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--no-publish") options.noPublish = true;
    else if (flag === "--resume") options.resume = true;
    else if (flag === "--allow-branch") options.allowBranch = true;
    else if (["--version", "--since", "--notes-file"].includes(flag!)) {
      const value = inline ?? args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(
          "Usage: --version X.Y.Z [--since DATE] [--notes-file PATH] [--resume] [--no-publish [--allow-branch]] [--dry-run]",
        );
      if (flag === "--version") options.version = value;
      if (flag === "--since") options.since = value;
      if (flag === "--notes-file") options.notesFile = value;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!options.version) throw new Error("Usage: --version X.Y.Z is required");
  compareVersions(options.version, "0.0.0");
  if (options.allowBranch && !options.noPublish)
    throw new Error("--allow-branch requires --no-publish");
  if (options.resume && options.dryRun) throw new Error("Cannot resume a dry run");
  if (options.since && !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(options.since))
    throw new Error("Invalid --since date");
  return options;
}

export function requireNotaryEnvironment(env: NodeJS.ProcessEnv) {
  for (const name of ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
    if (!env[name]?.trim())
      throw new Error(
        `Missing ${name}. Set the notarization API key path, key ID and issuer in the environment, or use --dry-run.`,
      );
  }
  if (!NodeFS.existsSync(env.APPLE_API_KEY!))
    throw new Error("APPLE_API_KEY must name a readable .p8 file.");
}

export function requireRust(version: string) {
  const [, major, minor] = /^rustc (\d+)\.(\d+)/.exec(version) ?? [];
  if (Number(major) < 1 || (Number(major) === 1 && Number(minor) < 95) || !major)
    throw new Error("Rust 1.95 or newer is required. See docs/operations/tiller-release.md.");
}

function requirePublishedMain(allowBranch: boolean, savedCommit?: string) {
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
  git("fetch", "--quiet", "origin", "main");
  requireReleaseCheckout(
    git("status", "--porcelain") === "",
    git("rev-parse", "HEAD"),
    git("rev-parse", "origin/main"),
    allowBranch,
    savedCommit,
  );
}

export function updateManifest(version: string, file: string, bytes: Uint8Array) {
  return `version: ${version}\nfiles:\n  - url: ${file}\n    sha512: ${NodeCrypto.createHash("sha512").update(bytes).digest("base64")}\n    size: ${bytes.length}\npath: ${file}\nsha512: ${NodeCrypto.createHash("sha512").update(bytes).digest("base64")}\nreleaseDate: '${new Date().toISOString()}'\n`;
}

export function cliVersionMatches(printed: string, version: string) {
  return printed === version || printed === `tiller v${version}`;
}

export function renderCask(template: string, version: string, sha256: string) {
  return template.replaceAll("{{VERSION}}", version).replaceAll("{{SHA256}}", sha256);
}

async function main() {
  const options = releaseOptions(process.argv.slice(2));
  const { dryRun, version } = options;
  // oxlint-disable-next-line t3code/no-global-process-runtime -- This CLI validates its actual build host.
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Run on an Apple Silicon Mac.");
  const root = NodePath.resolve(import.meta.dirname, "..");
  process.chdir(root);
  const capture = (command: string, args: string[], cwd = root) => {
    // npm may ask for a one-time password or print a browser login link.
    if (command === "npm" && args[0] === "publish") {
      NodeChildProcess.execFileSync(command, args, { cwd, stdio: "inherit" });
      return "";
    }
    return NodeChildProcess.execFileSync(command, args, {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  };
  const run = (command: string, args: string[], env = process.env) =>
    NodeChildProcess.execFileSync(command, args, { stdio: "inherit", env });
  if (
    !dryRun &&
    ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"].some((key) => !process.env[key])
  ) {
    const loaded = NodeChildProcess.execFileSync("/bin/zsh", [
      "-c",
      'set -a; source "$HOME/.config/tiller-release/env.sh"; env -0',
    ]);
    for (const entry of loaded.toString().split("\0")) {
      const at = entry.indexOf("=");
      const key = entry.slice(0, at);
      if (key.startsWith("APPLE_") && !process.env[key]) process.env[key] = entry.slice(at + 1);
    }
  }
  // Inherited from a terminal inside an Electron app, this stops the packaged app launching.
  delete process.env.ELECTRON_RUN_AS_NODE;
  process.env.PATH = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.local/share/vite-plus/bin:${process.env.PATH}`;
  process.env.DEVELOPER_DIR ??= "/Applications/Xcode.app/Contents/Developer";
  process.env.SDKROOT = capture("xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
  process.env.CC = capture("xcrun", ["--find", "clang"]);
  process.env.CXX = capture("xcrun", ["--find", "clang++"]);
  capture("xcodebuild", ["-version"]);
  requireRust(capture("rustc", ["--version"]));
  if (!dryRun) {
    requireNotaryEnvironment(process.env);
    if (
      !capture("security", ["find-identity", "-v", "-p", "codesigning"]).includes(signingIdentity)
    )
      throw new Error("Developer ID identity missing");
    capture("xcrun", [
      "notarytool",
      "history",
      "--key",
      process.env.APPLE_API_KEY!,
      "--key-id",
      process.env.APPLE_API_KEY_ID!,
      "--issuer",
      process.env.APPLE_API_ISSUER!,
      "--output-format",
      "json",
    ]);
  }
  const savedFile = NodePath.join(root, "release", `tiller-${version}`, "release-state.json");
  requirePublishedMain(
    options.allowBranch,
    options.resume ? JSON.parse(NodeFS.readFileSync(savedFile, "utf8")).commit : undefined,
  );
  for (const repo of [releaseRepository, "Antler-Web-Studios/homebrew-tap"]) {
    const access: { viewerPermission: string } = JSON.parse(
      capture("gh", ["repo", "view", repo, "--json", "viewerPermission"]),
    );
    if (!["ADMIN", "MAINTAIN", "WRITE"].includes(access.viewerPermission))
      throw new Error(`GitHub write access required: ${repo}`);
  }
  if (!options.noPublish) capture("npm", ["whoami"]);
  const releases: {
    tag_name: string;
    published_at: string;
    draft: boolean;
    prerelease: boolean;
  }[] = JSON.parse(capture("gh", ["api", `repos/${releaseRepository}/releases?per_page=100`]));
  const previous = releases
    .filter((r) => !r.draft && !r.prerelease)
    .sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  if (
    previous &&
    compareVersions(version, previous.tag_name.replace(/^v/, "")) <= 0 &&
    !(options.resume && previous.tag_name === `v${version}`)
  )
    throw new Error(`Version must be higher than ${previous.tag_name}`);
  if (!previous && !options.notesFile && !options.resume)
    throw new Error("First release requires --notes-file.");
  const output = NodePath.join(root, "release", `tiller-${version}${dryRun ? "-dry-run" : ""}`);
  const stateFile = NodePath.join(output, "release-state.json");
  const commit = capture("git", ["rev-parse", "HEAD"]);
  let state: ReleaseState = {
    version,
    commit,
    verified: false,
    github: false,
    npm: false,
    homebrew: false,
    tagged: false,
  };
  const save = () => {
    NodeFS.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
    NodeFS.renameSync(`${stateFile}.tmp`, stateFile);
  };
  const finish = async () => {
    const integrity: Record<string, string> = JSON.parse(
      NodeFS.readFileSync(NodePath.join(output, "artifact-hashes.json"), "utf8"),
    );
    const assets = Object.keys(integrity);
    if (JSON.stringify(artifactHashes(output, assets)) !== JSON.stringify(integrity))
      throw new Error("Artifacts changed since verification");
    if (dryRun || options.noPublish) {
      console.log(`Verified artifacts: ${output}; publishing disabled.`);
      return;
    }
    const prompt = NodeReadlinePromises.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    console.log(NodeFS.readFileSync(NodePath.join(output, "release-notes.md"), "utf8"));
    try {
      if (
        (await prompt.question(
          `Publish ${version}: GitHub ${releaseRepository}, npm tiller-app, Homebrew Antler-Web-Studios/homebrew-tap, then the source tag? Type publish: `,
        )) !== "publish"
      )
        throw new Error("Publishing cancelled; use --resume");
    } finally {
      prompt.close();
    }
    let failed = false;
    try {
      publishChannels(
        capture,
        state,
        output,
        assets.filter((a) => !["tiller.rb", "tiller-app.tgz", "release-notes.md"].includes(a)),
        save,
      );
    } catch (error) {
      failed = true;
      console.error("Publication interrupted; use --resume", error);
    }
    for (const [channel, check] of Object.entries({
      GitHub: async () => {
        const response = await fetch(
          `https://github.com/${releaseRepository}/releases/latest/download/latest-mac.yml`,
          { cache: "no-store" },
        );
        if (
          !response.ok ||
          (await response.text()) !==
            NodeFS.readFileSync(NodePath.join(output, "latest-mac.yml"), "utf8")
        )
          throw new Error("Public update manifest differs");
      },
      npm: async () => {
        waitForNpmVersion(capture, version);
      },
      Homebrew: async () => {
        if (
          capture("gh", [
            "api",
            "repos/Antler-Web-Studios/homebrew-tap/contents/Casks/tiller.rb?ref=main",
            "-H",
            "Accept: application/vnd.github.raw+json",
          ]) !== NodeFS.readFileSync(NodePath.join(output, "tiller.rb"), "utf8").trim()
        )
          throw new Error("Tap differs");
      },
    })) {
      try {
        await check();
        console.log(`${channel}: PASS`);
      } catch (error) {
        failed = true;
        console.error(`${channel}: FAIL`, error);
      }
    }
    if (failed) throw new Error("Post-publish checks failed; inspect channels and rerun --resume");
  };
  if (options.resume) {
    state = resumeState(JSON.parse(NodeFS.readFileSync(stateFile, "utf8")), version, commit);
    await finish();
    return;
  }
  if (NodeFS.existsSync(output))
    throw new Error(`Output already exists: ${output}; use --resume or move it aside.`);
  run("vp", releaseTestArgs);
  const notes = options.notesFile
    ? NodeFS.readFileSync(options.notesFile, "utf8")
    : draftNotes(notesSince(options.since, previous));
  console.log(`Release notes draft:\n${notes}`);
  NodeFS.mkdirSync(output, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(output, "release-notes.md"), notes);
  save();
  const env = {
    ...process.env,
    TILLER_RELEASE: "1",
    RUSTFLAGS: `${process.env.RUSTFLAGS ?? ""} --remap-path-prefix=${NodeOS.homedir()}=/build`,
    VP_NODE_VERSION: process.versions.node,
    T3CODE_DESKTOP_UPDATE_REPOSITORY: releaseRepository,
    T3CODE_DESKTOP_SIGNED: "false",
    T3CODE_CLI_MAC_SIGN_IDENTITY: dryRun ? "-" : signingIdentity,
  };
  if (dryRun)
    for (const key of [
      "APPLE_API_KEY",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
    ])
      delete env[key as keyof typeof env];
  run(
    "node",
    [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dir",
      "--arch",
      "arm64",
      "--build-version",
      version,
      "--output-dir",
      output,
    ],
    env,
  );
  const appParent = NodeFS.readdirSync(output).find((name) => name.startsWith("mac"));
  const app = appParent
    ? NodePath.join(output, appParent, "Tiller.app")
    : NodePath.join(output, "Tiller.app");
  if (!NodeFS.existsSync(app)) throw new Error(`Packaged app missing: ${app}`);
  NodeFS.writeFileSync(
    NodePath.join(app, "Contents/Resources/app-update.yml"),
    "provider: github\nowner: Antler-Web-Studios\nrepo: tiller\nupdaterCacheDirName: tiller-updater\n",
  );
  const zipName = `Tiller-${version}-arm64.zip`;
  const zip = NodePath.join(output, zipName);
  const notarize = (file: string) => {
    const result = NodeChildProcess.execFileSync(
      "xcrun",
      [
        "notarytool",
        "submit",
        file,
        "--key",
        process.env.APPLE_API_KEY!,
        "--key-id",
        process.env.APPLE_API_KEY_ID!,
        "--issuer",
        process.env.APPLE_API_ISSUER!,
        "--wait",
        "--output-format",
        "json",
      ],
      { encoding: "utf8" },
    );
    const status: { status: string } = JSON.parse(result);
    if (status.status !== "Accepted")
      throw new Error("Notarization was not accepted; inspect notarytool history.");
  };
  if (!dryRun) {
    const require = NodeModule.createRequire(import.meta.url);
    const { sign } = require("@electron/osx-sign") as typeof import("@electron/osx-sign");
    await sign({
      app,
      identity: signingIdentity,
      platform: "darwin",
      optionsForFile: () => ({
        entitlements: NodePath.join(root, "scripts/fork-release-entitlements.plist"),
        hardenedRuntime: true,
      }),
    });
    run("ditto", ["-c", "-k", "--keepParent", app, zip]);
    notarize(zip);
    run("xcrun", ["stapler", "staple", app]);
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
    run("xcrun", ["stapler", "validate", app]);
  }
  run("node", releaseSmokeArgs(NodePath.join(app, "Contents/MacOS/Tiller"), output));
  const require = NodeModule.createRequire(import.meta.url);
  const asar = require("@electron/asar") as typeof import("@electron/asar");
  const inspection = NodeFS.mkdtempSync(NodePath.join(output, ".inspect-"));
  const licence = NodeFS.readFileSync(NodePath.join(root, "LICENSE"), "utf8");
  const forbidden = Object.entries(
    loadRepoEnv({ baseEnv: { ...process.env, TILLER_RELEASE: undefined } }),
  )
    .filter(([key]) => /CLERK|RELAY/.test(key))
    .map(([, value]) => value ?? "");
  asar.extractAll(NodePath.join(app, "Contents/Resources/app.asar"), inspection);
  checkReleaseTree(inspection, licence, NodeOS.homedir(), forbidden);
  checkReleaseTree(app, licence, NodeOS.homedir(), forbidden, false);
  NodeFS.rmSync(inspection, { recursive: true });
  run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  const dmgName = `Tiller-${version}-arm64.dmg`;
  const dmg = NodePath.join(output, dmgName);
  const tools = NodePath.join(output, ".dmg-tools");
  run("python3", ["-m", "venv", tools]);
  run(NodePath.join(tools, "bin/pip"), ["install", "-r", "scripts/dmg/requirements.txt"]);
  run(NodePath.join(tools, "bin/python"), ["scripts/dmg/render.py", output]);
  run("tiffutil", [
    "-cathidpicheck",
    NodePath.join(output, "background.png"),
    NodePath.join(output, "background@2x.png"),
    "-out",
    NodePath.join(output, "background.tiff"),
  ]);
  run(NodePath.join(tools, "bin/dmgbuild"), [
    "-s",
    "scripts/dmg/settings.py",
    "-D",
    `app=${app}`,
    "-D",
    `artwork=${output}`,
    "-D",
    `icon=${NodePath.join(root, "apps/web/src/fork/assets/tiller.icns")}`,
    "Tiller",
    dmg,
  ]);
  if (!dryRun) {
    run("codesign", ["--sign", signingIdentity, "--timestamp", dmg]);
    notarize(dmg);
    run("xcrun", ["stapler", "staple", dmg]);
    run("codesign", ["--verify", "--strict", dmg]);
    run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", dmg]);
    run("xcrun", ["stapler", "validate", dmg]);
  }
  NodeFS.copyFileSync(dmg, NodePath.join(output, "Tiller-arm64.dmg"));
  const manifests = [
    "apps/server/package.json",
    "apps/desktop/package.json",
    "apps/web/package.json",
    "packages/contracts/package.json",
  ].map((file) => ({ file, bytes: NodeFS.readFileSync(file) }));
  try {
    run("node", ["scripts/update-release-package-versions.ts", version], env);
    run("node", ["apps/server/scripts/cli.ts", "build-exe"], env);
    buildReleaseSea(
      NodePath.join(root, "apps/server/dist-exe/bin.mjs"),
      NodePath.join(root, "apps/server/dist-exe/binMain.mjs"),
      NodePath.join(root, "apps/server/dist-exe/tiller"),
    );
    run(
      "node",
      [
        "scripts/build-cli-archive.ts",
        "--platform",
        "mac",
        "--arch",
        "arm64",
        "--version",
        version,
        "--resource-monitor-dir",
        NodePath.join(app, "Contents/Resources/resource-monitor"),
        "--output-dir",
        output,
      ],
      env,
    );
  } finally {
    for (const { file, bytes } of manifests) NodeFS.writeFileSync(file, bytes);
  }
  {
    const cliCheck = NodeFS.mkdtempSync(NodePath.join(output, ".cli-notary-"));
    try {
      run("tar", [
        "-xzf",
        NodePath.join(output, `tiller-${version}-darwin-arm64.tar.gz`),
        "-C",
        cliCheck,
      ]);
      const cliTree = NodePath.join(cliCheck, `tiller-${version}-darwin-arm64`);
      checkReleaseTree(cliTree, licence, NodeOS.homedir(), forbidden);
      const printed = capture(NodePath.join(cliTree, "tiller"), ["--version"]);
      if (!cliVersionMatches(printed, version)) throw new Error(`CLI version mismatch: ${printed}`);
      if (!dryRun) {
        run("codesign", ["--verify", "--strict", NodePath.join(cliTree, "tiller")]);
        const cliZip = NodePath.join(cliCheck, "cli.zip");
        run("ditto", ["-c", "-k", "--keepParent", cliTree, cliZip]);
        notarize(cliZip);
      }
    } finally {
      NodeFS.rmSync(cliCheck, { recursive: true, force: true });
    }
  }
  NodeFS.writeFileSync(
    NodePath.join(output, "latest-mac.yml"),
    updateManifest(version, zipName, NodeFS.readFileSync(zip)),
  );
  const assets = [
    dmgName,
    "Tiller-arm64.dmg",
    zipName,
    "latest-mac.yml",
    `tiller-${version}-darwin-arm64.tar.gz`,
  ];
  NodeFS.writeFileSync(
    NodePath.join(output, "SHA256SUMS"),
    assets
      .map(
        (name) =>
          `${NodeCrypto.createHash("sha256")
            .update(NodeFS.readFileSync(NodePath.join(output, name)))
            .digest("hex")}  ${name}\n`,
      )
      .join(""),
  );
  const template = NodeFS.readFileSync(
    NodePath.join(root, "scripts/homebrew/tiller.rb.template"),
    "utf8",
  );
  NodeFS.writeFileSync(
    NodePath.join(output, "tiller.rb"),
    renderCask(
      template,
      version,
      NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(dmg)).digest("hex"),
    ),
  );
  run("node", ["scripts/build-npm-launcher.ts", "--version", version, "--output-dir", output], env);
  run("npm", ["pack", "--dry-run", NodePath.join(output, "tiller-app")]);
  if (
    !NodeFS.readFileSync(dmg).equals(NodeFS.readFileSync(NodePath.join(output, "Tiller-arm64.dmg")))
  )
    throw new Error("Stable DMG differs");
  run("hdiutil", ["verify", dmg]);
  NodeFS.writeFileSync(
    NodePath.join(output, "artifact-hashes.json"),
    JSON.stringify(
      artifactHashes(output, [
        ...assets,
        "SHA256SUMS",
        "tiller.rb",
        "tiller-app.tgz",
        "release-notes.md",
      ]),
    ),
  );
  state.verified = true;
  save();
  await finish();
}

if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Release failed");
    process.exitCode = 1;
  });
