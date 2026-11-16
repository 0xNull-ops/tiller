import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  type ClientSettings,
} from "@t3tools/contracts/settings";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import type { ScopedSettingsPatch } from "../components/settings/scopedSettings";
import "~/index.css";

const state = vi.hoisted(() => ({
  colors: {} as ClientSettings["workflowCanvasColors"],
  updateSettings: vi.fn<(patch: ScopedSettingsPatch) => void>(),
}));

vi.mock(import("../components/settings/useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: ((selector: (settings: unknown) => unknown) =>
    selector({ ...DEFAULT_UNIFIED_SETTINGS, workflowCanvasColors: state.colors })) as never,
  useUpdateScopedSettings: () => state.updateSettings,
}));
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useClientSettings: ((selector: (settings: unknown) => unknown) =>
    selector({ ...DEFAULT_CLIENT_SETTINGS, workflowCanvasColors: state.colors })) as never,
}));
// The real row reads write permission from live environment state; this suite is about the
// colour a pick writes and where it lands.
vi.mock(import("../components/settings/settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsRow: ({ title, control, resetAction }) => (
    <div>
      <h3>{title}</h3>
      {control}
      {resetAction}
    </div>
  ),
  SettingsSection: (({ children }: { children: ReactNode }) => children) as never,
}));

import { WorkflowCanvasColorSync } from "./WorkflowCanvasColorSync";
import { WorkflowCanvasColorsSettings } from "./WorkflowCanvasColorsSettings";

const content = () => (
  <>
    <WorkflowCanvasColorSync />
    <WorkflowCanvasColorsSettings />
  </>
);

const rootColor = (name: string) => document.documentElement.style.getPropertyValue(name);

async function setup(colors: ClientSettings["workflowCanvasColors"] = {}) {
  state.colors = colors;
  const screen = await render(content());
  state.updateSettings.mockReset().mockImplementation((patch) => {
    state.colors = patch.workflowCanvasColors ?? state.colors;
    void screen.rerender(content());
  });
  return screen;
}

it("writes a picked kind colour to the root variable the canvas reads", async () => {
  await using _screen = await setup();
  await vi.waitFor(() => expect(rootColor("--wf-kind-credential")).toBe("#e3b341"));

  await userEvent.click(page.getByRole("button", { name: "Credential: Blue" }));

  expect(state.updateSettings).toHaveBeenCalledWith({
    workflowCanvasColors: { credential: "#58a6ff" },
  });
  await vi.waitFor(() => expect(rootColor("--wf-kind-credential")).toBe("#58a6ff"));
});

it("resets a kind to its default, and offers the reset only while it differs", async () => {
  await using _screen = await setup({ check: "#f778ba" });
  await vi.waitFor(() => expect(rootColor("--wf-kind-check")).toBe("#f778ba"));
  expect(
    page.getByRole("button", { name: "Reset Credential colour to default" }).query(),
  ).toBeNull();

  await userEvent.click(page.getByRole("button", { name: "Reset Check colour to default" }));

  // Reset drops the pick rather than storing today's default, so the canvas falls back on its own.
  expect(state.updateSettings).toHaveBeenLastCalledWith({ workflowCanvasColors: {} });
  await vi.waitFor(() => expect(rootColor("--wf-kind-check")).toBe("#3fb950"));
});
