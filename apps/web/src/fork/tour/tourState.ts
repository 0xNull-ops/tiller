/** Bump to offer the tour again after a big feature launch. */
export const TOUR_VERSION = 1;

export type TourStatus = "idle" | "running";

export interface TourState {
  readonly status: TourStatus;
  readonly index: number;
}

export type TourAction =
  | { readonly type: "start" }
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "skip" }
  | { readonly type: "finish" };

export const IDLE_TOUR: TourState = { status: "idle", index: 0 };

/** Replay is `start`: it resets the index from any state. Past the last step the tour ends. */
export function reduceTour(state: TourState, action: TourAction, stepCount: number): TourState {
  switch (action.type) {
    case "start":
      return stepCount > 0 ? { status: "running", index: 0 } : IDLE_TOUR;
    case "next":
      if (state.status !== "running") return state;
      return state.index + 1 >= stepCount
        ? IDLE_TOUR
        : { status: "running", index: state.index + 1 };
    case "back":
      if (state.status !== "running") return state;
      return { status: "running", index: Math.max(0, state.index - 1) };
    case "skip":
    case "finish":
      return IDLE_TOUR;
  }
}

/** Per-client settings: each device keeps its own, nothing reaches the server. */
export interface TourClientSettings {
  readonly tourCompletedVersion: number | null;
  readonly showTourOnNewDevices: boolean;
}

export const DEFAULT_TOUR_CLIENT_SETTINGS: TourClientSettings = {
  tourCompletedVersion: null,
  showTourOnNewDevices: true,
};

export function shouldOfferTour(settings: TourClientSettings, version = TOUR_VERSION): boolean {
  return (
    settings.showTourOnNewDevices &&
    (settings.tourCompletedVersion === null || settings.tourCompletedVersion < version)
  );
}
