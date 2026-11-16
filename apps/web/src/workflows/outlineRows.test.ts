import type {
  WorkflowDefinition,
  WorkflowListing,
  WorkflowRun,
  WorkflowStep,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { buildOutlineRows, type OutlineFilter, type OutlineInput } from "./outlineRows";
import { workflowRunFixture } from "./workflowTestFixture";

const listing = (workflow: string, steps: ReadonlyArray<WorkflowStep>): WorkflowListing => ({
  projectId: workflowRunFixture.projectId,
  workflow,
  definition: { version: 3, name: workflow, steps },
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: workflowRunFixture.startedAt,
  scratch: false,
  editedByThreadId: null,
});

const definition = (steps: ReadonlyArray<WorkflowStep>, loops?: WorkflowDefinition["loops"]) =>
  ({ version: 3, name: "root", steps, ...(loops ? { loops } : {}) }) as WorkflowDefinition;

const base = (overrides: Partial<OutlineInput>): OutlineInput => ({
  workflow: "launch",
  definition: definition([
    { id: "research", kind: "skill", skill: "research", title: "Research" },
    { id: "logo", kind: "skill", skill: "logo-generator", title: "Logo" },
    { id: "child", kind: "workflow", workflow: "brand-kit", title: "Brand kit" },
  ] as WorkflowStep[]),
  workflows: [
    listing("brand-kit", [
      { id: "palette", kind: "skill", skill: "design", title: "Palette" },
    ] as WorkflowStep[]),
  ],
  runFor: () => null,
  expanded: new Set(),
  query: "",
  filter: "all" as OutlineFilter,
  missingSkills: ["logo-generator"],
  ...overrides,
});

it("lists steps in order with nested workflows as collapsed branches", () => {
  const rows = buildOutlineRows(base({}));
  expect(rows.map((row) => row.title)).toEqual(["Research", "Logo", "Brand kit"]);
  expect(rows[2]).toMatchObject({ nested: "brand-kit", canExpand: true, expanded: false });
});

it("expands a nested workflow one level into its steps, keyed by its path", () => {
  const rows = buildOutlineRows(base({ expanded: new Set(["child"]) }));
  expect(rows.map((row) => [row.depth, row.title, row.key])).toEqual([
    [0, "Research", "research"],
    [0, "Logo", "logo"],
    [0, "Brand kit", "child"],
    [1, "Palette", "child/palette"],
  ]);
});

it("refuses to expand a reference that loops back to a workflow already on the path", () => {
  const rows = buildOutlineRows(
    base({
      workflow: "a",
      definition: definition([{ id: "to-b", kind: "workflow", workflow: "b" } as WorkflowStep]),
      workflows: [listing("b", [{ id: "back", kind: "workflow", workflow: "a" } as WorkflowStep])],
      expanded: new Set(["to-b", "to-b/back"]),
    }),
  );
  expect(rows.map((row) => [row.key, row.canExpand, row.expanded])).toEqual([
    ["to-b", true, true],
    ["to-b/back", false, false],
  ]);
});

it("marks loops, branches and missing skills", () => {
  const rows = buildOutlineRows(
    base({
      definition: definition(
        [
          { id: "a", kind: "skill", skill: "x", title: "A" },
          { id: "b", kind: "skill", skill: "logo-generator", title: "B", readsFrom: ["a"] },
          { id: "c", kind: "skill", skill: "y", title: "C", readsFrom: ["a", "b"] },
        ] as WorkflowStep[],
        [
          { id: "loop", from: "c", to: "b", maxRounds: 2, until: { kind: "step-says-pass" } },
        ] as never,
      ),
    }),
  );
  expect(rows.map((row) => [row.title, row.loop, row.branch, row.missingSkill])).toEqual([
    ["A", null, false, false],
    ["B", "start", false, true],
    ["C", "end", true, false],
  ]);
});

it("reads each step's status from the latest run, and filters on it", () => {
  const run = {
    ...workflowRunFixture,
    steps: [
      { stepId: "research", status: "done", attempts: 1, threadId: null },
      { stepId: "logo", status: "waiting", attempts: 0, threadId: null },
    ],
  } as WorkflowRun;
  const input = base({ runFor: (workflow) => (workflow === "launch" ? run : null) });
  expect(buildOutlineRows(input).map((row) => [row.title, row.status])).toEqual([
    ["Research", "done"],
    ["Logo", "waiting"],
    ["Brand kit", null],
  ]);
  expect(buildOutlineRows({ ...input, filter: "needs-you" }).map((row) => row.title)).toEqual([
    "Logo",
  ]);
  expect(buildOutlineRows({ ...input, filter: "not-run" }).map((row) => row.title)).toEqual([
    "Brand kit",
  ]);
  expect(buildOutlineRows({ ...input, filter: "missing-skill" }).map((row) => row.title)).toEqual([
    "Logo",
  ]);
});

it("searches names and skills at any depth, expanding nested workflows to find them", () => {
  const rows = buildOutlineRows(base({ query: "palette" }));
  expect(rows.map((row) => [row.depth, row.title])).toEqual([[1, "Palette"]]);
  expect(buildOutlineRows(base({ query: "LOGO-GEN" })).map((row) => row.title)).toEqual(["Logo"]);
});
