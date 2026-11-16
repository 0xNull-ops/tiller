import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowMcpInventory from "./WorkflowMcpInventory.ts";
import * as WorkflowRunner from "./WorkflowRunner.ts";
import * as WorkflowStore from "./WorkflowStore.ts";

export const inventoryProjectId = ProjectId.make("project-1");
export const inventoryThreadId = ThreadId.make("driver");
const instanceId = ProviderInstanceId.make("codex-work");
const modelSelection = { instanceId, model: "codex" };
/** Longer than every bounded provider string, and longer than one page of tools. */
export const oversized = "x".repeat(2_000);
const toolsOversized = Array.from({ length: 120 }, (_, index) => ({
  name: `${index}-${oversized}`,
  title: oversized,
  description: oversized,
}));

/**
 * A provider runtime whose answer breaks every contract bound at once. The inventory service
 * must clip it before any transport encodes the snapshot.
 */
export const oversizedInventoryLayer = WorkflowMcpInventory.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({
          id: inventoryThreadId,
          projectId: inventoryProjectId,
          deletedAt: null,
          runtimeMode: "full-access",
          interactionMode: "default",
        } as never),
      getProjectThreadRecords: () =>
        Effect.succeed({
          thread: { modelSelection, worktreePath: null },
          providerThreads: [
            {
              providerInstanceId: instanceId,
              providerSessionId: "session",
              status: "active",
              ownerNodeId: null,
              driver: "codex",
            },
          ],
        } as never),
    }),
  ),
  Layer.provide(
    Layer.mock(WorkflowStore.WorkflowStore)({
      readDefinition: () =>
        Effect.succeed({
          version: 3,
          name: "Launch",
          model: modelSelection,
          steps: [],
        } as never),
      projectRoot: () => Effect.succeed("/repo"),
    }),
  ),
  Layer.provide(
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      getInstance: () => Effect.succeed({ driverKind: "codex", displayName: oversized } as never),
      streamChanges: Stream.never,
    }),
  ),
  Layer.provide(
    Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
      get: () =>
        Effect.succeedSome({
          instanceId,
          mcpInventory: {
            list: () =>
              Effect.succeed({
                servers: [
                  {
                    name: oversized,
                    title: oversized,
                    description: oversized,
                    version: oversized,
                    origin: oversized,
                    status: "connected",
                    statusDetail: oversized,
                    toolsStatus: "available",
                    toolsDetail: oversized,
                    tools: toolsOversized,
                  },
                ],
              }),
          },
        } as never),
    }),
  ),
);

/** A runner that answers inventory calls from the real inventory service, as production does. */
export const inventoryRunnerLayer = Layer.unwrap(
  Effect.map(WorkflowMcpInventory.WorkflowMcpInventory, (inventory) =>
    Layer.mock(WorkflowRunner.WorkflowRunner)({
      mcpInventory: (input) => inventory.inspect({ ...input, refresh: false }),
      refreshMcpInventory: (input) => inventory.inspect({ ...input, refresh: true }),
    }),
  ),
);
