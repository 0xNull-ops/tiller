import type {
  WorkflowDefinition,
  WorkflowListing,
  WorkflowRun,
  WorkflowStep,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { WorkflowOutline } from "./WorkflowOutline";
import type { OutlineRow } from "./outlineRows";
import { workflowRunFixture } from "./workflowTestFixture";

/** A generated workflow: every tenth step names a skill that isn't installed. */
function generated(count: number): WorkflowDefinition {
  const steps: WorkflowStep[] = Array.from({ length: count }, (_, index) => ({
    id: `step-${index}`,
    kind: "skill",
    skill: index % 10 === 0 ? `missing-${index}` : `skill-${index}`,
    title: `Step ${index}`,
  })) as WorkflowStep[];
  return { version: 3, name: "Generated", steps } as WorkflowDefinition;
}

const run = {
  ...workflowRunFixture,
  steps: [
    { stepId: "step-0", status: "done", attempts: 1, threadId: null },
    { stepId: "step-1", status: "running", attempts: 1, threadId: null },
  ],
} as WorkflowRun;

function listing(workflow: string, steps: WorkflowStep[]): WorkflowListing {
  return {
    projectId: workflowRunFixture.projectId,
    workflow,
    definition: { version: 3, name: workflow, steps } as WorkflowDefinition,
    problem: null,
    missingSkills: [],
    skills: [],
    blockers: [],
    updatedAt: workflowRunFixture.startedAt,
    scratch: false,
    editedByThreadId: null,
  } as WorkflowListing;
}

function outline(props: {
  definition: WorkflowDefinition;
  workflows?: WorkflowListing[];
  missingSkills?: string[];
  onSelectRow?: (row: OutlineRow) => void;
}) {
  return (
    <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
      <WorkflowOutline
        workflow="big"
        definition={props.definition}
        workflows={props.workflows ?? []}
        runFor={(slug) => (slug === "big" ? run : null)}
        missingSkills={props.missingSkills ?? []}
        selectedStepId={null}
        onSelectRow={props.onSelectRow ?? (() => {})}
      />
    </div>
  );
}

it("keeps a 500-step outline virtualized: only the rows in view are in the DOM", async () => {
  await using screen = await render(outline({ definition: generated(500) }), { router: false });
  await expect.element(page.getByText("500 steps")).toBeInTheDocument();
  const rendered = screen.container.querySelectorAll('[role="treeitem"]').length;
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(60);
});

it("moves focus with the arrow keys and selects the focused row with Enter", async () => {
  const onSelectRow = vi.fn();
  await using screen = await render(outline({ definition: generated(500), onSelectRow }), {
    router: false,
  });
  const first = screen.container.querySelector<HTMLElement>('[data-outline-index="0"]')!;
  first.focus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{End}");
  await vi.waitFor(() =>
    expect(document.activeElement?.getAttribute("data-outline-key")).toBe("step-499"),
  );
  await userEvent.keyboard("{Enter}");
  expect(onSelectRow).toHaveBeenLastCalledWith(expect.objectContaining({ key: "step-499" }));
  await userEvent.keyboard("{Home}");
  await vi.waitFor(() =>
    expect(document.activeElement?.getAttribute("data-outline-key")).toBe("step-0"),
  );
  await userEvent.keyboard("{Enter}");
  expect(onSelectRow).toHaveBeenLastCalledWith(expect.objectContaining({ key: "step-0" }));
});

it("searches names and skills and filters by status", async () => {
  const missingSkills = Array.from({ length: 50 }, (_, index) => `missing-${index * 10}`);
  await using screen = await render(outline({ definition: generated(500), missingSkills }), {
    router: false,
  });
  await userEvent.fill(page.getByRole("searchbox", { name: "Search steps" }), "Step 49");
  await expect.element(page.getByText("11 steps")).toBeInTheDocument();
  await userEvent.fill(page.getByRole("searchbox", { name: "Search steps" }), "");
  await userEvent.selectOptions(
    page.getByRole("combobox", { name: "Filter steps by status" }),
    "missing-skill",
  );
  await expect.element(page.getByText("50 steps")).toBeInTheDocument();
  await userEvent.selectOptions(
    page.getByRole("combobox", { name: "Filter steps by status" }),
    "running",
  );
  await expect.element(page.getByText("1 step", { exact: true })).toBeInTheDocument();
  expect(screen.container.textContent).toContain("Step 1");
});

it("expands a nested workflow with the arrow keys and collapses it again", async () => {
  const definition = {
    version: 3,
    name: "Big",
    steps: [
      { id: "intro", kind: "skill", skill: "research", title: "Intro" },
      { id: "kit", kind: "workflow", workflow: "brand-kit", title: "Brand kit" },
    ],
  } as WorkflowDefinition;
  const kit = listing("brand-kit", [
    { id: "palette", kind: "skill", skill: "design", title: "Palette" },
  ] as WorkflowStep[]);
  await using screen = await render(outline({ definition, workflows: [kit] }), { router: false });
  const kitRow = screen.container.querySelector<HTMLElement>('[data-outline-key="kit"]')!;
  kitRow.focus();
  await userEvent.keyboard("{ArrowRight}");
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[data-outline-key="kit/palette"]')).not.toBeNull(),
  );
  expect(kitRow.getAttribute("aria-expanded")).toBe("true");
  await userEvent.keyboard("{ArrowLeft}");
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[data-outline-key="kit/palette"]')).toBeNull(),
  );
  expect(kitRow.getAttribute("aria-expanded")).toBe("false");
});
