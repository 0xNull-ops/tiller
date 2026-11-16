// fork(scenes): the scene themes that ship with Tiller. Each is a manifest the shared renderer draws.
import type { ThemeDefinition } from "@t3tools/shared/themePalettes";

import { GILDED_REALM } from "./builtins/gildedRealm";
import { NEON_BOULEVARD } from "./builtins/neonBoulevard";
import { AMBER_STATIC } from "./builtins/amberStatic";
import { VELVET_PAWS } from "./builtins/velvetPaws";
import { CARBON_HUSH } from "./builtins/carbonHush";
import { LANTERN_SLEIGH } from "./builtins/lanternSleigh";
import { ABYSSAL_STATION } from "./builtins/abyssalStation";
import { ORBITAL_DRIFT } from "./builtins/orbitalDrift";
import { MOSSLIGHT_GROVE } from "./builtins/mosslightGrove";
import { EMBER_FOUNDRY } from "./builtins/emberFoundry";
import type { SceneManifest } from "./manifest";

// Studio-prefixed IDs are persisted selections; keep them stable when bundling existing scenes.
export const BUILTIN_SCENES: ReadonlyArray<SceneManifest> = [
  NEON_BOULEVARD,
  GILDED_REALM,
  AMBER_STATIC,
  VELVET_PAWS,
  CARBON_HUSH,
  LANTERN_SLEIGH,
  ABYSSAL_STATION,
  ORBITAL_DRIFT,
  MOSSLIGHT_GROVE,
  EMBER_FOUNDRY,
];

export const SCENE_THEMES: ReadonlyArray<ThemeDefinition> = BUILTIN_SCENES.map(
  (scene) => scene.theme,
);
