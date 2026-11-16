import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { WorkflowZoomControls } from "./WorkflowZoomControls";

function controls(props: { view: "canvas" | "outline"; compact?: boolean; showCamera?: boolean }) {
  const onView = vi.fn();
  const onCompact = vi.fn();
  return {
    onView,
    onCompact,
    element: (
      <WorkflowZoomControls
        scale={1}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onFit={() => {}}
        {...(props.showCamera === undefined ? {} : { showCamera: props.showCamera })}
        viewSwitch={{
          view: props.view,
          onView,
          compact: props.compact ?? false,
          onCompact,
        }}
      />
    ),
  };
}

it("switches between canvas and outline, with the pressed state on the current view", async () => {
  const { element, onView } = controls({ view: "canvas" });
  await using _screen = await render(element, { router: false });
  await expect
    .element(page.getByRole("button", { name: "Canvas", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.click(page.getByRole("button", { name: "Outline", exact: true }));
  expect(onView).toHaveBeenCalledWith("outline");
});

it("offers compact cards only on the canvas", async () => {
  const canvas = controls({ view: "canvas", compact: true });
  await using _canvas = await render(canvas.element, { router: false });
  await expect
    .element(page.getByRole("button", { name: "Compact cards", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.click(page.getByRole("button", { name: "Compact cards", exact: true }));
  expect(canvas.onCompact).toHaveBeenCalledWith(false);
});

it("hides zoom and fit where there is no canvas, but keeps the switch", async () => {
  const outline = controls({ view: "outline", showCamera: false });
  await using _outline = await render(outline.element, { router: false });
  await expect
    .element(page.getByRole("button", { name: "Outline", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector('[aria-label="Fit to view"]')).toBeNull();
  expect(document.querySelector('[aria-label="Compact cards"]')).toBeNull();
});
