import type { Query as ClaudeQuery } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderDriverKind } from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";

/** Workflow inventory cards show bounded tool lists; the rest stay out of the wire payload. */
const CLAUDE_MCP_INVENTORY_TOOLS_PER_SERVER = 100;

export type ClaudeMcpServerStatus = Awaited<ReturnType<ClaudeQuery["mcpServerStatus"]>>[number];

/** The CLI's mcp_server_status control response, logged like every other decoded request. */
export type ClaudeMcpInventoryProtocolLogEvent = {
  readonly direction: "outgoing";
  readonly stage: "decoded";
  readonly payload: {
    readonly type: "query.mcp_server_status";
  };
};

/** Maps one CLI status into the shared inventory shape. Never exposes config or error text. */
export const normalizeClaudeMcpServerStatus = (
  server: ClaudeMcpServerStatus,
): ProviderAdapter.ProviderAdapterV2McpInventoryServer => {
  const status: ProviderAdapter.ProviderAdapterV2McpConnectionStatus =
    server.status === "connected"
      ? "connected"
      : server.status === "pending"
        ? "connecting"
        : server.status === "needs-auth"
          ? "needs-auth"
          : server.status === "disabled"
            ? "disabled"
            : "failed";
  const tools = server.tools ?? [];
  const truncated = tools.length > CLAUDE_MCP_INVENTORY_TOOLS_PER_SERVER;
  const transport =
    server.config !== undefined && "type" in server.config
      ? server.config.type === "stdio"
        ? ("stdio" as const)
        : server.config.type === "http" || server.config.type === "sse"
          ? ("http" as const)
          : ("unknown" as const)
      : ("unknown" as const);
  return {
    name: server.name,
    ...(server.serverInfo === undefined
      ? {}
      : {
          title: server.serverInfo.name,
          version: server.serverInfo.version,
        }),
    transport,
    status,
    auth: status === "needs-auth" ? "needs-auth" : "unknown",
    // The CLI's error text and mcp_status payload can echo header credentials.
    ...(status === "failed"
      ? { statusDetail: "Claude Code reported that this MCP server failed." }
      : {}),
    toolsStatus:
      status !== "connected" ? "unavailable" : tools.length === 0 ? "empty" : "available",
    tools: tools.slice(0, CLAUDE_MCP_INVENTORY_TOOLS_PER_SERVER).map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      ...(tool.annotations?.readOnly === true ? { readOnly: true } : {}),
      ...(tool.annotations?.destructive === true ? { destructive: true } : {}),
      ...(tool.annotations?.openWorld === true ? { openWorld: true } : {}),
    })),
    ...(truncated ? { toolsTruncated: true } : {}),
  };
};

/**
 * Wraps the CLI's status call for the query runner: typed error plus the protocol log line.
 * The runner keeps the call site so it still closes over its own runtime and logger.
 */
export const makeClaudeMcpServerStatusProbe =
  <E>(
    call: () => Promise<ReadonlyArray<ClaudeMcpServerStatus>>,
    mapError: (cause: unknown) => E,
    logProtocolEvent: (event: ClaudeMcpInventoryProtocolLogEvent) => Effect.Effect<void, never>,
  ): (() => Effect.Effect<ReadonlyArray<ClaudeMcpServerStatus>, E>) =>
  () =>
    Effect.tryPromise({
      try: () => call(),
      catch: mapError,
    }).pipe(
      Effect.tap(() =>
        logProtocolEvent({
          direction: "outgoing",
          stage: "decoded",
          payload: { type: "query.mcp_server_status" },
        }),
      ),
    );

/** The part of the adapter's live query context the inventory reads. */
export interface ClaudeMcpInventoryLiveQuery<E> {
  readonly stopping: boolean;
  readonly query: {
    readonly mcpServerStatus?: Effect.Effect<ReadonlyArray<ClaudeMcpServerStatus>, E>;
  };
}

export const makeClaudeMcpInventory = <E>(
  liveQuery: Effect.Effect<ClaudeMcpInventoryLiveQuery<E> | null>,
  driver: ProviderDriverKind,
): ProviderAdapter.ProviderAdapterV2McpInventory => ({
  list: Effect.fn("ClaudeAdapterV2.listMcpInventory")(
    function* () {
      const live = yield* liveQuery;
      if (live === null || live.stopping) {
        return {
          servers: [],
          unavailableReason:
            "Claude Code isn't running for this session, so its MCP connections can't be read.",
        };
      }
      if (live.query.mcpServerStatus === undefined) {
        return {
          servers: [],
          unavailableReason: "This Claude Code version doesn't report MCP server status.",
        };
      }
      const statuses = yield* live.query.mcpServerStatus;
      return {
        servers: statuses.map(normalizeClaudeMcpServerStatus),
      };
    },
    Effect.mapError(
      (cause) =>
        new ProviderAdapter.ProviderAdapterProtocolError({
          driver,
          detail: "Failed to list Claude Code MCP servers.",
          payload: cause,
        }),
    ),
  ),
});
