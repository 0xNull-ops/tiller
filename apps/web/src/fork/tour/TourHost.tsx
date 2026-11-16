import { useLocation, useNavigate } from "@tanstack/react-router";

import { Button } from "../../components/ui/button";
import { CoachMark } from "./CoachMark";
import { SchedulerPreview } from "./SchedulerPreview";
import { markTourCompleted, useTourClientSettings } from "./tourSettings";
import { shouldOfferTour } from "./tourState";
import { TOUR_STEPS } from "./tourSteps";
import { useTourStore } from "./tourStore";
import { SAMPLE_PATH, useStartTour } from "./useStartTour";

/** Mounted once under the app shell: the first-open offer and the running tour. */
export function TourHost() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const settings = useTourClientSettings();
  const startTour = useStartTour();
  const status = useTourStore((store) => store.status);
  const index = useTourStore((store) => store.index);
  const returnTo = useTourStore((store) => store.returnTo);
  const demoPlaying = useTourStore((store) => store.demoPlaying);
  const dispatch = useTourStore((store) => store.dispatch);
  const startDemo = useTourStore((store) => store.startDemo);
  const setSaveCopyOpen = useTourStore((store) => store.setSaveCopyOpen);

  const step = status === "running" ? TOUR_STEPS[index] : undefined;
  if (step !== undefined) {
    if (pathname !== SAMPLE_PATH) return null;
    const leave = () => void navigate({ to: (returnTo ?? "/") as never });
    return (
      <CoachMark
        step={step}
        index={index}
        total={TOUR_STEPS.length}
        onNext={() => {
          dispatch({ type: "next" });
          if (index + 1 >= TOUR_STEPS.length) leave();
        }}
        onBack={() => dispatch({ type: "back" })}
        onSkip={() => {
          dispatch({ type: "skip" });
          leave();
        }}
        sheet={step.schedulerPreview ? <SchedulerPreview /> : null}
        extra={
          step.demo ? (
            <Button variant="outline" size="xs" disabled={demoPlaying} onClick={startDemo}>
              {demoPlaying ? "Demo running…" : "Watch demo"}
            </Button>
          ) : step.final ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                dispatch({ type: "finish" });
                setSaveCopyOpen(true);
              }}
            >
              Save a copy
            </Button>
          ) : null
        }
      />
    );
  }

  if (status === "running" || !shouldOfferTour(settings)) return null;
  if (pathname === "/welcome" || pathname === SAMPLE_PATH) return null;
  return (
    <div
      role="region"
      aria-label="Tour offer"
      className="fixed right-4 bottom-4 z-40 w-72 space-y-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">Take the 90-second tour</p>
        <p className="text-xs text-muted-foreground">
          See workflows, loops, triggers and credentials on a sample. It costs nothing and changes
          nothing.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost-muted" size="xs" onClick={markTourCompleted}>
          Skip
        </Button>
        <Button size="xs" onClick={startTour}>
          Start
        </Button>
      </div>
    </div>
  );
}
