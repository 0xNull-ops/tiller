import { useEffect, useLayoutEffect, useState } from "react";

type Position = { x: number; y: number; status: string | undefined; element: HTMLElement };

function createCanvasMotion() {
  let container: HTMLDivElement | null = null;
  let previous = new Map<string, Position>();
  let edges = new Set<string>();
  let scope: string | null = null;
  let observer: IntersectionObserver | null = null;
  const visible = new Set<Element>();
  const animations = new Map<Element, Animation>();
  const ghosts = new Set<HTMLElement>();
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const syncVisibility = () => {
    if (!container) return;
    for (const card of container.querySelectorAll<HTMLElement>("[data-workflow-node]")) {
      card.dataset.motionActive = String(visible.has(card) && !document.hidden);
    }
  };
  const animate = (
    element: Element,
    frames: Keyframe[],
    duration: number,
    easing = "ease-out",
    delay = 0,
  ) => {
    animations.get(element)?.cancel();
    const animation = element.animate(frames, { duration, easing, delay, fill: "backwards" });
    animations.set(element, animation);
    animation.onfinish = () => {
      if (animations.get(element) === animation) animations.delete(element);
    };
  };
  const clear = () => {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    for (const ghost of ghosts) ghost.remove();
    ghosts.clear();
  };
  return {
    attach(element: HTMLDivElement | null) {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
      container = element;
      visible.clear();
      if (!element) return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
          }
          syncVisibility();
        },
        { root: element.parentElement },
      );
      document.addEventListener("visibilitychange", syncVisibility);
    },
    update(nextScope: string | null) {
      if (!container) return;
      const sameScope = scope === nextScope;
      if (!sameScope) clear();
      const currentIds = new Set(
        [...container.querySelectorAll<HTMLElement>("[data-workflow-node]")].map(
          (card) => card.dataset.workflowNode!,
        ),
      );
      const reflowDelay =
        sameScope && [...previous.keys()].some((id) => !currentIds.has(id)) ? 150 : 0;
      const next = new Map<string, Position>();
      for (const card of container.querySelectorAll<HTMLElement>("[data-workflow-node]")) {
        const id = card.dataset.workflowNode!;
        const position = {
          x: Number.parseFloat(card.style.left),
          y: Number.parseFloat(card.style.top),
          status: card.dataset.status,
          element: card,
        };
        const old = sameScope ? previous.get(id) : undefined;
        next.set(id, position);
        if (!old || old.element !== card) observer?.observe(card);
        // A card that was just dropped is already where the pointer left it; sliding it from its
        // pre-drag spot would replay the drag. The gesture controller marks that one pass.
        const settled = card.dataset.canvasSettled === "true";
        if (settled) delete card.dataset.canvasSettled;
        if (reduced() || !sameScope || settled || card.dataset.dragging === "true") continue;
        if (old && (old.x !== position.x || old.y !== position.y)) {
          animate(
            card,
            [
              { transform: `translate(${old.x - position.x}px, ${old.y - position.y}px)` },
              { transform: "none" },
            ],
            200,
            "cubic-bezier(0.2, 0.8, 0.2, 1)",
            reflowDelay,
          );
        }
        if (old && old.status !== position.status) {
          const indicator = card.querySelector("[data-workflow-status]");
          if (!indicator) continue;
          if (position.status === "done")
            animate(
              indicator,
              [{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }],
              200,
            );
          else if (position.status === "failed")
            animate(
              indicator,
              [
                { transform: "translateX(0)" },
                { transform: "translateX(-2px)" },
                { transform: "translateX(2px)" },
                { transform: "translateX(0)" },
              ],
              200,
            );
          else if (position.status === "waiting")
            animate(indicator, [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], 200);
        }
      }
      for (const [id, old] of previous) {
        if (next.has(id)) continue;
        observer?.unobserve(old.element);
        visible.delete(old.element);
        if (!sameScope || reduced()) continue;
        // React has removed this card. A short-lived inert copy lets it leave without
        // delaying the saved edit or keeping stale controls interactive.
        const ghost = old.element.cloneNode(true) as HTMLElement;
        ghost.removeAttribute("data-workflow-node");
        ghost.removeAttribute("data-appearing");
        ghost.dataset.motionActive = "false";
        ghost.inert = true;
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.pointerEvents = "none";
        container.append(ghost);
        ghosts.add(ghost);
        const animation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 });
        animation.onfinish = () => {
          ghost.remove();
          ghosts.delete(ghost);
        };
      }
      const nextEdges = new Set<string>();
      for (const edge of container.querySelectorAll<SVGPathElement>("[data-workflow-edge]")) {
        const id = edge.dataset.workflowEdge!;
        nextEdges.add(id);
        if (sameScope && !edges.has(id) && !reduced())
          animate(
            edge,
            [
              { strokeDasharray: "1", strokeDashoffset: "1" },
              { strokeDasharray: "1", strokeDashoffset: "0" },
            ],
            250,
          );
      }
      previous = next;
      edges = nextEdges;
      scope = nextScope;
      syncVisibility();
    },
    dispose() {
      clear();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
      previous.clear();
      visible.clear();
      container = null;
    },
  };
}

export function useWorkflowCanvasMotion(scope: string | null) {
  const [motion] = useState(createCanvasMotion);
  // oxlint-disable-next-line t3code/react-effect-budget -- Update the motion controller after the canvas commits so it can measure and animate mounted nodes.
  useLayoutEffect(() => {
    motion.update(scope);
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- Coordinate browser animation frames with canvas motion and clean them up on change.
  useEffect(() => () => motion.dispose(), [motion]);
  return motion.attach;
}
