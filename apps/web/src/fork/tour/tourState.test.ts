import { describe, expect, it } from "vite-plus/test";

import { placeCoachMark } from "./placeCoachMark";
import {
  DEFAULT_TOUR_CLIENT_SETTINGS,
  IDLE_TOUR,
  reduceTour,
  shouldOfferTour,
  TOUR_VERSION,
  type TourState,
} from "./tourState";

const COUNT = 3;

describe("reduceTour", () => {
  it("walks forward and back, and ends after the last step", () => {
    let state: TourState = reduceTour(IDLE_TOUR, { type: "start" }, COUNT);
    expect(state).toEqual({ status: "running", index: 0 });
    state = reduceTour(state, { type: "next" }, COUNT);
    state = reduceTour(state, { type: "next" }, COUNT);
    expect(state).toEqual({ status: "running", index: 2 });
    expect(reduceTour(state, { type: "back" }, COUNT)).toEqual({ status: "running", index: 1 });
    expect(reduceTour(state, { type: "next" }, COUNT)).toEqual(IDLE_TOUR);
  });

  it("does not go below the first step, and ignores moves while idle", () => {
    const first = reduceTour(IDLE_TOUR, { type: "start" }, COUNT);
    expect(reduceTour(first, { type: "back" }, COUNT)).toEqual(first);
    expect(reduceTour(IDLE_TOUR, { type: "next" }, COUNT)).toEqual(IDLE_TOUR);
    expect(reduceTour(IDLE_TOUR, { type: "back" }, COUNT)).toEqual(IDLE_TOUR);
  });

  it("skip and finish end the tour, and start resets a tour in progress", () => {
    const midway: TourState = { status: "running", index: 2 };
    expect(reduceTour(midway, { type: "skip" }, COUNT)).toEqual(IDLE_TOUR);
    expect(reduceTour(midway, { type: "finish" }, COUNT)).toEqual(IDLE_TOUR);
    expect(reduceTour(midway, { type: "start" }, COUNT)).toEqual({ status: "running", index: 0 });
  });
});

describe("shouldOfferTour", () => {
  it("offers a new device, then stays quiet until the version is bumped or the device opts out", () => {
    expect(shouldOfferTour(DEFAULT_TOUR_CLIENT_SETTINGS)).toBe(true);
    const done = { ...DEFAULT_TOUR_CLIENT_SETTINGS, tourCompletedVersion: TOUR_VERSION };
    expect(shouldOfferTour(done)).toBe(false);
    expect(shouldOfferTour(done, TOUR_VERSION + 1)).toBe(true);
    expect(shouldOfferTour({ ...done, showTourOnNewDevices: false }, TOUR_VERSION + 1)).toBe(false);
    expect(shouldOfferTour({ tourCompletedVersion: null, showTourOnNewDevices: false })).toBe(
      false,
    );
  });
});

describe("placeCoachMark", () => {
  const viewport = { width: 1000, height: 700 };
  const card = { width: 320, height: 180 };

  it("sits beside the target on the preferred side", () => {
    const target = { top: 300, left: 400, width: 100, height: 40 };
    expect(placeCoachMark(target, card, viewport, "bottom")).toEqual({ top: 352, left: 290 });
  });

  it("flips when the preferred side has no room, and stays inside the viewport", () => {
    const nearBottom = { top: 640, left: 10, width: 100, height: 40 };
    const placed = placeCoachMark(nearBottom, card, viewport, "bottom");
    expect(placed.top).toBe(640 - 12 - 180);
    expect(placed.left).toBe(8);
  });
});
