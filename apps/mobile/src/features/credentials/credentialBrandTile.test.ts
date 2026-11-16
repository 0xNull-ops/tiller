import { describe, expect, it } from "vite-plus/test";

import { credentialBrandMark } from "./credentialBrandTile";

const mark = (input: Parameters<typeof credentialBrandMark>[0]) => credentialBrandMark(input);

describe("credentialBrandMark", () => {
  it("draws a dark brand in its own colour with light letters", () => {
    expect(mark({ name: "GitHub token" })).toEqual({
      text: "GB",
      background: "#181717",
      foreground: "#ffffff",
    });
  });

  it("switches to dark letters on a bright brand", () => {
    expect(mark({ name: "Supabase service role" })).toEqual({
      text: "SE",
      background: "#3fcf8e",
      foreground: "#111111",
    });
  });

  it("falls back to a neutral monogram from the credential's own name", () => {
    expect(mark({ name: "Internal deploy token" })).toEqual({
      text: "IT",
      background: null,
      foreground: null,
    });
  });

  it("lets a picked icon beat the name", () => {
    expect(mark({ name: "Internal deploy token", iconOverride: "stripe" }).background).toBe(
      "#635bff",
    );
  });

  it("detects the brand from an environment variable when the name says nothing", () => {
    expect(mark({ name: "Production", envVars: ["STRIPE_SECRET_KEY"] }).background).toBe("#635bff");
  });

  it("uses the template's brand before the name", () => {
    expect(mark({ name: "Deploy key", templateIcon: "github" }).background).toBe("#181717");
  });
});
