import type { EnvironmentId, ProjectId, WorkflowListing } from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useWorkflowEdit } from "./workflowState";
import { uniqueWorkflowSlug } from "./workflowEditing";

export function WorkflowNewDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const edit = useWorkflowEdit(props.environmentId);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !edit.canEdit) return;
    const slug = uniqueWorkflowSlug(props.workflows, trimmedName);
    const result = await edit.run({
      _tag: "create",
      projectId: props.projectId,
      workflow: slug,
      name: trimmedName,
      ...(brief.trim() ? { brief: brief.trim() } : {}),
    });
    if (result) {
      props.onCreated(slug);
      props.onOpenChange(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup showCloseButton={false}>
        <form onSubmit={(event) => void create(event)}>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>Create a reusable workflow for this project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <label className="block space-y-1 text-sm">
              <span>Name</span>
              <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>
                Brief <span className="text-muted-foreground">(optional)</span>
              </span>
              <Textarea value={brief} onChange={(event) => setBrief(event.target.value)} />
            </label>
            {edit.error ? (
              <p role="alert" className="text-sm text-destructive">
                {edit.error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !edit.canEdit || edit.busy}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
