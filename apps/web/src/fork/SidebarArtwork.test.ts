import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironmentIdentificationMode } from "../hooks/useSettings";
import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import { resolveThemeHalf, themeAllowsSidebarArtwork } from "../themePalette";
import { resolveSidebarArtworkPolicy } from "./SidebarArtwork";

describe("sidebar artwork policy", () => {
  it.each(["light", "dark"] as const)("keeps default %s artwork available", () => {
    const mode = resolveEnvironmentIdentificationMode({
      mode: "artwork",
      settingsHydrated: true,
      paletteThemeActive: false,
    });

    expect(mode).toBe("artwork");
    expect(resolveSidebarArtworkPolicy("Beta", mode)).toEqual({
      enabled: true,
      stageBackdropEnabled: false,
    });
  });

  it("keeps artwork enabled for built-in themes selected by the active appearance half", () => {
    for (const appearance of ["light", "dark"] as const) {
      const definition = BUILT_IN_THEMES.find((theme) => theme.sidebarArtwork);
      expect(definition).toBeDefined();
      const halves = appearance === "light" ? { light: definition!.id } : { dark: definition!.id };
      const activeTheme = resolveThemeHalf("ocean", halves, appearance);
      expect(themeAllowsSidebarArtwork(activeTheme)).toBe(true);
      expect(
        resolveEnvironmentIdentificationMode({
          mode: "artwork",
          settingsHydrated: true,
          paletteThemeActive: true,
          paletteThemeAllowsArtwork: themeAllowsSidebarArtwork(activeTheme),
        }),
      ).toBe("artwork");
    }
  });

  it.each(["custom theme", "environment theme", "plain theme preview"])(
    "keeps %s plain when artwork is unavailable",
    () => {
      const mode = resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
        paletteThemeAllowsArtwork: false,
      });

      expect(mode).toBe("pill");
      expect(resolveSidebarArtworkPolicy("Beta", mode).enabled).toBe(false);
    },
  );

  it("honors artwork previews and explicit Pill or None choices", () => {
    const previewMode = resolveEnvironmentIdentificationMode({
      mode: "artwork",
      settingsHydrated: true,
      paletteThemeActive: true,
      paletteThemeAllowsArtwork: true,
    });
    expect(resolveSidebarArtworkPolicy("Beta", previewMode).enabled).toBe(true);

    for (const mode of ["pill", "none"] as const) {
      expect(resolveSidebarArtworkPolicy("Beta", mode).enabled).toBe(false);
    }
  });

  it.each([
    ["Dev", true],
    ["Nightly", true],
    ["Beta", false],
    ["Production", false],
  ] as const)("preserves %s stage treatment while allowing its header art", (stage, backdrop) => {
    expect(resolveSidebarArtworkPolicy(stage, "artwork")).toEqual({
      enabled: true,
      stageBackdropEnabled: backdrop,
    });
  });

  it("keeps stage identification and art off when the selection is None or Pill", () => {
    for (const mode of ["pill", "none"] as const) {
      expect(resolveSidebarArtworkPolicy("Nightly", mode)).toEqual({
        enabled: false,
        stageBackdropEnabled: false,
      });
    }
  });

  it.each(["dev-artwork", "nightly-artwork"] as const)(
    "shows the explicitly selected %s artwork regardless of the current stage",
    (mode) => {
      expect(resolveSidebarArtworkPolicy("Production", mode)).toEqual({
        enabled: true,
        stageBackdropEnabled: true,
      });
    },
  );
});
