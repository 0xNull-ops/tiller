import { EnvironmentId, ProjectId, type WorkflowPreferences } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { BuiltinGallery } from "./BuiltinGallery";

const state = vi.hoisted(() => ({
  use: vi.fn(),
  edit: vi.fn(),
  navigate: vi.fn(),
  prefs: null as WorkflowPreferences | null,
  allowed: true,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("@t3tools/client-runtime/state/workflowTemplates"), () => ({
  createWorkflowTemplateCommands: (() => ({
    use: { permissionAtom: () => Atom.make(state.allowed) },
    list: {},
  })) as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.use) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShells: () => [],
}));
vi.mock(import("../../workflows/workflowState"), async (original) => ({
  ...(await original()),
  workflowRead: ((args: unknown) => args) as never,
  useWorkflowEdit: () => ({
    canEdit: state.allowed,
    busy: false,
    error: null,
    clearError: () => {},
    run: state.edit,
  }),
  useWorkflowRuns: (() => ({ workflows: [] })) as never,
}));
vi.mock(import("../../workflows/useWorkflowLiveRefresh"), () => ({
  useWorkflowLiveRefresh: () => {},
}));
vi.mock(import("../../state/query"), () => ({
  useEnvironmentQuery: ((query: { input: { _tag: string } }) => {
    const [, refresh] = useState(0);
    return {
      data:
        query.input._tag === "preferences"
          ? { _tag: "preferences", preferences: state.prefs }
          : { _tag: "skills", skills: [{ name: "research" }, { name: "copywriting" }] },
      refresh: () => refresh((value) => value + 1),
    };
  }) as never,
}));
const projects = [
  { environmentId: EnvironmentId.make("local"), id: ProjectId.make("site"), title: "Site" },
];
function setup() {
  state.allowed = true;
  state.use.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      slug: "landing-page-in-an-afternoon",
      path: ".t3/workflows/landing-page-in-an-afternoon.json",
    },
  });
  state.navigate.mockReset();
  state.prefs = {
    pinnedSkills: [],
    pinnedWorkflows: [],
    showBuiltinWorkflows: true,
    hiddenBuiltins: [],
    maxSubagentModels: 4,
    workflowFirstForNewThreads: false,
  };
  state.edit.mockReset().mockImplementation((input: { hiddenBuiltins: string[] }) => {
    state.prefs = { ...state.prefs!, hiddenBuiltins: input.hiddenBuiltins };
    return Promise.resolve({});
  });
}
function Gallery(props: { readonly projects?: typeof projects }) {
  return (
    <div style={{ height: 800, display: "flex", flexDirection: "column" }}>
      <BuiltinGallery
        items={[]}
        projects={props.projects ?? projects}
        templatesOnly
        renderItem={() => null}
      />
    </div>
  );
}

it("hides a template, restores it through Show hidden, and copies through a read-only preview", async () => {
  setup();
  await using screen = await render(<Gallery />);
  const card = screen.getByRole("article", { name: "Landing Page in an Afternoon", exact: true });
  await expect.element(card.getByText("Needs 3 skills · Install all")).toBeVisible();
  await userEvent.click(card.getByRole("button", { name: "Hide", exact: true }));
  await expect.element(card).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show hidden", exact: true }));
  await expect.element(card).toBeInTheDocument();
  await userEvent.click(card.getByRole("button", { name: "Unhide", exact: true }));
  await expect
    .element(screen.getByRole("button", { name: "Show hidden", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(card.getByRole("button", { name: "Open", exact: true }));
  await expect.element(page.getByRole("dialog")).toBeVisible();
  expect(document.querySelector('[data-tour="add-step"]')).toBeNull();
  expect(state.use).not.toHaveBeenCalled();
  await userEvent.click(
    page.getByRole("dialog").getByRole("button", { name: "Use template", exact: true }),
  );
  await vi.waitFor(() =>
    expect(state.use).toHaveBeenCalledWith({
      environmentId: projects[0]!.environmentId,
      input: { templateId: "landing-page-in-an-afternoon", projectId: projects[0]!.id },
    }),
  );
  await vi.waitFor(() =>
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ slug: "landing-page-in-an-afternoon" }),
      }),
    ),
  );
});

it("cancels schedule setup after copying without creating a scheduled task", async () => {
  setup();
  state.use.mockResolvedValue({
    _tag: "Success",
    value: {
      slug: "weekly-seo-check-up",
      path: ".t3/workflows/weekly-seo-check-up.json",
      suggestedSchedule: {
        schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1] },
        knobs: {},
      },
    },
  });
  await using screen = await render(<Gallery />);
  await userEvent.fill(screen.getByRole("searchbox", { name: "Search workflows" }), "Weekly SEO");
  await userEvent.click(screen.getByRole("button", { name: "Use template Weekly SEO Check-up" }));
  await expect
    .element(page.getByRole("dialog").getByRole("heading", { name: "Set up schedule" }))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Skip schedule" }));
  expect(state.use).toHaveBeenCalledTimes(1);
  await vi.waitFor(() =>
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ slug: "weekly-seo-check-up" }) }),
    ),
  );
});

/** The preview canvas must lay out at a real height and draw a step, not collapse to a blank box. */
async function expectPreviewDrawsSteps() {
  const canvas = page.getByRole("dialog").getByRole("region", { name: "Workflow canvas" });
  await expect.element(canvas).toBeInTheDocument();
  const element = await canvas.element();
  await vi.waitFor(() => {
    const box = element.getBoundingClientRect();
    expect(box.height).toBeGreaterThan(200);
    const node = element.querySelector("[data-workflow-node]");
    expect(node).not.toBeNull();
    const nodeBox = node!.getBoundingClientRect();
    expect(nodeBox.bottom).toBeGreaterThan(box.top);
    expect(nodeBox.top).toBeLessThan(box.bottom);
  });
}

it("draws the built-in template's steps in the preview at a real canvas size", async () => {
  setup();
  await using screen = await render(<Gallery />);
  const card = screen.getByRole("article", { name: "Brand Kit", exact: true });
  await userEvent.click(card.getByRole("button", { name: "Open", exact: true }));
  await expect.element(page.getByRole("dialog").getByText("Brand Kit · Built-in")).toBeVisible();
  await expectPreviewDrawsSteps();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(document.querySelectorAll("[role=dialog]")).toHaveLength(0));
  const landing = screen.getByRole("article", {
    name: "Landing Page in an Afternoon",
    exact: true,
  });
  await userEvent.click(landing.getByRole("button", { name: "Open", exact: true }));
  await vi.waitFor(() =>
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("Copies to"),
  );
  await expectPreviewDrawsSteps();
});

it("draws the preview and says what to do when no project is open", async () => {
  setup();
  await using screen = await render(<Gallery projects={[]} />);
  const card = screen.getByRole("article", { name: "Brand Kit", exact: true });
  await userEvent.click(card.getByRole("button", { name: "Open", exact: true }));
  await vi.waitFor(() =>
    expect(page.getByRole("dialog").elements()[0]?.textContent).toContain("Add a project"),
  );
  await expectPreviewDrawsSteps();
});
