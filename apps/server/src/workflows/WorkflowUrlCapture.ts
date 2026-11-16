// @effect-diagnostics nodeBuiltinImport:off - Playwright must resolve from disk, including in a Node SEA executable.
import * as NodeModule from "node:module";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { publicProxy } from "../htmlRender/publicProxy.ts";
import * as PreviewBrowser from "../preview/PreviewBrowser.ts";
import { sandboxDisabled } from "../preview/PreviewBrowserHost.ts";

const requirePlaywright = NodeModule.createRequire(import.meta.url);
const HTML_URL = "https://workflow-output.invalid/index.html";

export class WorkflowUrlCaptureError extends Schema.TaggedError<WorkflowUrlCaptureError>()(
  "WorkflowUrlCaptureError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The workflow URL preview could not be captured.";
  }
}

export class WorkflowUrlCapture extends Context.Service<
  WorkflowUrlCapture,
  {
    readonly capture: (
      url: string,
      html?: string,
    ) => Effect.Effect<Uint8Array, WorkflowUrlCaptureError>;
  }
>()("t3/workflows/WorkflowUrlCapture") {}

const make = Effect.gen(function* () {
  const previewBrowser = yield* PreviewBrowser.PreviewBrowser;
  const noSandbox = sandboxDisabled(yield* HostProcess.Environment);
  const capture = Effect.fn("WorkflowUrlCapture.capture")(
    function* (url: string, html?: string) {
      const target = html === undefined ? url : HTML_URL;
      const parsed = URL.parse(target);
      if (!parsed || !["http:", "https:"].includes(parsed.protocol))
        return yield* new WorkflowUrlCaptureError({
          cause: new Error("Unsupported URL protocol."),
        });
      const executablePath = yield* previewBrowser.executable;
      const port = yield* publicProxy;
      const browser = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => {
            const { chromium } = requirePlaywright(
              "playwright-core",
            ) as typeof import("playwright-core");
            return chromium.launch({
              executablePath,
              headless: true,
              chromiumSandbox: !noSandbox,
              timeout: 10_000,
              args: [
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-domain-reliability",
                "--disable-sync",
                "--no-first-run",
                "--block-new-web-contents",
                "--disable-file-system",
                "--disable-features=FileSystemAccessAPI,WebRtcHideLocalIpsWithMdns",
                "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                `--proxy-server=socks5://127.0.0.1:${port}`,
                "--proxy-bypass-list=<-loopback>",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
              ],
            });
          },
          catch: (cause) => new WorkflowUrlCaptureError({ cause }),
        }),
        (browser) => Effect.promise(() => browser.close()).pipe(Effect.ignoreCause),
      );
      return yield* Effect.tryPromise({
        try: async () => {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
            serviceWorkers: "block",
            acceptDownloads: false,
          });
          await context.route("**/*", (route) => {
            const request = new URL(route.request().url());
            if (html !== undefined && request.origin === new URL(HTML_URL).origin) {
              // Only the document is supplied. Relative local assets have no filesystem route.
              return request.href === HTML_URL
                ? route.fulfill({
                    status: 200,
                    contentType: "text/html; charset=utf-8",
                    body: html,
                  })
                : route.abort();
            }
            return ["http:", "https:", "data:", "blob:", "about:"].includes(request.protocol)
              ? route.continue()
              : route.abort();
          });
          await context.addInitScript(
            "delete window.RTCPeerConnection; delete window.webkitRTCPeerConnection;",
          );
          const page = await context.newPage();
          context.on("page", (popup) => {
            void popup.close().catch(constVoid);
          });
          const response = await page.goto(target, { waitUntil: "load", timeout: 12_000 });
          if (!response?.ok()) throw new Error("The preview page did not load successfully.");
          if (typeof page.evaluate === "function") {
            // Let module scripts and first-frame canvas renders (such as WebGL/Three.js scenes) settle before capture.
            await page
              .evaluate(
                "document.fonts?.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))",
              )
              .catch(constVoid);
          }
          return page.screenshot({
            type: "jpeg",
            quality: 75,
            animations: "disabled",
            timeout: 5_000,
          });
        },
        catch: (cause) => new WorkflowUrlCaptureError({ cause }),
      });
    },
    Effect.scoped,
    Effect.timeout("20 seconds"),
    Effect.mapError((cause) => new WorkflowUrlCaptureError({ cause })),
  );
  return WorkflowUrlCapture.of({ capture });
});

export const layer = Layer.effect(WorkflowUrlCapture, make);
