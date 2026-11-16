import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { WorkflowExpandedSteps } from "./WorkflowExpandedSteps";
import { layoutExpansion, type NestedExpansion } from "./workflowExpansion";

const cardHeight = 112;
const cardWidth = 200;
const box = layoutExpansion({ cardWidth, cardHeight, count: 2 });
const expansion: NestedExpansion = {
  nodeId: "run:kit-step",
  stepId: "kit-step",
  workflow: "brand-kit",
  name: "Brand Kit",
  box,
  cardHeight,
  steps: [
    {
      stepId: "research",
      title: "Research",
      skill: "research",
      missingSkill: false,
      status: "done",
      x: 12,
      y: 142,
      width: 176,
      height: 56,
    },
    {
      stepId: "logo",
      title: "Logo",
      skill: "logo-generator",
      missingSkill: true,
      status: "running",
      x: 200,
      y: 142,
      width: 176,
      height: 56,
    },
  ],
};

it("lists a nested workflow's steps with their skill, missing-skill and run status", async () => {
  await using screen = await render(
    <div style={{ position: "relative", width: 800, height: 400 }}>
      <WorkflowExpandedSteps expansion={expansion} origin={{ x: 0, y: 0 }} onOpenStep={() => {}} />
    </div>,
    { router: false },
  );
  await expect
    .element(page.getByRole("region", { name: "Steps in Brand Kit" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("Skill missing")).toBeInTheDocument();
  expect(screen.container.textContent).toContain("Done");
  expect(screen.container.textContent).toContain("Running");
});

it("opens a step in its own workflow when it is clicked, and cannot be dragged or edited here", async () => {
  const onOpenStep = vi.fn();
  await using _screen = await render(
    <div style={{ position: "relative", width: 800, height: 400 }}>
      <WorkflowExpandedSteps
        expansion={expansion}
        origin={{ x: 0, y: 0 }}
        onOpenStep={onOpenStep}
      />
    </div>,
    { router: false },
  );
  await userEvent.click(page.getByRole("button", { name: /^Logo/ }));
  expect(onOpenStep).toHaveBeenCalledWith("brand-kit", "logo");
});
