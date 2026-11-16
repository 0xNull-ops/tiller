import { expect, it } from "vite-plus/test";
import { stepDelay, waitForMode, waitMode } from "./waitControlValue";

it("maps none, delay, and until without losing saved delay or weekday values", () => {
  const delay = { kind: "delay", minutes: 42 } as const;
  const until = { kind: "until", timeOfDay: "17:45", weekdays: [1, 3, 5] } as const;
  expect(waitMode(undefined)).toBe("none");
  expect(waitForMode("none", delay)).toBeUndefined();
  for (const value of [delay, until]) {
    expect(waitForMode(waitMode(value), value)).toEqual(value);
  }
  expect(waitForMode("delay", until)).toEqual({ kind: "delay", minutes: 15 });
  expect(waitForMode("until", delay)).toEqual({ kind: "until", timeOfDay: "09:00" });
  for (const [from, next] of [
    [1, 5],
    [5, 15],
    [15, 30],
    [30, 60],
    [60, 120],
    [120, 240],
    [240, 480],
    [480, 720],
    [720, 1440],
  ]) {
    expect(stepDelay(from!, 1)).toBe(next);
    expect(stepDelay(next!, -1)).toBe(from);
  }
  expect(stepDelay(42, 1)).toBe(60);
  expect(stepDelay(42, -1)).toBe(30);
});
