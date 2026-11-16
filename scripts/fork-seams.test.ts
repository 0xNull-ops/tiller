// fork(launch)
import { describe, expect, it } from "vite-plus/test";

import {
  FORK_LINE_WARN_LIMIT,
  launchIdentityViolations,
  oversizedSeamWarning,
  oversizedUpstreamFiles,
} from "./lib/fork-seam-rules.ts";

const file = (path: string, added: number, removed = 0) => ({ path, added, removed });

describe("fork seam size advisory", () => {
  it("warns only above the fork-line limit", () => {
    const files = [
      file("small.ts", 3),
      file("at-limit.ts", FORK_LINE_WARN_LIMIT),
      file("big.ts", FORK_LINE_WARN_LIMIT + 1),
    ];

    expect(oversizedUpstreamFiles(files).map((entry) => entry.path)).toEqual(["big.ts"]);
    expect(oversizedSeamWarning(files)).toEqual([
      `Upstream files with more than ${FORK_LINE_WARN_LIMIT} fork lines (move the logic into a fork-owned file):`,
      `  big.ts +${FORK_LINE_WARN_LIMIT + 1}`,
    ]);
  });

  it("counts added lines only, so a net reduction is not a seam", () => {
    expect(oversizedUpstreamFiles([file("rewritten.ts", 0, 240)])).toEqual([]);
  });

  it("lists the worst file first, then alphabetically", () => {
    const files = [file("b.ts", 80), file("a.ts", 80), file("c.ts", 400)];

    expect(oversizedUpstreamFiles(files).map((entry) => entry.path)).toEqual([
      "c.ts",
      "a.ts",
      "b.ts",
    ]);
  });

  it("says nothing when every upstream file is a seam", () => {
    expect(oversizedSeamWarning([file("one.ts", 1), file("two.ts", 12)])).toEqual([]);
  });
});

it("rejects upstream shipping identity without flagging credit, models or fixtures", () => {
  const path = "apps/server/src/config.ts";
  for (const identity of [
    "https://ingest.t3.codes",
    "https://registry.npmjs.org/t3/latest",
    '"pingdotgg/t3code"',
    "https://github.com/pingdotgg/t3code/releases/download",
    "com.t3tools.t3code",
    "t3code://auth/codex",
    '"t3code:"',
  ])
    expect(launchIdentityViolations(path, identity)).toHaveLength(1);
  for (const source of [
    "built on T3 Code",
    "https://raw.githubusercontent.com/pingdotgg/t3code/main/models.json",
    "https://github.com/pingdotgg/t3code/pull/25825",
  ])
    expect(launchIdentityViolations(path, source)).toEqual([]);
  expect(
    launchIdentityViolations("apps/server/src/triage/config.ts", '"pingdotgg/t3code"'),
  ).toHaveLength(1);
  expect(
    launchIdentityViolations("apps/desktop/src/example.test.ts", "com.t3tools.t3code"),
  ).toEqual([]);
});
