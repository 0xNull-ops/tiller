// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - Vite transforms the upstream static shell and manifest.
import * as NodeFS from "node:fs";
import type { Plugin } from "vite-plus";
import { FORK_BRAND, FORK_WEB_ICON_PATHS } from "./brand.ts";

export function forkNodeBrandPlugin() {
  return {
    name: "fork-node-brand",
    transform: (code: string, id: string) =>
      /\/(?:apps\/(?:desktop|server)|packages\/[^/]+)\/src\//.test(id) &&
      !id.includes(".test.") &&
      !id.includes("/node_modules/")
        ? { code: brandUiSource(code), map: null }
        : null,
  };
}

const webIcons = [
  { fileName: "favicon.ico", path: FORK_WEB_ICON_PATHS.faviconIco, type: "image/x-icon" },
  { fileName: "favicon-16x16.png", path: FORK_WEB_ICON_PATHS.favicon16Png, type: "image/png" },
  { fileName: "favicon-32x32.png", path: FORK_WEB_ICON_PATHS.favicon32Png, type: "image/png" },
  {
    fileName: "apple-touch-icon.png",
    path: FORK_WEB_ICON_PATHS.appleTouchIconPng,
    type: "image/png",
  },
] as const;

const readIcon = (path: string) =>
  NodeFS.readFileSync(new URL(`../../../../${path}`, import.meta.url));

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function brandIndexHtml(html: string, name: string) {
  const escaped = escapeHtml(name);
  return html
    .replace(/<title>T3 Code([^<]*)<\/title>/, () => `<title>${escaped}</title>`)
    .replace('aria-label="T3 Code splash screen"', () => `aria-label="${escaped} splash screen"`)
    .replace('alt="T3 Code"', () => `alt="${escaped}"`);
}

export function brandManifest(source: string, name: string, shortName: string) {
  const manifest: unknown = JSON.parse(source);
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The web manifest must be an object.");
  }
  return `${JSON.stringify({ ...manifest, name, short_name: shortName }, null, 2)}\n`;
}

