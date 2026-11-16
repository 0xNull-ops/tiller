import { useSyncExternalStore } from "react";
import type { SceneManifest } from "./manifest";
import { BUILTIN_SCENES } from "./sceneThemes";
import { useStudioSceneManifest } from "./studio/studioScenes";

/** Built-in scenes win over an applied studio scene with the same id. */
function useFindScene(themeId: string | null): SceneManifest | null {
  const builtin = BUILTIN_SCENES.find((scene) => scene.theme.id === themeId);
  const studioScene = useStudioSceneManifest(builtin ? null : themeId);
  return builtin ?? studioScene;
}

function subscribeThemeId(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme-id"] });
  return () => observer.disconnect();
}

function readThemeId(): string | null {
  return document.documentElement.dataset.themeId ?? null;
}

export function useActiveScene() {
  return useFindScene(useSyncExternalStore(subscribeThemeId, readThemeId, () => null));
}
