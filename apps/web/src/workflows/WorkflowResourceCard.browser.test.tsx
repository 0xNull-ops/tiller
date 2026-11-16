import type { WorkflowReadinessEntry } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { render } from "../../test/render";
import { WorkflowResourceCard } from "./WorkflowResourceCard";

const card = (readiness: WorkflowReadinessEntry) => (
  <WorkflowResourceCard
    attachment={{ id: "linear", kind: "mcp-connection", server: "linear" }}
    position={{ x: 0, y: 0 }}
    readiness={readiness}
    selected={false}
    onSelect={() => {}}
  />
);

it("updates MCP cards from unverified configuration to live evidence and keeps stale evidence visible", async () => {
  await using screen = await render(
    card({
      stepId: "build",
      attachmentId: "linear",
      kind: "mcp-connection",
      status: "unknown",
      message: "Configured in Work Codex, not verified (no live session).",
    }),
  );
  await expect.element(screen.getByText("Configured · not verified")).toBeVisible();

  await screen.rerender(
    card({
      stepId: "build",
      attachmentId: "linear",
      kind: "mcp-connection",
      status: "available",
      message:
        "Connected per live Work Codex session at 2026-10-22T12:00:00.000Z; T3 doesn't verify what the server can access (files, sign-ins).",
    }),
  );
  await expect.element(screen.getByText("Advisory · Connected")).toBeVisible();

  await screen.rerender(
    card({
      stepId: "build",
      attachmentId: "linear",
      kind: "mcp-connection",
      status: "missing",
      message: "Needs sign-in per live Work Codex session.",
      stale: true,
    }),
  );
  await expect.element(screen.getByText("Advisory · Needs sign-in · stale")).toBeVisible();
});
