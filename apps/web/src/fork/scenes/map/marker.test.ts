import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_MARKER_SIZE, imageMarkerFrame } from "./marker";

describe("imageMarkerFrame", () => {
  it("keeps a legacy marker centered in the original 26px box", () => {
    expect(DEFAULT_MARKER_SIZE).toBe(26);
    expect(imageMarkerFrame({ image: "marker.png" })).toEqual({
      x: -13,
      y: -13,
      width: 26,
      height: 26,
      preserveAspectRatio: "xMidYMid meet",
    });
    expect(imageMarkerFrame({ image: "marker.png", anchor: "center" })).toEqual(
      imageMarkerFrame({ image: "marker.png" }),
    );
  });

  it("scales a ground marker and sits its bottom edge on the route", () => {
    expect(imageMarkerFrame({ image: "marker.png", scale: 1.5, anchor: "ground" })).toEqual({
      x: -19.5,
      y: -39,
      width: 39,
      height: 39,
      preserveAspectRatio: "xMidYMax meet",
    });
  });
});
