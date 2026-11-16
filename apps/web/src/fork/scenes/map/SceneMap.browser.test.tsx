import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../../test/render";
import "../scenes.css";
import { SceneRenderer } from "../SceneRenderer";
import { BUILTIN_SCENES } from "../sceneThemes";
import { SceneMap } from "./SceneMap";

vi.mock("../../../state/entities", () => ({
  useProjects: () => [],
  useQuietThreadVisibleTurnItems: () => [],
  useServerConfigs: () => new Map(),
  useThreadShells: () => [],
  useQuietThreadShell: () => null,
  useAssistantMessageText: () => null,
  useThreadCheckpointSummaries: () => [],
}));

it("keeps the journey map usable when switching terrain", async () => {
  await using screen = await render(
    <SceneMap traveler="car" mapStyle="streets" terrain="city" path="asphalt" />,
  );
  await expect.element(page.getByRole("button", { name: "Enlarge map" })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Enlarge map" }));
  await expect.element(page.getByRole("button", { name: "Shrink map" })).toBeVisible();
  await screen.rerender(
    <SceneMap traveler="car" mapStyle="parchment" terrain="snow" path="asphalt" />,
  );
  await expect.element(page.getByRole("button", { name: "Shrink map" })).toBeVisible();
});

it("hides the journey map and lets the user restore it without changing themes", async () => {
  const previous = localStorage.getItem("tiller:scene-map-hidden");
  localStorage.removeItem("tiller:scene-map-hidden");
  try {
    await using _screen = await render(
      <>
        <div data-slot="sidebar-inner" />
        <SceneRenderer scene={BUILTIN_SCENES[0]!} bannerMode="compact" toggleBanner={() => {}} />
      </>,
    );
    await expect.element(page.getByRole("button", { name: "Hide journey map" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Hide journey map" }));
    await expect.element(page.getByRole("button", { name: "Enlarge map" })).not.toBeInTheDocument();
    expect(localStorage.getItem("tiller:scene-map-hidden")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: "Show journey map" }));
    await expect.element(page.getByRole("button", { name: "Enlarge map" })).toBeVisible();
  } finally {
    if (previous === null) localStorage.removeItem("tiller:scene-map-hidden");
    else localStorage.setItem("tiller:scene-map-hidden", previous);
  }
});
