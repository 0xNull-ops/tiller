import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Button } from "../../components/ui/button";
import { observeResize } from "../../lib/observeResize";
import { placeCoachMark, type Box } from "./placeCoachMark";
import type { TourStep } from "./tourSteps";

const SPOTLIGHT_PADDING = 6;

function sameBox(a: Box | null, b: Box | null) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.top === b.top &&
      a.left === b.left &&
      a.width === b.width &&
      a.height === b.height)
  );
}

/**
 * The anchor's box in viewport coordinates, or null when it isn't on screen. The overlay blocks
 * the app underneath, so only resizes, layout changes and the anchor appearing can move it.
 */
function useAnchorBox(anchor: string | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Measures an element outside React and follows its layout through observers.
  useEffect(() => {
    if (anchor === null) return;
    const selector = `[data-tour="${anchor}"]`;
    let observed: Element | null = null;
    let stopObserving = () => {};
    function measure() {
      const element = document.querySelector(selector);
      if (element !== observed) {
        stopObserving();
        observed = element;
        stopObserving = element === null ? () => {} : observeResize(element, () => measure());
        element?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const rect = element?.getBoundingClientRect();
      const next =
        rect === undefined || (rect.width === 0 && rect.height === 0)
          ? null
          : { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      setBox((current) => (sameBox(current, next) ? current : next));
    }
    measure();
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "d"],
    });
    window.addEventListener("resize", measure);
    return () => {
      mutationObserver.disconnect();
      stopObserving();
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);
  return anchor === null ? null : box;
}

export function CoachMark(props: {
  readonly step: TourStep;
  readonly index: number;
  readonly total: number;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onSkip: () => void;
  readonly extra?: ReactNode;
  /** A read-only surface the step shows under the card, above the spotlight dim. */
  readonly sheet?: ReactNode;
}) {
  const { step } = props;
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const box = useAnchorBox(step.anchor);
  const [size, setSize] = useState({ width: 320, height: 176 });
  const isLast = props.index + 1 >= props.total;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps the card's measured size for placement.
  useEffect(() => {
    const element = cardRef.current;
    if (element === null) return;
    return observeResize(element, () =>
      setSize({ width: element.offsetWidth, height: element.offsetHeight }),
    );
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A control that disables itself (the demo button) drops page focus; every commit checks the card still holds it.
  useEffect(() => {
    const element = cardRef.current;
    if (element === null) return;
    const active = document.activeElement;
    // The dialog primitive may park focus on its popup; the card's primary action is the next stop.
    if (
      active === element ||
      active === document.body ||
      active === null ||
      !element.contains(active)
    ) {
      nextRef.current?.focus();
    }
  });

  const skip = useEffectEvent(() => props.onSkip());

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const sheetHeight = Math.min(
    512,
    viewport.height * 0.6,
    Math.max(0, viewport.height - size.height - 32),
  );
  const anchoredPosition =
    box === null
      ? {
          top: Math.max(8, (viewport.height - size.height) / 2),
          left: Math.max(8, (viewport.width - size.width) / 2),
        }
      : placeCoachMark(box, size, viewport, step.placement);
  const position: CSSProperties & { "--tour-preview-height": string } = {
    ...anchoredPosition,
    top: props.sheet
      ? Math.max(
          8,
          Math.min(anchoredPosition.top, viewport.height - sheetHeight - size.height - 16),
        )
      : anchoredPosition.top,
    "--tour-preview-height": `${sheetHeight}px`,
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open, details) => {
        // Esc ends the tour; a stray outside press on the dim ignores the card.
        if (!open && details.reason === "escape-key") skip();
      }}
    >
      <DialogPrimitive.Portal>
        <div className="fixed inset-0 z-50" data-tour-overlay aria-hidden>
          {box === null ? (
            <div className="absolute inset-0 bg-black/40" />
          ) : (
            <>
              <div className="absolute inset-0" />
              <div
                className="pointer-events-none fixed rounded-lg ring-2 ring-primary"
                style={{
                  top: box.top - SPOTLIGHT_PADDING,
                  left: box.left - SPOTLIGHT_PADDING,
                  width: box.width + SPOTLIGHT_PADDING * 2,
                  height: box.height + SPOTLIGHT_PADDING * 2,
                  boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.4)",
                }}
              />
            </>
          )}
        </div>
        <DialogPrimitive.Popup
          ref={cardRef}
          initialFocus={nextRef}
          aria-labelledby={titleId}
          className="fixed z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
          style={position}
        >
          {props.sheet}
          <div className="relative z-10 space-y-3">
            <div className="space-y-1">
              <p className="text-3xs font-medium text-muted-foreground">
                Tour · {props.index + 1} of {props.total}
              </p>
              <h2 id={titleId} className="text-sm font-medium">
                {step.title}
              </h2>
              <p className="text-xs text-muted-foreground">{step.body}</p>
            </div>
            {props.extra ? <div className="flex flex-wrap gap-2">{props.extra}</div> : null}
            <div className="flex items-center gap-2">
              <Button variant="ghost-muted" size="xs" onClick={props.onSkip}>
                Skip tour
              </Button>
              <span className="flex-1" />
              <Button
                variant="outline"
                size="xs"
                disabled={props.index === 0}
                onClick={props.onBack}
              >
                Back
              </Button>
              <Button ref={nextRef} size="xs" onClick={props.onNext}>
                {isLast ? "Done" : "Next"}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
