import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export const createWorkflowTemplateCommands = <R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) => ({
  use: createEnvironmentRpcCommand(runtime, {
    label: "workflows:template-use",
    tag: WS_METHODS.workflowTemplateUse,
  }),
  list: createEnvironmentRpcCommand(runtime, {
    label: "workflows:templates-list",
    tag: WS_METHODS.workflowTemplatesList,
  }),
});
