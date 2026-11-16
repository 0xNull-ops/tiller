import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "./settings.ts";
import { WorkflowCanvasColors } from "./workflowCanvasColors.ts";

const decode = Schema.decodeSync(ClientSettingsSchema);
/** The same read the web app does on the client-settings blob it keeps in local storage. */
const decodeStored = Schema.decodeSync(Schema.fromJsonString(ClientSettingsSchema));
const encodeStored = Schema.encodeSync(Schema.fromJsonString(ClientSettingsSchema));
const encodeColors = Schema.encodeSync(WorkflowCanvasColors);

describe("workflow canvas colours", () => {
  it("defaults to no picks, so every kind keeps the colour in the web app", () => {
    expect(DEFAULT_CLIENT_SETTINGS.workflowCanvasColors).toEqual({});
    expect(decode({}).workflowCanvasColors).toEqual({});
  });

  it("keeps the picks a user made", () => {
    expect(
      decode({ workflowCanvasColors: { credential: "#E3B341", mcp: "#58a6ff" } }),
    ).toMatchObject({ workflowCanvasColors: { credential: "#E3B341", mcp: "#58a6ff" } });
  });

  it("refuses to write a colour that is not a hex triplet a browser can paint", () => {
    for (const value of ["red", "#fff", "#gggggg", "rgb(0 0 0)"]) {
      expect(() => encodeColors({ check: value })).toThrow();
    }
  });

  it("falls back to the defaults for a stored value it cannot read", () => {
    for (const stored of [
      '{"workflowCanvasColors":{"credential":"amber"}}',
      '{"workflowCanvasColors":{"credential":null}}',
      '{"workflowCanvasColors":"#e3b341"}',
      '{"workflowCanvasColors":[["credential","#e3b341"]]}',
    ]) {
      expect(decodeStored(stored).workflowCanvasColors).toEqual({});
    }
  });

  it("keeps the rest of the settings when only the colours are unreadable", () => {
    expect(
      decodeStored(
        '{"workflowCanvasColors":{"check":"#3fb950","mcp":"violet"},"panelAnimationDurationMs":120}',
      ),
    ).toMatchObject({ workflowCanvasColors: {}, panelAnimationDurationMs: 120 });
  });

  it("round-trips a pick through the stored JSON the web app writes", () => {
    const stored = encodeStored({
      ...DEFAULT_CLIENT_SETTINGS,
      workflowCanvasColors: { login: "#8b949e" },
    });
    expect(decodeStored(stored)).toMatchObject({ workflowCanvasColors: { login: "#8b949e" } });
  });
});
