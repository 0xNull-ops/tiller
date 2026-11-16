import type { EnvironmentId, ProjectId, WorkflowListing } from "@t3tools/contracts";
import {
  isScratchWorkflow,
  splitScratchWorkflows,
  workflowScratchThreadId,
} from "@t3tools/shared/workflowScratch";

export interface SavedWorkflowRow {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
  readonly title: string;
  readonly tags: ReadonlyArray<string>;
  readonly pinned: boolean;
  readonly stepCount: number;
  readonly loopCount: number;
  readonly invalid: boolean;
  readonly scratch: boolean;
  /**
   * The chat a tap opens: the thread that created a scratch workflow, else the one whose
   * agent last changed it. Mobile has no canvas, so the chat is the useful destination.
   */
  readonly threadId: string | null;
}

export interface SavedWorkflowRows {
  readonly regular: ReadonlyArray<SavedWorkflowRow>;
  readonly scratch: ReadonlyArray<SavedWorkflowRow>;
}

/**
 * The project's saved workflows, pinned first, then newest first. A scratch workflow leads its group so the
 * one the chat just auto-created is the first row the user sees after expanding.
 */
export function savedWorkflowRows(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly tag?: string | null;
}): SavedWorkflowRows {
  const projectWorkflows = [...input.workflows]
    .filter(
      (listing) =>
        listing.projectId === input.projectId &&
        (!input.tag || listing.definition?.tags?.includes(input.tag)),
    )
    .sort(
      (left, right) =>
        Number(right.pinned === true) - Number(left.pinned === true) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        titleOf(left).localeCompare(titleOf(right)),
    );
  const { regular, scratch } = splitScratchWorkflows(projectWorkflows);
  const toRow = (listing: WorkflowListing): SavedWorkflowRow => ({
    environmentId: input.environmentId,
    projectId: listing.projectId,
    workflow: listing.workflow,
    title: titleOf(listing),
    tags: listing.definition?.tags ?? [],
    pinned: listing.pinned === true,
    stepCount: listing.definition?.steps.length ?? 0,
    loopCount: listing.definition?.loops?.length ?? 0,
    invalid: listing.definition === null || listing.problem !== null,
    scratch: isScratchWorkflow(listing),
    threadId: workflowScratchThreadId(listing) ?? listing.editedByThreadId,
  });
  return { regular: regular.map(toRow), scratch: scratch.map(toRow) };
}

function titleOf(listing: WorkflowListing): string {
  return listing.definition?.name ?? listing.workflow;
}
