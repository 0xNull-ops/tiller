import { expect, it } from "vite-plus/test";
import { DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { tillerWebIconOverrides } from "../apps/web/src/fork/brand.ts";

it("keeps upstream icon generation independent of Tiller's packaging copies", () => {
  expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toHaveLength(4);
  for (const asset of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
    expect(asset.sourceRelativePath).toMatch(/^assets\/dev\//);
  }
  const packaged = tillerWebIconOverrides("apps/server/dist/client");
  expect(packaged.map((asset) => asset.targetRelativePath)).toEqual([
    "apps/server/dist/client/favicon.ico",
    "apps/server/dist/client/favicon-16x16.png",
    "apps/server/dist/client/favicon-32x32.png",
    "apps/server/dist/client/apple-touch-icon.png",
  ]);
  for (const asset of packaged) {
    expect(asset.sourceRelativePath).toMatch(/^apps\/web\/src\/fork\/assets\/tiller-/);
  }
});
