import { expect, it } from "vite-plus/test";
import { inspectorSize } from "./inspectorSize";

it("defaults to forty percent and reserves room for both surfaces", () => {
  expect(inspectorSize(800, null)).toEqual({ height: 320, min: 168, max: 640 });
  expect(inspectorSize(800, 0).height).toBe(168);
  expect(inspectorSize(800, 900).height).toBe(640);
});

it("clamps a saved height to the current viewport without losing the preference", () => {
  expect(inspectorSize(400, 600).height).toBe(240);
  expect(inspectorSize(900, 600).height).toBe(600);
  expect(inspectorSize(301, 600)).toEqual({ height: 150.5, min: 150.5, max: 150.5 });
  expect(inspectorSize(100, 600)).toEqual({ height: 50, min: 50, max: 50 });
  expect(inspectorSize(800, Number.NaN).height).toBe(320);
});
