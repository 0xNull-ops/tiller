import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { SidebarProvider } from "../../components/ui/sidebar";
import { render } from "../../../test/render";
import { SampleWorkflowPage } from "./SampleWorkflowPage";
import { TOUR_STEPS } from "./tourSteps";
import { useTourStore } from "./tourStore";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock(import("../../workflows/workflowState"), async (original) => ({
  ...(await original()),
  useWorkflowEdit: (() => ({
    canEdit: true,
    busy: false,
    error: null,
    run: mocks.run,
  })) as never,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [
    { environmentId: EnvironmentId.make("local"), id: ProjectId.make("p1"), title: "Site" },
  ]) as never,
}));

function setup() {
  mocks.run.mockReset();
  mocks.run.mockResolvedValue({});
  useTourStore.setState({
    status: "idle",
    index: 0,
    returnTo: null,
    demoRun: null,
    demoPlaying: false,
    saveCopyOpen: false,
  });
}

function Page() {
  return (
    <SidebarProvider>
      <SampleWorkflowPage />
    </SidebarProvider>
  );
}

it("renders the sample read-only with an anchor for every canvas step", async () => {
  setup();
  await using screen = await render(<Page />);
  await expect.element(page.getByRole("heading", { name: "Launch a landing page" })).toBeVisible();
  await expect.element(page.getByText("Sample", { exact: true })).toBeVisible();
  for (const anchor of [
    "step-card",
    "start-triggers",
    "reads-arc",
    "loop-arc",
    "credential-card",
  ]) {
    await vi.waitFor(() =>
      expect(screen.container.querySelector(`[data-tour="${anchor}"]`)).not.toBeNull(),
    );
  }
  // A card click and the "+" preview edit nothing.
  await userEvent.click(page.getByText("Research").first());
  expect(mocks.run).not.toHaveBeenCalled();
});

it("shows the + controls only while the tour is on the add-step step", async () => {
  setup();
  await using screen = await render(<Page />);
  expect(screen.container.querySelector('[data-tour="add-step"]')).toBeNull();
  useTourStore.setState({
    status: "running",
    index: TOUR_STEPS.findIndex((step) => step.id === "add-step"),
  });
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[data-tour="add-step"]')).not.toBeNull(),
  );
  expect(mocks.run).not.toHaveBeenCalled();
});

it("labels the demo run and clears it on exit", async () => {
  setup();
  await using screen = await render(<Page />);
  const tour = useTourStore.getState();
  tour.startDemo();
  await expect.element(page.getByText("Demo", { exact: true })).toBeVisible();
  tour.exitDemo();
  await vi.waitFor(() => expect(screen.container.textContent).not.toContain("Exit demo"));
});

it("writes only when Save a copy is confirmed", async () => {
  setup();
  await using _screen = await render(<Page />);
  expect(mocks.run).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole("button", { name: "Save a copy" }).first());
  await userEvent.click(page.getByRole("dialog").getByRole("button", { name: "Save a copy" }));
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
  expect(mocks.run.mock.calls[0]![0]).toMatchObject({
    _tag: "import",
    projectId: "p1",
    workflow: "launch-a-landing-page",
  });
});
