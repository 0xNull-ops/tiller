import type { WorkflowDefinition, WorkflowStep } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { SampleCanvas } from "../fork/tour/SampleCanvas";

/** A generated workflow: a chain of skill steps, each reading the step before it. */
function generated(count: number): WorkflowDefinition {
  const steps: WorkflowStep[] = Array.from({ length: count }, (_, index) => ({
    id: `step-${index}`,
    kind: "skill",
    skill: `skill-${index}`,
    title: `Step ${index}`,
  })) as WorkflowStep[];
  return { version: 3, name: "Generated", steps } as WorkflowDefinition;
}

it("draws every step of a generated 200-step workflow on the canvas", async () => {
  await using screen = await render(
    <div style={{ height: 800, width: 1200, display: "flex", flexDirection: "column" }}>
      <SampleCanvas run={null} editPreview={false} definition={generated(200)} />
    </div>,
    { router: false },
  );
  await expect.element(page.getByText("Step 199")).toBeInTheDocument();
  const cards = screen.container.querySelectorAll("[data-workflow-node]");
  expect(cards.length).toBeGreaterThanOrEqual(200);
});
