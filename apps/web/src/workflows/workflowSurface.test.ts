import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { filterCommandPaletteGroups } from "../components/CommandPalette.logic";
import { resolveWorkflowSurfaceRef, workflowPaletteActions } from "./workflowSurface";
import { DraftId, type DraftSessionState } from "../composerDraftStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

const actions = workflowPaletteActions({
  environmentId: EnvironmentId.make("local"),
  id: ThreadId.make("thread"),
});

function matches(query: string) {
  return filterCommandPaletteGroups({
    activeGroups: [{ value: "actions", label: "Actions", items: actions }],
    query,
    isInSubmenu: false,
    projectSearchItems: [],
    threadSearchItems: [],
  }).some((group) =>
    group.items.some((item) => actions.some((action) => action.value === item.value)),
  );
}

it("finds the workflow graph by its title and by what it shows", () => {
  for (const query of ["show work", "Show workflow graph", "workflow", "graph", "subagents"]) {
    expect(matches(query), query).toBe(true);
  }
  expect(matches("terminal")).toBe(false);
});

it("offers New workflow from the command palette", () => {
  expect(actions.map((item) => item.title)).toContain("New workflow…");
  expect(matches("new workflow")).toBe(true);
});

it("opens an unsent draft's panel using its environment and reserved thread id", () => {
  const target = { kind: "draft" as const, draftId: DraftId.make("unsent") };
  const draft: DraftSessionState = {
    environmentId: EnvironmentId.make("remote"),
    threadId: ThreadId.make("reserved"),
    projectId: ProjectId.make("project"),
    logicalProjectKey: "project",
    createdAt: "2026-10-20T12:00:00Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    startFromOrigin: false,
  };
  expect(resolveWorkflowSurfaceRef(target, draft)).toEqual(
    scopeThreadRef(draft.environmentId, draft.threadId),
  );
  const promotedTo = scopeThreadRef(draft.environmentId, ThreadId.make("promoted"));
  expect(resolveWorkflowSurfaceRef(target, { ...draft, promotedTo })).toEqual(promotedTo);
  expect(resolveWorkflowSurfaceRef(target, null)).toBeNull();
  expect(resolveWorkflowSurfaceRef(null, draft)).toBeNull();
});
