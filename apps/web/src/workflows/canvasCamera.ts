import type { CSSProperties } from "react";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
export const FIT_PADDING = 24;

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export function toCanvasPoint(
  view: Camera,
  rect: Pick<DOMRect, "left" | "top">,
  clientX: number,
  clientY: number,
) {
  return {
    x: (clientX - rect.left - view.x) / view.scale,
    y: (clientY - rect.top - view.y) / view.scale,
  };
}

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function fitCamera(content: Size, viewport: Size): Camera {
  if (content.width === 0 || viewport.width === 0) {
    return { x: FIT_PADDING, y: FIT_PADDING, scale: 1 };
  }
  const scale = clampScale(
    Math.min(
      1,
      (viewport.width - FIT_PADDING * 2) / content.width,
      (viewport.height - FIT_PADDING * 2) / content.height,
    ),
  );
  return {
    x: Math.max(FIT_PADDING, (viewport.width - content.width * scale) / 2),
    y: Math.max(FIT_PADDING, (viewport.height - content.height * scale) / 2),
    scale,
  };
}

/** Keeps the canvas point under `anchor` (viewport coordinates) still while zooming. */
export function zoomAt(
  camera: Camera,
  nextScale: number,
  anchor: { x: number; y: number },
): Camera {
  const scale = clampScale(nextScale);
  const ratio = scale / camera.scale;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    scale,
  };
}

export function hasVisibleCard(
  camera: Camera,
  viewport: Size,
  cards: ReadonlyArray<Size & { readonly x: number; readonly y: number }>,
): boolean {
  return cards.some((card) => {
    const left = camera.x + card.x * camera.scale;
    const top = camera.y + card.y * camera.scale;
    return (
      left < viewport.width &&
      top < viewport.height &&
      left + card.width * camera.scale > 0 &&
      top + card.height * camera.scale > 0
    );
  });
}

export const DOT_GRID: CSSProperties = {
  backgroundImage:
    "radial-gradient(color-mix(in srgb, var(--muted-foreground) 18%, transparent) 1px, transparent 1px)",
  backgroundSize: "16px 16px",
};
