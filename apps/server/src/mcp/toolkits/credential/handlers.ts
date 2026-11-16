import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as CredentialUse from "../../../credentials/CredentialUse.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { CredentialToolkit } from "./tools.ts";

const invoke = Effect.fn("credential.invoke")(function* <A>(
  operation: (
    service: CredentialUse.CredentialUse["Service"],
    threadId: NonNullable<McpInvocationContext.McpInvocationScope["thread"]>["threadId"],
  ) => Effect.Effect<A, { readonly message: string }>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "credential");
  const service = yield* CredentialUse.CredentialUse;
  return yield* operation(service, thread.threadId).pipe(
    Effect.mapError(
      (error) => new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
    ),
  );
});
export const layer = McpToolAccess.toLayer(CredentialToolkit, {
  credential_list: McpToolAccess.reads(() => invoke((service, threadId) => service.list(threadId))),
  credential_exec: McpToolAccess.actsAsCaller((input) =>
    invoke((service, threadId) => service.exec(input, threadId)),
  ),
  credential_file: McpToolAccess.actsAsCaller((input) =>
    invoke((service, threadId) => service.file(input, threadId)),
  ),
  credential_request: McpToolAccess.actsAsCaller((input) =>
    invoke((service, threadId) => service.request(input, threadId)),
  ),
});
