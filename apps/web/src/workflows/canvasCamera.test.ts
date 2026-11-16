import { expect, it } from "vite-plus/test";
import { fitCamera, hasVisibleCard, toCanvasPoint } from "./canvasCamera";

it("converts a client point through the viewport and camera transform", () => {
  expect(toCanvasPoint({ x: 40, y: 25, scale: 2 }, { left: 10, top: 5 }, 110, 90)).toEqual({
    x: 30,
    y: 30,
  });
});

it("checks the actual cards, including partial intersections after pan and zoom", () => {
  const cards = [{ x: 50, y: 20, width: 100, height: 80 }];
  const viewport = { width: 400, height: 200 };
  expect(hasVisibleCard({ x: 0, y: 0, scale: 1 }, viewport, cards)).toBe(true);
  expect(hasVisibleCard({ x: -299, y: 0, scale: 2 }, viewport, cards)).toBe(true);
  expect(hasVisibleCard({ x: -300, y: 0, scale: 2 }, viewport, cards)).toBe(false);
  expect(hasVisibleCard({ x: 0, y: 200, scale: 1 }, viewport, cards)).toBe(false);
  expect(hasVisibleCard({ x: 0, y: 0, scale: 1 }, viewport, [])).toBe(false);
});

it("does not count the empty space between cards as a visible card", () => {
  expect(
    hasVisibleCard({ x: 0, y: 0, scale: 1 }, { width: 100, height: 100 }, [
      { x: -200, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 100, height: 100 },
    ]),
  ).toBe(false);
});

it("fits against the remaining viewport after the inspector grows", () => {
  const content = { width: 300, height: 400 };
  const viewport = { width: 800, height: 200 };
  const view = fitCamera(content, viewport);
  expect(view.scale).toBeCloseTo(0.38);
  expect(view.x + (content.width * view.scale) / 2).toBe(viewport.width / 2);
  expect(view.y + (content.height * view.scale) / 2).toBe(viewport.height / 2);
});
