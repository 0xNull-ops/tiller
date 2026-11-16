import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import {
  OrchestratorMcpFailure,
  SkillsShPreview,
  SkillsShSearch,
  SkillsShLocation,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Access from "../../mcp/McpToolAccess.ts";
import { SkillsShService } from "./SkillsShService.ts";
import { SkillInstallRequests } from "./pending.ts";

const common = {
  dependencies: [
    SkillsShService,
    SkillInstallRequests,
    McpInvocationContext,
    ThreadManagementService,
  ],
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
};
export const SkillsToolkit = Toolkit.make(
  Tool.make("skills_search", {
    ...common,
    description: "Search skills.sh for agent skills in this environment.",
    parameters: Schema.Struct({ query: Schema.String }),
    success: SkillsShSearch,
  }),
  Tool.make("skills_install", {
    ...common,
    description:
      "Preview a GitHub skill and queue a pending request. The user must review and install it in Settings → Tiller → Skills; this tool never writes skill files.",
    parameters: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({
      requestId: Schema.String,
      preview: SkillsShPreview,
      message: Schema.String,
    }),
  }),
  Tool.make("skills_uninstall", {
    ...common,
    description: "Remove a Tiller lockfile-tracked skill from this environment.",
    parameters: Schema.Struct({ ...SkillsShLocation.fields, name: Schema.String }),
    success: Schema.Void,
  }),
);
const failed = (error: { message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
export const layer = Access.toLayer(SkillsToolkit, {
  skills_search: Access.reads(({ query }) =>
    Effect.gen(function* () {
      return yield* (yield* SkillsShService).search(query).pipe(Effect.mapError(failed));
    }),
  ),
  skills_install: Access.writesEnvironment(({ id }) =>
    Effect.gen(function* () {
      const preview = yield* (yield* SkillsShService).preview(id).pipe(Effect.mapError(failed));
      const requestId = yield* (yield* SkillInstallRequests).add(preview);
      return {
        requestId,
        preview,
        message: "Pending user confirmation in Settings → Tiller → Skills.",
      };
    }),
  ),
  skills_uninstall: Access.writesEnvironment((input) =>
    Effect.gen(function* () {
      return yield* (yield* SkillsShService)
        .uninstall(input.name, input)
        .pipe(Effect.mapError(failed));
    }),
  ),
});
