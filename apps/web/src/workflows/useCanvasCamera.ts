import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { observeResize } from "~/lib/observeResize";
import { fitCamera, type Camera, type Size, zoomAt } from "./canvasCamera";
import { useInspectorAnimating } from "./inspectorMotion";

export function useCanvasCamera(props: { readonly content: Size; readonly enabled: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const inspectorAnimating = useInspectorAnimating();
  // Null follows the graph: it keeps fitting as work is added until the user pans or zooms.
  const [camera, setCamera] = useState<Camera | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize canvas camera state with the mounted DOM element and viewport.
  useEffect(() => {
    if (!props.enabled || inspectorAnimating) return;
    const element = viewportRef.current;
    if (element === null) return;
    // Unsubscribing mid-animation keeps the camera still, and re-subscribing measures the
    // final size once, so the fit lands on the settled viewport instead of every frame.
    return observeResize(element, (entries) => {
      const rect = entries.at(-1)?.contentRect;
      if (rect !== undefined) setViewport({ width: rect.width, height: rect.height });
    });
  }, [props.enabled, inspectorAnimating]);

  const view = camera ?? fitCamera(props.content, viewport);
  const resetCamera = () => setCamera(null);
  const hovered = useRef(false);
  const fitFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      !props.enabled ||
      event.defaultPrevented ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.code !== "Digit1" && event.key !== "!")
    )
      return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      )
    )
      return;
    if (!hovered.current && !viewportRef.current?.contains(document.activeElement)) return;
    event.preventDefault();
    resetCamera();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize canvas camera state with the mounted DOM element and viewport.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => fitFromKeyboard(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const zoomBy = (factor: number) =>
    setCamera(zoomAt(view, view.scale * factor, { x: viewport.width / 2, y: viewport.height / 2 }));

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!props.enabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // Pinch arrives as ctrl+wheel; a plain wheel or two-finger scroll pans.
    if (event.ctrlKey || event.metaKey) {
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setCamera(zoomAt(view, view.scale * Math.exp(-event.deltaY * 0.01), anchor));
      return;
    }
    setCamera({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !props.enabled) return;
    if (event.target instanceof Element && event.target.closest("[data-canvas-no-pan]")) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    // Capturing only once it is a drag lets a still click reach the card under the pointer,
    // while a drag that started on a card pans instead of opening it.
    if (!current.moved) event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { ...current, x: event.clientX, y: event.clientY, moved: true };
    setCamera({ ...view, x: view.x + dx, y: view.y + dy });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  return {
    viewportRef,
    viewport,
    view,
    zoomBy,
    resetCamera,
    handlers: {
      onPointerEnter: () => {
        hovered.current = true;
      },
      onPointerLeave: () => {
        hovered.current = false;
      },
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
