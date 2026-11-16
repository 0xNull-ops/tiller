import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type AssetResource } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { act, render } from "../../test/render";
import { ExpandedImageDialogHost } from "../components/chat/ExpandedImageDialog";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { WorkflowOutputStrip } from "./WorkflowOutputStrip";
import "~/index.css";

const assetCalls = vi.hoisted(() => [] as Array<AssetResource | null>);
const image = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
vi.mock("../assets/assetUrls", () => ({
  useAssetUrlState: (_environmentId: string, resource: AssetResource | null) => {
    assetCalls.push(resource);
    return resource ? { _tag: "Success", url: image } : { _tag: "Loading" };
  },
  useAssetUrlRefresh: () => async () => image,
}));
const threadRef = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("driver"));

function renderStrip(ui: ReactNode, style: Partial<CSSStyleDeclaration> = {}) {
  assetCalls.length = 0;
  const container = document.createElement("div");
  container.style.width = "500px";
  Object.assign(container.style, style);
  return render(ui, { container });
}

it("shows cached URL screenshots and local images, and opens the image in T3", async () => {
  await using screen = await renderStrip(
    <AppAtomRegistryProvider>
      <WorkflowOutputStrip
        threadRef={threadRef}
        outputs={{
          site: "https://example.com/",
          artwork: "design/hero.png",
          report: "reports/brief.md",
        }}
        previews={{ site: { status: "ready", attachmentId: "cached-site" } }}
        onShowAll={() => {}}
      />
      <ExpandedImageDialogHost threadKey={scopedThreadKey(threadRef)} />
    </AppAtomRegistryProvider>,
  );
  await vi.waitFor(() => expect(screen.container.querySelectorAll("img")).toHaveLength(1));
  expect(assetCalls).toContainEqual({ _tag: "attachment", attachmentId: "cached-site" });
  expect(assetCalls).toContainEqual({
    _tag: "media-file",
    threadId: threadRef.threadId,
    path: "design/hero.png",
  });
  expect(
    screen.container.querySelector<HTMLAnchorElement>('a[aria-label="Open output site"]')?.href,
  ).toBe("https://example.com/");
  expect(screen.container.querySelector('[aria-label="Open output report"]')).not.toBeNull();
  await act(() =>
    screen.container
      .querySelector<HTMLButtonElement>('[aria-label="Open output artwork"]')!
      .click(),
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("artwork");
});

it("shows local HTML screenshots and opens the artifact in the visible file panel", async () => {
  await using screen = await renderStrip(
    <WorkflowOutputStrip
      threadRef={threadRef}
      resourceThreadId={ThreadId.make("worker")}
      outputs={{ html: ".t3/workflows/out/mascot.html", artwork: "out/eyes.png" }}
      previews={{ html: { status: "ready", attachmentId: "cached-mascot" } }}
      onShowAll={() => {}}
    />,
  );
  await vi.waitFor(() => expect(screen.container.querySelectorAll("img")).toHaveLength(1));
  expect(assetCalls).toContainEqual({ _tag: "attachment", attachmentId: "cached-mascot" });
  expect(assetCalls).toContainEqual({
    _tag: "media-file",
    threadId: "worker",
    path: "out/eyes.png",
  });
  const open = screen.container.querySelector<HTMLButtonElement>(
    '[aria-label="Open output html"]',
  )!;
  expect(open.textContent).toContain("Open HTML");
  await act(() => open.click());
  const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
  expect(
    state.surfaces.some(
      (surface) =>
        surface.kind === "file" && surface.relativePath === ".t3/workflows/out/mascot.html",
    ),
  ).toBe(true);
});

it("opens file chips in the file panel and never treats executable URLs as links", async () => {
  await using screen = await renderStrip(
    <WorkflowOutputStrip
      threadRef={threadRef}
      outputs={{ report: "reports/result.md", note: "javascript:alert(1)" }}
      onShowAll={() => {}}
    />,
  );
  expect(screen.container.querySelector("a")).toBeNull();
  await act(() =>
    screen.container.querySelector<HTMLButtonElement>('[aria-label="Open output report"]')!.click(),
  );
  const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
  expect(
    state.surfaces.some(
      (surface) => surface.kind === "file" && surface.relativePath === "reports/result.md",
    ),
  ).toBe(true);
});

it("shows a plain value as text instead of a file that opens nothing", async () => {
  await using screen = await renderStrip(
    <WorkflowOutputStrip
      threadRef={threadRef}
      outputs={{ validation: "Syntax check passed" }}
      onShowAll={() => {}}
    />,
  );
  const strip = screen.container.querySelector<HTMLElement>("[data-workflow-outputs]")!;
  expect(strip.textContent).toContain("validation:");
  expect(strip.textContent).toContain("Syntax check passed");
  expect(strip.querySelector("button")).toBeNull();
  expect(strip.querySelector("a")).toBeNull();
  expect(strip.querySelector(".lucide-file")).toBeNull();
});

it("wraps the outputs instead of scrolling them sideways", async () => {
  await using screen = await renderStrip(
    <WorkflowOutputStrip
      threadRef={threadRef}
      outputs={{
        site: "https://example.com/",
        "quarterly-report": "reports/q1.md",
        "release-notes": "reports/release.md",
        "design-spec": "reports/design.md",
      }}
      previews={{ site: { status: "ready", attachmentId: "cached-site" } }}
      onShowAll={() => {}}
    />,
    { width: "200px" },
  );
  const strip = screen.container.querySelector<HTMLElement>("[data-workflow-outputs]")!;
  expect(strip.scrollWidth).toBeLessThanOrEqual(strip.clientWidth);
  for (const element of strip.querySelectorAll<HTMLElement>("*")) {
    const overflowX = getComputedStyle(element).overflowX;
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
  }
});

it("loads image resources only once the strip enters the viewport", async () => {
  await using screen = await renderStrip(
    <WorkflowOutputStrip
      threadRef={threadRef}
      outputs={{ artwork: "hero.png" }}
      onShowAll={() => {}}
    />,
    { position: "absolute", top: "10000px" },
  );
  expect(assetCalls.filter(Boolean)).toHaveLength(0);
  screen.container.style.top = "0";
  await vi.waitFor(() => expect(screen.container.querySelector("img")).not.toBeNull());
});

vi.mock("./WorkflowOutputPreviewButton", () => ({ WorkflowOutputPreviewButton: () => null }));
