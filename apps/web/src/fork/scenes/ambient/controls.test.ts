import { expect, it } from "vite-plus/test";
import { AMBIENT_KINDS } from "./types";
import {
  ambientParticleCount,
  DEFAULT_AMBIENT_CONTROLS,
  normalizeAmbientControls,
  resolveAmbient,
} from "./controls";
it("clamps stored controls and recovers corrupt or older preferences", () => {
  expect(normalizeAmbientControls(null)).toEqual(DEFAULT_AMBIENT_CONTROLS);
  expect(
    normalizeAmbientControls({
      size: 20,
      density: -1,
      speed: Number.NaN,
      opacity: "bad",
      wind: -10,
      activityBoost: false,
    }),
  ).toEqual({
    ...DEFAULT_AMBIENT_CONTROLS,
    size: 3,
    density: 0.25,
    wind: -1,
    activityBoost: false,
  });
});
it("uses the theme default or the saved effect choice", () => {
  for (const kind of AMBIENT_KINDS) {
    const configured = { kind, intensity: "low" as const };
    expect(resolveAmbient(configured, "theme")?.kind).toBe(kind);
    expect(resolveAmbient(configured, kind)?.kind).toBe(kind);
  }
  expect(resolveAmbient(undefined, "theme")).toBeUndefined();
});
it("caps total particle work across all canvas layers while density remains adjustable", () => {
  for (const layers of [1, 2, 3]) {
    expect(ambientParticleCount("medium", 2, layers) * layers).toBeLessThanOrEqual(240);
    expect(ambientParticleCount("medium", 2, layers)).toBeGreaterThan(
      ambientParticleCount("medium", 1, layers),
    );
  }
});
