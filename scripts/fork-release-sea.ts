// @effect-diagnostics nodeBuiltinImport:off - SEA creation runs in Node before signing.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export function buildReleaseSea(bundle: string, cliAsset: string, output: string) {
  const staging = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tiller-sea-"));
  try {
    NodeFS.copyFileSync(bundle, NodePath.join(staging, "bin.mjs"));
    NodeFS.copyFileSync(cliAsset, NodePath.join(staging, "binMain.mjs"));
    NodeFS.writeFileSync(
      NodePath.join(staging, "sea.json"),
      JSON.stringify({
        main: "bin.mjs",
        mainFormat: "module",
        output,
        useCodeCache: false,
        assets: { "binMain.mjs": "binMain.mjs" },
        execArgv: ["--require-module"],
        disableExperimentalSEAWarning: true,
      }),
    );
    NodeChildProcess.execFileSync(process.execPath, ["--build-sea", "sea.json"], {
      cwd: staging,
      stdio: "inherit",
    });
  } finally {
    NodeFS.rmSync(staging, { recursive: true, force: true });
  }
}
