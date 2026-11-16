import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { useThreadRouteTarget } from "../../../hooks/useThreadRouteTarget";
import { useQuietThreadShell } from "../../../state/entities";
import { observeResize } from "~/lib/observeResize";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SceneManifest } from "../manifest";
import { useAmbientEnabled, useAmbientChoice, useAmbientControls } from "./preference";
import { ambientParticleCount, resolveAmbient, type AmbientControls } from "./controls";
import { drawAmbientFrame } from "./draw";
import "./ambient.css";

type Ambient = NonNullable<SceneManifest["ambient"]>;
type Battery = EventTarget & { charging: boolean; level: number };
function Canvas({
  ambient,
  area,
  controls,
  layers,
  active,
}: {
  ambient: Ambient;
  area: "frame" | "chat" | "banner";
  controls: AmbientControls;
  layers: number;
  active: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns canvas rendering and browser power/motion subscriptions.
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const colors = getComputedStyle(document.documentElement);
    const color =
      ambient.kind === "snow"
        ? "#f3f8ff"
        : ambient.kind === "petals"
          ? "#f5a4c3"
          : ambient.kind === "fire" || ambient.kind === "embers"
            ? "#ff923b"
            : colors
                .getPropertyValue(ambient.kind === "dust" ? "--scene-paper" : "--scene-accent")
                .trim() || "#cbd5e1";
    const particles = Array.from(
      { length: ambientParticleCount(ambient.intensity, controls.density, layers) },
      () => ({
        x: Math.random(),
        y: Math.random(),
        phase: Math.random() * Math.PI * 2,
        size: 1 + Math.random() * 2.5,
      }),
    );
    let width = 0,
      height = 0,
      frame = 0,
      last = 0,
      time = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let focused = document.hasFocus(),
      disposed = false;
    let battery: Battery | undefined;
    const banner = document.querySelector<HTMLElement>("[data-scene-banner-art]");
    const allowed = () =>
      !disposed &&
      !motion.matches &&
      !document.hidden &&
      focused &&
      !(battery && !battery.charging && battery.level < 0.2);
    const flicker = () => {
      timer = setTimeout(
        () => {
          if (!allowed()) return;
          banner?.style.setProperty("filter", `brightness(${1 + 0.15 * controls.opacity})`);
          timer = setTimeout(() => {
            banner?.style.removeProperty("filter");
            flicker();
          }, 100);
        },
        (8000 + Math.random() * 12000) / controls.speed,
      );
    };
    const draw = (now: number) => {
      if (!allowed()) return;
      const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      const elapsed = delta * controls.speed * (controls.activityBoost && active ? 1.4 : 1);
      time += elapsed;
      drawAmbientFrame({
        context,
        kind: ambient.kind,
        controls,
        particles,
        width,
        height,
        time,
        elapsed,
        color,
      });
      timer = setTimeout(() => {
        frame = requestAnimationFrame(draw);
      }, 1000 / 24);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      last = 0;
      banner?.style.removeProperty("filter");
      if (!allowed()) {
        context.clearRect(0, 0, width, height);
        return;
      }
      if (ambient.kind === "neon-flicker") {
        if (area === "frame") flicker();
      } else frame = requestAnimationFrame(draw);
    };
    const resize = observeResize(canvas, () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    const focus = () => {
      focused = true;
      sync();
    };
    const blur = () => {
      focused = false;
      sync();
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    motion.addEventListener("change", sync);
    const navigatorWithBattery = navigator as Navigator & { getBattery?: () => Promise<Battery> };
    void navigatorWithBattery
      .getBattery?.()
      .then((value) => {
        if (disposed) return;
        battery = value;
        battery.addEventListener("chargingchange", sync);
        battery.addEventListener("levelchange", sync);
        sync();
      })
      .catch(() => {});
    sync();
    return () => {
      disposed = true;
      sync();
      resize();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      motion.removeEventListener("change", sync);
      battery?.removeEventListener("chargingchange", sync);
      battery?.removeEventListener("levelchange", sync);
    };
  }, [ambient, area, controls, layers, active]);
  return <canvas ref={ref} data-scene-ambient={area} aria-hidden="true" />;
}
export function AmbientLayer({ ambient: configured }: { ambient: Ambient | undefined }) {
  const enabled = useAmbientEnabled();
  const target = useThreadRouteTarget();
  const shell = useQuietThreadShell(target?.kind === "server" ? target.threadRef : null);
  const active = threadRuntimeIsActive(shell?.runtime);
  const choice = useAmbientChoice();
  const controls = useAmbientControls();
  const ambient = resolveAmbient(configured, choice);
  const [targets, setTargets] = useState<{ banner: HTMLElement | null; chat: HTMLElement | null }>({
    banner: null,
    chat: null,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows portal targets across navigation without covering text or controls.
  useEffect(() => {
    if (!enabled || !ambient) return;
    const find = () => {
      const banner = document.querySelector<HTMLElement>("[data-scene-banner-art]");
      const chat =
        ambient.area === "chat"
          ? document.querySelector<HTMLElement>('[data-workspace-area="conversation"]')
          : null;
      setTargets((current) =>
        current.banner === banner && current.chat === chat ? current : { banner, chat },
      );
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, ambient]);
  if (!enabled || !ambient) return null;
  const layers = 1 + (targets.banner ? 1 : 0) + (targets.chat ? 1 : 0);
  return (
    <>
      {createPortal(
        <Canvas
          ambient={ambient}
          area="frame"
          controls={controls}
          layers={layers}
          active={active}
        />,
        document.body,
      )}
      {targets.banner && ambient.kind !== "neon-flicker"
        ? createPortal(
            <Canvas
              ambient={ambient}
              area="banner"
              controls={controls}
              layers={layers}
              active={active}
            />,
            targets.banner,
          )
        : null}
      {targets.chat
        ? createPortal(
            <Canvas
              ambient={ambient}
              area="chat"
              controls={controls}
              layers={layers}
              active={active}
            />,
            targets.chat,
          )
        : null}
    </>
  );
}
