import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import type { RunGraphNode } from "./runGraph";
import { WorkflowCanvasCard } from "./WorkflowCanvasCard";

const node: RunGraphNode = {
  id: "run-one:run-brand-kit",
  kind: "step",
  workflowStepId: "run-brand-kit",
  nestedWorkflow: "brand-kit",
  title: "Run brand kit",
  detail: "workflow brand-kit",
  status: "idle",
  childThreadId: null,
};

function card(
  onOpenNested: (() => void) | undefined,
  extra: { onToggleExpand?: () => void; expanded?: boolean } = {},
) {
  return (
    <WorkflowCanvasCard
      node={node}
      style={{ left: 0, top: 0, width: 240, height: 96 }}
      onOpen={null}
      actions={null}
      error=""
      worker={null}
      appearing={false}
      onAppearanceEnd={() => {}}
      onSelectDetail={() => {}}
      onOpenNested={onOpenNested}
      {...extra}
    />
  );
}

it("opens a nested card's workflow on double-click", async () => {
  const onOpenNested = vi.fn();
  await using _screen = await render(card(onOpenNested), { router: false });
  await userEvent.dblClick(page.getByText("Run brand kit"));
  expect(onOpenNested).toHaveBeenCalled();
});

it("opens the same action from the card's menu and from a right-click", async () => {
  const onOpenNested = vi.fn();
  await using _screen = await render(card(onOpenNested), { router: false });
  await userEvent.click(page.getByRole("button", { name: "Workflow actions for Run brand kit" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Open workflow" }));
  expect(onOpenNested).toHaveBeenCalledTimes(1);
});

it("offers the same menu from a right-click on the card", async () => {
  const onOpenNested = vi.fn();
  await using _screen = await render(card(onOpenNested), { router: false });
  page
    .getByText("Run brand kit")
    .element()
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await userEvent.click(page.getByRole("menuitem", { name: "Open workflow" }));
  expect(onOpenNested).toHaveBeenCalledTimes(1);
});

it("has no open action on a card that is not a nested workflow", async () => {
  await using _screen = await render(card(undefined), { router: false });
  expect(document.querySelector('[aria-label="Workflow actions for Run brand kit"]')).toBeNull();
});

it("shows and hides the card's steps from its toggle, which reports whether they are open", async () => {
  const onToggleExpand = vi.fn();
  await using _screen = await render(
    card(() => {}, { onToggleExpand, expanded: false }),
    {
      router: false,
    },
  );
  const toggle = page.getByRole("button", { name: "Show steps of Run brand kit" });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(toggle);
  expect(onToggleExpand).toHaveBeenCalledTimes(1);
});

it("shows the hide label while the steps are open", async () => {
  await using _screen = await render(
    card(() => {}, { onToggleExpand: () => {}, expanded: true }),
    {
      router: false,
    },
  );
  await expect
    .element(page.getByRole("button", { name: "Hide steps of Run brand kit" }))
    .toHaveAttribute("aria-expanded", "true");
});
