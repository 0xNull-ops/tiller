import { describe, expect, it } from "@effect/vitest";

import {
  normalizeClaudeMcpServerStatus,
  type ClaudeMcpServerStatus,
} from "./claudeMcpInventory.ts";
import {
  normalizeCodexMcpAuth,
  normalizeCodexMcpConnectionStatus,
  normalizeCodexMcpTool,
} from "./codexMcpInventory.ts";

const claudeServer = (overrides: Partial<ClaudeMcpServerStatus> = {}): ClaudeMcpServerStatus =>
  ({ name: "linear", status: "connected", ...overrides }) as ClaudeMcpServerStatus;

describe("provider MCP inventory normalizers", () => {
  it("keeps every Codex connection state distinct instead of collapsing online/offline", () => {
    expect(
      [
        "connected",
        "starting",
        "authenticationRequired",
        "failed",
        "cancelled",
        "disabled",
        "notStarted",
        null,
        undefined,
      ].map(normalizeCodexMcpConnectionStatus),
    ).toEqual([
      "connected",
      "connecting",
      "needs-auth",
      "failed",
      "failed",
      "disabled",
      "not-started",
      "unknown",
      "unknown",
    ]);
  });

  it("maps Codex auth states without treating unsupported as signed out", () => {
    expect(
      ["bearerToken", "oAuth", "notLoggedIn", "unsupported", "unknown"].map(normalizeCodexMcpAuth),
    ).toEqual(["signed-in", "signed-in", "needs-auth", "not-required", "unknown"]);
  });

  it("keeps Codex tool hints optional and never invents permission", () => {
    expect(normalizeCodexMcpTool({ name: "create_issue" })).toEqual({ name: "create_issue" });
    expect(
      normalizeCodexMcpTool({
        name: "delete_issue",
        title: "Delete issue",
        description: "Deletes one issue",
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      }),
    ).toEqual({
      name: "delete_issue",
      title: "Delete issue",
      description: "Deletes one issue",
      destructive: true,
      openWorld: true,
    });
    expect(
      normalizeCodexMcpTool({
        name: "list_issues",
        annotations: { readOnlyHint: true },
      }),
    ).toEqual({ name: "list_issues", readOnly: true });
  });

  it("maps Claude status, scope and tools without exposing config or error text", () => {
    expect(
      normalizeClaudeMcpServerStatus(
        claudeServer({
          status: "connected",
          serverInfo: { name: "Linear", version: "1.0.0" },
          tools: [
            {
              name: "create_issue",
              description: "Create one issue",
              annotations: { readOnly: false, destructive: true, openWorld: true },
            },
          ],
        }),
      ),
    ).toMatchObject({
      name: "linear",
      title: "Linear",
      version: "1.0.0",
      transport: "unknown",
      status: "connected",
      auth: "unknown",
      toolsStatus: "available",
      tools: [
        {
          name: "create_issue",
          description: "Create one issue",
          destructive: true,
          openWorld: true,
        },
      ],
    });

    const failed = normalizeClaudeMcpServerStatus(
      claudeServer({
        status: "failed",
        error: "Authorization: Bearer SUPER_SECRET",
        config: { type: "http", url: "https://user:pass@example.test/mcp" } as never,
      }),
    );
    expect(failed).toMatchObject({
      status: "failed",
      auth: "unknown",
      toolsStatus: "unavailable",
      statusDetail: "Claude Code reported that this MCP server failed.",
      transport: "http",
    });
    expect(JSON.stringify(failed)).not.toContain("SUPER_SECRET");
    expect(JSON.stringify(failed)).not.toContain("user:pass");
  });

  it("uses empty only for a connected server with a reported empty catalogue", () => {
    expect(
      normalizeClaudeMcpServerStatus(claudeServer({ status: "connected", tools: [] })),
    ).toMatchObject({ status: "connected", toolsStatus: "empty" });
    expect(
      normalizeClaudeMcpServerStatus(claudeServer({ status: "pending", tools: [] })),
    ).toMatchObject({ status: "connecting", toolsStatus: "unavailable" });
    expect(
      normalizeClaudeMcpServerStatus(claudeServer({ status: "needs-auth", tools: [] })),
    ).toMatchObject({ status: "needs-auth", auth: "needs-auth", toolsStatus: "unavailable" });
    expect(
      normalizeClaudeMcpServerStatus(claudeServer({ status: "disabled", tools: [] })),
    ).toMatchObject({ status: "disabled", toolsStatus: "unavailable" });
  });

  it("caps a long Claude tool catalogue and marks the truncation", () => {
    const normalised = normalizeClaudeMcpServerStatus(
      claudeServer({
        status: "connected",
        tools: Array.from({ length: 101 }, (_, index) => ({ name: `tool_${index}` })),
      }),
    );
    expect(normalised.tools).toHaveLength(100);
    expect(normalised.toolsTruncated).toBe(true);
  });
});
