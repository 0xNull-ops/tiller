import type { ProviderDriverKind } from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";

/** Workflow inventory cards show bounded tool lists; the rest stay out of the wire payload. */
const OPENCODE_MCP_INVENTORY_TOOLS_PER_SERVER = 100;

const protocolError = (driver: ProviderDriverKind) => (cause: unknown) =>
  new ProviderAdapter.ProviderAdapterProtocolError({
    driver,
    detail: "Failed to list OpenCode MCP servers.",
    payload: cause,
  });

const legacyConnectionStatus = (
  status: string,
): ProviderAdapter.ProviderAdapterV2McpConnectionStatus =>
  status === "connected"
    ? "connected"
    : status === "needs_auth"
      ? "needs-auth"
      : status === "disabled"
        ? "disabled"
        : "failed";

/**
 * The legacy SDK client publishes tool ids, not per-server catalogues. Ownership is the same
 * sanitized `<server>_` prefix the adapter uses to present MCP tool calls.
 */
export const makeOpenCodeMcpInventory = <EStatus, EToolIds>(options: {
  readonly statuses: () => Effect.Effect<
    { readonly data?: Record<string, { readonly status: string }> },
    EStatus
  >;
  readonly toolIds: () => Effect.Effect<{ readonly data?: ReadonlyArray<string> }, EToolIds>;
  readonly driver: ProviderDriverKind;
}): ProviderAdapter.ProviderAdapterV2McpInventory => ({
  list: Effect.fn("OpencodeAdapter.listMcpInventory")(
    function* () {
      const response = yield* options.statuses();
      const statuses = response.data ?? {};
      const toolIds = yield* options.toolIds().pipe(
        Effect.map((ids) => ids.data ?? undefined),
        Effect.orElseSucceed(() => undefined),
      );
      return {
        servers: Object.entries(statuses).map(([name, status]) => {
          const connection = legacyConnectionStatus(status.status);
          const prefix = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}_`;
          const tools =
            toolIds === undefined
              ? undefined
              : toolIds
                  .filter((id) => id.startsWith(prefix))
                  .slice(0, OPENCODE_MCP_INVENTORY_TOOLS_PER_SERVER)
                  .map((id) => ({ name: id, title: id.slice(prefix.length) }));
          return {
            name,
            status: connection,
            auth: connection === "needs-auth" ? "needs-auth" : "unknown",
            ...(status.status === "failed"
              ? { statusDetail: "OpenCode reported that this MCP server failed." }
              : status.status === "needs_client_registration"
                ? {
                    statusDetail: "OpenCode needs client registration for this server.",
                  }
                : {}),
            toolsStatus:
              connection !== "connected"
                ? "unavailable"
                : tools === undefined
                  ? "error"
                  : tools.length === 0
                    ? "empty"
                    : "available",
            ...(tools === undefined
              ? {
                  toolsDetail:
                    "OpenCode didn't answer its tool list, so this server's tools are unknown.",
                }
              : {
                  toolsDetail:
                    "Tool names are matched by OpenCode's sanitized server prefix; owners are not published.",
                }),
            tools: tools ?? [],
          } satisfies ProviderAdapter.ProviderAdapterV2McpInventoryServer;
        }),
      };
    },
    Effect.mapError(protocolError(options.driver)),
  ),
});

const connectionStatus = (status: string): ProviderAdapter.ProviderAdapterV2McpConnectionStatus =>
  status === "connected"
    ? "connected"
    : status === "pending"
      ? "connecting"
      : status === "needs_auth"
        ? "needs-auth"
        : status === "disabled"
          ? "disabled"
          : "failed";

/** The effect client reports connection state but not each server's tool list. */
export const makeOpenCode2McpInventory = <E>(options: {
  readonly list: () => Effect.Effect<
    {
      readonly data: ReadonlyArray<{
        readonly name: string;
        readonly status: { readonly status: string };
      }>;
    },
    E
  >;
  readonly driver: ProviderDriverKind;
}): ProviderAdapter.ProviderAdapterV2McpInventory => ({
  list: Effect.fn("OpenCode2Adapter.listMcpInventory")(
    function* () {
      const listed = yield* options.list();
      return {
        servers: listed.data.map((server) => {
          const status = connectionStatus(server.status.status);
          return {
            name: server.name,
            status,
            auth: status === "needs-auth" ? "needs-auth" : "unknown",
            ...(status === "failed"
              ? { statusDetail: "OpenCode reported that this MCP server failed." }
              : {}),
            toolsStatus: "unavailable",
            toolsDetail:
              "OpenCode reports MCP connection state but doesn't expose each server's tool list to T3.",
            tools: [],
          } satisfies ProviderAdapter.ProviderAdapterV2McpInventoryServer;
        }),
      };
    },
    Effect.mapError(protocolError(options.driver)),
  ),
});
