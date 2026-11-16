import {
  FocusIcon,
  LayoutGridIcon,
  LayoutListIcon,
  MinusIcon,
  PlusIcon,
  ShrinkIcon,
  WorkflowIcon,
} from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { Button } from "../components/ui/button";
import type { WorkflowViewMode } from "./workflowViewPrefs";

export function WorkflowZoomControls(props: {
  readonly scale: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
  /** Clears saved card positions; absent when the canvas can't be edited. */
  readonly onTidy?: (() => void) | undefined;
  /** Hidden where the canvas isn't drawn (the outline), so only the view switch shows. */
  readonly showCamera?: boolean;
  /** The canvas/outline switch and compact toggle; absent where the view can't change. */
  readonly viewSwitch?: {
    readonly view: WorkflowViewMode;
    readonly onView: (view: WorkflowViewMode) => void;
    readonly compact: boolean;
    readonly onCompact: (compact: boolean) => void;
  };
}) {
  const camera = props.showCamera !== false;
  const switchView = props.viewSwitch;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <div
        data-canvas-no-pan
        data-workflow-camera-control
        className="pointer-events-auto flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-sm"
      >
        {camera ? (
          <>
            <Button variant="ghost" size="icon-xs" aria-label="Zoom out" onClick={props.onZoomOut}>
              <MinusIcon />
            </Button>
            <span className="w-10 text-center text-2xs text-muted-foreground tabular-nums">
              {Math.round(props.scale * 100)}%
            </span>
            <Button variant="ghost" size="icon-xs" aria-label="Zoom in" onClick={props.onZoomIn}>
              <PlusIcon />
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Fit to view"
                    onClick={props.onFit}
                  />
                }
              >
                <FocusIcon />
              </TooltipTrigger>
              <TooltipPopup>Fit steps (Shift+1)</TooltipPopup>
            </Tooltip>
            {props.onTidy ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Tidy up"
                      onClick={props.onTidy}
                    />
                  }
                >
                  <LayoutGridIcon />
                </TooltipTrigger>
                <TooltipPopup>Tidy up (reset card positions)</TooltipPopup>
              </Tooltip>
            ) : null}
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          </>
        ) : null}
        {switchView ? (
          <>
            <Button
              variant={switchView.view === "canvas" ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={switchView.view === "canvas"}
              onClick={() => switchView.onView("canvas")}
            >
              <WorkflowIcon />
              Canvas
            </Button>
            <Button
              variant={switchView.view === "outline" ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={switchView.view === "outline"}
              onClick={() => switchView.onView("outline")}
            >
              <LayoutListIcon />
              Outline
            </Button>
          </>
        ) : null}
        {switchView && switchView.view === "canvas" ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={switchView.compact ? "secondary" : "ghost"}
                  size="icon-xs"
                  aria-label="Compact cards"
                  aria-pressed={switchView.compact}
                  onClick={() => switchView.onCompact(!switchView.compact)}
                />
              }
            >
              <ShrinkIcon />
            </TooltipTrigger>
            <TooltipPopup>Compact cards (saved positions stay put)</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
