import { themeColorToHex } from "../../../themePalette";
import { STUDIO_ART_KEYS, type StudioSceneFile } from "./sceneFile";

export type SceneGateIssue = { readonly level: "error" | "warning"; readonly message: string };

const MIN_BANNER_WIDTH = 1600;
const MIN_BANNER_ASPECT = 4;
const MAX_BANNER_ASPECT = 9;
const MIN_TEXT_CONTRAST = 4.5;
const MIN_ACCENT_CONTRAST = 3;
const MIN_MARKER_SHORT_SIDE = 96;
const MAX_MARKER_ASPECT = 4;
const MAX_MARKER_LONG_SIDE = 512;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of any color the theme parser reads, or null when it can't. */
function relativeLuminance(color: string): number | null {
  const hex = themeColorToHex(color);
  if (hex === null) return null;
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return (
    0.2126 * channelLuminance((value >> 16) & 0xff) +
    0.7152 * channelLuminance((value >> 8) & 0xff) +
    0.0722 * channelLuminance(value & 0xff)
  );
}

function contrastRatio(first: string, second: string): number | null {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Checks a studio scene before it is applied. Errors block applying; warnings are advice. */
export function checkScene(
  file: StudioSceneFile,
  input: {
    readonly missingFiles: ReadonlyArray<string>;
    readonly travelerSize?: { readonly width: number; readonly height: number };
    readonly bannerSize?: { readonly width: number; readonly height: number };
  },
): SceneGateIssue[] {
  const issues: SceneGateIssue[] = input.missingFiles.map((name) => ({
    level: "error",
    message: `Missing art file: ${name}`,
  }));

  const traveler = file.map.traveler;
  if (typeof traveler === "object") {
    const reused = STUDIO_ART_KEYS.filter((key) => file.art?.[key] === traveler.image);
    if (reused.length > 0)
      issues.push({
        level: "warning",
        message: `Traveler image reuses ${reused.join(", ")}; use a dedicated, tightly cropped sprite.`,
      });
  }
  const marker = input.travelerSize;
  if (typeof traveler === "object" && marker) {
    const shortSide = Math.min(marker.width, marker.height);
    const longSide = Math.max(marker.width, marker.height);
    if (shortSide < MIN_MARKER_SHORT_SIDE)
      issues.push({
        level: "warning",
        message: `Traveler sprite is too small to read at map size (${marker.width}×${marker.height}; aim for at least ${MIN_MARKER_SHORT_SIDE}px on its short side).`,
      });
    else if (longSide / shortSide > MAX_MARKER_ASPECT)
      issues.push({
        level: "warning",
        message: `Traveler sprite is too elongated to read at map size (${marker.width}×${marker.height}; keep it under ${MAX_MARKER_ASPECT}:1).`,
      });
    if (longSide > MAX_MARKER_LONG_SIDE)
      issues.push({
        level: "warning",
        message: `Traveler art is ${marker.width}×${marker.height}; use a tightly cropped sprite, not a full illustration.`,
      });
  }
  const size = input.bannerSize;
  if (size !== undefined && size.height > 0) {
    const aspect = size.width / size.height;
    if (size.width < MIN_BANNER_WIDTH || aspect < MIN_BANNER_ASPECT || aspect > MAX_BANNER_ASPECT) {
      issues.push({
        level: "warning",
        message: `Banner may look squashed or cropped (${size.width}×${size.height}; aim for at least ${MIN_BANNER_WIDTH}px wide, between 4:1 and 9:1).`,
      });
    }
  }

  const textContrast = contrastRatio(file.look.paper, file.look.surface);
  if (textContrast !== null && textContrast < MIN_TEXT_CONTRAST) {
    issues.push({
      level: "warning",
      message: `Text on the surface is hard to read (${textContrast.toFixed(1)}:1, needs ${MIN_TEXT_CONTRAST}:1).`,
    });
  }
  const accentContrast = contrastRatio(file.look.accent, file.look.chatTint);
  if (accentContrast !== null && accentContrast < MIN_ACCENT_CONTRAST) {
    issues.push({
      level: "warning",
      message: `Headings blend into the chat (${accentContrast.toFixed(1)}:1, needs ${MIN_ACCENT_CONTRAST}:1).`,
    });
  }

  if (!STUDIO_ART_KEYS.some((key) => file.art?.[key] !== undefined)) {
    issues.push({ level: "warning", message: "Colors only: this model made no images." });
  } else {
    if (!file.art?.chatBackdrop) {
      issues.push({
        level: "warning",
        message: "No chat backdrop; the banner is reused behind the chat",
      });
    }
    if (!file.art?.userAvatar) {
      issues.push({ level: "warning", message: "No user avatar" });
    }
  }
  return issues;
}
