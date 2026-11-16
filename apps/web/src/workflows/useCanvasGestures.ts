import type { WorkflowDefinition } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useState, type PointerEvent, type RefObject } from "react";

import { toCanvasPoint, type Camera } from "./canvasCamera";
import { edgePath, stepAtPoint } from "./canvasSpots";
import type { RunGraph } from "./runGraph";
import { canLoopBack, canReadFrom } from "./workflowEditing";
import type { RunGraphDirection, RunGraphLayout } from "./runGraphLayout";

const DRAG_THRESHOLD = 4;

/** What the canvas draws while a gesture is under way; null when nothing is being dragged. */
export type CanvasGesture =
  | { readonly kind: "move"; readonly cardKey: string }
  | {
      readonly kind: "link";
      readonly sourceId: string;
      readonly targetId: string | null;
      readonly invalidTargetId: string | null;
    }
  | null;

interface GestureOptions {
  readonly enabled: boolean;
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  readonly view: Camera;
  readonly graph: RunGraph;
  readonly layout: RunGraphLayout;
  readonly nodeSize: { readonly width: number; readonly height: number };
  readonly direction: RunGraphDirection;
  readonly definition: WorkflowDefinition | null;
  readonly onPosition: (cardKey: string, position: { x: number; y: number }) => void;
  readonly onLink: (
    sourceId: string,
    targetId: string | null,
    invalidTargetId: string | null,
    point: ReturnType<typeof toCanvasPoint>,
  ) => void;
}

interface Tracking {
  readonly kind: "move" | "link";
  readonly cardKey: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly element: HTMLElement;
  active: boolean;
  readonly origin: { readonly x: number; readonly y: number };
  position: { x: number; y: number };
  readonly edges: ReadonlyArray<{
    element: SVGPathElement;
    path: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    moveStart: boolean;
    moveEnd: boolean;
  }>;
  target: string | null;
  invalidTarget: string | null;
}

