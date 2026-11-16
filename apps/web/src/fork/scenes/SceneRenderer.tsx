import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AmbientLayer } from "./ambient/AmbientLayer";
import type { SceneManifest } from "./manifest";
import { SceneMap } from "./map/SceneMap";

export type SceneBannerMode = "full" | "compact";

const FLYBY_MS = 26_000;

/** Schedules one flyby at a time instead of a looping animation. */
function useFlybys(everyMs: readonly [number, number] | null): number {
  const [flight, setFlight] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the timer that schedules each flyby.
  useEffect(() => {
    if (!everyMs) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = (delay: number) => {
      timer = setTimeout(() => {
        setFlight((count) => count + 1);
        next(FLYBY_MS + everyMs[0] + Math.random() * (everyMs[1] - everyMs[0]));
      }, delay);
    };
    next(4_000);
    return () => clearTimeout(timer);
  }, [everyMs]);
  return flight;
}

function useSidebarSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the sidebar DOM node the map portals into.
  useEffect(() => {
    const find = () => {
      const inner = document.querySelector<HTMLElement>('[data-slot="sidebar-inner"]');
      setSlot((current) => (current === inner ? current : inner));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return slot;
}

/** Draws one scene manifest around the normal app layout. */
export function SceneRenderer({
  scene,
  bannerMode,
  toggleBanner,
}: {
  scene: SceneManifest;
  bannerMode: SceneBannerMode;
  toggleBanner: () => void;
}) {
  const flight = useFlybys(scene.flyby?.everyMs ?? null);
  const sidebar = useSidebarSlot();
  const [mapHidden, setMapHidden] = useState(() => {
    try {
      return localStorage.getItem("tiller:scene-map-hidden") === "true";
    } catch {
      return false;
    }
  });
  const toggleMap = () => {
    const hidden = !mapHidden;
    setMapHidden(hidden);
    try {
      localStorage.setItem("tiller:scene-map-hidden", String(hidden));
    } catch {
      /* The control still works without storage. */
    }
  };

  return (
    <>
      <AmbientLayer ambient={scene.ambient} />
      {createPortal(
        <div data-scene-banner="" onDoubleClick={toggleBanner}>
          <div data-scene-banner-art="" />
          {scene.flyby && flight > 0 && bannerMode === "full" ? (
            <img
              key={flight}
              data-scene-flyby=""
              data-scene-motion=""
              src={scene.flyby.image}
              style={{ width: scene.flyby.width }}
              alt=""
            />
          ) : null}
          {scene.art.character ? (
            <img data-scene-character="" src={scene.art.character} alt="" />
          ) : null}
          <Link to="/" data-scene-logo="" aria-label="Tiller home">
            {scene.art.logo ? (
              <img src={scene.art.logo} alt="Tiller" />
            ) : (
              <span data-scene-logo-text="">Tiller</span>
            )}
          </Link>
          <button
            type="button"
            data-scene-banner-toggle=""
            aria-label={bannerMode === "full" ? "Shrink banner" : "Expand banner"}
            aria-expanded={bannerMode === "full"}
            onClick={toggleBanner}
          >
            {bannerMode === "full" ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
        </div>,
        document.body,
      )}
      {sidebar
        ? createPortal(
            <div data-scene-sidebar-map="">
              <button
                type="button"
                data-scene-map-toggle=""
                aria-label={mapHidden ? "Show journey map" : "Hide journey map"}
                aria-expanded={!mapHidden}
                onClick={toggleMap}
              >
                Journey map {mapHidden ? <ChevronDownIcon /> : <ChevronUpIcon />}
              </button>
              {mapHidden ? null : (
                <SceneMap
                  traveler={scene.map.traveler}
                  trail={scene.map.trail}
                  terrain={scene.map.terrain ?? "city"}
                  path={scene.map.path ?? "asphalt"}
                  mapStyle={scene.map.style ?? "streets"}
                />
              )}
            </div>,
            sidebar,
          )
        : null}
    </>
  );
}
