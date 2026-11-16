import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";

import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { render } from "../../test/render";

const setup = vi.hoisted(() => ({ addToast: vi.fn(), run: vi.fn() }));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: { input?: { _tag: string } } | null) => ({
    data:
      query?.input?._tag === "preferences"
        ? { _tag: "preferences", preferences: { workflowFirstForNewThreads: false } }
        : { _tag: "workflowFirst", enabled: false },
    refresh: vi.fn(),
  }),
}));
vi.mock("./workflowState", () => ({
  workflowRead: (input: unknown) => input,
  useWorkflowEdit: () => ({ canEdit: true, busy: false, error: null, run: setup.run }),
}));
vi.mock("./useWorkflowLiveRefresh", () => ({ useWorkflowLiveRefresh: vi.fn() }));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: setup.addToast },
}));

import { WorkflowFirstComposerControl } from "./WorkflowFirstComposerControl";
import { draftWorkflowFirstChoice, moveDraftWorkflowFirstChoice } from "./workflowFirstDraftState";

it("shows the Workflow-first RPC reason when an update fails", async () => {
  setup.addToast.mockClear();
  setup.run.mockReset().mockImplementation(async (_input, onFailure) => {
    onFailure?.("Thread not found.");
    return null;
  });
  await using screen = await render(
    <WorkflowFirstComposerControl
      environmentId={"environment-test" as EnvironmentId}
      threadId={"thread-test" as ThreadId}
      size="sm"
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Workflow-first" }));

  expect(setup.run).toHaveBeenCalledExactlyOnceWith(
    {
      _tag: "workflowFirstSet",
      threadId: "thread-test",
      enabled: true,
    },
    expect.any(Function),
  );
  expect(setup.addToast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "error",
      title: "Could not update Workflow-first",
      description: "Thread not found.",
    }),
  );
});

it("keeps an explicit draft choice for the first send", async () => {
  const threadId = "thread-draft-choice" as ThreadId;
  await using screen = await render(
    <WorkflowFirstComposerControl
      environmentId={"environment-test" as EnvironmentId}
      threadId={threadId}
      isDraft
      size="sm"
    />,
  );

  const toggle = screen.getByRole("button", { name: "Workflow-first" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(toggle);
  expect(draftWorkflowFirstChoice(threadId)).toBe(true);
  await expect
    .element(screen.getByRole("button", { name: "Workflow-first" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(draftWorkflowFirstChoice(threadId)).toBe(true);
  const retryThreadId = "thread-draft-retry" as ThreadId;
  moveDraftWorkflowFirstChoice(threadId, retryThreadId);
  expect(draftWorkflowFirstChoice(threadId)).toBeUndefined();
  expect(draftWorkflowFirstChoice(retryThreadId)).toBe(true);
});
