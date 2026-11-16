import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import { WorkflowSchedulePanel } from "./WorkflowSchedulePanel";
import { workflowRunFixture } from "./workflowTestFixture";

const state = vi.hoisted(() => ({ send: vi.fn(), allowed: true }));
vi.mock(import("./workflowState"), () => ({
  useWorkflowEdit: () => ({
    canEdit: state.allowed,
    busy: false,
    error: null,
    clearError: () => {},
    run: state.send,
  }),
  editWorkflow: { permissionAtom: () => ({}) } as never,
}));
vi.mock(import("./useWorkflowSchedules"), () => ({
  useWorkflowSchedules: () => ({ tasks: [], nextRunAt: null, isPending: false, error: null }),
}));
vi.mock(import("../state/environments"), () => ({
  useEnvironmentHttpBaseUrl: () => "https://server.example",
}));

const projectId = ProjectId.make("project");
const driverThreadId = ThreadId.make("driver");
const listing = {
  projectId,
  workflow: "monthly-aso",
  definition: {
    ...workflowRunFixture.definition,
    name: "Monthly ASO",
    inputs: [{ id: "app-name", label: "App name", kind: "text" as const, required: true }],
  },
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: workflowRunFixture.startedAt,
  scratch: false,
  editedByThreadId: null,
};
const byLabel = (label: string) =>
  document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const addButton = () =>
  [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent === "Add schedule",
  )!;

function setup() {
  state.allowed = true;
  state.send.mockReset().mockResolvedValue({});
}

function renderPanel(driver: typeof driverThreadId | null = driverThreadId) {
  return render(
    <WorkflowSchedulePanel
      environmentId={EnvironmentId.make("remote")}
      projectId={projectId}
      workflow={listing}
      driverThreadId={driver}
      onClose={() => {}}
    />,
  );
}

it("requires run inputs before adding a bound monthly schedule", async () => {
  setup();
  await using _screen = await renderPanel();
  await userEvent.click(addButton());
  expect(state.send).not.toHaveBeenCalled();
  await userEvent.fill(byLabel("Scheduled App name"), "My App");
  const moreKnobs = [...document.body.querySelectorAll("summary")].find((el) =>
    el.textContent?.includes("More knobs"),
  )!;
  await userEvent.click(moreKnobs);
  await userEvent.selectOptions(byLabel("Rotate input field"), "app-name");
  const rotateTextarea = byLabel("Rotate input values") as HTMLTextAreaElement;
  await userEvent.type(rotateTextarea, "Billing{Enter}Onboarding, Search");
  expect(rotateTextarea.value).toBe("Billing\nOnboarding, Search");
  await userEvent.click(addButton());
  expect(state.send).toHaveBeenCalledWith({
    _tag: "scheduleAdd",
    projectId,
    workflow: "monthly-aso",
    driverThreadId,
    schedule: { type: "interval", everyMs: 30 * 86_400_000 },
    inputs: { "app-name": "My App" },
    knobs: {
      overlap: "skip",
      rotate: {
        inputId: "app-name",
        values: ["Billing", "Onboarding", "Search"],
        next: 0,
      },
    },
  });
});

it("keeps an unsent draft from creating an unbound automation", async () => {
  setup();
  await using _screen = await renderPanel(null);
  expect(document.body.textContent).toContain("Send the first message");
  expect(addButton()).toBeUndefined();
  expect(state.send).not.toHaveBeenCalled();
});

it("prefills a template suggestion and submits only after choosing a driver and inputs", async () => {
  setup();
  await using screen = await render(
    <WorkflowSchedulePanel
      environmentId={EnvironmentId.make("remote")}
      projectId={projectId}
      workflow={listing}
      driverThreadId={null}
      driverThreads={[{ id: driverThreadId, title: "Driver chat" }]}
      suggestedSchedule={{
        schedule: { type: "fixed_time", timeOfDay: "10:00", weekdays: [5] },
        knobs: {
          carryOver: true,
          rotate: { inputId: "app-name", values: ["home", "pricing"], next: 0 },
        },
      }}
      onClose={() => {}}
    />,
  );
  expect(state.send).not.toHaveBeenCalled();
  await expect.element(screen.getByRole("dialog")).toBeInTheDocument();
  const input = document.body.querySelector<HTMLInputElement>('input[type="time"]')!;
  expect(input.value).toBe("10:00");
  await userEvent.fill(byLabel("Scheduled App name"), "Website");
  await userEvent.click(addButton());
  await vi.waitFor(() =>
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "scheduleAdd",
        driverThreadId,
        inputs: { "app-name": "Website" },
        schedule: { type: "fixed_time", timeOfDay: "10:00", weekdays: [5] },
        knobs: expect.objectContaining({
          carryOver: true,
          rotate: { inputId: "app-name", values: ["home", "pricing"], next: 0 },
        }),
      }),
    ),
  );
});
