import type { OrchestrationV2ProviderThread } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { ProviderAdapterV2Error } from "./ProviderAdapter.ts";

// fork(workflows): a provider-native MCP inventory capability. Adapters that cannot answer
// authoritatively omit it; callers must never infer availability from configuration.
export type ProviderAdapterV2McpConnectionStatus =
  | "connected"
  | "connecting"
  | "needs-auth"
  | "failed"
  | "disabled"
  | "not-started"
  | "unknown";

export type ProviderAdapterV2McpToolsStatus = "available" | "empty" | "unavailable" | "error";

export interface ProviderAdapterV2McpInventoryTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly openWorld?: boolean;
}

export interface ProviderAdapterV2McpInventoryServer {
  readonly name: string;
  /** Presentation metadata the server advertises, never configuration or credentials. */
  readonly title?: string;
  readonly description?: string;
  readonly version?: string;
  /** HTTP origin only: no credentials, path, query or fragment. */
  readonly origin?: string;
  readonly transport?: "http" | "stdio" | "unknown";
  readonly status: ProviderAdapterV2McpConnectionStatus;
  readonly auth?: "signed-in" | "needs-auth" | "not-required" | "unsupported" | "unknown";
  readonly statusDetail?: string;
  readonly toolsStatus: ProviderAdapterV2McpToolsStatus;
  readonly toolsDetail?: string;
  readonly tools: ReadonlyArray<ProviderAdapterV2McpInventoryTool>;
  readonly toolsTruncated?: boolean;
  readonly resources?: number;
  readonly resourceTemplates?: number;
}

export interface ProviderAdapterV2McpInventoryPage {
  readonly servers: ReadonlyArray<ProviderAdapterV2McpInventoryServer>;
  readonly nextCursor?: string;
  /**
   * Set when the provider supports this inventory but cannot answer right now,
   * such as a Claude session with no live process. Never set for "no servers".
   */
  readonly unavailableReason?: string;
}

export interface ProviderAdapterV2McpInventory {
  readonly list: (input: {
    readonly providerThread: OrchestrationV2ProviderThread;
    readonly cursor?: string;
    readonly limit?: number;
  }) => Effect.Effect<ProviderAdapterV2McpInventoryPage, ProviderAdapterV2Error>;
}
