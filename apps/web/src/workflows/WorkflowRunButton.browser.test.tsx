import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { WorkflowRunButton } from "./WorkflowRunButton";

it("runs the workflow in the current chat from the Run button", async () => {
  const onRun = vi.fn();
  await using screen = await render(
    <WorkflowRunButton disabled={false} disabledReason={null} busy={false} onRun={onRun} />,
  );

  await userEvent.click(screen.container.querySelector("button")!);

  expect(onRun).toHaveBeenCalledExactlyOnceWith();
  expect(screen.container.textContent).toContain("Run");
  expect(screen.container.querySelector('[aria-label="Run in another chat…"]')).toBeNull();
});
