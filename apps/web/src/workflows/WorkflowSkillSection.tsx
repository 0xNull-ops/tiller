import { MissingSkillActions } from "./MissingSkillActions";
import type { EnvironmentId, ProjectId, WorkflowListing, WorkflowStep } from "@t3tools/contracts";
import { AlertTriangleIcon, PencilIcon } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useWorkflowEdit } from "./workflowState";
import { skillTemplate } from "./workflowEditing";
import { isWorkflowSkillStep } from "./workflowStep";
import { WorkflowSkillPicker } from "./WorkflowSkillPicker";

export function WorkflowSkillSection(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly listing: WorkflowListing;
  readonly step: WorkflowStep;
  readonly onChangeSkill: (name: string) => void;
  readonly onOpenEditor: (name: string) => void;
}) {
  const edit = useWorkflowEdit(props.environmentId);
  if (!isWorkflowSkillStep(props.step)) return null;
  const step = props.step;
  const missing = props.listing.missingSkills.some(
    (name) => name.toLocaleLowerCase() === step.skill.toLocaleLowerCase(),
  );
  const skill =
    props.listing.skills.find(
      (item) => item.name.toLocaleLowerCase() === step.skill.toLocaleLowerCase(),
    ) ?? null;
  const blockers = props.listing.blockers.filter((blocker) => blocker.stepId === step.id);
  const createMissing = async () => {
    const result = await edit.run({
      _tag: "skillWrite",
      projectId: props.projectId,
      name: step.skill as never,
      content: skillTemplate(step.skill, ""),
      target: "project",
    });
    if (result) props.onOpenEditor(step.skill);
  };

  return (
    <section className="space-y-2 rounded-lg border bg-card p-2.5" aria-label="Skill">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-xs font-semibold">{step.skill}</h4>
            {skill ? (
              <Badge variant="secondary">{skill.scope === "project" ? "Project" : "Global"}</Badge>
            ) : null}
            {missing ? <Badge variant="destructive">Missing</Badge> : null}
          </div>
          {skill?.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {!missing ? (
            <Button
              variant="outline"
              size="xs"
              disabled={!edit.canEdit}
              onClick={() => props.onOpenEditor(step.skill)}
            >
              <PencilIcon /> View / Edit
            </Button>
          ) : null}
          <WorkflowSkillPicker
            environmentId={props.environmentId}
            projectId={props.projectId}
            onPick={props.onChangeSkill}
            missingSkill={step.skill}
          >
            <Button variant="ghost" size="xs" disabled={!edit.canEdit}>
              Change
            </Button>
          </WorkflowSkillPicker>
        </div>
      </div>
      {skill?.scope === "global" ? (
        <p className="text-2xs text-muted-foreground">Global · shared by every project</p>
      ) : null}
      {skill?.requires.length ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-2xs text-muted-foreground">Requires</span>
          {skill.requires.map((requirement) => (
            <Badge key={requirement} variant="outline">
              {requirement}
            </Badge>
          ))}
        </div>
      ) : null}
      {missing ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">This step’s skill isn’t installed.</span>
          <MissingSkillActions
            environmentId={props.environmentId}
            listing={props.listing}
            stepId={step.id}
          />
          <Button
            size="xs"
            variant="outline"
            disabled={!edit.canEdit || edit.busy}
            onClick={() => void createMissing()}
          >
            Create it
          </Button>
          <WorkflowSkillPicker
            environmentId={props.environmentId}
            projectId={props.projectId}
            onPick={props.onChangeSkill}
            missingSkill={step.skill}
          >
            <Button size="xs" variant="ghost" disabled={!edit.canEdit}>
              Link another
            </Button>
          </WorkflowSkillPicker>
        </div>
      ) : null}
      {blockers.map((blocker) => (
        <p
          key={`${blocker.kind}:${blocker.message}`}
          className="flex items-start gap-1.5 text-xs text-warning"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {blocker.message}
        </p>
      ))}
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
    </section>
  );
}
