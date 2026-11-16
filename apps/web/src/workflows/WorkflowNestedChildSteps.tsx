import { useState } from "react";
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepStatus,
} from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { isWorkflowNestedStep, isWorkflowSkillStep } from "./workflowStep";

export const STEP_STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  queued: "Queued",
  ready: "Ready",
  waiting: "Needs you",
  running: "Running",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

/** The steps of a nested workflow, read-only, with the latest run's status when one exists. */
export function WorkflowNestedChildSteps(props: {
  readonly workflowName: string;
  readonly definition: WorkflowDefinition;
  readonly missingSkills: ReadonlyArray<string>;
  readonly run: WorkflowRun | null;
  readonly onEditStep: (stepId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = props.definition.steps.find((step) => step.id === selectedId) ?? null;
  const statusOf = (stepId: string) => {
    const status = props.run?.steps.find((entry) => entry.stepId === stepId)?.status;
    return status ? STEP_STATUS_LABEL[status] : props.run ? "Not reached" : null;
  };
  return (
    <div className="space-y-2">
      <ol aria-label={`Steps in ${props.workflowName}`} className="space-y-1">
        {props.definition.steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              aria-pressed={step.id === selectedId}
              onClick={() => setSelectedId(step.id)}
              className="flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-left text-xs hover:bg-accent aria-pressed:border-primary aria-pressed:bg-accent"
            >
              <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{step.title ?? step.id}</span>
              <StepKindBadge step={step} missingSkills={props.missingSkills} />
              {statusOf(step.id) ? (
                <span className="shrink-0 text-2xs text-muted-foreground">{statusOf(step.id)}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
      {selected ? (
        <section
          aria-label="Selected step"
          className="space-y-1.5 rounded-md border bg-muted/40 p-2 text-xs"
        >
          <p className="font-medium">{selected.title ?? selected.id}</p>
          <p className="text-muted-foreground">
            {isWorkflowNestedStep(selected)
              ? `Runs workflow ${selected.workflow}`
              : isWorkflowSkillStep(selected)
                ? `Skill: ${selected.skill}`
                : null}
          </p>
          {isWorkflowSkillStep(selected) && props.missingSkills.includes(selected.skill) ? (
            <p className="text-destructive">This step’s skill isn’t installed.</p>
          ) : null}
          {selected.note ? <p className="whitespace-pre-wrap">{selected.note}</p> : null}
          <Button variant="outline" size="xs" onClick={() => props.onEditStep(selected.id)}>
            Edit in {props.workflowName}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function StepKindBadge(props: {
  readonly step: WorkflowStep;
  readonly missingSkills: ReadonlyArray<string>;
}) {
  if (isWorkflowNestedStep(props.step)) {
    return <span className="shrink-0 text-2xs text-muted-foreground">Workflow</span>;
  }
  const skill = isWorkflowSkillStep(props.step) ? props.step.skill : null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
      {skill ? <span className="max-w-32 truncate font-mono">{skill}</span> : null}
      {skill && props.missingSkills.includes(skill) ? (
        <span className="rounded bg-destructive/10 px-1 text-destructive">Skill missing</span>
      ) : null}
    </span>
  );
}
