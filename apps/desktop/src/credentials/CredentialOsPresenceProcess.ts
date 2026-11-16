// @effect-diagnostics nodeBuiltinImport:off - Windows PowerShell and polkit are platform boundaries; their output is what proves user presence.
import * as NodeChildProcess from "node:child_process";

import type {
  PkcheckRunner,
  PowerShellScriptRunner,
  ProcessResult,
} from "./CredentialOsPresence.ts";

const UNREACHABLE: ProcessResult = { stdout: "", exitCode: -1 };

export const POWERSHELL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  "-",
] as const;

/**
 * The script goes in on stdin, never on the command line: a shared machine can read another
 * process's arguments, and this one runs on behalf of a secret store.
 */
export const runPowerShellScript: PowerShellScriptRunner = (script) =>
  new Promise((resolve) => {
    const child = NodeChildProcess.spawn("powershell.exe", [...POWERSHELL_ARGS], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", () => resolve(UNREACHABLE));
    child.once("close", (code) => resolve({ stdout, exitCode: code ?? -1 }));
    child.stdin?.end(script, "utf8");
  });

export const runPkcheck: PkcheckRunner = (args) =>
  new Promise((resolve) => {
    NodeChildProcess.execFile("pkcheck", [...args], { windowsHide: true }, (error, stdout) => {
      if (error === null) {
        resolve({ stdout, exitCode: 0 });
        return;
      }
      resolve({
        stdout: typeof stdout === "string" ? stdout : "",
        exitCode: typeof error.code === "number" ? error.code : -1,
      });
    });
  });
