import "./workflowInspectorMotion.css";
import * as Schema from "effect/Schema";
import { useState, type ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useResizeDrag } from "../hooks/useResizeDrag";
import { observeResize } from "../lib/observeResize";
import { InspectorMotionProvider } from "./inspectorMotion";
import { inspectorSize } from "./inspectorSize";

const Height = Schema.NullOr(Schema.Number);

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

export function WorkflowInspectorLayout(props: {
  readonly surface: "thread" | "page";
  readonly inspector: ReactNode;
  readonly inspectorKey?: string | null;
  readonly children: ReactNode;
}) {
  const open = Boolean(props.inspector);
  const [lastInspector, setLastInspector] = useState(props.inspector);
  const [lastKey, setLastKey] = useState<string | null>(props.inspectorKey ?? null);
  if (props.inspector && props.inspector !== lastInspector) {
    setLastInspector(props.inspector);
    setLastKey(props.inspectorKey ?? null);
  }
  const [available, setAvailable] = useState(0);
  const [savedHeight, saveHeight] = useLocalStorage(
    `t3code:workflow-inspector-height:${props.surface}`,
    null,
    Height,
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const { height, min, max } = inspectorSize(available, dragHeight ?? savedHeight);
  const [openBefore, setOpenBefore] = useState(open);
  const [animating, setAnimating] = useState(false);
  if (open !== openBefore) {
    setOpenBefore(open);
    setAnimating(height > 0 && !prefersReducedMotion());
  }
  // Subscribing from the ref callback ties the observation to the element itself, so it needs no
  // effect to find the container after mount.
  const observeContainer = (container: HTMLDivElement | null) => {
    if (!container) return;
    return observeResize(container, (entries) => {
      const rect = entries.at(-1)?.contentRect;
      if (rect) setAvailable(rect.height);
    });
  };
  const { refresh: _refresh, ...resize } = useResizeDrag<HTMLDivElement>(() => ({
    axis: "vertical",
    width: height,
    edge: "left",
    bounds: { min, max },
    resize: (next) => {
      const clamped = inspectorSize(available, next).height;
      setDragHeight(clamped);
      return clamped;
    },
    finish: (next) => {
      saveHeight(next);
      setDragHeight(null);
    },
    cleanup: (committed) => {
      if (!committed) setDragHeight(null);
    },
  }));

  return (
    <InspectorMotionProvider value={animating}>
      <div ref={observeContainer} className="flex min-h-0 flex-1 flex-col">
        {props.children}
        <div
          data-workflow-inspector
          data-inspector-motion
          data-open={open ? "" : undefined}
          data-resizing={dragHeight !== null ? "" : undefined}
          className="shrink-0 overflow-hidden"
          style={{ height: open ? height : 0 }}
          inert={!open}
          aria-hidden={open ? undefined : true}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "height")
              setAnimating(false);
          }}
          onTransitionCancel={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "height")
              setAnimating(false);
          }}
        >
          {open || animating ? (
            <div className="flex flex-col" style={{ height }}>
              <div
                role="separator"
                aria-label="Inspector height"
                aria-orientation="horizontal"
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={height}
                tabIndex={0}
                className="flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center border-t bg-background outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                {...resize}
                onPointerDown={(event) => {
                  event.currentTarget.focus();
                  resize.onPointerDown(event);
                }}
                onDoubleClick={() => saveHeight(null)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "Home"
                      ? min
                      : event.key === "End"
                        ? max
                        : event.key === "ArrowUp"
                          ? height + 16
                          : event.key === "ArrowDown"
                            ? height - 16
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  saveHeight(inspectorSize(available, next).height);
                }}
              >
                <span className="h-0.5 w-8 rounded-full bg-border" />
              </div>
              <div className="@container min-h-0 flex-1 overflow-auto bg-background">
                <div key={props.inspector ? (props.inspectorKey ?? null) : lastKey}>
                  {props.inspector ?? lastInspector}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </InspectorMotionProvider>
  );
}
