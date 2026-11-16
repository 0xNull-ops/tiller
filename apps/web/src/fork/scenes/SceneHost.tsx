import { StudioActivity } from "./studio/StudioSessions";
import { useEffect, useState } from "react";

import { sceneStyleVars } from "./manifest";
import { useActiveScene } from "./useActiveScene";
import { AmbientLayer } from "./ambient/AmbientLayer";
import { SceneRenderer, type SceneBannerMode } from "./SceneRenderer";
import { StudioPanelHost } from "./studio/StudioPanel";
import "./scenes.css";

const BANNER_MODE_KEY = "tiller:scene-banner";
// Below this window height the full banner costs too much room, so it starts compact.
const COMPACT_BELOW_HEIGHT = 860;

function readBannerMode(): SceneBannerMode {
  try {
    const stored = localStorage.getItem(BANNER_MODE_KEY);
    if (stored === "full" || stored === "compact") return stored;
  } catch {
    // Storage can be blocked; fall through to the size-based default.
  }
  return window.innerHeight < COMPACT_BELOW_HEIGHT ? "compact" : "full";
}

function storeBannerMode(mode: SceneBannerMode) {
  try {
    localStorage.setItem(BANNER_MODE_KEY, mode);
  } catch {
    // A preference that cannot be saved still applies for this session.
  }
}

/** Draws the artwork for scene themes around the normal app layout. */
export function SceneHost() {
  const scene = useActiveScene();
  const sceneId = scene?.theme.id ?? null;
  const [bannerMode, setBannerMode] = useState(readBannerMode);
  const toggleBanner = () => {
    const next = bannerMode === "full" ? "compact" : "full";
    storeBannerMode(next);
    setBannerMode(next);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scene layout CSS keys off <html>, outside React.
  useEffect(() => {
    if (scene === null) return;
    const root = document.documentElement;
    const vars = sceneStyleVars(scene);
    root.dataset.tillerScene = scene.theme.id;
    root.dataset.sceneBannerMode = bannerMode;
    root.dataset.sceneHeading = scene.look.headingStyle;
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return () => {
      delete root.dataset.tillerScene;
      delete root.dataset.sceneBannerMode;
      delete root.dataset.sceneHeading;
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [scene, bannerMode]);

  return (
    <>
      {scene === null ? (
        <AmbientLayer ambient={undefined} />
      ) : (
        <SceneRenderer
          key={sceneId}
          scene={scene}
          bannerMode={bannerMode}
          toggleBanner={toggleBanner}
        />
      )}
      <StudioPanelHost />
      <StudioActivity />
    </>
  );
}
