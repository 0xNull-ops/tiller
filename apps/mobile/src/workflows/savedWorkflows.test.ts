import { EnvironmentId, ProjectId, ThreadId, type WorkflowListing } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { savedWorkflowRows } from "./savedWorkflows.ts";

const envId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-1");
const otherProjectId = ProjectId.make("project-2");
const creatorThread = ThreadId.make("creator-thread");
const editorThread = ThreadId.make("editor-thread");

function makeListing(input: {
  readonly workflow: string;
  readonly name: string;
  readonly tags?: ReadonlyArray<string>;
  readonly pinned?: boolean;
  readonly updatedAt: string;
  readonly project?: ProjectId;
  readonly editedByThreadId?: ThreadId | null;
  readonly problem?: string | null;
}): WorkflowListing {
  return {
    projectId: input.project ?? projectId,
    workflow: input.workflow,
    ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
    definition: {
      version: 2,
      name: input.name,
      ...(input.tags ? { tags: input.tags } : {}),
      steps: [
        { id: "one", title: "One", skill: "brief" },
        { id: "two", title: "Two", skill: "build" },
      ],
    },
    problem: input.problem ?? null,
    missingSkills: [],
    skills: [],
    blockers: [],
    updatedAt: input.updatedAt,
    editedByThreadId: "editedByThreadId" in input ? (input.editedByThreadId ?? null) : editorThread,
    scratch: false,
  };
}

function makeScratchListing(
  input: Parameters<typeof makeListing>[0] & { readonly createdBy?: ThreadId },
): WorkflowListing {
  const base = makeListing(input);
  if (base.definition === null) throw new Error("A scratch fixture needs a definition.");
  return {
    ...base,
    scratch: true,
    definition: {
      ...base.definition,
      origin: { kind: "workflow-first", threadId: input.createdBy ?? creatorThread },
    },
  };
}

describe("savedWorkflowRows", () => {
  it("keeps only this project's workflows, pins first, and filters by tags", () => {
    const workflows = [
      makeListing({
        workflow: "older",
        name: "Older",
        updatedAt: "2026-10-20T10:00:00.000Z",
        pinned: true,
        tags: ["web"],
      }),
      makeListing({
        workflow: "other-project",
        name: "Other Project",
        updatedAt: "2026-10-23T10:00:00.000Z",
        project: otherProjectId,
        tags: ["web"],
      }),
      makeListing({
        workflow: "newer",
        name: "Newer",
        updatedAt: "2026-10-22T10:00:00.000Z",
        tags: ["video"],
      }),
      makeListing({
        workflow: "untagged",
        name: "Untagged",
        updatedAt: "2026-10-19T10:00:00.000Z",
      }),
    ];
    const input = { environmentId: envId, projectId, workflows };
    const rows = savedWorkflowRows(input);
    expect(rows.regular.map((row) => row.workflow)).toEqual(["older", "newer", "untagged"]);
    expect(rows.regular[0]).toMatchObject({ pinned: true, tags: ["web"] });
    expect(rows.regular[2]).toMatchObject({ pinned: false, tags: [] });
    expect(rows.scratch).toEqual([]);
    expect(savedWorkflowRows({ ...input, tag: "web" }).regular.map((row) => row.workflow)).toEqual([
      "older",
    ]);
    expect(
      savedWorkflowRows({ ...input, tag: "video" }).regular.map((row) => row.workflow),
    ).toEqual(["newer"]);
    expect(savedWorkflowRows({ ...input, tag: "unknown" }).regular).toEqual([]);
    expect(savedWorkflowRows({ ...input, tag: null })).toEqual(rows);
    const unpinned = workflows.map((listing) => ({ ...listing, pinned: false }));
    expect(
      savedWorkflowRows({ ...input, workflows: unpinned }).regular.map((row) => row.workflow),
    ).toEqual(["newer", "older", "untagged"]);
  });

  it("splits scratch workflows into their own group with the creating thread", () => {
    const rows = savedWorkflowRows({
      environmentId: envId,
      projectId,
      workflows: [
        makeListing({ workflow: "kept", name: "Kept", updatedAt: "2026-10-20T10:00:00.000Z" }),
        makeScratchListing({
          workflow: "auto-a",
          name: "Auto A",
          updatedAt: "2026-10-21T10:00:00.000Z",
          createdBy: creatorThread,
        }),
        makeScratchListing({
          workflow: "auto-b",
          name: "Auto B",
          updatedAt: "2026-10-22T10:00:00.000Z",
          createdBy: ThreadId.make("second-creator"),
        }),
      ],
    });

    expect(rows.regular.map((row) => row.workflow)).toEqual(["kept"]);
    expect(rows.scratch.map((row) => row.workflow)).toEqual(["auto-b", "auto-a"]);
    expect(rows.scratch.map((row) => row.threadId)).toEqual(["second-creator", creatorThread]);
    expect(rows.scratch.every((row) => row.scratch)).toBe(true);
    expect(rows.regular[0]?.scratch).toBe(false);
  });

  it("falls back to the last editing thread for an ordinary workflow", () => {
    const [row] = savedWorkflowRows({
      environmentId: envId,
      projectId,
      workflows: [
        makeListing({
          workflow: "ordinary",
          name: "Ordinary",
          updatedAt: "2026-10-20T10:00:00.000Z",
          editedByThreadId: editorThread,
        }),
      ],
    }).regular;

    expect(row?.threadId).toBe(editorThread);
  });

  it("has no destination when nobody edited the workflow", () => {
    const [row] = savedWorkflowRows({
      environmentId: envId,
      projectId,
      workflows: [
        makeListing({
          workflow: "hand-written",
          name: "Hand Written",
          updatedAt: "2026-10-20T10:00:00.000Z",
          editedByThreadId: null,
        }),
      ],
    }).regular;

    expect(row?.threadId).toBeNull();
  });

  it("marks unreadable and invalid definitions, and counts steps", () => {
    const unreadable = makeListing({
      workflow: "broken",
      name: "Broken",
      updatedAt: "2026-10-21T10:00:00.000Z",
      problem: "The file does not parse.",
    });
    const rows = savedWorkflowRows({
      environmentId: envId,
      projectId,
      workflows: [
        makeListing({ workflow: "valid", name: "Valid", updatedAt: "2026-10-20T10:00:00.000Z" }),
        unreadable,
        {
          ...makeListing({
            workflow: "empty",
            name: "Empty",
            updatedAt: "2026-10-19T10:00:00.000Z",
          }),
          definition: null,
        },
      ],
    });

    expect(rows.regular.map((row) => [row.workflow, row.invalid, row.stepCount])).toEqual([
      ["broken", true, 2],
      ["valid", false, 2],
      ["empty", true, 0],
    ]);
  });

  it("returns two empty groups when the project has no workflows", () => {
    expect(savedWorkflowRows({ environmentId: envId, projectId, workflows: [] })).toEqual({
      regular: [],
      scratch: [],
    });
  });
});