export function brandUiSource(source: string) {
  return source
    .replaceAll(
      "Link this environment to T3 Connect for a public URL.",
      "Public webhook URLs are unavailable in this release. Use a reachable environment address.",
    )
    .replaceAll(
      "Link T3 Connect for a public URL.",
      "Use Tailscale or your own proxy for remote access.",
    )
    .replaceAll(
      "No `webhookUrl`: T3 Connect remote access is off.",
      "No `webhookUrl`: public webhook URLs are unavailable in this release.",
    )
    .replaceAll(
      "The user must enable T3 Connect remote access.",
      "Public webhook URLs are unavailable in this release; use a reachable environment address.",
    )
    .replaceAll(
      "https://github.com/pingdotgg/t3code/blob/main/docs/user/faq.md#can-i-add-a-bunch-of-accounts-for-one-provider",
      "https://tiller.shipr.app",
    )
    .replaceAll(
      "T3 Connect remote access is needed",
      "webhook remote access is unavailable in this release",
    )
    .replaceAll("T3 Connect", "remote access (unavailable in this release)")
    .replaceAll("https://t3.codes/faq", "https://tiller.shipr.app")
    .replaceAll("t3 pair", "tiller pair")
    .replace(/(built on) T3 Code/gi, "$1 __UPSTREAM_CREDIT__")
    .replace(/Copyright[^\n]*T3 Code/g, (notice) =>
      notice.replaceAll("T3 Code", "__UPSTREAM_CREDIT__"),
    )
    .replaceAll("T3 Code", "Tiller")
    .replaceAll(
      "How we handle your data, including the anonymous usage data Tiller collects.",
      "How we handle your data. Tiller collects no telemetry.",
    )
    .replaceAll(
      "Tiller collects anonymous usage data to help us improve it.",
      "Tiller does not collect usage data.",
    )
    .replaceAll(" and how to opt out", "")
    .replaceAll("__UPSTREAM_CREDIT__", "T3 Code")
    .replaceAll("https://app.t3.codes", "https://tiller.shipr.app")
    .replaceAll("https://t3.codes/privacy-policy", "https://tiller.shipr.app/privacy")
    .replaceAll("https://t3.codes/terms-of-service", "https://tiller.shipr.app/terms")
    .replaceAll("https://t3.codes/download", "https://tiller.shipr.app")
    .replaceAll(
      "https://github.com/pingdotgg/t3code/issues",
      "https://github.com/Antler-Web-Studios/tiller/issues",
    )
    .replaceAll("Run Tiller's CLI as `t3`", "Run Tiller's CLI as `tiller`")
    .replaceAll("Another t3 at", "Another tiller at")
    .replaceAll("Could not install t3", "Could not install tiller")
    .replaceAll("Could not remove t3", "Could not remove tiller")
    .replaceAll("`t3`", "`tiller`")
    .replaceAll("\\`t3\\`", "\\`tiller\\`")
    .replaceAll("the t3 CLI", "the Tiller CLI")
    .replace(/\bt3 connect(?= tunnel|["'])/g, "tiller connect")
    .replace(/\bnpx t3(?= |@|["'`\\])/g, "npx tiller-app")
    .replace(/(?<![\w@/.-])t3@/g, "tiller-app@")
    .replace(/(`|\\`)t3 /g, "$1tiller ")
    .replace(
      /(["'])t3 (?=--help|\.\/|pair\b|triage\b|connect cli|project cli|thread cli|up\b|status\b)/g,
      "$1tiller ",
    )
    .replace(
      /\bt3 (?=launcher\b|command\b|release\b|releases\b|runtime\b|runtimes\b|CLI\b|version\b)/g,
      "tiller ",
    )
    .replace(
      /\b(Remove|Added|This|this|Another|newer|unused|downloaded|pinned|once|Run) t3(?= |["'`\\])/g,
      "$1 tiller",
    )
    .replaceAll("t3 is already on", "tiller is already on")
    .replaceAll("t3 and its background service", "tiller and its background service")
    .replaceAll("t3 is uninstalled", "tiller is uninstalled")
    .replaceAll("t3 is not installed", "tiller is not installed")
    .replaceAll(">t3 auth pairing create<", ">tiller auth pairing create<")
    .replace(/npm uninstall -g t3(?=[`"\x27\\ ])/g, "npm uninstall -g tiller-app");
}

export function forkBrandPlugin(
  identity: { readonly name: string; readonly shortName: string } = FORK_BRAND,
): Plugin {
  const readManifest = () =>
    brandManifest(
      NodeFS.readFileSync(new URL("../../public/manifest.webmanifest", import.meta.url), "utf8"),
      identity.name,
      identity.shortName,
    );
  return {
    name: "fork-brand",
    apply: (_config, { mode }) => mode !== "test",
    enforce: "pre",
    transform(source, id) {
      if (
        !/\/src\/.*\.[cm]?[jt]sx?(?:\?|$)/.test(id) ||
        id.includes(".test.") ||
        id.includes("/node_modules/") ||
        id.includes("/fork/brandPlugin.ts")
      )
        return;
      return { code: brandUiSource(source), map: null };
    },
    transformIndexHtml: (html) => brandIndexHtml(html, identity.name),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0];
        const icon = webIcons.find((entry) => pathname === `/${entry.fileName}`);
        if (icon && (request.method === "GET" || request.method === "HEAD")) {
          response.setHeader("Content-Type", icon.type);
          response.setHeader("Cache-Control", "no-cache");
          response.end(request.method === "HEAD" ? undefined : readIcon(icon.path));
          return;
        }
        if (
          request.url?.split("?")[0] !== "/manifest.webmanifest" ||
          (request.method !== "GET" && request.method !== "HEAD")
        ) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/manifest+json");
        response.setHeader("Cache-Control", "no-cache");
        response.end(request.method === "HEAD" ? undefined : readManifest());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: readManifest() });
      for (const icon of webIcons) {
        this.emitFile({ type: "asset", fileName: icon.fileName, source: readIcon(icon.path) });
      }
    },
  };
}
