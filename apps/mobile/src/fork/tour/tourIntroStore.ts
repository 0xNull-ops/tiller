/** Bump to show the intro again after a big feature launch. */
export const TOUR_INTRO_VERSION = 1;

export const TOUR_INTRO_CARDS = [
  {
    id: "workflows",
    title: "Workflows",
    body: "Build a flow of steps on the canvas at your desk. Your phone shows every run and lets you stop, approve or resume it.",
  },
  {
    id: "triggers-loops",
    title: "Triggers and loops",
    body: "A workflow starts by hand, on a schedule, from a webhook or after another workflow. Loops send work back until it's good, up to a set number of rounds.",
  },
  {
    id: "credentials",
    title: "Credentials",
    body: "Keys and logins stay in your vault. Steps ask before using them, and you can approve from here.",
  },
] as const;

export interface TourIntroStorage {
  readonly read: () => Promise<number | null>;
  readonly write: (version: number) => Promise<void>;
}

export interface TourIntroState {
  readonly open: boolean;
  readonly index: number;
}

/** Per-device intro state: replay resets it, and skipping or finishing records the version. */
export function createTourIntroStore(
  storage: TourIntroStorage,
  cardCount = TOUR_INTRO_CARDS.length,
) {
  let state: TourIntroState = { open: false, index: 0 };
  const listeners = new Set<() => void>();
  const set = (next: TourIntroState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const close = () => {
    set({ open: false, index: 0 });
    void storage.write(TOUR_INTRO_VERSION).catch(() => {});
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** First open of this device, or after a version bump. */
    offerIfNew: async () => {
      const completed = await storage.read().catch(() => null);
      if (completed === null || completed < TOUR_INTRO_VERSION) set({ open: true, index: 0 });
    },
    replay: () => set({ open: true, index: 0 }),
    next: () =>
      state.index + 1 >= cardCount ? close() : set({ open: true, index: state.index + 1 }),
    back: () => set({ open: state.open, index: Math.max(0, state.index - 1) }),
    skip: close,
  };
}
