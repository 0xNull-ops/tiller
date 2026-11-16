export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export type CoachPlacement = "top" | "bottom" | "left" | "right";

const GAP = 12;
const MARGIN = 8;

/** Puts a card beside the target on its preferred side, flips when it won't fit, then clamps. */
export function placeCoachMark(
  target: Box,
  card: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  preferred: CoachPlacement,
): { readonly top: number; readonly left: number } {
  const room = {
    top: target.top - GAP - card.height >= MARGIN,
    bottom: target.top + target.height + GAP + card.height <= viewport.height - MARGIN,
    left: target.left - GAP - card.width >= MARGIN,
    right: target.left + target.width + GAP + card.width <= viewport.width - MARGIN,
  };
  const order: ReadonlyArray<CoachPlacement> = [
    preferred,
    { top: "bottom", bottom: "top", left: "right", right: "left" }[preferred] as CoachPlacement,
    "bottom",
    "top",
    "right",
    "left",
  ];
  const side = order.find((candidate) => room[candidate]) ?? preferred;
  const centeredLeft = target.left + target.width / 2 - card.width / 2;
  const centeredTop = target.top + target.height / 2 - card.height / 2;
  const raw =
    side === "top"
      ? { top: target.top - GAP - card.height, left: centeredLeft }
      : side === "bottom"
        ? { top: target.top + target.height + GAP, left: centeredLeft }
        : side === "left"
          ? { top: centeredTop, left: target.left - GAP - card.width }
          : { top: centeredTop, left: target.left + target.width + GAP };
  return {
    top: Math.min(
      Math.max(raw.top, MARGIN),
      Math.max(MARGIN, viewport.height - card.height - MARGIN),
    ),
    left: Math.min(
      Math.max(raw.left, MARGIN),
      Math.max(MARGIN, viewport.width - card.width - MARGIN),
    ),
  };
}