function createController(setGesture: (gesture: CanvasGesture) => void) {
  let latest: GestureOptions | null = null;
  let tracking: Tracking | null = null;
  let linkPreview: SVGPathElement | null = null;
  let suppressClick = false;

  const canvasPoint = (clientX: number, clientY: number) => {
    const rect = latest!.viewportRef.current?.getBoundingClientRect();
    return rect === undefined ? null : toCanvasPoint(latest!.view, rect, clientX, clientY);
  };

  const finish = (commit: boolean, point: ReturnType<typeof toCanvasPoint> | null = null) => {
    const current = tracking;
    if (current === null) return;
    tracking = null;
    current.element.style.translate = "";
    current.element.style.zIndex = "";
    for (const edge of current.edges) edge.element.setAttribute("d", edge.path);
    linkPreview?.setAttribute("d", "");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    setGesture(null);
    if (!current.active) return;
    // Consume the release click before document listeners can dismiss a picker just opened
    // by the drop. The card's click handler cannot catch a click on empty canvas.
    const consumeReleaseClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", consumeReleaseClick, { capture: true, once: true });
    suppressClick = true;
    window.setTimeout(() => {
      window.removeEventListener("click", consumeReleaseClick, true);
      suppressClick = false;
    }, 0);
    if (!commit) return;
    if (current.kind === "move") {
      // The canvas motion pass would otherwise slide the card back from where the drag began.
      current.element.dataset.canvasSettled = "true";
      latest!.onPosition(current.cardKey, current.position);
    }
    if (current.kind === "link" && current.invalidTarget === null && point !== null) {
      const steps = latest!.definition?.steps ?? [];
      const loopBack =
        current.target !== null &&
        latest!.definition !== null &&
        canLoopBack(latest!.definition, current.cardKey, current.target);
      const reverse =
        !loopBack &&
        current.target !== null &&
        steps.findIndex((step) => step.id === current.target) <
          steps.findIndex((step) => step.id === current.cardKey);
      latest!.onLink(
        reverse ? current.target! : current.cardKey,
        reverse ? current.cardKey : current.target,
        current.invalidTarget,
        point,
      );
    }
  };

  const trackMove = (current: Tracking, event: globalThis.PointerEvent) => {
    const { view, direction } = latest!;
    const position = {
      x: Math.max(0, current.origin.x + (event.clientX - current.startX) / view.scale),
      y: Math.max(0, current.origin.y + (event.clientY - current.startY) / view.scale),
    };
    current.position = position;
    const dx = position.x - current.origin.x;
    const dy = position.y - current.origin.y;
    // Keep pointer traffic outside React; only the start and drop change component state.
    current.element.style.translate = `${dx}px ${dy}px`;
    current.element.style.zIndex = "20";
    for (const edge of current.edges) {
      const start = edge.moveStart ? { x: edge.start.x + dx, y: edge.start.y + dy } : edge.start;
      const end = edge.moveEnd ? { x: edge.end.x + dx, y: edge.end.y + dy } : edge.end;
      edge.element.setAttribute("d", edgePath(start, end, direction));
    }
  };

  const trackLink = (current: Tracking, event: globalThis.PointerEvent) => {
    const point = canvasPoint(event.clientX, event.clientY);
    if (point === null) return;
    const { direction, graph, layout, nodeSize, definition } = latest!;
    const source = graph.nodes.find(
      (node) => node.kind === "step" && node.workflowStepId === current.cardKey,
    );
    const from = source === undefined ? undefined : layout.positions.get(source.id);
    if (source !== undefined && from !== undefined) {
      const sourceSize = layout.nodeSizes?.get(source.id) ?? nodeSize;
      const start =
        direction === "vertical"
          ? { x: from.x + sourceSize.width / 2, y: from.y + sourceSize.height }
          : { x: from.x + sourceSize.width, y: from.y + sourceSize.height / 2 };
      linkPreview?.setAttribute("d", edgePath(start, point, direction));
    }
    const hovered = stepAtPoint(graph, layout, nodeSize, point);
    const valid =
      hovered !== null &&
      definition !== null &&
      (canReadFrom(definition, hovered, current.cardKey) ||
        canReadFrom(definition, current.cardKey, hovered) ||
        canLoopBack(definition, current.cardKey, hovered));
    const target = valid ? hovered : null;
    const invalidTarget = hovered !== null && !valid ? hovered : null;
    if (target === current.target && invalidTarget === current.invalidTarget) return;
    current.target = target;
    current.invalidTarget = invalidTarget;
    setGesture({
      kind: "link",
      sourceId: current.cardKey,
      targetId: target,
      invalidTargetId: invalidTarget,
    });
  };

  function onMove(event: globalThis.PointerEvent) {
    const current = tracking;
    if (current === null || event.pointerId !== current.pointerId) return;
    if (!current.active) {
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      if (distance < DRAG_THRESHOLD) return;
      current.active = true;
      setGesture(
        current.kind === "move"
          ? { kind: "move", cardKey: current.cardKey }
          : { kind: "link", sourceId: current.cardKey, targetId: null, invalidTargetId: null },
      );
    }
    event.preventDefault();
    if (current.kind === "move") trackMove(current, event);
    else trackLink(current, event);
  }
  function onUp(event: globalThis.PointerEvent) {
    if (event.pointerId !== tracking?.pointerId) return;
    const rect = latest!.viewportRef.current?.getBoundingClientRect();
    const inside =
      rect !== undefined &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (tracking?.kind === "link" && tracking.active && inside) trackLink(tracking, event);
    finish(tracking?.kind !== "link" || inside, canvasPoint(event.clientX, event.clientY));
  }
  function onCancel(event: globalThis.PointerEvent) {
    if (event.pointerId === tracking?.pointerId) finish(false);
  }
  function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape" || tracking === null) return;
    // Escape ends the drag only; it must not also close the open editor.
    event.stopPropagation();
    finish(false);
  }

  const begin = (
    kind: "move" | "link",
    cardKey: string,
    event: PointerEvent<HTMLElement>,
    origin = { x: 0, y: 0 },
  ) => {
    if (!latest!.enabled || event.button !== 0 || tracking !== null) return;
    // The handle sits inside the card; its press must not also start moving the card.
    if (kind === "link") event.stopPropagation();
    const edges =
      kind === "move"
        ? Array.from(
            latest!.viewportRef.current?.querySelectorAll<SVGPathElement>(
              "[data-canvas-edge-from]",
            ) ?? [],
          )
            .filter(
              (element) =>
                element.dataset.canvasEdgeFrom === cardKey ||
                element.dataset.canvasEdgeTo === cardKey,
            )
            .map((element) => ({
              element,
              path: element.getAttribute("d") ?? "",
              start: { x: Number(element.dataset.startX), y: Number(element.dataset.startY) },
              end: { x: Number(element.dataset.endX), y: Number(element.dataset.endY) },
              moveStart: element.dataset.canvasEdgeFrom === cardKey,
              moveEnd: element.dataset.canvasEdgeTo === cardKey,
            }))
        : [];
    tracking = {
      kind,
      cardKey,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      element: event.currentTarget,
      active: false,
      origin,
      position: origin,
      edges,
      target: null,
      invalidTarget: null,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  return {
    setOptions: (options: GestureOptions) => {
      latest = options;
    },
    setLinkPreviewElement: (element: SVGPathElement | null) => {
      linkPreview = element;
    },
    begin,
    cancel: () => finish(false),
    consumeClick: () => suppressClick,
  };
}

/**
 * Move cards freely, or link work steps through their handles. Cards and connected edges
 * update through the DOM during a drag; only a completed drop persists a position.
 */
export function useCanvasGestures(options: GestureOptions) {
  const [gesture, setGesture] = useState<CanvasGesture>(null);
  const [controller] = useState(() => createController(setGesture));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Install current gesture options on the external canvas controller after commit.
  useLayoutEffect(() => {
    controller.setOptions(options);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Install and clean up native canvas gesture listeners after the DOM commits.
  useEffect(() => {
    if (!options.enabled) controller.cancel();
  }, [options.enabled, controller]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Install and clean up native canvas gesture listeners after the DOM commits.
  useEffect(() => controller.cancel, [controller]);

  return {
    gesture,
    setLinkPreviewElement: controller.setLinkPreviewElement,
    startMove: (
      cardKey: string,
      position: { x: number; y: number },
      event: PointerEvent<HTMLElement>,
    ) => controller.begin("move", cardKey, event, position),
    startLink: (stepId: string, event: PointerEvent<HTMLElement>) =>
      controller.begin("link", stepId, event),
    /** For the card's capture-phase click handler: true means swallow the click. */
    consumeClick: controller.consumeClick,
  };
}
