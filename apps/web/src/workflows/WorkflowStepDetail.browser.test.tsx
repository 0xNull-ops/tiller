import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { act, render } from "../../test/render";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { WorkflowStepDetail } from "./WorkflowStepDetail";
import { workflowRunFixture } from "./workflowTestFixture";
import "~/index.css";

const edit = vi.hoisted(() => ({ run: vi.fn(), canEdit: true, busy: false, error: null }));
vi.mock("./workflowState", () => ({ useWorkflowEdit: () => edit }));
const setup = () => {
  edit.run.mockReset();
};

vi.mock("../assets/assetUrls", () => ({
  useAssetUrlState: () => ({ _tag: "Loading" }),
  useAssetUrlRefresh: () => async () => null,
}));

const threadRef = scopeThreadRef(EnvironmentId.make("remote"), ThreadId.make("driver"));
const step = { id: "build", skill: "frontend-design", title: "Build" } as const;

function renderDetail(outputs: Record<string, string>) {
  return render(
    <WorkflowStepDetail
      ref={null}
      step={step}
      runState={{
        stepId: "build",
        status: "done",
        threadId: ThreadId.make("worker"),
        attempts: 1,
        outputs,
      }}
      checks={[]}
      configuredChecks={[]}
      missingSkills={[]}
      definitionModel={undefined}
      threadShell={null}
      labels={{
        chatAgentInThisChat: "chat agent, in this chat",
        chatAgent: "chat agent",
        subagent: "subagent",
        unassigned: "Unassigned",
      }}
      driverThreadId={ThreadId.make("driver")}
      onOpenThread={vi.fn()}
      threadRef={threadRef}
    />,
  );
}

it("shows the step outputs as openable artifacts", async () => {
  setup();
  await using screen = await renderDetail({ artifact: "out/mascot.html" });

  const row = screen.container.querySelector<HTMLElement>('[data-workflow-output="artifact"]');
  expect(row?.textContent).toContain("out/mascot.html");
  const open = row?.querySelector<HTMLButtonElement>("button");
  if (!open) throw new Error("The artifact has no open action");
  await act(() => open.click());
  const surfaces = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  ).surfaces;
  expect(
    surfaces.some(
      (surface) => surface.kind === "file" && surface.relativePath === "out/mascot.html",
    ),
  ).toBe(true);
});

it("keeps a reported note readable instead of offering it as a file", async () => {
  setup();
  await using screen = await renderDetail({ note: "the mascot page is ready" });

  const row = screen.container.querySelector<HTMLElement>('[data-workflow-output="note"]');
  expect(row?.textContent).toContain("the mascot page is ready");
  expect(row?.querySelector("button")).toBeNull();
});

it("offers a checks-only retry beside a failed check and removes it after success", async () => {
  setup();
  const check = { kind: "file", path: "/outside/index.html" } as const;
  const detail = (ok: boolean) => (
    <WorkflowStepDetail
      ref={null}
      step={{ ...step, checks: [check] }}
      runState={{
        stepId: "build",
        status: ok ? "done" : "ready",
        attempts: 1,
        threadId: threadRef.threadId,
        checks: [{ check, ok, message: ok ? "exists" : "is missing" }],
      }}
      checks={[{ check, ok, message: ok ? "exists" : "is missing" }]}
      configuredChecks={[check]}
      missingSkills={[]}
      definitionModel={undefined}
      threadShell={null}
      labels={{
        chatAgentInThisChat: "chat agent",
        chatAgent: "chat agent",
        subagent: "subagent",
        unassigned: "Unassigned",
      }}
      driverThreadId={threadRef.threadId}
      onOpenThread={() => {}}
      threadRef={threadRef}
      run={workflowRunFixture}
    />
  );
  await using screen = await render(detail(false));
  await expect.element(screen.getByText("Failed: is missing")).toBeVisible();
  await screen.getByRole("button", { name: "Run checks again" }).click();
  expect(edit.run).toHaveBeenCalledWith({
    _tag: "stepChecksRun",
    runId: workflowRunFixture.id,
    stepId: "build",
  });
  await screen.rerender(detail(true));
  await expect.element(screen.getByText("Passed: exists")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Run checks again" }))
    .not.toBeInTheDocument();
});

vi.mock("./WorkflowOutputPreviewButton", () => ({ WorkflowOutputPreviewButton: () => null }));
