import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { useWorkflowEdit } from "./workflowState";

export interface KeepWorkflowTarget {
  readonly projectId: ProjectId;
  readonly workflow: string;
  /** Shown in a failure toast and the button's accessible name. */
  readonly name: string;
}

/**
 * Keeping promotes a scratch workflow into the ordinary saved list. It only clears the
 * definition's origin, so the workflow keeps its id, runs and schedules.
 */
export function useKeepWorkflow(environmentId: EnvironmentId) {
  const edit = useWorkflowEdit(environmentId);
  const keep = async (target: KeepWorkflowTarget) => {
    await edit.run(
      { _tag: "keep", projectId: target.projectId, workflow: target.workflow },
      (message) =>
        toastManager.add({
          type: "error",
          title: `Could not keep “${target.name}”`,
          description: message,
        }),
    );
  };
  return { canEdit: edit.canEdit, busy: edit.busy, keep };
}

/** The row action. Absent when this client may not edit workflows in the environment. */
export function WorkflowKeepButton(
  props: { readonly environmentId: EnvironmentId } & KeepWorkflowTarget,
) {
  const keep = useKeepWorkflow(props.environmentId);
  if (!keep.canEdit) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={`Keep ${props.name}`}
      disabled={keep.busy}
      onClick={() => void keep.keep(props)}
    >
      {keep.busy ? "Keeping…" : "Keep"}
    </Button>
  );
}
