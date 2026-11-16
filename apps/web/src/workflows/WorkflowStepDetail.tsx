import { WorkflowStepCredentialUse } from "./WorkflowCredentialUse";
import { WorkflowCredentialNeeds } from "./WorkflowCredentialSatellite";
import { stepCredentialSatellites } from "./workflowCredentialAttachments";
import type { Ref } from "react";
import type {
  ScopedThreadRef,
  ThreadId,
  EnvironmentId,
  WorkflowCheckResult,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowReadinessSnapshot,
  WorkflowStep,
  WorkflowStepCheck,
  WorkflowStepRun,
} from "@t3tools/contracts";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useState } from "react";
import { enclosingLoopForStep } from "./workflowEditing";
import { useWorkflowEdit } from "./workflowState";
import { isWorkflowSkillStep, stepModel } from "./workflowStep";
import { WorkflowOutputDetails } from "./WorkflowOutputDetails";
import type { useThreadShell } from "../state/entities";

export function WorkflowStepDetail({
  ref,
  ...props
}: {
  readonly step: WorkflowStep;
  readonly runState: WorkflowStepRun | null;
  readonly checks: ReadonlyArray<WorkflowCheckResult>;
  readonly configuredChecks: ReadonlyArray<WorkflowStepCheck>;
  readonly missingSkills: ReadonlyArray<string>;
  readonly definitionModel: WorkflowDefinition["model"];
  readonly threadShell: ReturnType<typeof useThreadShell>;
  readonly labels: {
    readonly chatAgentInThisChat: string;
    readonly chatAgent: string;
    readonly subagent: string;
    readonly unassigned: string;
  };
  readonly driverThreadId: ThreadId | null | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly ref: Ref<HTMLDivElement>;
  readonly run?: WorkflowRun | null | undefined;
  /** The draft's readiness, or the run's preflight; the Needs block names what the agent gets. */
  readonly readiness?: WorkflowReadinessSnapshot | undefined;
  readonly credentialApprovals?: WorkflowDefinition["credentialApprovals"];
  readonly onRunCreated?: (runId: string) => void;
  /** The thread whose panel shows this step; its outputs open in the same panel. */
  readonly threadRef: ScopedThreadRef;
}) {
  const { step, runState, threadShell, threadRef } = props;
  const model = stepModel(step, props.definitionModel) ?? threadShell?.modelSelection;
  const enclosingLoop = props.run?.definition
    ? enclosingLoopForStep(props.run.definition, step.id)
    : null;
  const credentialSatellites = stepCredentialSatellites({
    step,
    entries: (props.run ? props.run.preflight : props.readiness)?.entries,
    activity: [],
    approval: props.run?.definition.credentialApprovals ?? props.credentialApprovals,
  });
  return (
    <div
      ref={ref}
      data-workflow-detail
      className="px-3 py-2.5"
      aria-label={`${step.title ?? step.id} details`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{step.title ?? step.id}</h3>
          <p className="text-xs text-muted-foreground">
            {runState?.threadId === props.driverThreadId
              ? runState?.threadId === threadRef.threadId
                ? props.labels.chatAgentInThisChat
                : props.labels.chatAgent
              : runState?.threadId
                ? props.labels.subagent
                : props.labels.unassigned}
            {threadShell ? ` · ${threadShell.modelSelection.model}` : ""}
          </p>
        </div>
        {runState?.threadId && runState.threadId !== threadRef.threadId ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => props.onOpenThread(runState.threadId as ThreadId)}
          >
            Open thread <ArrowUpRightIcon />
          </Button>
        ) : null}
        {props.run ? (
          <WorkflowRunActions
            environmentId={threadRef.environmentId}
            run={props.run}
            step={step}
            runState={runState}
            onRunCreated={props.onRunCreated}
          />
        ) : null}
      </div>
      <WorkflowCredentialNeeds satellites={credentialSatellites} />
      {props.run ? (
        <WorkflowStepCredentialUse
          environmentId={threadRef.environmentId}
          runId={props.run.id}
          since={props.run.startedAt}
          stepId={step.id}
        />
      ) : null}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {isWorkflowSkillStep(step) ? (
          <>
            <dt className="text-muted-foreground">Skill</dt>
            <dd>
              {step.skill}
              {props.missingSkills.includes(step.skill) ? " · skill missing" : ""}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">Workflow</dt>
            <dd>{step.workflow}</dd>
          </>
        )}
        {step.note ? (
          <>
            <dt className="text-muted-foreground">Note</dt>
            <dd className="whitespace-pre-wrap">{step.note}</dd>
          </>
        ) : null}
        {model ? (
          <>
            <dt className="text-muted-foreground">Model</dt>
            <dd>{model.model}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Gate</dt>
        <dd>{step.gate ? "Approval required" : "No"}</dd>
        <dt className="text-muted-foreground">Pause after</dt>
        <dd>{step.pauseAfter ? "Yes" : "No"}</dd>
        {runState?.round !== undefined ? (
          <>
            <dt className="text-muted-foreground">Round</dt>
            <dd>
              {enclosingLoop ? `${runState.round} of ${enclosingLoop.maxRounds}` : runState.round}
              {runState.loopExhausted ? " · max rounds reached" : ""}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Attempts</dt>
        <dd>{runState?.attempts ?? 0}</dd>
      </dl>
      {runState?.loopExhausted ? (
        <p
          role="status"
          className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning"
        >
          Loop reached max rounds without passing; the run continued with this step’s last output.
        </p>
      ) : null}
      {props.configuredChecks.length > 0 ? (
        <section className="mt-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-medium">Checks</h4>
            {props.run &&
            runState?.checks?.some((check) => !check.ok) &&
            props.run.status !== "stopped" ? (
              <WorkflowChecksRetry
                environmentId={threadRef.environmentId}
                runId={props.run.id}
                stepId={step.id}
                checking={runState.checking !== undefined}
              />
            ) : null}
          </div>
          <ul className="mt-1 space-y-1 text-xs">
            {props.configuredChecks.map((check) => {
              const result = props.checks.find((entry) => sameCheck(entry.check, check));
              const label = check.kind === "file" ? check.path : check.command;
              return (
                <li
                  key={`${check.kind}:${label}`}
                  className={
                    result === undefined
                      ? "text-muted-foreground"
                      : result.ok
                        ? "text-success"
                        : "text-destructive"
                  }
                >
                  {result === undefined ? "Pending" : result.ok ? "Passed" : "Failed"}:{" "}
                  {result?.message ?? label}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {runState?.summary ? (
        <section className="mt-2">
          <h4 className="text-xs font-medium">Summary</h4>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
            {runState.summary}
          </p>
        </section>
      ) : null}
      {runState?.outputs && Object.keys(runState.outputs).length > 0 ? (
        <section className="mt-2">
          <WorkflowOutputDetails
            threadRef={threadRef}
            {...(runState.threadId ? { resourceThreadId: runState.threadId } : {})}
            outputs={runState.outputs}
            {...(runState.outputPreviews ? { previews: runState.outputPreviews } : {})}
          />
        </section>
      ) : null}
      {runState?.error ? (
        <section className="mt-2">
          <h4 className="text-xs font-medium text-destructive">Error</h4>
          <p className="whitespace-pre-wrap text-xs text-destructive">{runState.error}</p>
        </section>
      ) : null}
      {runState?.previousRounds && runState.previousRounds.length > 0 ? (
        <section className="mt-2 space-y-2 border-t pt-2" aria-label="Previous rounds">
          <h4 className="text-xs font-medium">Previous rounds</h4>
          {runState.previousRounds.map((previous) => (
            <div key={previous.round} className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
              <div className="flex items-center justify-between gap-2 font-medium">
                <span>Round {previous.round}</span>
                <span className="text-2xs text-muted-foreground">
                  {previous.verdict ? `verdict: ${previous.verdict}` : previous.status}
                </span>
              </div>
              {previous.summary ? (
                <p className="whitespace-pre-wrap text-muted-foreground">{previous.summary}</p>
              ) : null}
              {previous.error ? (
                <p className="whitespace-pre-wrap text-destructive">{previous.error}</p>
              ) : null}
              {previous.outputs && Object.keys(previous.outputs).length > 0 ? (
                <WorkflowOutputDetails
                  threadRef={threadRef}
                  {...(runState.threadId ? { resourceThreadId: runState.threadId } : {})}
                  outputs={previous.outputs}
                />
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function sameCheck(left: WorkflowStepCheck, right: WorkflowStepCheck) {
  return left.kind === "file" && right.kind === "file"
    ? left.path === right.path && left.minBytes === right.minBytes
    : left.kind === "command" && right.kind === "command"
      ? left.command === right.command && left.timeoutSec === right.timeoutSec
      : false;
}

function WorkflowRunActions(props: {
  environmentId: EnvironmentId;
  run: WorkflowRun;
  step: WorkflowStep;
  runState: WorkflowStepRun | null;
  onRunCreated: ((runId: string) => void) | undefined;
}) {
  const edit = useWorkflowEdit(props.environmentId);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const finished = ["done", "failed", "stopped"].includes(props.run.status);
  const live = ["running", "waiting"].includes(props.run.status);
  const canSkip =
    live && props.runState && ["queued", "ready", "waiting"].includes(props.runState.status);
  const rerun = async () => {
    const result = await edit.run({
      _tag: "stepRerun",
      runId: props.run.id,
      stepId: props.step.id,
    });
    if (result?.runId) props.onRunCreated?.(result.runId);
  };
  const skip = async () => {
    const result = await edit.run({ _tag: "stepSkip", runId: props.run.id, stepId: props.step.id });
    if (result) setConfirmSkip(false);
  };
  return (
    <>
      {finished ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="xs"
                disabled={!edit.canEdit || edit.busy}
                onClick={() => void rerun()}
              />
            }
          >
            Rerun from here
          </TooltipTrigger>
          <TooltipPopup>
            Starts a new run from this step with the skills as they are now. Earlier results are
            copied.
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {canSkip ? (
        <Button
          variant="outline"
          size="xs"
          disabled={!edit.canEdit || edit.busy}
          onClick={() => setConfirmSkip(true)}
        >
          Skip
        </Button>
      ) : null}
      {edit.error ? (
        <p role="alert" className="basis-full text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
      <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip “{props.step.title ?? props.step.id}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This step will be marked skipped for the current run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {edit.error ? (
            <p role="alert" className="px-6 text-xs text-destructive">
              {edit.error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={!edit.canEdit || edit.busy}
              onClick={() => void skip()}
            >
              {edit.busy ? "Skipping…" : "Skip step"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function WorkflowChecksRetry(props: {
  readonly environmentId: EnvironmentId;
  readonly runId: string;
  readonly stepId: string;
  readonly checking: boolean;
}) {
  const edit = useWorkflowEdit(props.environmentId);
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        disabled={!edit.canEdit || edit.busy || props.checking}
        onClick={() =>
          void edit.run({ _tag: "stepChecksRun", runId: props.runId, stepId: props.stepId })
        }
      >
        {edit.busy || props.checking ? "Checking…" : "Run checks again"}
      </Button>
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
    </>
  );
}
