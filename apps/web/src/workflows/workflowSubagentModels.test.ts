import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  removeWorkflowSubagentModel,
  resolveWorkflowSubagentSelections,
  toggleResolvedWorkflowSubagentModel,
  toggleWorkflowSubagentModel,
} from "./workflowSubagentModels";
import { workflowSubagentMissingReason } from "@t3tools/shared/workflowSubagents";
import { workflowExecutionChipLabel } from "./WorkflowExecutionControl";

const deepseek = {
  driver: ProviderDriverKind.make("opencode"),
  instanceId: ProviderInstanceId.make("opencode-go"),
  model: "deepseek",
};
const haiku = {
  driver: ProviderDriverKind.make("claudeAgent"),
  instanceId: ProviderInstanceId.make("claude-haiku"),
  model: "haiku",
};
const luna = {
  driver: ProviderDriverKind.make("codex"),
  instanceId: ProviderInstanceId.make("codex"),
  model: "luna",
};

const provider = (
  instanceId: string,
  driver: string,
  models: ReadonlyArray<{ slug: string; aliases?: ReadonlyArray<string> }>,
) =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    availability: "available",
    auth: { status: "authenticated" },
    models,
  }) as ServerProvider;

it("adds two picked models with their driver kinds and clears the last choice", () => {
  const one = toggleWorkflowSubagentModel([], deepseek, 4);
  expect(one).toEqual([deepseek]);
  const two = toggleWorkflowSubagentModel(one ?? [], haiku, 4);
  expect(two).toEqual([deepseek, haiku]);
  expect(toggleWorkflowSubagentModel(two ?? [], haiku, 4)).toEqual([deepseek]);
  expect(toggleWorkflowSubagentModel([deepseek], deepseek, 4)).toBeNull();
});

it("does not add past the configured cap and removes missing hints", () => {
  expect(toggleWorkflowSubagentModel([deepseek, haiku], luna, 2)).toBeNull();
  expect(removeWorkflowSubagentModel([deepseek, haiku], deepseek)).toEqual([haiku]);
  expect(removeWorkflowSubagentModel([deepseek], deepseek)).toBeNull();
});

it("maps exact, same-driver, and alias resolutions back to their original hints", () => {
  const exact = {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex-old"),
    model: "gpt",
  };
  const remapped = {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex-legacy"),
    model: "gpt",
  };
  const alias = {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex-new"),
    model: "gpt-latest",
  };
  const missing = {
    driver: ProviderDriverKind.make("claudeAgent"),
    instanceId: ProviderInstanceId.make("claude-old"),
    model: "haiku",
  };
  const providers = [
    provider("codex-old", "codex", [{ slug: "gpt" }]),
    provider("codex-new", "codex", [{ slug: "gpt", aliases: ["gpt-latest"] }]),
  ];
  expect(resolveWorkflowSubagentSelections([exact], providers)).toEqual([
    { hint: exact, instanceId: "codex-old", model: "gpt" },
  ]);
  expect(
    resolveWorkflowSubagentSelections(
      [remapped, missing],
      [{ ...providers[0]!, enabled: false }, providers[1]!],
    ),
  ).toEqual([{ hint: remapped, instanceId: "codex-new", model: "gpt" }]);
  expect(resolveWorkflowSubagentSelections([alias], [providers[1]!])).toEqual([
    { hint: alias, instanceId: "codex-new", model: "gpt" },
  ]);
});

it("removes a remapped choice at the cap and reduces over-cap lists", () => {
  const hint = {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex-old"),
    model: "gpt",
  };
  const providers = [provider("codex-new", "codex", [{ slug: "gpt" }])];
  expect(
    toggleResolvedWorkflowSubagentModel(
      [hint],
      { ...hint, instanceId: ProviderInstanceId.make("codex-new") },
      providers,
      1,
    ),
  ).toBeNull();
  expect(toggleWorkflowSubagentModel([deepseek, haiku], deepseek, 1)).toEqual([haiku]);
});

it("uses short reasons for missing provider models", () => {
  expect(workflowSubagentMissingReason("signed-out")).toBe("not signed in");
  expect(workflowSubagentMissingReason("not-installed")).toBe("not installed");
  expect(workflowSubagentMissingReason("model-not-offered")).toBe("not offered");
  expect(workflowSubagentMissingReason("model-not-offered", "Claude")).toBe(
    "not offered by Claude",
  );
  expect(workflowSubagentMissingReason("no-instance")).toBe("no such provider");
});

it("summarizes the header chip and warns when a hint is missing", () => {
  expect(workflowExecutionChipLabel("prefer-subagents", ["DeepSeek", "Haiku"], 0)).toBe(
    "Prefer subagents · DeepSeek, Haiku",
  );
  expect(workflowExecutionChipLabel("always-subagents", ["DeepSeek", "Haiku", "Luna"], 0)).toBe(
    "Always subagents · DeepSeek, Haiku +1",
  );
  expect(workflowExecutionChipLabel("auto", ["DeepSeek"], 1)).toBe("Agent decides · ⚠ 1 missing");
});
