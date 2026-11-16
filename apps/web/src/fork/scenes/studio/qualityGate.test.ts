import { describe, expect, it } from "vite-plus/test";

import { checkScene } from "./qualityGate";
import { parseSceneFile, studioSceneToManifest, type StudioSceneFile } from "./sceneFile";

const base = {
  version: 1,
  name: "Night Harbor",
  palette: { background: "#0b1020", accent: "#4fd1c5" },
  look: {
    frame: "#2c7a7b",
    glow: "rgb(79 209 197 / 0.3)",
    accent: "#4fd1c5",
    accentAlt: "#f6ad55",
    ink: "#06151a",
    paper: "#e6fffa",
    surface: "#0b1020",
    chatTint: "#0e1528",
    headingStyle: "italic",
  },
  art: { banner: "banner.webp", logo: "logo.webp" },
  map: {
    ground: "#111827",
    water: "#1e3a5f",
    park: "#1f3d2b",
    block: "#2d3748",
    road: "#4a5568",
    route: "#4fd1c5",
    vehicle: "car",
  },
};

function parsed(overrides: Record<string, unknown> = {}): StudioSceneFile {
  const result = parseSceneFile(JSON.stringify({ ...base, ...overrides }));
  if (!result.ok) throw new Error(result.error);
  return result.file;
}

describe("parseSceneFile", () => {
  it("decodes a valid file and reports invalid ones", () => {
    const marker = parsed({
      map: { ...base.map, traveler: { image: "marker.png" }, trail: "prints" },
    });
    const sprite = parsed({
      map: {
        ...base.map,
        traveler: { image: "marker.png", scale: 1.4, anchor: "ground" },
      },
    });
    expect(studioSceneToManifest(marker, "test", () => "https://host/marker").map.traveler).toEqual(
      { image: "https://host/marker" },
    );
    expect(studioSceneToManifest(sprite, "test", () => "https://host/marker").map.traveler).toEqual(
      { image: "https://host/marker", scale: 1.4, anchor: "ground" },
    );
    expect(
      studioSceneToManifest(
        parsed({ map: { ...base.map, traveler: "sleigh" } }),
        "sleigh",
        () => undefined,
      ).map.traveler,
    ).toBe("sleigh");
    expect(
      checkScene(marker, {
        missingFiles: ["marker.png"],
        travelerSize: { width: 256, height: 128 },
      }).some((issue) => issue.level === "error"),
    ).toBe(true);
    expect(
      checkScene(marker, { missingFiles: [], travelerSize: { width: 256, height: 128 } }).some(
        (issue) => issue.message.startsWith("Traveler"),
      ),
    ).toBe(false);
    expect(
      checkScene(marker, { missingFiles: [], travelerSize: { width: 128, height: 128 } }).some(
        (issue) => issue.message.startsWith("Traveler"),
      ),
    ).toBe(false);
    const terrain = parsed({
      map: { ...base.map, terrain: "forest", path: "dirt", tree: "#123456" },
    });
    expect(studioSceneToManifest(terrain, "forest", () => undefined).map).toMatchObject({
      terrain: "forest",
      path: "dirt",
      tree: "#123456",
    });
    expect(studioSceneToManifest(parsed(), "legacy", () => undefined).map).toMatchObject({
      terrain: "city",
      path: "asphalt",
    });
    expect(
      parseSceneFile(JSON.stringify({ ...base, map: { ...base.map, terrain: "ocean" } })).ok,
    ).toBe(false);
    const ambient = { kind: "snow", intensity: "low", area: "chat" };
    expect(studioSceneToManifest(parsed({ ambient }), "snow", () => undefined).ambient).toEqual(
      ambient,
    );
    for (const invalid of [
      { kind: "wind" },
      { kind: "rain", intensity: "high" },
      { kind: "dust", area: "all" },
    ])
      expect(parseSceneFile(JSON.stringify({ ...base, ambient: invalid })).ok).toBe(false);
    for (const traveler of [
      { image: "marker.png", scale: 0.2 },
      { image: "marker.png", scale: 3 },
      { image: "marker.png", anchor: "top" },
    ])
      expect(parseSceneFile(JSON.stringify({ ...base, map: { ...base.map, traveler } })).ok).toBe(
        false,
      );
    expect(parsed().name).toBe("Night Harbor");
    const wrongVersion = parseSceneFile(JSON.stringify({ ...base, version: 2 }));
    expect(wrongVersion.ok).toBe(false);
    const badTint = parseSceneFile(
      JSON.stringify({ ...base, look: { ...base.look, chatTint: "teal" } }),
    );
    expect(badTint.ok).toBe(false);
    const notJson = parseSceneFile("{");
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.error.length).toBeGreaterThan(0);
  });
});

