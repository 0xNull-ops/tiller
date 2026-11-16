import { describe, expect, it } from "vite-plus/test";

import {
  credentialActorLabel,
  credentialStatusPresentation,
  historyEventLabel,
} from "./credentialPresentation.ts";

describe("credentialActorLabel", () => {
  it("shows a driver's display name, not its raw id", () => {
    expect(
      credentialActorLabel({ provider: "codex", model: "gpt-6.1-sol", agentRole: "subagent" }),
    ).toBe("Codex · gpt-6.1-sol · subagent");
    expect(credentialActorLabel({ provider: "claudeAgent", agentRole: "main" })).toBe(
      "Claude · main agent",
    );
  });

  it("keeps an unknown driver's raw id instead of dropping it", () => {
    expect(credentialActorLabel({ provider: "acme-cli", agentRole: "main" })).toBe(
      "acme-cli · main agent",
    );
  });
});

describe("credentialStatusPresentation", () => {
  it("labels every status and says how bad it is", () => {
    expect(credentialStatusPresentation("ready")).toEqual({ label: "Ready", variant: "success" });
    expect(credentialStatusPresentation("missing-field")).toEqual({
      label: "Missing field",
      variant: "error",
    });
    expect(credentialStatusPresentation("expiring")).toEqual({
      label: "Expires soon",
      variant: "warning",
    });
    expect(credentialStatusPresentation("expired")).toEqual({
      label: "Expired",
      variant: "error",
    });
  });
});

describe("historyEventLabel", () => {
  it("labels every event type, including the reserved use record", () => {
    expect(historyEventLabel("created")).toBe("Created");
    expect(historyEventLabel("renamed")).toBe("Renamed");
    expect(historyEventLabel("updated")).toBe("Details updated");
    expect(historyEventLabel("secret-replaced")).toBe("Secret replaced");
    expect(historyEventLabel("secret-removed")).toBe("Secret removed");
    expect(historyEventLabel("policy-changed")).toBe("Policy changed");
    expect(historyEventLabel("deleted")).toBe("Deleted");
    expect(historyEventLabel("pin-set")).toBe("PIN set");
    expect(historyEventLabel("pin-changed")).toBe("PIN changed");
    expect(historyEventLabel("unlock-failed")).toBe("Unlock failed");
    expect(historyEventLabel("used")).toBe("Used");
    expect(historyEventLabel("approved")).toBe("Allowed");
    expect(historyEventLabel("denied")).toBe("Denied");
  });
});
