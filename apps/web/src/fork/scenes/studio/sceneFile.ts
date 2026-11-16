import { AMBIENT_KINDS } from "../ambient/types";
import { BUILTIN_SCENES } from "../sceneThemes";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { createVividThemeColors } from "../../../themePalette";
import type { SceneManifest } from "../manifest";

const Color = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Hex = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i));
const FileName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const TravelerKind = Schema.Literals(["car", "rider", "paw", "boat", "sleigh"]);
const TravelerScale = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(0.5),
  Schema.isLessThanOrEqualTo(2),
);
const TravelerAnchor = Schema.Literals(["center", "ground"]);

export const StudioSceneFile = Schema.Struct({
  version: Schema.Literal(1),
  ambient: Schema.optionalKey(
    Schema.Struct({
      kind: Schema.Literals(AMBIENT_KINDS),
      intensity: Schema.optionalKey(Schema.Literals(["low", "medium"])),
      area: Schema.optionalKey(Schema.Literals(["frame", "chat"])),
    }),
  ),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(48)),
  tagline: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))),
  palette: Schema.Struct({ background: Color, accent: Color }),
  look: Schema.Struct({
    frame: Color,
    glow: Color,
    accent: Color,
    accentAlt: Color,
    ink: Color,
    paper: Color,
    surface: Color,
    chatTint: Hex,
    headingStyle: Schema.Literals(["italic", "serif", "plain"]),
  }),
  art: Schema.optionalKey(
    Schema.Struct({
      banner: Schema.optionalKey(FileName),
      logo: Schema.optionalKey(FileName),
      character: Schema.optionalKey(FileName),
      chatBackdrop: Schema.optionalKey(FileName),
      userAvatar: Schema.optionalKey(FileName),
      corner: Schema.optionalKey(FileName),
    }),
  ),
  bannerGradient: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))),
  bannerFocus: Schema.optionalKey(Schema.Struct({ full: Color, compact: Color })),
  map: Schema.Struct({
    terrain: Schema.optionalKey(
      Schema.Literals(["city", "forest", "meadow", "hills", "desert", "snow"]),
    ),
    path: Schema.optionalKey(Schema.Literals(["asphalt", "dirt", "stone", "boardwalk"])),
    style: Schema.optionalKey(Schema.Literals(["streets", "parchment"])),
    tree: Schema.optionalKey(Color),
    treeShadow: Schema.optionalKey(Color),
    grass: Schema.optionalKey(Color),
    contour: Schema.optionalKey(Color),
    pathColor: Schema.optionalKey(Color),
    ground: Color,
    water: Color,
    park: Color,
    block: Color,
    road: Color,
    route: Color,
    vehicle: Schema.optionalKey(TravelerKind),
    traveler: Schema.optionalKey(
      Schema.Union([
        TravelerKind,
        Schema.Struct({
          image: FileName,
          scale: Schema.optionalKey(TravelerScale),
          anchor: Schema.optionalKey(TravelerAnchor),
        }),
      ]),
    ),
    trail: Schema.optionalKey(Schema.Literals(["line", "prints"])),
  }),
});
export type StudioSceneFile = typeof StudioSceneFile.Type;
export type StudioArtKey = keyof NonNullable<StudioSceneFile["art"]>;

export const STUDIO_ART_KEYS: ReadonlyArray<StudioArtKey> = [
  "banner",
  "logo",
  "character",
  "chatBackdrop",
  "userAvatar",
  "corner",
];

const decodeSceneFile = Schema.decodeUnknownExit(Schema.fromJsonString(StudioSceneFile));

export function parseSceneFile(
  json: string,
):
  | { readonly ok: true; readonly file: StudioSceneFile }
  | { readonly ok: false; readonly error: string } {
  const result = decodeSceneFile(json);
  if (Exit.isSuccess(result)) return { ok: true, file: result.value };
  const error = Cause.squash(result.cause);
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/** Scene folder names; theme ids are at most 48 characters and "studio-" takes 7. */
export function isStudioSceneSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(slug);
}

export function studioSceneThemeId(slug: string): string {
  const id = `studio-${slug}`;
  // Revisions of shipped scenes get their own identity instead of replacing the bundled artwork.
  return BUILTIN_SCENES.some((scene) => scene.theme.id === id) ? `design-${slug}` : id;
}

function hexToRgbTriplet(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff}`;
}

export function studioSceneToManifest(
  file: StudioSceneFile,
  slug: string,
  resolveArt: (name: string) => string | undefined,
): SceneManifest {
  const art: SceneManifest["art"] = {};
  for (const key of STUDIO_ART_KEYS) {
    const name = file.art?.[key];
    const url = name === undefined ? undefined : resolveArt(name);
    if (url !== undefined) art[key] = url;
  }
  const { look } = file;
  return {
    theme: {
      id: studioSceneThemeId(slug),
      label: file.name,
      appearance: "dark",
      colors: createVividThemeColors("dark", file.palette.background, file.palette.accent),
    },
    ...(file.tagline !== undefined ? { tagline: file.tagline } : {}),
    art,
    ...(file.ambient ? { ambient: file.ambient } : {}),
    ...(file.bannerGradient !== undefined ? { bannerGradient: file.bannerGradient } : {}),
    bannerFocus: file.bannerFocus ?? { full: "60%", compact: "80%" },
    look: {
      frame: look.frame,
      glow: look.glow,
      accent: look.accent,
      accentAlt: look.accentAlt,
      ink: look.ink,
      paper: look.paper,
      backdrop: `radial-gradient(120% 60% at 50% 0, ${look.glow}, transparent 70%), ${file.palette.background}`,
      surface: look.surface,
      chatTint: hexToRgbTriplet(look.chatTint),
      headingStyle: look.headingStyle,
    },
    map: {
      ...file.map,
      terrain: file.map.terrain ?? "city",
      path: file.map.path ?? "asphalt",
      traveler:
        typeof file.map.traveler === "object"
          ? {
              image: resolveArt(file.map.traveler.image) ?? "",
              ...(file.map.traveler.scale === undefined ? {} : { scale: file.map.traveler.scale }),
              ...(file.map.traveler.anchor === undefined
                ? {}
                : { anchor: file.map.traveler.anchor }),
            }
          : (file.map.traveler ?? file.map.vehicle ?? "car"),
    },
  };
}
