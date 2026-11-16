import type { WorkflowRun } from "@t3tools/contracts";
import { create } from "zustand";

import { playDemoRun } from "./demoRun";
import { markTourCompleted } from "./tourSettings";
import { IDLE_TOUR, reduceTour, type TourAction, type TourState } from "./tourState";
import { TOUR_STEPS } from "./tourSteps";

interface TourStore extends TourState {
  /** Where the user was when the tour began, so ending it puts them back. */
  readonly returnTo: string | null;
  /** The recorded run on the sample canvas; null when no demo is shown. */
  readonly demoRun: WorkflowRun | null;
  readonly demoPlaying: boolean;
  /** Start and Replay: begins at step 1 from any state. */
  readonly saveCopyOpen: boolean;
  readonly setSaveCopyOpen: (open: boolean) => void;
  readonly requestStart: (returnTo: string) => void;
  readonly dispatch: (action: TourAction) => void;
  readonly startDemo: () => void;
  readonly exitDemo: () => void;
}

let stopDemo: (() => void) | null = null;

export const useTourStore = create<TourStore>((set, get) => ({
  ...IDLE_TOUR,
  returnTo: null,
  demoRun: null,
  demoPlaying: false,
  saveCopyOpen: false,
  setSaveCopyOpen: (saveCopyOpen) => set({ saveCopyOpen }),
  requestStart: (returnTo) => {
    get().exitDemo();
    set({ ...reduceTour(IDLE_TOUR, { type: "start" }, TOUR_STEPS.length), returnTo });
  },
  dispatch: (action) => {
    const next = reduceTour(get(), action, TOUR_STEPS.length);
    if (next.status === "idle" && get().status === "running") {
      markTourCompleted();
      get().exitDemo();
    }
    set(next);
  },
  startDemo: () => {
    stopDemo?.();
    set({ demoPlaying: true });
    stopDemo = playDemoRun(
      (demoRun) => set({ demoRun }),
      () => set({ demoPlaying: false }),
    );
  },
  exitDemo: () => {
    stopDemo?.();
    stopDemo = null;
    set({ demoRun: null, demoPlaying: false });
  },
}));
