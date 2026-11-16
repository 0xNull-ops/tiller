import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { render } from "../../test/render";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { WorkflowOutputDetails } from "./WorkflowOutputDetails";
import { WorkflowOutputStrip } from "./WorkflowOutputStrip";
import "~/index.css";

const state = vi.hoisted(() => ({
  available: true,
  canRead: true,
  canOperate: true,
  create: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../browser/previewRuntime", () => ({
  usePreviewAvailable: () => state.available,
  isPreviewAvailableFor: () => state.available,
  previewRuntimeFor: () => "server",
}));
vi.mock("../browser/browserDefaults", () => ({
  resolveBrowserDefaults: async () => ({}),
  browserDefaultOpenProfileId: () => "default",
  browserDefaultOpenViewport: () => ({ _tag: "fill" }),
}));
vi.mock("../state/filesystem", () => ({
  useFilesystemReadAccess: () => ({ canReadFiles: state.canRead }),
}));
vi.mock("../state/environments", () => ({
  useEnvironmentHttpBaseUrl: () => "https://environment.test",
}));
vi.mock("../state/preview", async () => {
  const { Atom } = await import("effect/reactivity");
  return { previewEnvironment: { open: { permissionAtom: () => Atom.make(state.canOperate) } } };
});
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.open }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.create }));
vi.mock("../assets/assetUrls", () => ({
  resolveAssetUrl,
  useAssetUrlState: () => ({ _tag: "Loading" }),
  useAssetUrlRefresh: () => async () => null,
}));

const threadRef = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("driver"));
const worker = ThreadId.make("worker");
function setup() {
  state.available = true;
  state.canRead = true;
  state.canOperate = true;
  state.create
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ relativeUrl: "/api/assets/signed/report.html" }));
  const snapshot: PreviewSessionSnapshot = {
    threadId: threadRef.threadId,
    tabId: "output-tab",
    navStatus: {
      _tag: "Loading",
      url: "https://environment.test/api/assets/signed/report.html",
      title: "",
    },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-10-22T12:00:00.000Z",
  };
  state.open.mockReset().mockResolvedValue(AsyncResult.success(snapshot));
  useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
}

it.each(["/outside/index.html", "/outside/report.pdf", "reports/index.html"])(
  "previews %s in the visible thread using the producer's file context",
  async (path) => {
    setup();
    await using screen = await render(
      <WorkflowOutputDetails
        threadRef={threadRef}
        resourceThreadId={worker}
        outputs={{ report: path }}
      />,
    );
    await expect.element(screen.getByRole("button", { name: "Open output report" })).toBeVisible();
    await screen.getByRole("button", { name: "Preview output report" }).click();
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledOnce());
    expect(state.create).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { resource: { _tag: "media-file", threadId: worker, path } },
    });
    expect(state.open).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: threadRef.environmentId,
        input: expect.objectContaining({
          threadId: threadRef.threadId,
          url: "https://environment.test/api/assets/signed/report.html",
        }),
      }),
    );
    expect(
      selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        threadRef,
      ).surfaces.some((surface) => surface.kind === "preview"),
    ).toBe(true);
  },
);

it.each(["unavailable", "no read grant", "no preview grant"])(
  "hides Preview when %s while keeping Open",
  async (reason) => {
    setup();
    if (reason === "unavailable") state.available = false;
    if (reason === "no read grant") state.canRead = false;
    if (reason === "no preview grant") state.canOperate = false;
    await using screen = await render(
      <WorkflowOutputDetails threadRef={threadRef} outputs={{ report: "/outside/report.pdf" }} />,
    );
    await expect
      .element(screen.getByRole("button", { name: "Preview output report" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Open output report" })).toBeVisible();
    expect(state.create).not.toHaveBeenCalled();
  },
);

it("previews HTML from the canvas strip and shows asset failures", async () => {
  setup();
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("File is missing"))));
  await using screen = await render(
    <WorkflowOutputStrip
      threadRef={threadRef}
      resourceThreadId={worker}
      outputs={{ site: "/outside/index.html" }}
      onShowAll={() => {}}
    />,
  );
  await screen.getByRole("button", { name: "Preview output site" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("File is missing");
  expect(state.open).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Preview output site" }).click();
  await vi.waitFor(() => expect(state.open).toHaveBeenCalledOnce());
});
