import type { OrchestrationV2ProviderThread } from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import type * as CodexSchema from "effect-codex-app-server/schema";

/** Workflow inventory cards show bounded tool lists; the rest stay out of the wire payload. */
const CODEX_MCP_INVENTORY_TOOLS_PER_SERVER = 100;

/** The app-server's connection enum, kept honest rather than collapsed into online/offline. */
export const normalizeCodexMcpConnectionStatus = (
  status: string | null | undefined,
): ProviderAdapter.ProviderAdapterV2McpConnectionStatus => {
  switch (status) {
    case "connected":
      return "connected";
    case "starting":
      return "connecting";
    case "authenticationRequired":
      return "needs-auth";
    case "failed":
    case "cancelled":
      return "failed";
    case "disabled":
      return "disabled";
    case "notStarted":
      return "not-started";
    default:
      return "unknown";
  }
};

export const normalizeCodexMcpAuth = (
  status: string,
): NonNullable<ProviderAdapter.ProviderAdapterV2McpInventoryServer["auth"]> => {
  switch (status) {
    case "bearerToken":
    case "oAuth":
      return "signed-in";
    case "notLoggedIn":
      return "needs-auth";
    case "unsupported":
      return "not-required";
    default:
      return "unknown";
  }
};

/** Tool hints are advertised metadata, never permission. Unknown stays absent. */
export const normalizeCodexMcpTool = (tool: {
  readonly name: string;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly annotations?: unknown;
}): ProviderAdapter.ProviderAdapterV2McpInventoryTool => {
  const annotations =
    typeof tool.annotations === "object" && tool.annotations !== null
      ? (tool.annotations as Record<string, unknown>)
      : undefined;
  return {
    name: tool.name,
    ...(typeof tool.title === "string" ? { title: tool.title } : {}),
    ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    ...(annotations?.readOnlyHint === true ? { readOnly: true } : {}),
    ...(annotations?.destructiveHint === true ? { destructive: true } : {}),
    ...(annotations?.openWorldHint === true ? { openWorld: true } : {}),
  };
};

export type CodexMcpStatusRequest = {
  readonly threadId: string;
  readonly detail: "toolsAndAuthOnly";
  readonly limit: number | null;
  readonly cursor: string | null;
};

const toCodexMcpInventoryPage = (
  response: CodexSchema.V2ListMcpServerStatusResponse,
): ProviderAdapter.ProviderAdapterV2McpInventoryPage => ({
  servers: response.data.map((server) => {
    const status = normalizeCodexMcpConnectionStatus(server.runtimeStatus);
    const tools = Object.values(server.tools);
    const truncated = tools.length > CODEX_MCP_INVENTORY_TOOLS_PER_SERVER;
    return {
      name: server.name,
      ...(server.serverInfo?.title == null ? {} : { title: server.serverInfo.title }),
      ...(server.serverInfo?.description == null
        ? {}
        : { description: server.serverInfo.description }),
      ...(server.serverInfo?.version == null ? {} : { version: server.serverInfo.version }),
      ...(server.httpOrigin == null ? {} : { origin: server.httpOrigin }),
      transport: server.httpOrigin == null ? "unknown" : "http",
      status,
      auth: normalizeCodexMcpAuth(server.authStatus),
      ...(status === "failed"
        ? { statusDetail: "Codex reported that this MCP server failed." }
        : {}),
      toolsStatus:
        status !== "connected"
          ? "unavailable"
          : server.toolsError != null
            ? "error"
            : tools.length === 0
              ? "empty"
              : "available",
      ...(server.toolsError == null
        ? {}
        : { toolsDetail: "Codex couldn't list this server's tools." }),
      tools: tools.slice(0, CODEX_MCP_INVENTORY_TOOLS_PER_SERVER).map(normalizeCodexMcpTool),
      ...(truncated ? { toolsTruncated: true } : {}),
      resources: server.resources.length,
      resourceTemplates: server.resourceTemplates.length,
    } satisfies ProviderAdapter.ProviderAdapterV2McpInventoryServer;
  }),
  ...(response.nextCursor == null ? {} : { nextCursor: response.nextCursor }),
});

export const makeCodexMcpInventory = <EThreadId, ERequest>(options: {
  readonly getNativeThreadId: (
    providerThread: OrchestrationV2ProviderThread,
  ) => Effect.Effect<string, EThreadId>;
  readonly request: (
    params: CodexMcpStatusRequest,
  ) => Effect.Effect<CodexSchema.V2ListMcpServerStatusResponse, ERequest>;
  readonly mapError: (cause: unknown) => ProviderAdapter.ProviderAdapterV2Error;
}): ProviderAdapter.ProviderAdapterV2McpInventory => ({
  list: Effect.fn("CodexAdapterV2.listMcpInventory")(function* (inventoryInput) {
    const threadId = yield* options.getNativeThreadId(inventoryInput.providerThread);
    const response = yield* options.request({
      threadId,
      detail: "toolsAndAuthOnly",
      limit: inventoryInput.limit ?? null,
      cursor: inventoryInput.cursor ?? null,
    });
    return toCodexMcpInventoryPage(response);
  }, Effect.mapError(options.mapError)),
});
