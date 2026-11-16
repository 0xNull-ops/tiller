// @effect-diagnostics nodeBuiltinImport:off - Build integration uses an isolated temporary output directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { build } from "vite-plus";
import { expect, it } from "vite-plus/test";
import { brandUiSource, brandIndexHtml, brandManifest, forkBrandPlugin } from "./brandPlugin";

it("escapes branding in the startup title and accessible splash labels", () => {
  const html =
    '<title>T3 Code (Beta)</title><img alt="T3 Code" aria-label="T3 Code splash screen"><p>T3 Code support</p>';
  expect(brandIndexHtml(html, 'A&B <"Fork">')).toBe(
    '<title>A&amp;B &lt;&quot;Fork&quot;&gt;</title><img alt="A&amp;B &lt;&quot;Fork&quot;&gt;" aria-label="A&amp;B &lt;&quot;Fork&quot;&gt; splash screen"><p>T3 Code support</p>',
  );
});

it("retains manifest routing, icons and display settings when changing names", () => {
  const source =
    '{"id":"/","start_url":"/","scope":"/","display":"standalone","icons":[{"src":"/favicon.ico"}]}';
  expect(JSON.parse(brandManifest(source, "Fork & Co", "Fork"))).toEqual({
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    name: "Fork & Co",
    short_name: "Fork",
    icons: [{ src: "/favicon.ico" }],
  });
  expect(() => brandManifest("[]", "Fork", "Fork")).toThrow("must be an object");
});

it("writes the configured manifest over the public copy in a production build", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-fork-brand-"));
  try {
    await NodeFSP.mkdir(NodePath.join(root, "public"));
    await NodeFSP.writeFile(
      NodePath.join(root, "public", "manifest.webmanifest"),
      '{"name":"T3 Code"}',
    );
    await NodeFSP.writeFile(NodePath.join(root, "public", "favicon.ico"), "upstream icon");
    await NodeFSP.writeFile(
      NodePath.join(root, "index.html"),
      "<html><head><title>T3 Code (Beta)</title></head><body></body></html>",
    );
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [forkBrandPlugin({ name: "Example Fork", shortName: "Example" })],
      build: { outDir: NodePath.join(root, "dist") },
    });
    expect(await NodeFSP.readFile(NodePath.join(root, "dist", "index.html"), "utf8")).toContain(
      "Example Fork",
    );
    const manifest = JSON.parse(
      await NodeFSP.readFile(NodePath.join(root, "dist", "manifest.webmanifest"), "utf8"),
    );
    expect(manifest).toMatchObject({
      name: "Example Fork",
      short_name: "Example",
      start_url: "/",
      scope: "/",
    });
    expect(manifest.icons).toContainEqual({
      src: "/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
    });
    expect(await NodeFSP.readFile(NodePath.join(root, "dist", "favicon.ico"))).toEqual(
      await NodeFSP.readFile(new URL("./assets/tiller-favicon.ico", import.meta.url)),
    );
    expect(await NodeFSP.readFile(NodePath.join(root, "dist", "apple-touch-icon.png"))).toEqual(
      await NodeFSP.readFile(new URL("./assets/tiller-touch.png", import.meta.url)),
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("brands UI copy while preserving upstream credit and the model catalogue", () => {
  expect(
    brandUiSource(
      "T3 Code; built on T3 Code; https://raw.githubusercontent.com/pingdotgg/t3code/main/models.json",
    ),
  ).toBe(
    "Tiller; built on T3 Code; https://raw.githubusercontent.com/pingdotgg/t3code/main/models.json",
  );
});

it("preserves upstream copyright notices", () => {
  expect(brandUiSource("Copyright (c) 2026 T3 Code")).toBe("Copyright (c) 2026 T3 Code");
  expect(
    brandUiSource(
      '"T3 Code collects anonymous usage data to help us improve it." " and how to opt out"',
    ),
  ).toBe('"Tiller does not collect usage data." ""');
});

it.each([
  ["Run \\`t3\\`", "Run \\`tiller\\`"],
  ['searchTerms: ["offline t3 connect"]', 'searchTerms: ["offline tiller connect"]'],
  [
    "npx t3.json @t3tools/shared ~/.t3/cache t3.json",
    "npx t3.json @t3tools/shared ~/.t3/cache t3.json",
  ],
  ["npx t3 serve; npx t3@latest", "npx tiller-app serve; npx tiller-app@latest"],
  ["t3@1.2.3; `t3 service install`", "tiller-app@1.2.3; `tiller service install`"],
  ["Run \\`t3 pair\\`", "Run \\`tiller pair\\`"],
  ['label: "t3 pair"; command: "t3 up --lan"', 'label: "tiller pair"; command: "tiller up --lan"'],
  ["the t3 launcher; t3 release checksums", "the tiller launcher; tiller release checksums"],
  [
    "~/.t3 .t3/ t3.json @t3tools/shared T3CODE_HOME t3Identifier t3/cloud",
    "~/.t3 .t3/ t3.json @t3tools/shared T3CODE_HOME t3Identifier t3/cloud",
  ],
  [
    'Command.make("pair"); ["serve", "--base-dir", "/opt/t3"]',
    'Command.make("pair"); ["serve", "--base-dir", "/opt/t3"]',
  ],
])("brands launcher copy without changing internal identity: %s", (source, expected) => {
  expect(brandUiSource(source)).toBe(expected);
  expect(brandUiSource(expected)).toBe(expected);
});
