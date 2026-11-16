import { useRef } from "react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { useWorkflowSchedules } from "./useWorkflowSchedules";
import { useWorkflowEdit } from "./workflowState";

export interface WorkflowDeleteTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Shown as the project the workflow file lives in. Callers fall back to the id. */
  readonly projectTitle: string;
  readonly workflow: string;
  readonly name: string;
  /** A running or waiting run survives the delete; the dialog says so before committing. */
  readonly hasActiveRun: boolean;
}

/**
 * The confirm dialog behind every Delete workflow entry point. Mounted only while a target
 * is set, so the edit permission it reads belongs to the target's environment.
 */
export function WorkflowDeleteDialog(props: {
  readonly target: WorkflowDeleteTarget;
  readonly onClose: () => void;
  readonly onDeleted?: () => void;
}) {
  const edit = useWorkflowEdit(props.target.environmentId);
  const { tasks: schedules } = useWorkflowSchedules(
    props.target.environmentId,
    props.target.projectId,
    props.target.workflow,
  );
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteWorkflow = async () => {
    const result = await edit.run({
      _tag: "delete",
      projectId: props.target.projectId,
      workflow: props.target.workflow,
    });
    if (!result) return;
    props.onDeleted?.();
    props.onClose();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogPopup initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{props.target.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block">
              This removes the workflow file from{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs">.t3/workflows</code>{" "}
              in {props.target.projectTitle}. Past runs stay in history. This can’t be undone.
            </span>
            {schedules.length > 0 ? (
              <span className="mt-2 block">
                {schedules.length === 1
                  ? "Its schedule is removed too."
                  : `Its ${schedules.length} schedules are removed too.`}
              </span>
            ) : null}
            {props.target.hasActiveRun ? (
              <span className="mt-2 block">
                It has a run in progress. That run keeps going, but the workflow can’t be started
                again.
              </span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {edit.error ? (
          <p role="alert" className="px-6 text-xs text-destructive">
            {edit.error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose ref={cancelRef} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            disabled={!edit.canEdit || edit.busy}
            onClick={() => void deleteWorkflow()}
          >
            {edit.busy ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
