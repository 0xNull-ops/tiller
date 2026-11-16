import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render, type Screen } from "../../test/render";

const state = vi.hoisted(() => ({ label: null as string | null }));

vi.mock(import("./workflowStepActivityState"), () => ({
  useStepActivityLabel: () => state.label,
}));

import { WorkflowStepActivityLine } from "./WorkflowStepActivityLine";

const environmentId = EnvironmentId.make("local");
const threadId = ThreadId.make("step-thread");

function setup() {
  state.label = null;
}

function line(screen: Screen): HTMLElement | null {
  return screen.container.querySelector("[data-workflow-step-activity]");
}

function step(props: { startedAt?: string; running?: boolean } = {}) {
  return (
    <WorkflowStepActivityLine
      environmentId={environmentId}
      threadId={threadId}
      startedAt={props.startedAt ?? "2026-10-20T10:00:00.000Z"}
      running={props.running ?? true}
    />
  );
}

it("shows what the step's thread is doing", async () => {
  setup();
  state.label = "Editing index.html";
  await using screen = await render(step());

  expect(line(screen)?.textContent).toBe("Editing index.html");
});

it("shows nothing while the step has no live work", async () => {
  setup();
  await using screen = await render(step());

  expect(line(screen)).toBeNull();
});

it("throttles updates to one every 500ms", async () => {
  setup();
  using _timers = fakeTimers();
  state.label = "Editing index.html";
  await using screen = await render(step());
  expect(line(screen)?.textContent).toBe("Editing index.html");

  state.label = "Running vp";
  await screen.rerender(step());
  expect(line(screen)?.textContent).toBe("Editing index.html");

  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(line(screen)?.textContent).toBe("Running vp");
});

it("clears the line when the step stops running", async () => {
  setup();
  state.label = "Editing index.html";
  await using screen = await render(step());
  expect(line(screen)?.textContent).toBe("Editing index.html");

  await screen.rerender(step({ running: false }));

  expect(line(screen)).toBeNull();
});

it("clears the line when the step changes", async () => {
  setup();
  state.label = "Editing index.html";
  await using screen = await render(step());
  expect(line(screen)?.textContent).toBe("Editing index.html");

  state.label = "Reading src/app.ts";
  await screen.rerender(step({ startedAt: "2026-10-20T10:05:00.000Z" }));

  expect(line(screen)?.textContent).toBe("Reading src/app.ts");
});

it("does not starve while activity keeps changing and cancels trailing work on unmount", async () => {
  setup();
  using _timers = fakeTimers();
  state.label = "Reading a.ts";
  await using screen = await render(step());
  for (let index = 1; index <= 4; index++) {
    await act(() => vi.advanceTimersByTime(100));
    state.label = `Editing file-${index}.ts`;
    await screen.rerender(step());
  }
  expect(line(screen)?.textContent).toBe("Reading a.ts");
  await act(() => vi.advanceTimersByTime(100));
  expect(line(screen)?.textContent).toBe("Editing file-4.ts");
  state.label = "Running tests";
  await screen.rerender(step());
  await screen.rerender(null);
  await act(() => vi.advanceTimersByTime(1000));
  expect(line(screen)).toBeNull();
});

it("clears idle activity immediately without bypassing the throttle for the next tool", async () => {
  setup();
  using _timers = fakeTimers();
  state.label = "Reading a.ts";
  await using screen = await render(step());
  await act(() => vi.advanceTimersByTime(100));
  state.label = null;
  await screen.rerender(step());
  expect(line(screen)).toBeNull();
  state.label = "Editing b.ts";
  await screen.rerender(step());
  expect(line(screen)).toBeNull();
  await act(() => vi.advanceTimersByTime(400));
  expect(line(screen)?.textContent).toBe("Editing b.ts");
});
