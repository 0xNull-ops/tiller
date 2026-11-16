import * as NodeEvents from "node:events";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  execFile: mocks.execFile,
}));

import { POWERSHELL_ARGS, runPkcheck, runPowerShellScript } from "./CredentialOsPresenceProcess.ts";

type ExecFileCallback = (error: unknown, stdout: string) => void;

class FakeStdout extends NodeEvents.EventEmitter {
  setEncoding(_encoding: string) {}
}

class FakeChild extends NodeEvents.EventEmitter {
  readonly stdout = new FakeStdout();
  readonly stdinText: string[] = [];
  readonly stdin = {
    end: (text: string) => {
      this.stdinText.push(text);
    },
  };
}

const lastChild = (): FakeChild => mocks.spawn.mock.results.at(-1)!.value as FakeChild;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawn.mockImplementation(() => new FakeChild());
});

describe("runPowerShellScript", () => {
  it("sends the script on stdin and keeps the command line static", async () => {
    const promise = runPowerShellScript("Write-Output 'Verified'");
    const child = lastChild();

    expect(mocks.spawn).toHaveBeenCalledWith("powershell.exe", [...POWERSHELL_ARGS], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    expect(POWERSHELL_ARGS.join(" ")).not.toContain("Write-Output");
    expect(child.stdinText).toEqual(["Write-Output 'Verified'"]);

    child.stdout.emit("data", "Verified\n");
    child.emit("close", 0);
    await expect(promise).resolves.toEqual({ stdout: "Verified\n", exitCode: 0 });
  });

  it("reports a missing PowerShell as unreachable", async () => {
    const promise = runPowerShellScript("Write-Output 'Verified'");
    lastChild().emit("error", new Error("ENOENT"));
    await expect(promise).resolves.toEqual({ stdout: "", exitCode: -1 });
  });
});

describe("runPkcheck", () => {
  it("passes only the polkit arguments, with no PIN in them", async () => {
    mocks.execFile.mockImplementation(
      (_file: string, _args: readonly string[], _options: unknown, callback: ExecFileCallback) => {
        callback(null, "");
      },
    );
    const args = ["--action-id", "org.freedesktop.policykit.exec", "--process", "42"];
    await expect(runPkcheck(args)).resolves.toEqual({ stdout: "", exitCode: 0 });
    expect(mocks.execFile).toHaveBeenCalledWith(
      "pkcheck",
      args,
      { windowsHide: true },
      expect.any(Function),
    );
  });

  it("surfaces pkcheck's exit code and treats a missing binary as unreachable", async () => {
    mocks.execFile.mockImplementation(
      (_file: string, _args: readonly string[], _options: unknown, callback: ExecFileCallback) => {
        callback(Object.assign(new Error("not authorized"), { code: 1 }), "");
      },
    );
    await expect(runPkcheck([])).resolves.toEqual({ stdout: "", exitCode: 1 });

    mocks.execFile.mockImplementation(
      (_file: string, _args: readonly string[], _options: unknown, callback: ExecFileCallback) => {
        callback(Object.assign(new Error("missing"), { code: "ENOENT" }), "");
      },
    );
    await expect(runPkcheck([])).resolves.toEqual({ stdout: "", exitCode: -1 });
  });
});
