import {
  EnvironmentId,
  ProjectId,
  type WorkflowListing,
  type WorkflowNestedStep,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";
import { WorkflowNestedStepFields } from "./WorkflowNestedStepFields";
import { workflowRunsLive } from "./workflowState";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");

const state = vi.hoisted(() => ({
  runsAtom: null as unknown,
  runs: null as unknown,
}));

// Only the query layer is faked. The live runs stream stays waiting after its first chunk, as the
// real subscription does, and the real `useWorkflowRuns` reads that result.
vi.mock(import("../state/query"), () => ({
  useEnvironmentQuery: ((atom: unknown) => (atom === state.runsAtom ? state.runs : null)) as never,
}));

const child: WorkflowListing = {
  projectId,
  workflow: "brand-kit",
  scratch: false,
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-11-01T00:00:00.000Z",
  editedByThreadId: null,
  definition: {
    version: 3,
    name: "Brand Kit",
    steps: [{ id: "research", kind: "skill", skill: "research", title: "Research" }],
    inputs: [{ id: "brand", label: "Brand", kind: "text" }],
  },
} as never;

const nested: WorkflowNestedStep = {
  id: "run-brand-kit",
  kind: "workflow",
  workflow: "brand-kit",
  inputs: {},
} as never;

function liveRuns(workflows: ReadonlyArray<WorkflowListing>, runs: ReadonlyArray<unknown> = []) {
  return {
    data: { workflows, runs },
    dataUpdatedAt: 1,
    error: null,
    failure: null,
    isPending: true,
    isSuccess: true,
    refresh: () => {},
  };
}

const brandKit: WorkflowListing = {
  ...child,
  definition: {
    ...child.definition!,
    steps: [
      { id: "research", kind: "skill", skill: "research", title: "Research", note: "Competitors" },
      { id: "logo", kind: "skill", skill: "logo-generator", title: "Logo" },
      { id: "brand-page", kind: "skill", skill: "frontend-design", title: "Brand page" },
    ],
  },
  missingSkills: ["logo-generator"],
} as never;

const childRun = {
  id: "run-brand-kit",
  projectId,
  workflow: "brand-kit",
  status: "running",
  startedAt: "2026-11-01T10:00:00.000Z",
  definition: brandKit.definition,
  skills: [],
  steps: [
    { stepId: "research", status: "done", attempts: 1, threadId: null },
    { stepId: "logo", status: "waiting", attempts: 0, threadId: null },
  ],
} as never;

function renderNested(
  overrides: Partial<{
    workflow: string;
    onOpen: (workflow: string, stepId?: string) => void;
  }> = {},
  step: WorkflowNestedStep = nested,
) {
  return render(
    <WorkflowNestedStepFields
      environmentId={environmentId}
      projectId={projectId}
      workflow={overrides.workflow ?? "parent-flow"}
      parentInputs={[]}
      step={step}
      onChange={async () => true}
      disabled={false}
      onOpenWorkflow={overrides.onOpen ?? (() => {})}
    />,
    { router: false },
  );
}

it("shows the child's inputs once the live runs snapshot arrives, not a loading line", async () => {
  state.runsAtom = workflowRunsLive(environmentId);
  state.runs = liveRuns([child]);
  await using screen = await renderNested();
  await expect.element(page.getByLabelText("Mapping for brand")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("Loading");
});

it("opens the referenced workflow from the primary action", async () => {
  state.runsAtom = workflowRunsLive(environmentId);
  state.runs = liveRuns([child]);
  const onOpen = vi.fn();
  await using _screen = await renderNested({ onOpen });
  await userEvent.click(page.getByRole("button", { name: "Open workflow", exact: true }));
  expect(onOpen).toHaveBeenCalledWith("brand-kit");
});

it("lists the child's steps read-only with missing-skill badges and live status, then edits one in its own workflow", async () => {
  state.runsAtom = workflowRunsLive(environmentId);
  state.runs = liveRuns([brandKit], [childRun]);
  const onOpen = vi.fn();
  await using screen = await renderNested({ onOpen });
  const steps = page.getByRole("list", { name: "Steps in Brand Kit" });
  await expect.element(steps.getByText("Skill missing")).toBeInTheDocument();
  expect(screen.container.textContent).toContain("Done");
  expect(screen.container.textContent).toContain("Needs you");
  await userEvent.click(steps.getByRole("button", { name: /Research/ }));
  await expect.element(page.getByRole("region", { name: "Selected step" })).toBeInTheDocument();
  expect(page.getByLabelText("Mapping for brand").element()).toBeTruthy();
  await userEvent.click(page.getByRole("button", { name: "Edit in Brand Kit" }));
  expect(onOpen).toHaveBeenCalledWith("brand-kit", "research");
});

it("keeps Open workflow disabled for a step that runs its own workflow", async () => {
  state.runsAtom = workflowRunsLive(environmentId);
  state.runs = liveRuns([child]);
  await using screen = await renderNested({ workflow: "brand-kit" });
  await expect
    .element(page.getByRole("button", { name: "Open workflow", exact: true }))
    .toBeDisabled();
  expect(screen.container.textContent).toContain("runs the workflow it’s in");
});

it("says a missing reference can't be opened and names the fix", async () => {
  state.runsAtom = workflowRunsLive(environmentId);
  state.runs = liveRuns([]);
  await using screen = await renderNested({}, { ...nested, workflow: "gone-flow" } as never);
  await expect
    .element(page.getByRole("button", { name: "Open workflow", exact: true }))
    .toBeDisabled();
  expect(screen.container.textContent).toContain("isn’t in this project any more");
});
