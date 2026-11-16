import { expect, it } from "vite-plus/test";
import { refreshTheme, setTheme } from "../../../hooks/useTheme";
import { BUILTIN_SCENES } from "../sceneThemes";
import { applyStudioScene, removeStudioScene } from "./studioScenes";

it("repaints an active theme when its palette is replaced without changing its id", () => {
  const scene = BUILTIN_SCENES[0]!;
  const file = {
    version: 1,
    name: "Palette update",
    palette: { background: "#111122", accent: "#22aacc" },
    look: { ...scene.look, chatTint: "#111122", surface: "#111122" },
    map: { ...scene.map },
  };
  const previous = localStorage.getItem("t3code:theme");
  const entry = applyStudioScene({
    cwd: "/tmp/studio",
    slug: "palette-update-test",
    rawJson: JSON.stringify(file),
  });
  try {
    setTheme(entry.themeId);
    const before = document.documentElement.style.getPropertyValue("--app-theme-canvas");
    expect(before).not.toBe("");
    applyStudioScene({
      cwd: entry.cwd,
      slug: entry.slug,
      rawJson: JSON.stringify({ ...file, palette: { ...file.palette, background: "#332211" } }),
    });
    expect(document.documentElement.style.getPropertyValue("--app-theme-canvas")).not.toBe(before);
  } finally {
    removeStudioScene(entry.themeId);
    if (previous === null) localStorage.removeItem("t3code:theme");
    else localStorage.setItem("t3code:theme", previous);
    refreshTheme();
  }
});
