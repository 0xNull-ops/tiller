import { expect, it, vi } from "vite-plus/test";

import { render, stubGlobal } from "../../../test/render";
import { FeedbackSettingsSection } from "./FeedbackSettingsSection";

const openedUrl = (openExternal: ReturnType<typeof vi.fn>, call: number) => {
  const [url] = openExternal.mock.calls[call]! as [string];
  return new URL(url);
};

it("opens the public bug form with only the three environment facts prefilled", async () => {
  const openExternal = vi.fn(async () => true);
  using _bridge = stubGlobal("desktopBridge", {
    openExternal,
    getClientPlatform: () => "darwin",
  });

  await using screen = await render(<FeedbackSettingsSection />);
  await screen.getByRole("button", { name: "Report a bug" }).click();

  expect(openExternal).toHaveBeenCalledTimes(1);
  const url = openedUrl(openExternal, 0);
  expect(url.origin + url.pathname).toBe("https://github.com/Antler-Web-Studios/tiller/issues/new");
  expect(url.searchParams.get("template")).toBe("bug.yml");
  expect([...url.searchParams.keys()].toSorted()).toEqual(["arch", "os", "template", "version"]);
  expect(url.searchParams.get("os")).toContain("macOS");
  // Nothing local may ride along: no paths, no project names, no logs.
  expect(url.href).not.toContain("/Users/");
  expect(url.href).not.toContain("node_modules");
});

it("offers the feature form from the same section", async () => {
  const openExternal = vi.fn(async () => true);
  using _bridge = stubGlobal("desktopBridge", {
    openExternal,
    getClientPlatform: () => "darwin",
  });

  await using screen = await render(<FeedbackSettingsSection />);
  await screen.getByRole("button", { name: "Request a feature" }).click();

  expect(openedUrl(openExternal, 0).searchParams.get("template")).toBe("feature.yml");
});
