// @effect-diagnostics nodeBuiltinImport:off - Release artifact inspection runs in Node.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export function requireReleaseCheckout(
  clean: boolean,
  head: string,
  main: string,
  allowBranch: boolean,
  savedCommit?: string,
) {
  if (!clean || (savedCommit ? head !== savedCommit : !allowBranch && head !== main))
    throw new Error(
      savedCommit
        ? "Resume requires a clean tree at the saved commit."
        : "Release from a clean checkout of origin/main.",
    );
}

export const releaseTestArgs = [
  "test",
  "run",
  "scripts/fork-release.test.ts",
  "scripts/fork-release-publish.test.ts",
  "scripts/fork-release-checks.test.ts",
  "scripts/build-npm-launcher.test.ts",
  "apps/server/src/workflows",
  "packages/contracts/src/workflow.test.ts",
  "packages/contracts/src/workflowSchedule.test.ts",
];
export const releaseSmokeArgs = (executable: string, output: string) => [
  "scripts/smoke-desktop-app.ts",
  "--executable",
  executable,
  "--artifacts-dir",
  NodePath.join(output, "smoke"),
];

export function checkReleaseTree(
  root: string,
  licence: string,
  ownerHome: string,
  forbiddenValues: readonly string[],
  requireNotice = true,
) {
  let noticeFound = false;
  const walk = (dir: string) => {
    for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
      const file = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = NodeFS.readFileSync(file);
      if (bytes.includes(ownerHome)) throw new Error(`Owner home path in ${file}`);
      if (forbiddenValues.some((value) => value && bytes.includes(value)))
        throw new Error(`Disabled public configuration in ${file}`);
      if (entry.name === "LICENSE-T3-CODE" && bytes.toString() === licence) noticeFound = true;
      if (entry.name === "third-party-licenses.json") {
        const manifest = JSON.parse(bytes.toString()) as {
          entries: { name: string; noticeText: string }[];
        };
        if (
          manifest.entries.some(
            (e) => e.name === "T3 Code" && e.noticeText.trim() === licence.trim(),
          )
        )
          noticeFound = true;
      }
    }
  };
  walk(root);
  if (requireNotice && !noticeFound) throw new Error(`T3 Code MIT notice missing from ${root}`);
}
