import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type WorkflowSubagentModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSubagentModels, workflowSubagentMissingReason } from "./workflowSubagents.ts";

describe("workflowSubagentMissingReason", () => {
  it("turns each missing reason into user-facing words", () => {
    expect(
      [
        "signed-out",
        "not-installed",
        "disabled",
        "unavailable",
        "model-not-offered",
        "no-instance",
      ].map((reason) => workflowSubagentMissingReason(reason)),
    ).toEqual([
      "not signed in",
      "not installed",
      "disabled",
      "unavailable",
      "not offered",
      "no such provider",
    ]);
  });

  it("can name the provider that does not offer a model", () => {
    expect(workflowSubagentMissingReason("model-not-offered", "Claude")).toBe(
      "not offered by Claude",
    );
  });
});

const model = (
  slug: string,
  name: string,
  extra: Partial<ServerProviderModel> = {},
): ServerProviderModel => ({ slug, name, isCustom: false, capabilities: null, ...extra });

const provider = (
  instanceId: string,
  driver: string,
  overrides: Partial<ServerProvider> = {},
): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const hint = (instanceId: string, model: string, driver?: string): WorkflowSubagentModel => ({
  ...(driver === undefined ? {} : { driver: ProviderDriverKind.make(driver) }),
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});

const deepseek = model("opencode-go/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", {
  shortName: "DeepSeek",
});
const haiku = model("claude-haiku-5-5", "Claude Haiku 5.5", {
  shortName: "Haiku 5.5",
  aliases: ["haiku"],
});
const luna = model("gpt-6-luna", "GPT-6 Luna");

describe("resolveSubagentModels", () => {
  it("takes the exact instance and names the model the way the picker does", () => {
    expect(
      resolveSubagentModels(
        [hint("opencode-go", "opencode-go/deepseek-v4.1-flash", "opencode")],
        [provider("opencode-go", "opencode", { models: [deepseek] })],
      ),
    ).toEqual({
      usable: [
        {
          driver: "opencode",
          instanceId: "opencode-go",
          model: "opencode-go/deepseek-v4.1-flash",
          label: "DeepSeek",
        },
      ],
      missing: [],
      fallback: false,
    });
  });

  it("prefers the named instance over an earlier instance of the same driver", () => {
    const [usable] = resolveSubagentModels(
      [hint("codex-work", "gpt-6-luna", "codex")],
      [
        provider("codex", "codex", { models: [luna] }),
        provider("codex-work", "codex", { models: [luna] }),
      ],
    ).usable;
    expect(usable?.instanceId).toBe("codex-work");
  });

  it("falls back to another instance of the same driver", () => {
    const snapshot = resolveSubagentModels(
      [hint("claude-work", "claude-haiku-5-5", "claudeAgent")],
      [provider("claude-home", "claudeAgent", { models: [haiku] })],
    );
    expect(snapshot.usable).toEqual([
      {
        driver: "claudeAgent",
        instanceId: "claude-home",
        model: "claude-haiku-5-5",
        label: "Haiku 5.5",
      },
    ]);
    expect(snapshot.missing).toEqual([]);
  });

  it("reads a hint without a driver as its instance id, which a default instance is named after", () => {
    expect(
      resolveSubagentModels(
        [hint("codex", "gpt-6-luna")],
        [provider("codex", "codex", { models: [luna] })],
      ).usable,
    ).toMatchObject([{ instanceId: "codex", model: "gpt-6-luna", label: "GPT-6 Luna" }]);
    // The legacy id no longer exists here, so the driver carries it to a renamed instance.
    expect(
      resolveSubagentModels(
        [hint("codex", "gpt-6-luna")],
        [provider("codex-work", "codex", { models: [luna] })],
      ).usable,
    ).toMatchObject([{ instanceId: "codex-work" }]);
  });

  it("matches an alias and reports the canonical slug a subagent target takes", () => {
    const snapshot = resolveSubagentModels(
      [hint("claude", "haiku", "claudeAgent")],
      [provider("claude", "claudeAgent", { models: [haiku] })],
    );
    expect(snapshot.usable[0]).toMatchObject({ model: "claude-haiku-5-5", label: "Haiku 5.5" });
  });

  it("names each reason a hint is missing", () => {
    const cases = [
      {
        reason: "no-instance",
        hint: hint("codex", "gpt-6-luna", "codex"),
        providers: [provider("claude-home", "claudeAgent", { models: [haiku] })],
      },
      {
        reason: "disabled",
        hint: hint("codex", "gpt-6-luna", "codex"),
        providers: [provider("codex", "codex", { enabled: false, models: [luna] })],
      },
      {
        reason: "not-installed",
        hint: hint("codex", "gpt-6-luna", "codex"),
        providers: [provider("codex", "codex", { installed: false, models: [luna] })],
      },
      {
        reason: "unavailable",
        hint: hint("codex", "gpt-6-luna", "codex"),
        providers: [
          provider("codex", "codex", {
            availability: "unavailable",
            installed: false,
            enabled: false,
            models: [luna],
          }),
        ],
      },
      {
        reason: "signed-out",
        hint: hint("claude", "claude-haiku-5-5", "claudeAgent"),
        providers: [
          provider("claude", "claudeAgent", {
            auth: { status: "unauthenticated" },
            models: [haiku],
          }),
        ],
      },
      {
        reason: "model-not-offered",
        hint: hint("codex", "gpt-6-luna", "codex"),
        providers: [provider("codex", "codex", { models: [model("gpt-6-mini", "GPT-6 Mini")] })],
      },
    ] as const;
    for (const testCase of cases) {
      const snapshot = resolveSubagentModels([testCase.hint], testCase.providers);
      expect(snapshot.usable).toEqual([]);
      expect(snapshot.missing).toEqual([{ hint: testCase.hint, reason: testCase.reason }]);
      expect(snapshot.fallback).toBe(true);
    }
  });

  it("uses the rest when only some hints are missing", () => {
    const snapshot = resolveSubagentModels(
      [
        hint("opencode-go", "opencode-go/deepseek-v4.1-flash", "opencode"),
        hint("claude", "claude-haiku-5-5", "claudeAgent"),
        hint("codex", "gpt-6-luna", "codex"),
      ],
      [
        provider("opencode-go", "opencode", { models: [deepseek] }),
        provider("claude", "claudeAgent", {
          auth: { status: "unauthenticated" },
          models: [haiku],
        }),
      ],
    );
    expect(snapshot.usable).toHaveLength(1);
    expect(snapshot.missing.map((entry) => entry.reason)).toEqual(["signed-out", "no-instance"]);
    expect(snapshot.fallback).toBe(false);
  });

  it("never falls back when the workflow names no models", () => {
    expect(resolveSubagentModels([], [provider("codex", "codex", { models: [luna] })])).toEqual({
      usable: [],
      missing: [],
      fallback: false,
    });
  });

  it("dedupes a model the workflow names twice", () => {
    const snapshot = resolveSubagentModels(
      [hint("claude", "claude-haiku-5-5", "claudeAgent"), hint("claude", "haiku", "claudeAgent")],
      [provider("claude", "claudeAgent", { models: [haiku] })],
    );
    expect(snapshot.usable).toEqual([
      {
        driver: "claudeAgent",
        instanceId: "claude",
        model: "claude-haiku-5-5",
        label: "Haiku 5.5",
      },
    ]);
    expect(snapshot.missing).toEqual([]);
  });
});
