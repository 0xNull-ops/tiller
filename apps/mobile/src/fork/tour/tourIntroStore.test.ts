import { describe, expect, it } from "vite-plus/test";

import { createTourIntroStore, TOUR_INTRO_VERSION, type TourIntroStorage } from "./tourIntroStore";

function memoryStorage(initial: number | null) {
  let value = initial;
  const storage: TourIntroStorage = {
    read: async () => value,
    write: async (version) => {
      value = version;
    },
  };
  return { storage, current: () => value };
}

describe("tour intro store", () => {
  it("opens on a device that has not seen it, and skip records the version", async () => {
    const memory = memoryStorage(null);
    const store = createTourIntroStore(memory.storage);
    await store.offerIfNew();
    expect(store.getSnapshot()).toEqual({ open: true, index: 0 });
    store.skip();
    expect(store.getSnapshot()).toEqual({ open: false, index: 0 });
    expect(memory.current()).toBe(TOUR_INTRO_VERSION);
  });

  it("stays closed once seen, offers again after a version bump, and replay always opens", async () => {
    const seen = createTourIntroStore(memoryStorage(TOUR_INTRO_VERSION).storage);
    await seen.offerIfNew();
    expect(seen.getSnapshot().open).toBe(false);
    seen.replay();
    expect(seen.getSnapshot()).toEqual({ open: true, index: 0 });

    const stale = createTourIntroStore(memoryStorage(TOUR_INTRO_VERSION - 1).storage);
    await stale.offerIfNew();
    expect(stale.getSnapshot().open).toBe(true);
  });

  it("walks the cards, never goes below the first, and finishing after the last card closes", async () => {
    const memory = memoryStorage(null);
    const store = createTourIntroStore(memory.storage, 3);
    store.replay();
    store.back();
    expect(store.getSnapshot().index).toBe(0);
    store.next();
    store.next();
    expect(store.getSnapshot()).toEqual({ open: true, index: 2 });
    store.back();
    expect(store.getSnapshot().index).toBe(1);
    store.next();
    store.next();
    expect(store.getSnapshot().open).toBe(false);
    expect(memory.current()).toBe(TOUR_INTRO_VERSION);
  });
});
