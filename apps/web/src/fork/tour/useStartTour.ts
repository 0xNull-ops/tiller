import { useLocation, useNavigate } from "@tanstack/react-router";

import { useTourStore } from "./tourStore";

export const SAMPLE_PATH = "/workflows/sample";

/** Starts (or replays) the tour from step 1 and opens the sample it walks over. */
export function useStartTour() {
  const navigate = useNavigate();
  const href = useLocation({ select: (location) => location.href });
  return () => {
    useTourStore.getState().requestStart(href === SAMPLE_PATH ? "/workflows" : href);
    void navigate({ to: SAMPLE_PATH as never });
  };
}
