import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export const createSkillsShCommands = <R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) => ({
  audit: createEnvironmentRpcCommand(runtime, {
    label: "skills:audit",
    tag: WS_METHODS.skillsShAudit,
  }),
  dismiss: createEnvironmentRpcCommand(runtime, {
    label: "skills:dismiss",
    tag: WS_METHODS.skillsShDismiss,
  }),
  pending: createEnvironmentRpcCommand(runtime, {
    label: "skills:pending",
    tag: WS_METHODS.skillsShPending,
  }),
  search: createEnvironmentRpcCommand(runtime, {
    label: "skills:search",
    tag: WS_METHODS.skillsShSearch,
  }),
  preview: createEnvironmentRpcCommand(runtime, {
    label: "skills:preview",
    tag: WS_METHODS.skillsShPreview,
  }),
  install: createEnvironmentRpcCommand(runtime, {
    label: "skills:install",
    tag: WS_METHODS.skillsShInstall,
  }),
  uninstall: createEnvironmentRpcCommand(runtime, {
    label: "skills:uninstall",
    tag: WS_METHODS.skillsShUninstall,
  }),
  list: createEnvironmentRpcCommand(runtime, {
    label: "skills:list",
    tag: WS_METHODS.skillsShListInstalled,
  }),
  updates: createEnvironmentRpcCommand(runtime, {
    label: "skills:updates",
    tag: WS_METHODS.skillsShCheckUpdates,
  }),
});
