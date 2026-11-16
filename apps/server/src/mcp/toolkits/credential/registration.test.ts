import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";
import * as CredentialUse from "../../../credentials/CredentialUse.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Handlers from "./handlers.ts";
import { CredentialToolkit } from "./tools.ts";

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("credential-test"),
  requestNamespace: "credential-test",
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  thread: {
    threadId: ThreadId.make("caller"),
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
};
const client = McpSchema.McpServerClient.of({
  getClient: Effect.die("unused"),
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
});
const registered = McpHttpServer.toolkitRegistration(CredentialToolkit, Handlers.layer).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(Layer.mock(ThreadManagementService.ThreadManagementService)({})),
  Layer.provide(Layer.mock(CredentialUse.CredentialUse)({ list: () => Effect.succeed([]) })),
);
it.effect("registers the four credential tools and lists metadata through MCP", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "credential_list", arguments: {} })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(Object.keys(CredentialToolkit.tools).toSorted()).toEqual([
      "credential_exec",
      "credential_file",
      "credential_list",
      "credential_request",
    ]);
    expect(result.isError).not.toBe(true);
    const content = result.content[0];
    expect(content?.type).toBe("text");
    if (content?.type === "text") expect(JSON.parse(content.text)).toEqual([]);
  }).pipe(Effect.provide(registered)),
);
it.effect("rejects client-only credential execution before reaching the service", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "credential_exec", arguments: { credential: "deploy", command: "deploy" } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...scope,
          thread: undefined,
        }),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type === "text")
      expect(JSON.parse(content.text)).toMatchObject({ code: "thread_credential_required" });
  }).pipe(Effect.provide(registered)),
);
