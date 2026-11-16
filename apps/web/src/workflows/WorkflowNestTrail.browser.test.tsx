import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { WorkflowNestTrail } from "./WorkflowNestTrail";

const names: Record<string, string> = {
  launch: "Launch site",
  "brand-kit": "Brand Kit",
  logo: "Logo",
};
const nameOf = (slug: string) => names[slug] ?? slug;

it("renders nothing until the panel has opened a nested workflow", async () => {
  await using screen = await render(
    <WorkflowNestTrail trail={[]} current="launch" nameOf={nameOf} onBackTo={() => {}} />,
    { router: false },
  );
  expect(screen.container.querySelector('nav[aria-label="Workflow path"]')).toBeNull();
});

it("walks back to any ancestor from the trail, keyboard reachable", async () => {
  const onBackTo = vi.fn();
  await using _screen = await render(
    <WorkflowNestTrail
      trail={["launch", "brand-kit"]}
      current="logo"
      nameOf={nameOf}
      onBackTo={onBackTo}
    />,
    { router: false },
  );
  const path = page.getByRole("navigation", { name: "Workflow path" });
  await expect.element(path.getByText("Logo")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Back to Brand Kit" }));
  expect(onBackTo).toHaveBeenLastCalledWith(1);
  await userEvent.click(path.getByRole("button", { name: "Launch site" }));
  expect(onBackTo).toHaveBeenLastCalledWith(0);
});
