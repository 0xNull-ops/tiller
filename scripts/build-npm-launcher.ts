#!/usr/bin/env node
// fork(launch): output <output-dir>/tiller-app/ and publishable tiller-app.tgz.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import { windowsSystemTar } from "./lib/windows-tar.ts";

// fork(launch)
export const NPM_LAUNCHER_PACKAGE_NAME = "tiller-app";

const encodePackageJson = Schema.encodeEffect(fromJsonStringPretty(Schema.Unknown));

export class NpmLauncherCommandFailedError extends Schema.TaggedError<NpmLauncherCommandFailedError>()(
  "NpmLauncherCommandFailedError",
  { command: Schema.String, exitCode: Schema.Int },
) {
  override get message(): string {
    return `${this.command} exited with code ${this.exitCode}.`;
  }
}

/** engines requires import.meta.dirname and fetch. `t3code` is read back by npmReleaseDatabaseMigration. */
export function npmLauncherPackageManifest(version: string, databaseMigration: number) {
  return {
    name: NPM_LAUNCHER_PACKAGE_NAME,
    version,
    description:
      // fork(launch)
      "Tiller CLI (Apple Silicon Macs only). Downloads the self-contained executable for this platform from the GitHub Release.",
    license: "MIT", // fork(launch)
    // fork(launch)
    repository: "github:Antler-Web-Studios/tiller",
    // fork(launch)
    bin: { tiller: "./bin/tiller.mjs" },
    files: ["bin", "dist", "LICENSE-T3-CODE", "README.md"], // fork(launch)
    engines: { node: ">=20.11" },
    t3code: { databaseMigration },
  };
}

/** Highest server migration id, from the `NNN_Name.ts` files the server registers. */
const latestServerMigrationId = Effect.fn("latestServerMigrationId")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* path.fromFileUrl(
    new URL("../apps/server/src/persistence/Migrations/", import.meta.url),
  );
  const ids = (yield* fs.readDirectory(dir)).flatMap((name) => {
    const id = /^(\d+)_\w+\.ts$/.exec(name)?.[1];
    return id === undefined ? [] : [Number(id)];
  });
  return Math.max(0, ...ids);
});

export const buildNpmLauncher = Effect.fn("buildNpmLauncher")(function* (input: {
  readonly version: string;
  readonly outputDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const sourceDir = yield* path.fromFileUrl(new URL("./npm-launcher/", import.meta.url));

  yield* fs.makeDirectory(input.outputDir, { recursive: true });
  const scratch = yield* fs.makeTempDirectoryScoped({
    directory: input.outputDir,
    prefix: ".launcher-",
  });
  const stageDir = path.join(scratch, "package");
  yield* fs.makeDirectory(path.join(stageDir, "bin"), { recursive: true });
  yield* fs.makeDirectory(path.join(stageDir, "dist"));
  yield* fs.writeFileString(
    path.join(stageDir, "package.json"),
    `${yield* encodePackageJson(
      npmLauncherPackageManifest(input.version, yield* latestServerMigrationId()),
    )}\n`,
  );
  // fork(launch)
  yield* fs.copyFile(path.join(sourceDir, "t3.mjs"), path.join(stageDir, "bin/tiller.mjs"));
  // fork(launch)
  yield* fs.chmod(path.join(stageDir, "bin/tiller.mjs"), 0o755);
  yield* fs.copyFile(path.join(sourceDir, "bin.mjs"), path.join(stageDir, "dist/bin.mjs"));
  // fork(launch)
  yield* fs.copyFile(
    yield* path.fromFileUrl(new URL("../LICENSE", import.meta.url)),
    path.join(stageDir, "LICENSE-T3-CODE"),
  );
  yield* fs.writeFileString(
    path.join(stageDir, "README.md"),
    "# Tiller\n\nTiller is a free, open-source (MIT) app for coding agents, built on T3 Code. This package installs the Tiller CLI for Apple Silicon Macs.\n\nhttps://tiller.shipr.app\n\nSource: https://github.com/0xNull-ops/tiller\n\nThe MIT license, including T3 Code's notice, is in LICENSE-T3-CODE.\n",
  );

  const packageDir = path.join(input.outputDir, NPM_LAUNCHER_PACKAGE_NAME);
  const tarball = path.join(input.outputDir, `${NPM_LAUNCHER_PACKAGE_NAME}.tgz`);
  yield* fs.remove(tarball, { force: true });
  const tar = (yield* HostProcess.Platform) === "win32" ? windowsSystemTar() : "tar";
  // fork(launch): npm's registry rejects folder entries, so list files only.
  const entries = yield* fs.readDirectory(stageDir, { recursive: true });
  const members: string[] = [];
  for (const entry of entries) {
    const info = yield* fs.stat(path.join(stageDir, entry));
    if (info.type === "File") members.push(path.join("package", entry));
  }
  // npm tarballs root everything under `package/`.
  const child = yield* spawner.spawn(
    ChildProcess.make(tar, ["-czf", tarball, "-C", scratch, ...members], {
      // macOS tar otherwise adds a hidden ._ file per member.
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new NpmLauncherCommandFailedError({ command: `tar (${tarball})`, exitCode });
  }
  yield* fs.remove(packageDir, { recursive: true, force: true });
  yield* fs.rename(stageDir, packageDir);
  yield* Effect.log(`[npm-launcher] Wrote ${packageDir} and ${tarball}`);
  return { packageDir, tarball };
}, Effect.scoped);

const command = Command.make(
  "build-npm-launcher",
  {
    version: Flag.String("version").pipe(
      Flag.withDescription("Exact release version; the launcher downloads this version's archive."),
    ),
    outputDir: Flag.String("output-dir").pipe(Flag.withDefault("npm-packages")),
  },
  buildNpmLauncher,
  // fork(launch)
).pipe(Command.withDescription("Build the Tiller npm launcher package."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
