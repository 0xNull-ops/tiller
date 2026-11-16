import type { EnvironmentIdentificationMode } from "@t3tools/contracts/settings";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { observeResize } from "../lib/observeResize";
import "./sidebarArtwork.css";

export type SidebarArtworkPolicy = {
  enabled: boolean;
  stageBackdropEnabled: boolean;
};

export function resolveSidebarArtworkPolicy(
  stageLabel: string,
  mode: EnvironmentIdentificationMode,
): SidebarArtworkPolicy {
  const enabled = mode === "artwork" || mode === "dev-artwork" || mode === "nightly-artwork";
  const stage = stageLabel.trim().toLowerCase();
  return {
    enabled,
    // Dev and Nightly keep a stage-tinted variant of the header art so artwork
    // mode still identifies them without a fixed backdrop palette.
    stageBackdropEnabled:
      mode === "dev-artwork" ||
      mode === "nightly-artwork" ||
      (enabled && (stage === "dev" || stage === "nightly")),
  };
}

/**
 * Theme-aware diagonal panels behind the sidebar lockup. Colors come from the
 * active sidebar tokens so light, dark and built-in themes repaint themselves.
 */
export const SidebarArtworkHeaderArt = memo(function SidebarArtworkHeaderArt({
  variant,
}: {
  variant: "dev" | "nightly" | null;
}) {
  return (
    <div aria-hidden="true" data-shipyard-header-art={variant ?? "base"}>
      <div data-shipyard-art-panel="near" />
      <div data-shipyard-art-panel="far" />
      <div data-shipyard-art-accent="" />
    </div>
  );
});

const REST_MS = 8_000;
const REST_VARIANCE_MS = 4_000;
const PULSE_MS = 2_400;
const MAX_DPR = 1.25;
const FRAME_MS = 1000 / 30;

