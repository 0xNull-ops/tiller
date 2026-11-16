import type { SceneTravelerImage } from "../manifest";

export const DEFAULT_MARKER_SIZE = 26;

export type MarkerFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly preserveAspectRatio: string;
};

/**
 * The square envelope an image marker fits inside. The sprite keeps its own aspect ratio, and a
 * ground anchor puts its bottom edge on the route point.
 */
export function imageMarkerFrame(traveler: SceneTravelerImage): MarkerFrame {
  const size = DEFAULT_MARKER_SIZE * (traveler.scale ?? 1);
  const ground = traveler.anchor === "ground";
  return {
    x: -size / 2,
    y: ground ? -size : -size / 2,
    width: size,
    height: size,
    preserveAspectRatio: ground ? "xMidYMax meet" : "xMidYMid meet",
  };
}
