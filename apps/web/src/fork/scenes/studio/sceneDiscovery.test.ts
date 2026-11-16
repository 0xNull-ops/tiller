import { describe, expect, it } from "vite-plus/test";

import { fileNamesIn, inspectStudioScene, sceneFixPrompt, sceneSlugs } from "./sceneDiscovery";

const scene = {
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

describe("scene discovery", () => {
  it("finds scene folders and the files directly inside one", () => {
    expect(
      sceneSlugs([
        { path: "scenes/rainy-alley", kind: "directory" },
        { path: "scenes/README.md", kind: "file" },
        { path: "scenes/autumn", kind: "directory" },
      ]),
    ).toEqual(["autumn", "rainy-alley"]);
    expect([
      ...fileNamesIn(
        [
          { path: "scenes/autumn/scene.json", kind: "file" },
          { path: "scenes/autumn/banner.webp", kind: "file" },
          { path: "scenes/autumn/old", kind: "directory" },
          { path: "scenes/autumn-2/logo.webp", kind: "file" },
        ],
        "scenes/autumn",
      ),
    ]).toEqual(["scene.json", "banner.webp"]);
  });

  it("reports missing art, broken files and bad folder names as errors", () => {
    const missing = inspectStudioScene({
      slug: "night-harbor",
      rawJson: JSON.stringify(scene),
      fileNames: new Set(["scene.json", "banner.webp"]),
    });
    expect(missing.themeId).toBe("studio-night-harbor");
    const revision = inspectStudioScene({
      slug: "velvet-paws",
      rawJson: JSON.stringify(scene),
      fileNames: new Set(["scene.json", "banner.webp", "logo.webp"]),
    });
    expect(revision.themeId).toBe("design-velvet-paws");
    expect(missing.issues).toContainEqual({
      level: "error",
      message: "Missing art file: logo.webp",
    });

    const broken = inspectStudioScene({ slug: "Bad Name", rawJson: "{", fileNames: new Set() });
    expect(broken.file).toBeNull();
    expect(broken.issues.map((issue) => issue.level)).toEqual(["error", "error"]);
    expect(sceneFixPrompt(broken).split("\n")).toHaveLength(3);
  });
});
