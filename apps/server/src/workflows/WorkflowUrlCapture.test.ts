import * as HostProcess from "@t3tools/shared/HostProcess";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as PreviewBrowser from "../preview/PreviewBrowser.ts";
import * as WorkflowUrlCapture from "./WorkflowUrlCapture.ts";

const chrome = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("node:module", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:module")>();
  return {
    ...original,
    createRequire: (url: string) => {
      const require = original.createRequire(url);
      return (name: string) => (name === "playwright-core" ? { chromium: chrome } : require(name));
    },
  };
});
// These tests exercise browser ownership with a fake browser, without binding a proxy socket.
vi.mock("../htmlRender/publicProxy.ts", async () => {
  const Effect = await import("effect/Effect");
  return { publicProxy: Effect.succeed(12345) };
});

const layer = WorkflowUrlCapture.layer.pipe(
  Layer.provide(
    Layer.succeed(PreviewBrowser.PreviewBrowser, {
      executable: Effect.succeed("/test/chrome"),
      installed: Effect.succeedNone,
    }),
  ),
);

const browserFixture = (screenshot: () => Promise<Uint8Array>, ok = true) => {
  const close = vi.fn(async () => {});
  const route = vi.fn();
  const init = vi.fn();
  const goto = vi.fn(async (_url: string) => ({ ok: () => ok }));
  const context = {
    route,
    addInitScript: init,
    on: vi.fn(),
    newPage: async () => ({ goto, screenshot }),
  };
  chrome.launch.mockResolvedValue({ close, newContext: async () => context });
  return { close, route, init, goto };
};

it.effect("captures in an isolated sandboxed browser and always closes it", () =>
  Effect.gen(function* () {
    const bytes = new Uint8Array([255, 216, 255, 217]);
    const h = browserFixture(async () => bytes);
    const capture = yield* WorkflowUrlCapture.WorkflowUrlCapture;
    expect(yield* capture.capture("https://example.com")).toEqual(bytes);
    expect(h.close).toHaveBeenCalledOnce();
    expect(chrome.launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ chromiumSandbox: true }),
    );
    const handler = h.route.mock.calls[0]![1] as (route: {
      request: () => { url: () => string };
      continue: () => Promise<void>;
      abort: () => Promise<void>;
    }) => Promise<void>;
    const allow = vi.fn(async () => {});
    const block = vi.fn(async () => {});
    yield* Effect.promise(() =>
      handler({
        request: () => ({ url: () => "file:///etc/passwd" }),
        continue: allow,
        abort: block,
      }),
    );
    expect(block).toHaveBeenCalledOnce();
    expect(allow).not.toHaveBeenCalled();
    expect(h.init).toHaveBeenCalledWith(expect.stringContaining("delete window.RTCPeerConnection"));
  }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Environment, {})),
);

it.effect.each(["<!doctype html><h1>Report</h1>", ""])(
  "fulfills local HTML at an isolated HTTPS URL and restricts asset requests (%s)",
  (html) =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([255, 216, 255, 217]);
      const h = browserFixture(async () => bytes);
      const capture = yield* WorkflowUrlCapture.WorkflowUrlCapture;
      expect(yield* capture.capture("out/report.html", html)).toEqual(bytes);
      expect(h.close).toHaveBeenCalledOnce();
      const target = h.goto.mock.calls[0]![0];
      expect(target).toBe("https://workflow-output.invalid/index.html");
      expect(chrome.launch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          chromiumSandbox: true,
          args: expect.arrayContaining([
            "--proxy-server=socks5://127.0.0.1:12345",
            "--proxy-bypass-list=<-loopback>",
            "--disable-file-system",
          ]),
        }),
      );
      const handler = h.route.mock.calls[0]![1] as (route: {
        request: () => { url: () => string };
        continue: () => Promise<void>;
        abort: () => Promise<void>;
        fulfill: (options: { status: number; contentType: string; body: string }) => Promise<void>;
      }) => Promise<void>;
      for (const url of [
        target,
        "https://cdn.example.com/styles.css",
        "https://workflow-output.invalid/styles.css",
        "file:///etc/passwd",
        "ftp://example.com/file",
      ]) {
        const allow = vi.fn(async () => {});
        const block = vi.fn(async () => {});
        const fulfill = vi.fn(async () => {});
        yield* Effect.promise(() =>
          handler({ request: () => ({ url: () => url }), continue: allow, abort: block, fulfill }),
        );
        if (url === target) {
          expect(fulfill).toHaveBeenCalledExactlyOnceWith({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: html,
          });
          expect(allow).not.toHaveBeenCalled();
          expect(block).not.toHaveBeenCalled();
        } else if (url === "https://cdn.example.com/styles.css") {
          expect(allow).toHaveBeenCalledOnce();
          expect(block).not.toHaveBeenCalled();
          expect(fulfill).not.toHaveBeenCalled();
        } else {
          expect(block).toHaveBeenCalledOnce();
          expect(allow).not.toHaveBeenCalled();
          expect(fulfill).not.toHaveBeenCalled();
        }
      }
    }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Environment, {})),
);

it.effect.each([undefined, "<h1>Report</h1>"])(
  "closes the capture browser on interruption while screenshotting (HTML: %s)",
  (html) =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      const h = browserFixture(() => {
        started.resolve();
        return new Promise(() => {});
      });
      const capture = yield* WorkflowUrlCapture.WorkflowUrlCapture;
      const fiber = yield* capture.capture("https://example.com", html).pipe(Effect.forkScoped);
      yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(fiber);
      expect(h.close).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Environment, {})),
);

it.effect("closes the HTML capture browser when screenshotting fails", () =>
  Effect.gen(function* () {
    const h = browserFixture(async () => {
      throw new Error("Screenshot unavailable");
    });
    const capture = yield* WorkflowUrlCapture.WorkflowUrlCapture;
    expect((yield* Effect.flip(capture.capture("out/report.html", "<h1>Report</h1>")))._tag).toBe(
      "WorkflowUrlCaptureError",
    );
    expect(h.close).toHaveBeenCalledOnce();
  }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Environment, {})),
);

it.effect(
  "keeps launch and HTTP errors typed, closes failed pages, and honors sandbox opt-out",
  () =>
    Effect.gen(function* () {
      const h = browserFixture(async () => new Uint8Array(), false);
      const capture = yield* WorkflowUrlCapture.WorkflowUrlCapture;
      expect((yield* Effect.flip(capture.capture("https://example.com")))._tag).toBe(
        "WorkflowUrlCaptureError",
      );
      expect(h.close).toHaveBeenCalledOnce();
      expect(chrome.launch).toHaveBeenLastCalledWith(
        expect.objectContaining({ chromiumSandbox: false }),
      );
      chrome.launch.mockRejectedValueOnce(new Error("Chrome unavailable"));
      expect((yield* Effect.flip(capture.capture("https://example.com")))._tag).toBe(
        "WorkflowUrlCaptureError",
      );
      const before = chrome.launch.mock.calls.length;
      expect((yield* Effect.flip(capture.capture("file:///etc/passwd")))._tag).toBe(
        "WorkflowUrlCaptureError",
      );
      expect(chrome.launch.mock.calls.length).toBe(before);
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(HostProcess.Environment, { T3CODE_SERVER_BROWSER_SANDBOX: "0" }),
    ),
);
