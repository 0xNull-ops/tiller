import { useState } from "react";
import {
  MAX_WORKFLOW_NOTE_LENGTH,
  type EnvironmentId,
  type WorkflowNote,
  type WorkflowListing,
} from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { useWorkflowEdit } from "./workflowState";

export function WorkflowNoteEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly listing: WorkflowListing;
  readonly note: WorkflowNote;
  readonly editMode: boolean;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const edit = useWorkflowEdit(props.environmentId);
  const [text, setText] = useState(props.note.text);
  const [anchorStepId, setAnchorStepId] = useState(props.note.anchorStepId ?? "");
  const save = async () => {
    if (!props.editMode || !props.listing.definition) return;
    const next: WorkflowNote = {
      ...props.note,
      text: text.slice(0, MAX_WORKFLOW_NOTE_LENGTH),
      ...(anchorStepId ? { anchorStepId } : { anchorStepId: undefined }),
    };
    await edit.run({
      _tag: "notePut",
      projectId: props.listing.projectId,
      workflow: props.listing.workflow,
      note: next,
    });
  };
  const remove = async () => {
    const result = await edit.run({
      _tag: "noteRemove",
      projectId: props.listing.projectId,
      workflow: props.listing.workflow,
      noteId: props.note.id,
    });
    if (result) props.onDeleted();
  };
  return (
    <section data-workflow-note-editor className="space-y-3" aria-label="Note editor">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Note</h3>
          <p className="text-2xs text-muted-foreground">Context only · never runs</p>
        </div>
        <Button variant="ghost" size="xs" onClick={props.onClose}>
          Close
        </Button>
      </header>
      <Textarea
        autoFocus={props.editMode}
        aria-label="Note text"
        maxLength={MAX_WORKFLOW_NOTE_LENGTH}
        rows={3}
        value={text}
        readOnly={!props.editMode}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Near step
          <select
            aria-label="Anchor note to step"
            className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
            value={anchorStepId}
            disabled={!props.editMode || !edit.canEdit}
            onChange={(event) => setAnchorStepId(event.target.value)}
          >
            <option value="">Annotation lane</option>
            {(props.listing.definition?.steps ?? []).map((step) => (
              <option key={step.id} value={step.id}>
                {step.title ?? step.id}
              </option>
            ))}
          </select>
        </label>
        <span className="text-2xs text-muted-foreground">
          {text.length}/{MAX_WORKFLOW_NOTE_LENGTH}
        </span>
      </div>
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
      {props.editMode ? (
        <footer className="flex justify-between">
          <Button
            variant="destructive"
            size="xs"
            disabled={edit.busy || !edit.canEdit}
            onClick={() => void remove()}
          >
            Delete note
          </Button>
          <Button size="xs" disabled={edit.busy || !edit.canEdit} onClick={() => void save()}>
            Save note
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
