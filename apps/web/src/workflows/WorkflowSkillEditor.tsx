import { useEffect, useRef, useState } from "react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { CopyIcon, XIcon } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { MiddleTruncate } from "../components/ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { WorkflowConfirmDialog } from "./WorkflowConfirmDialog";
import { useWorkflowEdit, workflowRead } from "./workflowState";

export function WorkflowSkillEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    workflowRead({
      environmentId: props.environmentId,
      input: { _tag: "skill", projectId: props.projectId, name: props.name },
    }),
  );
  const edit = useWorkflowEdit(props.environmentId);
  const skill = query.data?._tag === "skill" ? query.data.skill : null;
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [dirty, setDirty] = useState(false);
  const loadedSkill = useRef<typeof skill>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- Load server skill content without replacing a dirty local draft.
  useEffect(() => {
    if (skill && !dirty && skill !== loadedSkill.current) {
      setText(skill.text);
      setSavedText(skill.text);
      loadedSkill.current = skill;
    }
  }, [skill, dirty]);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => {
    if (dirty) setConfirmDiscard(true);
    else props.onClose();
  };
  const save = async () => {
    if (!skill || !dirty || !edit.canEdit || edit.busy) return;
    const result = await edit.run({
      _tag: "skillWrite",
      projectId: props.projectId,
      name: skill.name,
      content: text,
      target: "installed",
    });
    if (result) {
      setSavedText(text);
      setDirty(false);
      await query.refresh();
    }
  };
  // oxlint-disable-next-line t3code/react-effect-budget -- Load server skill content without replacing a dirty local draft.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const copyToProject = async () => {
    if (!skill || !edit.canEdit || edit.busy) return;
    const result = await edit.run({
      _tag: "skillCopyToProject",
      projectId: props.projectId,
      name: skill.name,
    });
    // Unsaved text stays as a draft, so the next save writes it into the project copy.
    if (result) await query.refresh();
  };

  return (
    <section
      data-workflow-detail
      className="min-h-0 space-y-3"
      aria-label={`${props.name} skill editor`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{skill?.name ?? props.name}</h3>
            {skill ? (
              <Badge variant="secondary">{skill.scope === "project" ? "Project" : "Global"}</Badge>
            ) : null}
          </div>
          {skill ? (
            <Tooltip>
              <TooltipTrigger render={<p className="text-2xs text-muted-foreground" />}>
                <MiddleTruncate value={skill.path} showTitle={false} />
              </TooltipTrigger>
              <TooltipPopup>{skill.path}</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close skill editor" onClick={close}>
          <XIcon />
        </Button>
      </header>
      {skill?.scope === "global" ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
          <span>Editing a global skill changes it for every project.</span>
          <Button
            variant="outline"
            size="xs"
            disabled={!edit.canEdit || edit.busy}
            onClick={() => void copyToProject()}
          >
            <CopyIcon /> Make a project copy
          </Button>
        </div>
      ) : null}
      {query.isPending && !query.data ? (
        <p className="text-xs text-muted-foreground">Loading skill…</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="text-xs text-destructive">
          Couldn’t load this skill.
        </p>
      ) : null}
      {skill ? (
        <textarea
          aria-label="Skill content"
          spellCheck={false}
          className="min-h-64 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
          value={text}
          disabled={!edit.canEdit}
          onChange={(event) => {
            setText(event.target.value);
            setDirty(event.target.value !== savedText);
          }}
        />
      ) : null}
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
      <footer className="flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">
          {dirty ? "Unsaved changes" : "⌘S / Ctrl+S to save"}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="xs" onClick={close}>
            Cancel
          </Button>
          <Button
            size="xs"
            disabled={!edit.canEdit || edit.busy || !dirty}
            onClick={() => void save()}
          >
            {edit.busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </footer>
      <WorkflowConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        description="Your unsaved edits to this skill will be lost."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmDiscard(false);
          props.onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </section>
  );
}
