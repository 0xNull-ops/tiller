import { describe, expect, it } from "vite-plus/test";
import {
  applyWorkflowCanvasColors,
  WORKFLOW_CANVAS_COLOR_PRESETS,
  WORKFLOW_CANVAS_KINDS,
  workflowCanvasKindColor,
} from "./workflowCanvasColors";

function recordingStyle() {
  const values = new Map<string, string>();
  return {
    values,
    style: {
      setProperty: (name: string, value: string) => {
        values.set(name, value);
      },
    },
  };
}

describe("applyWorkflowCanvasColors", () => {
  it("sets every kind to its default when nothing has been picked", () => {
    const { values, style } = recordingStyle();
    applyWorkflowCanvasColors(style, {});
    expect(Object.fromEntries(values)).toEqual({
      "--wf-kind-credential": "#e3b341",
      "--wf-kind-mcp": "#a78bfa",
      "--wf-kind-check": "#3fb950",
      "--wf-kind-login": "#8b949e",
    });
  });

  it("applies a pick to its own kind and keeps the other defaults", () => {
    const { values, style } = recordingStyle();
    applyWorkflowCanvasColors(style, { mcp: "#58a6ff" });
    expect(values.get("--wf-kind-mcp")).toBe("#58a6ff");
    expect(values.get("--wf-kind-credential")).toBe("#e3b341");
  });

  it("offers every default as a preset, so the current colour is always a swatch", () => {
    const presets = WORKFLOW_CANVAS_COLOR_PRESETS.map((preset) => preset.color);
    for (const { defaultColor } of WORKFLOW_CANVAS_KINDS) {
      expect(presets).toContain(defaultColor);
    }
  });

  it("gives a card the default as its CSS fallback, so one drawn before the sync still has a colour", () => {
    expect(workflowCanvasKindColor("credential")).toBe("var(--wf-kind-credential, #e3b341)");
    expect(workflowCanvasKindColor("login")).toBe("var(--wf-kind-login, #8b949e)");
  });
});
