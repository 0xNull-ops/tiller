import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type AssetResource } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { act, render, type Screen } from "../../test/render";
import { ExpandedImageDialogHost } from "../components/chat/ExpandedImageDialog";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { WorkflowOutputDetails } from "./WorkflowOutputDetails";
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

function renderDetails(ui: ReactNode) {
  assetCalls.length = 0;
  const container = document.createElement("div");
  container.style.width = "500px";
  return render(ui, { container });
}

function outputRow(screen: Screen, name: string) {
  const row = screen.container.querySelector<HTMLElement>(`[data-workflow-output="${name}"]`);
  if (!row) throw new Error(`No output row named ${name}`);
  return row;
}
function openButton(screen: Screen, name: string) {
  const button = outputRow(screen, name).querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error(`No open action for output ${name}`);
  return button;
}
function openSurfaces() {
  return selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces;
}

it("names the output, its type and its full path, and opens the file in the panel", async () => {
  await using screen = await renderDetails(
    <AppAtomRegistryProvider>
      <WorkflowOutputDetails
        threadRef={threadRef}
        outputs={{ report: "reports/result.md", site: "out/mascot.html" }}
      />
    </AppAtomRegistryProvider>,
  );

  const report = outputRow(screen, "report");
  expect(report.textContent).toContain("report");
  expect(report.textContent).toContain("MD");
  expect(report.textContent).toContain("reports/result.md");

  await act(() => openButton(screen, "report").click());
  expect(
    openSurfaces().some(
      (surface) => surface.kind === "file" && surface.relativePath === "reports/result.md",
    ),
  ).toBe(true);

  await act(() => openButton(screen, "site").click());
  expect(
    openSurfaces().some(
      (surface) => surface.kind === "file" && surface.relativePath === "out/mascot.html",
    ),
  ).toBe(true);
});

it("shows a captured HTML artifact and opens it in the file panel", async () => {
  await using screen = await renderDetails(
    <AppAtomRegistryProvider>
      <WorkflowOutputDetails
        threadRef={threadRef}
        outputs={{ html: ".t3/workflows/out/mascot.html" }}
        previews={{ html: { status: "ready", attachmentId: "cached-mascot" } }}
      />
    </AppAtomRegistryProvider>,
  );

  const html = outputRow(screen, "html");
  expect(html.textContent).toContain("HTML");
  expect(html.querySelector("img")).not.toBeNull();
  expect(assetCalls).toContainEqual({ _tag: "attachment", attachmentId: "cached-mascot" });

  await act(() => openButton(screen, "html").click());
  expect(
    openSurfaces().some(
      (surface) =>
        surface.kind === "file" && surface.relativePath === ".t3/workflows/out/mascot.html",
    ),
  ).toBe(true);
});

it("keeps prose outputs readable instead of offering them as files", async () => {
  await using screen = await renderDetails(
    <AppAtomRegistryProvider>
      <WorkflowOutputDetails
        threadRef={threadRef}
        outputs={{ note: "wrote reports/result.md and it passed" }}
      />
    </AppAtomRegistryProvider>,
  );

  const note = outputRow(screen, "note");
  expect(note.textContent).toContain("wrote reports/result.md and it passed");
  expect(note.querySelector("button")).toBeNull();
});

it("previews an image against the thread that worked the step", async () => {
  await using screen = await renderDetails(
    <AppAtomRegistryProvider>
      <WorkflowOutputDetails
        threadRef={threadRef}
        resourceThreadId={ThreadId.make("worker")}
        outputs={{ artwork: "design/hero.png" }}
      />
      <ExpandedImageDialogHost threadKey={scopedThreadKey(threadRef)} />
    </AppAtomRegistryProvider>,
  );

  expect(assetCalls).toContainEqual({
    _tag: "media-file",
    threadId: "worker",
    path: "design/hero.png",
  });
  await act(() => openButton(screen, "artwork").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("artwork");
});

it("links a URL output and reports a missing screenshot", async () => {
  await using screen = await renderDetails(
    <AppAtomRegistryProvider>
      <WorkflowOutputDetails
        threadRef={threadRef}
        outputs={{ site: "https://example.com/" }}
        previews={{ site: { status: "unavailable" } }}
      />
    </AppAtomRegistryProvider>,
  );

  const site = outputRow(screen, "site");
  const link = site.querySelector<HTMLAnchorElement>("a");
  expect(link?.href).toBe("https://example.com/");
  expect(link?.target).toBe("_blank");
  expect(site.textContent).toContain("Screenshot unavailable");
});

vi.mock("./WorkflowOutputPreviewButton", () => ({ WorkflowOutputPreviewButton: () => null }));
