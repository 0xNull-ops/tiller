import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { useEnvironmentQuery } from "../state/query";
import { keepWorkflowSteps, slugify } from "./workflowEditing";
import { isWorkflowSkillStep } from "./workflowStep";
import { useWorkflowEdit, workflowRead } from "./workflowState";

export function WorkflowSaveDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly onCreated: (slug: string) => void;
}) {
  const query = useEnvironmentQuery(
    workflowRead({
      environmentId: props.environmentId,
      input: { _tag: "draftFromThread", projectId: props.projectId, threadId: props.threadId },
    }),
  );
  const edit = useWorkflowEdit(props.environmentId);
  const draft = query.data?._tag === "draftFromThread" ? query.data.draft : null;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const initialized = useRef<string | null>(null);

  // oxlint-disable-next-line t3code/react-effect-budget -- Initialize dialog fields from the loaded draft only after it is available.
  useEffect(() => {
    if (!props.open || !draft || initialized.current === props.threadId) return;
    initialized.current = props.threadId;
    setName(draft.definition.name);
    setSlug(draft.slug);
    setKept(new Set(draft.definition.steps.map((step) => step.id)));
    setTitles(
      Object.fromEntries(draft.definition.steps.map((step) => [step.id, step.title ?? step.id])),
    );
  }, [draft, props.open, props.threadId]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const workflow = slugify(slug);
    if (!draft || !edit.canEdit || !workflow || !name.trim()) return;
    const definition = keepWorkflowSteps(draft.definition, kept);
    const importedDefinition = {
      ...definition,
      name: name.trim(),
      steps: definition.steps.map((step) => ({
        ...step,
        title: titles[step.id]?.trim() || step.title || step.id,
      })),
    };
    const skillNames = new Set(
      importedDefinition.steps
        .filter((step) => isWorkflowSkillStep(step))
        .map((step) => step.skill),
    );
    const result = await edit.run({
      _tag: "import",
      projectId: props.projectId,
      workflow,
      definition: importedDefinition,
      skills: draft.skills
        .filter((skill) => skillNames.has(skill.name) && !skill.exists)
        .map(({ name: skillName, content }) => ({ name: skillName, content })),
    });
    if (result) {
      props.onCreated(workflow);
      props.onOpenChange(false);
    }
  };

  const toggleStep = (stepId: string, checked: boolean) => {
    setKept((current) => {
      const next = new Set(current);
      if (checked) next.add(stepId);
      else next.delete(stepId);
      return next;
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <form onSubmit={(event) => void save(event)}>
          <DialogHeader>
            <DialogTitle>Save as workflow</DialogTitle>
            <DialogDescription>
              Review the delegated work before saving it for this project.
            </DialogDescription>
          </DialogHeader>
          {query.isPending && !query.data ? (
            <p className="px-6 pb-4 text-xs text-muted-foreground">
              Reading this thread’s subagents…
            </p>
          ) : query.error ? (
            <p role="alert" className="px-6 pb-4 text-xs text-destructive">
              {query.error}
            </p>
          ) : !draft ? (
            <p className="px-6 pb-4 text-xs text-muted-foreground">
              There’s no delegated work to save yet.
            </p>
          ) : (
            <div className="max-h-[min(65vh,36rem)] space-y-4 overflow-y-auto px-6 pb-5">
              <label className="block space-y-1 text-xs font-medium">
                Workflow name
                <Input
                  aria-label="Workflow name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1 text-xs font-medium">
                Slug
                <Input
                  aria-label="Workflow slug"
                  value={slug}
                  onChange={(event) =>
                    setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))
                  }
                  onBlur={() => setSlug(slugify(slug))}
                />
              </label>
              <ol className="space-y-3">
                {draft.definition.steps.map((step) => {
                  const skill = isWorkflowSkillStep(step)
                    ? draft.skills.find((item) => item.name === step.skill)
                    : undefined;
                  return (
                    <li key={step.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          aria-label={`Keep ${titles[step.id] ?? step.title ?? step.id}`}
                          checked={kept.has(step.id)}
                          onCheckedChange={(checked) => toggleStep(step.id, Boolean(checked))}
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Input
                            aria-label={`Step title ${step.id}`}
                            value={titles[step.id] ?? step.title ?? step.id}
                            onChange={(event) =>
                              setTitles((current) => ({
                                ...current,
                                [step.id]: event.target.value,
                              }))
                            }
                          />
                          <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                            <span>
                              {isWorkflowSkillStep(step)
                                ? `Skill: ${step.skill}`
                                : "Nested workflow"}
                            </span>
                            {skill?.exists ? (
                              <Badge variant="secondary">Already installed; will reuse</Badge>
                            ) : null}
                          </div>
                          {skill ? (
                            <details>
                              <summary className="cursor-pointer text-2xs text-muted-foreground">
                                Preview skill text
                              </summary>
                              <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 text-2xs whitespace-pre-wrap font-mono">
                                {skill.content}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {edit.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {edit.error}
                </p>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !draft ||
                kept.size === 0 ||
                !slugify(slug) ||
                !name.trim() ||
                !edit.canEdit ||
                edit.busy
              }
            >
              {edit.busy ? "Saving…" : "Save workflow"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
