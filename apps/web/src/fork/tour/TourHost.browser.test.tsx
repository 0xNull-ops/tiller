import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../../test/render";
import { TOUR_SETTINGS_STORAGE_KEY } from "./tourSettings";
import { TOUR_STEPS } from "./tourSteps";
import { TourHost } from "./TourHost";
import { TourSettingsSection } from "./TourSettingsSection";
import { useTourStore } from "./tourStore";

function setup() {
  localStorage.removeItem(TOUR_SETTINGS_STORAGE_KEY);
  useTourStore.setState({
    status: "idle",
    index: 0,
    returnTo: null,
    demoRun: null,
    demoPlaying: false,
    saveCopyOpen: false,
  });
}

/** The demo replay owns timers; stop them even when an assertion fails. */
function stopDemoOnDispose(): Disposable {
  return { [Symbol.dispose]: () => useTourStore.getState().exitDemo() };
}

function Harness() {
  return (
    <>
      <TourSettingsSection />
      <TourHost />
    </>
  );
}

it("Replay tour in Settings opens step 1, Back and Next move, and Esc skips for good", async () => {
  setup();
  await using screen = await render(<Harness />, { router: "/settings/workflows" });
  await expect.element(page.getByRole("region", { name: "Tour offer" })).toBeInTheDocument();

  await userEvent.click(page.getByRole("button", { name: "Replay tour" }));
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByRole("heading", { name: TOUR_STEPS[0]!.title })).toBeVisible();
  await expect.element(dialog.getByText("Tour · 1 of 9")).toBeVisible();

  await userEvent.click(dialog.getByRole("button", { name: "Next" }));
  await expect.element(dialog.getByRole("heading", { name: TOUR_STEPS[1]!.title })).toBeVisible();
  await expect.element(dialog.getByRole("button", { name: "Next" })).toHaveFocus();
  await userEvent.click(dialog.getByRole("button", { name: "Back" }));
  await expect.element(dialog.getByRole("heading", { name: TOUR_STEPS[0]!.title })).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(TOUR_SETTINGS_STORAGE_KEY)!)).toMatchObject({
    tourCompletedVersion: 1,
  });
  // Completed on this device: the offer stays away.
  expect(screen.container.querySelector('[aria-label="Tour offer"]')).toBeNull();
});

it("keeps focus inside the card with Tab", async () => {
  setup();
  await using _screen = await render(<Harness />, { router: "/settings/workflows" });
  await userEvent.click(page.getByRole("button", { name: "Replay tour" }));
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByRole("button", { name: "Next" })).toHaveFocus();
  await userEvent.tab();
  await expect.element(dialog.getByRole("button", { name: "Skip tour" })).toHaveFocus();
});

it("shows the read-only scheduler preview at the trigger step", async () => {
  setup();
  await using _screen = await render(<Harness />, { router: "/workflows/sample" });
  useTourStore.setState({
    status: "running",
    index: TOUR_STEPS.findIndex((step) => step.id === "triggers"),
  });
  const preview = page.getByRole("region", { name: "Schedule preview" });
  await expect.element(preview.getByRole("heading", { name: "Workflow schedules" })).toBeVisible();
  await expect
    .element(preview.getByRole("checkbox", { name: "Mon" }))
    .toHaveAttribute("aria-checked", "true");
  const time = preview.getByLabelText("Schedule time");
  await expect.element(time).toHaveValue("09:00");
  await expect.element(time).toBeDisabled();
  await expect.element(preview.getByRole("heading", { name: /Next 3 runs/ })).toBeVisible();
  await expect.element(preview.getByRole("button", { name: "Add schedule" })).toBeDisabled();

  // The preview adds no tab stops: the card still owns focus.
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByRole("button", { name: "Next" })).toHaveFocus();
  await userEvent.tab();
  await expect.element(dialog.getByRole("button", { name: "Skip tour" })).toHaveFocus();
});

it("closes the scheduler preview on Back, Next and Skip", async () => {
  setup();
  await using _screen = await render(<Harness />, { router: "/workflows/sample" });
  useTourStore.setState({
    status: "running",
    index: TOUR_STEPS.findIndex((step) => step.id === "triggers"),
  });
  const preview = page.getByRole("region", { name: "Schedule preview" });
  const dialog = page.getByRole("dialog");
  await expect.element(preview).toBeVisible();

  await userEvent.click(dialog.getByRole("button", { name: "Next" }));
  await expect.element(preview).not.toBeInTheDocument();
  await expect.element(dialog.getByRole("heading", { name: TOUR_STEPS[6]!.title })).toBeVisible();

  await userEvent.click(dialog.getByRole("button", { name: "Back" }));
  await expect.element(preview).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Skip tour" }));
  await expect.element(preview).not.toBeInTheDocument();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

it("keeps focus in the card after Watch demo disables itself", async () => {
  setup();
  using _demo = stopDemoOnDispose();
  await using _screen = await render(<Harness />, { router: "/workflows/sample" });
  useTourStore.setState({ status: "running", index: 6, demoPlaying: false });
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByRole("button", { name: "Watch demo" })).toBeVisible();

  await userEvent.click(dialog.getByRole("button", { name: "Watch demo" }));
  await expect.element(dialog.getByRole("button", { name: "Demo running…" })).toBeVisible();
  // The button greys itself out; the card takes focus back instead of the page.
  await expect.element(dialog.getByRole("button", { name: "Next" })).toHaveFocus();
  await userEvent.tab({ shift: true });
  await expect.element(dialog.getByRole("button", { name: "Back" })).toHaveFocus();
  expect(document.querySelector('[aria-label="Show the tour on new devices"]')).not.toBe(
    document.activeElement,
  );
});
