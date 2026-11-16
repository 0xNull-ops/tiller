import { expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { credentialWorkLogSummary } from "./credentialWorkLogSummary";
import { credentialActivityFixture, credentialHistoryFixture } from "./credentialActivityFixture";

const item = {
  toolName: "mcp__t3_code__credential_exec",
  input: { credential: "github", command: "echo TOP_SECRET", env: { TOKEN: "TOP_SECRET" } },
  output: { exitCode: 0, stdout: "TOP_SECRET", stderr: "TOP_SECRET" },
  threadId: credentialActivityFixture.caller.threadId,
  startedAt: DateTime.makeUnsafe("2026-10-22T14:00:00Z"),
  completedAt: DateTime.makeUnsafe("2026-10-22T14:00:04Z"),
};
it("renders only redacted history and allowlisted result fields", () => {
  const summary = credentialWorkLogSummary(item, [credentialHistoryFixture]);
  expect(summary).toEqual({
    name: "GitHub",
    action: "Used",
    commandPreview: "gh release list",
    exitCode: 0,
  });
  expect(JSON.stringify(summary)).not.toContain("TOP_SECRET");
});
it("uses safe metadata when history is unavailable and never borrows a different use", () => {
  expect(credentialWorkLogSummary(item, []).commandPreview).toBeUndefined();
  expect(
    credentialWorkLogSummary(item, [{ ...credentialHistoryFixture, at: "2026-10-23T14:00:00Z" }])
      .commandPreview,
  ).toBeUndefined();
  expect(credentialWorkLogSummary({ ...item, toolName: "credential_list" }, []).action).toBe(
    "Listed credentials",
  );
  expect(credentialWorkLogSummary({ ...item, toolName: "credential_request" }, []).action).toBe(
    "Asked for",
  );
});
it("does not claim a use while the exec is still waiting", () => {
  expect(credentialWorkLogSummary({ ...item, completedAt: null }, []).action).toBe(
    "Waiting to use",
  );
});