describe("studioSceneToManifest", () => {
  it("maps the file to a dark studio manifest with resolved art", () => {
    const manifest = studioSceneToManifest(parsed(), "night-harbor", (name) =>
      name === "banner.webp" ? "https://host/banner" : undefined,
    );
    expect(manifest.theme.id).toBe("studio-night-harbor");
    expect(manifest.theme.label).toBe("Night Harbor");
    expect(manifest.theme.appearance).toBe("dark");
    expect(manifest.look.chatTint).toBe("14 21 40");
    expect(manifest.bannerFocus).toEqual({ full: "60%", compact: "80%" });
    expect(manifest.art).toEqual({ banner: "https://host/banner" });
  });
});

describe("checkScene", () => {
  it("errors on each missing art file", () => {
    const issues = checkScene(parsed(), { missingFiles: ["banner.webp", "logo.webp"] });
    expect(issues.filter((issue) => issue.level === "error")).toHaveLength(2);
  });

  it("warns when the traveler reuses scene art", () => {
    const reused = parsed({
      art: { ...base.art, chatBackdrop: "marker.png" },
      map: { ...base.map, traveler: { image: "marker.png" } },
    });
    expect(checkScene(reused, { missingFiles: [] })).toContainEqual({
      level: "warning",
      message: "Traveler image reuses chatBackdrop; use a dedicated, tightly cropped sprite.",
    });
    expect(
      checkScene(parsed({ map: { ...base.map, traveler: { image: "marker.png" } } }), {
        missingFiles: [],
      }).some((issue) => issue.message.startsWith("Traveler image reuses")),
    ).toBe(false);
  });

  it("warns only when a traveler sprite is unreadable", () => {
    const marker = parsed({ map: { ...base.map, traveler: { image: "marker.png" } } });
    const warns = (width: number, height: number) =>
      checkScene(marker, { missingFiles: [], travelerSize: { width, height } }).some((issue) =>
        issue.message.startsWith("Traveler"),
      );
    expect(warns(128, 128)).toBe(false);
    expect(warns(256, 128)).toBe(false);
    expect(warns(512, 512)).toBe(false);
    expect(warns(48, 96)).toBe(true);
    expect(warns(128, 64)).toBe(true);
    expect(warns(512, 64)).toBe(true);
    expect(warns(640, 320)).toBe(true);
    expect(warns(1024, 1024)).toBe(true);
  });

  it("warns about a narrow or badly shaped banner", () => {
    const warns = (width: number, height: number) =>
      checkScene(parsed(), { missingFiles: [], bannerSize: { width, height } }).some((issue) =>
        issue.message.startsWith("Banner may look squashed or cropped"),
      );
    expect(warns(2400, 440)).toBe(false);
    expect(warns(1200, 220)).toBe(true);
    expect(warns(2400, 1000)).toBe(true);
    expect(warns(4000, 300)).toBe(true);
  });

  it("warns about low contrast text and accent", () => {
    expect(
      checkScene(
        parsed({ art: { ...base.art, chatBackdrop: "chat.webp", userAvatar: "avatar.webp" } }),
        { missingFiles: [] },
      ),
    ).toEqual([]);
    const dim = parsed({
      look: { ...base.look, paper: "#2a3040", accent: "#1a2238" },
    });
    const messages = checkScene(dim, { missingFiles: [] }).map((issue) => issue.message);
    expect(messages.some((message) => message.startsWith("Text on the surface"))).toBe(true);
    expect(messages.some((message) => message.startsWith("Headings blend"))).toBe(true);
  });

  it("warns when art lacks a chat backdrop or user avatar", () => {
    expect(checkScene(parsed(), { missingFiles: [] })).toEqual([
      { level: "warning", message: "No chat backdrop; the banner is reused behind the chat" },
      { level: "warning", message: "No user avatar" },
    ]);
  });

  it("warns when the scene has no art", () => {
    const issues = checkScene(parsed({ art: {} }), { missingFiles: [] });
    expect(issues).toEqual([
      { level: "warning", message: "Colors only: this model made no images." },
    ]);
  });
});
