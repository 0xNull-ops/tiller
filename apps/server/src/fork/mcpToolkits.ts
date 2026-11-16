import { SkillsShService } from "./skillsSh/SkillsShService.ts";
import { SkillInstallRequests } from "./skillsSh/pending.ts";
import * as Skills from "./skillsSh/mcp.ts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { toolkitRegistration } from "../mcp/McpHttpServer.ts";
import * as CredentialAgentServices from "../credentials/CredentialAgentServices.ts";
import * as CredentialHandlers from "../mcp/toolkits/credential/handlers.ts";
import { CredentialToolkit } from "../mcp/toolkits/credential/tools.ts";
import * as WorkflowHandlers from "../mcp/toolkits/workflow/handlers.ts";
import { WorkflowToolkit } from "../mcp/toolkits/workflow/tools.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as WorkflowServices from "../workflows/WorkflowServices.ts";

class SkipForkMcpToolkits extends Context.Service<SkipForkMcpToolkits, boolean>()(
  "t3/fork/mcpToolkits/SkipForkMcpToolkits",
) {}

export const forkMcpToolkits = [Skills.SkillsToolkit, WorkflowToolkit, CredentialToolkit] as const;

export const layerForkMcpToolkits = (register: typeof toolkitRegistration) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const skip = yield* Effect.serviceOption(SkipForkMcpToolkits);
      if (Option.isSome(skip) && skip.value) return Layer.empty;
      return Layer.mergeAll(
        register(Skills.SkillsToolkit, Skills.layer),
        register(WorkflowToolkit, WorkflowHandlers.layer).pipe(
          Layer.provide(WorkflowServices.layer),
        ),
        register(CredentialToolkit, CredentialHandlers.layer).pipe(
          Layer.provide(CredentialAgentServices.layer),
        ),
      );
    }),
  );

export const layerMcpToolkitTestServices = Layer.mergeAll(
  Layer.mock(SkillsShService)({}),
  Layer.mock(SkillInstallRequests)({}),
  Layer.succeed(SkipForkMcpToolkits, true),
  Layer.mock(ProcessRunner.ProcessRunner)({}),
  Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({}),
);
