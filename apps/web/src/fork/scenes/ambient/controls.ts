import type { AmbientChoice, AmbientDefinition } from "./types";

export const AMBIENT_CONTROL_LIMITS = {
  size: {
    label: "Particle size",
    description: "Make snowflakes, sparks and other particles larger.",
    min: 0.5,
    max: 3,
    step: 0.25,
  },
  density: {
    label: "Density",
    description: "Adjust how many particles appear, within the rendering budget.",
    min: 0.25,
    max: 2,
    step: 0.25,
  },
  speed: {
    label: "Speed",
    description: "Slow the effect down or make it move faster.",
    min: 0.25,
    max: 2,
    step: 0.25,
  },
  opacity: {
    label: "Opacity",
    description: "Control how visible the effect is over the scene.",
    min: 0.15,
    max: 1,
    step: 0.05,
  },
  wind: {
    label: "Wind",
    description: "Drift left or right. Zero keeps the effect's natural motion.",
    min: -1,
    max: 1,
    step: 0.1,
  },
} as const;
export type AmbientControlKey = keyof typeof AMBIENT_CONTROL_LIMITS;
export type AmbientControls = Record<AmbientControlKey, number> & { activityBoost: boolean };
export const DEFAULT_AMBIENT_CONTROLS: AmbientControls = {
  size: 1,
  density: 1,
  speed: 1,
  opacity: 1,
  wind: 0,
  activityBoost: true,
};

export function normalizeAmbientControls(value: unknown): AmbientControls {
  const controls = { ...DEFAULT_AMBIENT_CONTROLS };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return controls;
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(AMBIENT_CONTROL_LIMITS) as AmbientControlKey[]) {
    const number = candidate[key];
    const { min, max } = AMBIENT_CONTROL_LIMITS[key];
    if (typeof number === "number" && Number.isFinite(number))
      controls[key] = Math.min(max, Math.max(min, number));
  }
  if ("activityBoost" in value && typeof value.activityBoost === "boolean")
    controls.activityBoost = value.activityBoost;
  return controls;
}

export function resolveAmbient(
  configured: AmbientDefinition | undefined,
  choice: AmbientChoice,
): AmbientDefinition | undefined {
  return choice === "theme"
    ? configured
    : { kind: choice, intensity: "medium" as const, area: "chat" as const };
}

export function ambientParticleCount(
  intensity: AmbientDefinition["intensity"],
  density: number,
  layers: number,
): number {
  const count = Math.max(1, layers);
  return Math.max(
    1,
    Math.min(
      Math.floor(240 / count),
      Math.round(((intensity === "medium" ? 150 : 90) * density) / count),
    ),
  );
}
