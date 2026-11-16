import type { WorkflowDefinition, WorkflowListing, WorkflowRun } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chooseCanvasView,
  canReadFrom,
  definitionChanged,
  insertBetween,
  keepWorkflowSteps,
  relatedWorkflowRuns,
  skillNameFromFile,
  slugify,
  uniqueStepId,
  withoutReadsFrom,
  withReadsFrom,
  workflowStepRemovalSummary,
} from "./workflowEditing";
import { workflowRunFixture } from "./workflowTestFixture";

const definition = (steps: WorkflowDefinition["steps"]): WorkflowDefinition => ({
  version: 1,
  name: "Launch",
  steps,
});
const linear = definition([
  { id: "brief", skill: "brief" },
  { id: "design", skill: "frontend-design" },
  { id: "deploy", skill: "vercel-deploy" },
]);

describe("workflow editing", () => {
  it("summarizes dependent work, derived cards, resources, and anchored notes before deletion", () => {
    const workflow: WorkflowDefinition = {
      version: 3,
      name: "Release",
      steps: [
        {
          id: "build",
          skill: "build",
          gate: true,
          checks: [{ kind: "file", path: "dist/index.html" }],
          attachments: [{ id: "node", kind: "requirement", requirement: "Node 22" }],
        },
        { id: "deploy", skill: "deploy" },
      ],
      notes: [{ id: "reminder", text: "Review release", anchorStepId: "build" }],
    };
    expect(workflowStepRemovalSummary(workflow, "build")).toContain(
      "detach 1 dependent step: deploy",
    );
    expect(workflowStepRemovalSummary(workflow, "build")).toContain(
      "approval gate will be removed",
    );
    expect(workflowStepRemovalSummary(workflow, "build")).toContain(
      "Check card and 1 configured check",
    );
    expect(workflowStepRemovalSummary(workflow, "build")).toContain(
      "1 attached resource will be detached",
    );
    expect(workflowStepRemovalSummary(workflow, "build")).toContain(
      "1 anchored note will remain and be detached",
    );
  });

  it("includes every ancestor of a delegated nested step without pulling in unrelated runs", () => {
    const root = { ...workflowRunFixture, steps: [] };
    const child = { ...root, id: "child", parent: { runId: root.id, stepId: "child-step" } };
    const leaf = {
      ...root,
      id: "leaf",
      parent: { runId: child.id, stepId: "leaf-step" },
      steps: [
        {
          stepId: "capture",
          status: "running" as const,
          attempts: 1,
          threadId: ThreadId.make("capture-agent"),
        },
      ],
    };
    const unrelated = { ...root, id: "unrelated" };
    expect(
      relatedWorkflowRuns([root, child, leaf, unrelated], "capture-agent").map((run) => run.id),
    ).toEqual([root.id, child.id, leaf.id]);
  });
  it("removes explicit reads from steps that were not kept", () => {
    const draft = definition([
      { id: "one", skill: "one" },
      { id: "two", skill: "two" },
      { id: "three", skill: "three", readsFrom: ["one", "two"] },
    ]);
    expect(keepWorkflowSteps(draft, new Set(["one", "three"])).steps).toEqual([
      { id: "one", skill: "one" },
      { id: "three", skill: "three", readsFrom: ["one"] },
    ]);
  });

  it("makes slugs and unique step ids", () => {
    expect(slugify("  Mood Board: v2! ")).toBe("mood-board-v2");
    expect(slugify("!!!")).toBe("");
    expect(uniqueStepId(linear, "Design")).toBe("design-2");
    expect(uniqueStepId(linear, "")).toBe("step");
  });

  it("spells out the implicit dependency when adding a link", () => {
    expect(withReadsFrom(linear, "deploy", "brief")?.readsFrom).toEqual(["design", "brief"]);
    expect(withReadsFrom(linear, "deploy", "design")).toBeNull();
    expect(withReadsFrom(linear, "deploy", "deploy")).toBeNull();
    expect(withoutReadsFrom(linear, "deploy", "design")?.readsFrom).toEqual([]);
  });

  it("allows sibling links, rejects self links and cycles, and preserves sibling edges", () => {
    const siblings = definition([
      { id: "source", skill: "source" },
      { id: "left", skill: "left", readsFrom: [] },
      { id: "right", skill: "right", readsFrom: [] },
    ]);
    expect(canReadFrom(siblings, "left", "source")).toBe(true);
    expect(withReadsFrom(siblings, "left", "source")?.readsFrom).toEqual(["source"]);
    expect(canReadFrom(siblings, "source", "source")).toBe(false);
    const linked = definition([
      { id: "source", skill: "source", readsFrom: ["middle"] },
      { id: "middle", skill: "middle", readsFrom: ["target"] },
      { id: "target", skill: "target", readsFrom: [] },
    ]);
    expect(canReadFrom(linked, "target", "source")).toBe(false);
  });

  it("rewires only explicit followers when inserting between steps", () => {
    expect(insertBetween(linear, "brief", "design", "moodboard")).toEqual({
      after: "brief",
      rewired: null,
    });
    const explicit = definition([
      { id: "brief", skill: "brief" },
      { id: "design", skill: "frontend-design", readsFrom: ["brief"] },
    ]);
    expect(insertBetween(explicit, "brief", "design", "moodboard").rewired?.readsFrom).toEqual([
      "moodboard",
    ]);
  });

  it("names a dropped skill from frontmatter, then the file name", () => {
    expect(skillNameFromFile("---\nname: ASO Refresh\n---\nbody", "SKILL.md")).toBe("aso-refresh");
    expect(skillNameFromFile("no frontmatter", "paywall-copy.md")).toBe("paywall-copy");
    expect(skillNameFromFile("no frontmatter", "SKILL.md")).toBeNull();
  });

  it("compares definitions regardless of key order", () => {
    const reordered = { steps: linear.steps, name: "Launch", version: 1 } as WorkflowDefinition;
    expect(definitionChanged(linear, reordered)).toBe(false);
    expect(definitionChanged(linear, definition(linear.steps.slice(1)))).toBe(true);
    expect(definitionChanged(linear, null)).toBe(false);
    // Moving a card never reads as a changed workflow.
    const moved = {
      ...linear,
      layout: { a: { x: 10, y: 20 } },
    } as WorkflowDefinition;
    expect(definitionChanged(linear, moved)).toBe(false);
    expect(definitionChanged({ ...linear, notes: [{ id: "note-a", text: "Keep" }] }, linear)).toBe(
      true,
    );
  });

  it("shows live or picked runs, and the saved workflow otherwise", () => {
    const listing = { workflow: "launch", definition: linear } as WorkflowListing;
    const run = (id: string, status: WorkflowRun["status"], startedAt: string) =>
      ({ id, workflow: "launch", status, startedAt, definition: linear }) as WorkflowRun;
    const done = run("old", "done", "2026-10-01T00:00:00Z");
    const running = run("new", "running", "2026-10-02T00:00:00Z");
    const view = (runs: WorkflowRun[], pickedRunId: string | null, editing = false) =>
      chooseCanvasView({ listing, runs, pickedRunId, editing }).mode;
    expect(view([done], null)).toBe("edit");
    expect(view([done, running], null)).toBe("run");
    expect(view([done, running], null, true)).toBe("edit");
    expect(view([done], "old")).toBe("run");
    expect(
      chooseCanvasView({ listing: null, runs: [], pickedRunId: null, editing: false }),
    ).toEqual({ mode: "none" });
  });
});