/** Draws a sparse theme-colored mesh and only schedules frames during short pulses. */
export const SidebarKineticMesh = memo(function SidebarKineticMesh() {
  const headerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [surface, setSurface] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    setSurface(
      header.closest<HTMLElement>(
        '[data-app-sidebar] > [data-slot="sidebar-inner"], [data-app-sidebar][data-slot="sidebar"]',
      ) ?? header.closest<HTMLElement>("[data-app-sidebar]"),
    );
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !surface) return;
    const sidebar = surface.closest<HTMLElement>('[data-slot="sidebar"]');

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let visible = false;
    let frame = 0;
    let scheduleTimer = 0;
    let pulseStartedAt = 0;
    let lastPaintAt = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;

    const resize = () => {
      const bounds = surface.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      draw(0);
    };

    const draw = (elapsed: number) => {
      if (width <= 0 || height <= 0 || !context) return;
      const styles = getComputedStyle(surface);
      const primary = styles.getPropertyValue("--primary").trim() || styles.color;
      const foreground = styles.getPropertyValue("--sidebar-foreground").trim() || styles.color;
      const columns = Math.max(5, Math.min(11, Math.floor(width / 27)));
      const rows = Math.max(14, Math.min(46, Math.floor(height / 34)));
      const cellX = width / columns;
      const cellY = height / rows;
      const active = elapsed > 0;
      const progress = active ? Math.min(1, elapsed / PULSE_MS) : 0;
      const envelope = active ? Math.sin(Math.PI * progress) : 0;
      const centerX = width * (0.16 + progress * 0.72);
      const centerY = height * (0.2 + Math.sin(progress * Math.PI * 2) * 0.36 + progress * 0.36);
      const displacement = (x: number, y: number) => {
        if (!active || envelope <= 0) return 0;
        const distance = Math.hypot((x - centerX) * 0.75, y - centerY);
        return (
          Math.sin(distance / 17 - progress * Math.PI * 8) *
          envelope *
          2.2 *
          Math.exp(-distance / Math.max(100, height * 0.42))
        );
      };

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineWidth = 0.7;
      context.strokeStyle = primary;
      context.globalAlpha = active ? 0.08 + envelope * 0.13 : 0.075;
      for (let column = 0; column <= columns; column++) {
        context.beginPath();
        for (let row = 0; row <= rows; row++) {
          const x = column * cellX;
          const y = row * cellY;
          const pointX = x + displacement(x, y);
          const pointY = y + displacement(y, x) * 0.58;
          if (row === 0) context.moveTo(pointX, pointY);
          else context.lineTo(pointX, pointY);
        }
        context.stroke();
      }
      for (let row = 0; row <= rows; row++) {
        context.beginPath();
        for (let column = 0; column <= columns; column++) {
          const x = column * cellX;
          const y = row * cellY;
          const pointX = x + displacement(x, y);
          const pointY = y + displacement(y, x) * 0.58;
          if (column === 0) context.moveTo(pointX, pointY);
          else context.lineTo(pointX, pointY);
        }
        context.stroke();
      }

      context.fillStyle = foreground;
      context.globalAlpha = active ? 0.12 + envelope * 0.28 : 0.11;
      for (let row = 1; row < rows; row += 4) {
        for (let column = 1; column < columns; column += 2) {
          const x = column * cellX;
          const y = row * cellY;
          const distance = Math.hypot((x - centerX) * 0.75, y - centerY);
          const tension = active ? Math.max(0, 1 - distance / (height * 0.2)) * envelope : 0;
          const radius = 0.8 + tension * 1.6;
          context.beginPath();
          context.arc(
            x + displacement(x, y),
            y + displacement(y, x) * 0.58,
            radius,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
      context.globalAlpha = 1;
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (scheduleTimer) window.clearTimeout(scheduleTimer);
      scheduleTimer = 0;
      draw(0);
    };

    const paused = () =>
      disposed ||
      !visible ||
      document.hidden ||
      media.matches ||
      sidebar?.dataset.state === "collapsed";

    const schedule = () => {
      if (paused() || scheduleTimer || frame) return;
      scheduleTimer = window.setTimeout(
        () => {
          scheduleTimer = 0;
          if (paused()) return;
          pulseStartedAt = performance.now();
          lastPaintAt = 0;
          const animate = (now: number) => {
            frame = 0;
            if (paused()) return;
            if (now - lastPaintAt >= FRAME_MS) {
              lastPaintAt = now;
              draw(now - pulseStartedAt);
            }
            if (now - pulseStartedAt < PULSE_MS) frame = requestAnimationFrame(animate);
            else {
              draw(0);
              schedule();
            }
          };
          frame = requestAnimationFrame(animate);
        },
        REST_MS + Math.random() * REST_VARIANCE_MS,
      );
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else if (visible && !media.matches) schedule();
    };
    const onMotionChange = () => {
      if (media.matches) stop();
      else schedule();
    };
    const onSidebarStateChange = () => {
      if (paused()) stop();
      else {
        resize();
        schedule();
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
      if (!visible) stop();
      else {
        resize();
        if (!media.matches && !document.hidden) schedule();
      }
    });
    observer.observe(surface);
    const disconnectResize = observeResize(surface, resize);
    const themeObserver = new MutationObserver(() => draw(0));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const sidebarObserver = sidebar ? new MutationObserver(onSidebarStateChange) : null;
    if (sidebar && sidebarObserver) {
      sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ["data-state"] });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    media.addEventListener("change", onMotionChange);
    resize();

    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      disconnectResize();
      themeObserver.disconnect();
      sidebarObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      media.removeEventListener("change", onMotionChange);
    };
  }, [surface]);

  return (
    <>
      <div ref={headerRef} data-sidebar-kinetic-mesh-anchor aria-hidden="true" />
      {surface
        ? createPortal(
            <canvas ref={canvasRef} data-sidebar-kinetic-mesh aria-hidden="true" />,
            surface,
          )
        : null}
    </>
  );
});
