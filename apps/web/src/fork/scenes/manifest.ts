import type { AmbientDefinition } from "./ambient/types";
import type { ThemeDefinition } from "@t3tools/shared/themePalettes";

/** A theme's own map marker: one tightly cropped sprite, never a whole illustration. */
export type SceneTravelerImage = {
  image: string;
  /** Marker box as a multiple of the default 26 map units. */
  scale?: number;
  /** Which point of the sprite sits on the route. Center keeps older markers where they were. */
  anchor?: "center" | "ground";
};

export type SceneTraveler = "car" | "rider" | "paw" | "boat" | "sleigh" | SceneTravelerImage;

/**
 * Everything a scene theme is, as data. Built-in scenes and generated ones share this shape;
 * one renderer and one stylesheet draw any of them. Art values are image URLs.
 */
export type SceneManifest = {
  /** The palette. Its id is the scene id and is what the theme picker stores. */
  ambient?: AmbientDefinition;
  theme: ThemeDefinition;
  art: {
    /** Wide banner, cropped never stretched. Key content in the 30%-85% vertical band. */
    banner?: string;
    /** Wordmark shown at the top left of the banner; without it the word is set in type. */
    logo?: string;
    /** Optional bust beside the logo; hidden in the compact banner. */
    character?: string;
    /** Low-contrast picture behind the conversation, darkest on the left. */
    chatBackdrop?: string;
    /** Square picture beside the user's messages. */
    userAvatar?: string;
    /** Ornament drawn on the top-left corner of the chat and side panels. */
    corner?: string;
  };
  /** Banner background when there is no banner image, any CSS background. Defaults to the backdrop. */
  bannerGradient?: string;
  /** Vertical background position of the banner art in the full and compact banner. */
  bannerFocus: { full: string; compact: string };
  look: {
    /** Panel frame color. */
    frame: string;
    /** Frame glow, as an rgb() color with alpha. */
    glow: string;
    /** Headings and highlights. */
    accent: string;
    /** Second highlight: waiting states, the next leg of a route. */
    accentAlt: string;
    /** Dark ink used on top of the accent. */
    ink: string;
    /** Light text on dark scene surfaces. */
    paper: string;
    /** Page background behind the panels, any CSS background. */
    backdrop: string;
    /** Sidebar and HUD surface. */
    surface: string;
    /** Conversation tint as "r g b", laid over the chat backdrop. */
    chatTint: string;
    headingStyle: "italic" | "serif" | "plain";
  };
  map: {
    terrain?: "city" | "forest" | "meadow" | "hills" | "desert" | "snow";
    path?: "asphalt" | "dirt" | "stone" | "boardwalk";
    tree?: string;
    treeShadow?: string;
    grass?: string;
    contour?: string;
    pathColor?: string;
    ground: string;
    water: string;
    park: string;
    block: string;
    road: string;
    route: string;
    traveler: SceneTraveler;
    trail?: "line" | "prints";
    /** How the map is drawn: neon streets with lane markings, or parchment with ink roads. */
    style?: "streets" | "parchment";
  };
  /** An occasional object crossing the banner, such as a helicopter or a bird. */
  flyby?: { image: string; width: number; everyMs: readonly [number, number] };
  /** A short line under the theme name in the picker. */
  tagline?: string;
};

/** CSS custom properties the shared scene stylesheet reads. */
export function sceneStyleVars(scene: SceneManifest): Readonly<Record<string, string>> {
  const url = (value: string | undefined) => (value ? `url("${value}")` : "none");
  const { look, map } = scene;
  return {
    "--scene-frame-color": look.frame,
    "--scene-glow": look.glow,
    "--scene-frame-shadow": `0 0 0 1px ${look.glow}, 0 0 22px ${look.glow}`,
    "--scene-accent": look.accent,
    "--scene-accent-alt": look.accentAlt,
    "--scene-ink": look.ink,
    "--scene-paper": look.paper,
    "--scene-backdrop": look.backdrop,
    "--scene-surface-dark": look.surface,
    "--scene-chat-tint": look.chatTint,
    "--scene-art-banner": scene.art.banner
      ? url(scene.art.banner)
      : (scene.bannerGradient ?? look.backdrop),
    "--scene-art-chat": url(scene.art.chatBackdrop ?? scene.art.banner),
    "--scene-avatar-display": scene.art.userAvatar ? "block" : "none",
    "--scene-art-avatar": url(scene.art.userAvatar),
    "--scene-art-corner": url(scene.art.corner),
    "--scene-banner-focus": scene.bannerFocus.full,
    "--scene-banner-focus-compact": scene.bannerFocus.compact,
    "--map-ground": map.ground,
    "--map-water": map.water,
    "--map-park": map.park,
    "--map-block": map.block,
    "--map-road": map.road,
    "--map-route": map.route,
    "--map-tree": map.tree ?? map.park,
    "--map-tree-shadow": map.treeShadow ?? map.ground,
    "--map-grass": map.grass ?? map.park,
    "--map-contour": map.contour ?? map.block,
    "--map-path": map.pathColor ?? map.road,
  };
}
