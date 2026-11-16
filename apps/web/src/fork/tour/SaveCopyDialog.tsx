import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useProjects } from "../../state/entities";
import { uniqueWorkflowSlug } from "../../workflows/workflowEditing";
import { useWorkflowEdit } from "../../workflows/workflowState";
import { useAllEnvironmentsWorkflows } from "../../workflows/useAllEnvironmentsWorkflows";
import { SAMPLE_WORKFLOW, saveCopyEdit } from "./sampleWorkflow";
import { useTourStore } from "./tourStore";

/** Writes the sample into a project through one `import` edit; nothing else ever does. */
export function SaveCopyDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const projects = useProjects();
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const project =
    projects.find((entry) => `${entry.environmentId}:${entry.id}` === projectKey) ??
    projects[0] ??
    null;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save a copy</DialogTitle>
          <DialogDescription>
            Adds “{SAMPLE_WORKFLOW.name}” to a project, where you can edit and run it.
          </DialogDescription>
        </DialogHeader>
        {project === null ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            Add a project first, then save a copy.
          </p>
        ) : (
          <SaveCopyForm
            key={`${project.environmentId}:${project.id}`}
            environmentId={project.environmentId}
            projectId={project.id}
            projectOptions={projects.map((entry) => ({
              key: `${entry.environmentId}:${entry.id}`,
              title: entry.title,
            }))}
            selectedKey={`${project.environmentId}:${project.id}`}
            onSelectKey={setProjectKey}
            onCancel={() => props.onOpenChange(false)}
            onSaved={() => props.onOpenChange(false)}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function SaveCopyForm(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectOptions: ReadonlyArray<{ key: string; title: string }>;
  readonly selectedKey: string;
  readonly onSelectKey: (key: string) => void;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}) {
  const navigate = useNavigate();
  const edit = useWorkflowEdit(props.environmentId);
  const snapshots = useAllEnvironmentsWorkflows();
  const [name, setName] = useState(SAMPLE_WORKFLOW.name);
  const existing =
    snapshots
      .find((snapshot) => snapshot.environmentId === props.environmentId)
      ?.workflows.filter((listing) => listing.projectId === props.projectId) ?? [];

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !edit.canEdit) return;
    const workflow = uniqueWorkflowSlug(existing, trimmed);
    const result = await edit.run(
      saveCopyEdit({ projectId: props.projectId, workflow, name: trimmed }),
    );
    if (result === null) return;
    props.onSaved();
    useTourStore.getState().dispatch({ type: "finish" });
    void navigate({
      to: "/workflows/$environmentId/$projectId/$slug" as never,
      params: {
        environmentId: props.environmentId,
        projectId: props.projectId,
        slug: workflow,
      } as never,
      search: {} as never,
    });
  };

  return (
    <form onSubmit={(event) => void save(event)}>
      <div className="space-y-4 px-6 pb-6">
        <label className="block space-y-1 text-sm">
          <span>Project</span>
          <Select
            value={props.selectedKey}
            onValueChange={(value) => {
              if (value) props.onSelectKey(value);
            }}
          >
            <SelectTrigger aria-label="Project">
              <SelectValue>
                {props.projectOptions.find((option) => option.key === props.selectedKey)?.title}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {props.projectOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {edit.error ? (
          <p role="alert" className="text-sm text-destructive">
            {edit.error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || !edit.canEdit || edit.busy}>
          Save a copy
        </Button>
      </DialogFooter>
    </form>
  );
}
