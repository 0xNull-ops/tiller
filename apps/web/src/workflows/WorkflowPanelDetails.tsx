import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ThreadId,
  WorkflowListing,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepCheck,
  WorkflowNote,
  WorkflowAttachment,
} from "@t3tools/contracts";
import type { RefObject } from "react";
import { WorkflowMetaEditor } from "./WorkflowMetaEditor";
import { WorkflowStepDetail } from "./WorkflowStepDetail";
import { WorkflowStepEditor } from "./WorkflowStepEditor";
import { WorkflowNoteEditor } from "./WorkflowNoteEditor";
import { WorkflowResourceEditor } from "./WorkflowResourceEditor";

export function WorkflowPanelDetails({
  detailRef,
  ...props
}: {
  readonly detailRef: RefObject<HTMLDivElement | null>;
  readonly threadRef: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
  readonly probeContextThreadId: ThreadId | null;
  readonly probeContextWorkspaceRoot: string | null;
  readonly probeContextModelRevision: string;
  readonly projectId: ProjectId | null;
  readonly listing: WorkflowListing | null;
  readonly definitionModel: ModelSelection | undefined;
  readonly selectedStepId: string | null;
  readonly step: WorkflowStep | null;
  readonly note: WorkflowNote | null;
  readonly resource: {
    readonly owner: WorkflowStep;
    readonly attachment: WorkflowAttachment;
  } | null;
  readonly editMode: boolean;
  readonly lastRun: WorkflowRun | null;
  readonly stepRun: WorkflowRun["steps"][number] | null;
  readonly checks: ReadonlyArray<NonNullable<WorkflowRun["steps"][number]["checks"]>[number]>;
  readonly configuredChecks: ReadonlyArray<WorkflowStepCheck>;
  readonly threadShell: import("@t3tools/client-runtime/state/shell").EnvironmentThreadShell | null;
  readonly currentRun: WorkflowRun | null;
  readonly workflowRunMode: boolean;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
  readonly onOpenThread: (threadId: string) => void;
  readonly onRunCreated: (runId: string) => void;
  readonly onOpenWorkflow: (workflow: string, stepId?: string) => void;
}) {
  const contentClass = "px-3 py-2.5";
  if (
    props.selectedStepId === "__workflow__" &&
    props.editMode &&
    props.listing &&
    props.projectId
  ) {
    return (
      <div
        ref={detailRef}
        className={contentClass}
        // Portalled controls bubble through this React boundary, even outside the detail DOM.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <WorkflowMetaEditor
          environmentId={props.threadRef.environmentId}
          projectId={props.projectId}
          listing={props.listing}
          onClose={props.onClose}
          onDeleted={props.onDeleted}
        />
      </div>
    );
  }
  if (props.note && props.listing) {
    return (
      <div
        ref={detailRef}
        className={contentClass}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <WorkflowNoteEditor
          key={`${props.note.id}:${props.note.text}:${props.note.anchorStepId ?? ""}`}
          environmentId={props.threadRef.environmentId}
          listing={props.listing}
          note={props.note}
          editMode={props.editMode}
          onClose={props.onClose}
          onDeleted={props.onClose}
        />
      </div>
    );
  }
  if (props.resource && props.listing) {
    return (
      <div
        ref={detailRef}
        className={contentClass}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <WorkflowResourceEditor
          key={`${props.resource.attachment.id}:${JSON.stringify(props.resource.attachment)}:${JSON.stringify(
            [
              props.listing.definition?.model ?? null,
              "skill" in props.resource.owner ? (props.resource.owner.model ?? null) : null,
              props.probeContextThreadId,
              props.probeContextWorkspaceRoot,
              props.probeContextModelRevision,
            ],
          )}`}
          environmentId={props.threadRef.environmentId}
          {...(props.probeContextThreadId
            ? { probeContextThreadId: props.probeContextThreadId }
            : {})}
          probeContextWorkspaceRoot={props.probeContextWorkspaceRoot}
          probeContextModelRevision={props.probeContextModelRevision}
          listing={props.listing}
          owner={props.resource.owner}
          attachment={props.resource.attachment}
          readinessSnapshot={
            props.workflowRunMode
              ? (props.currentRun?.preflight ?? null)
              : (props.listing.readiness ?? null)
          }
          editMode={props.editMode}
          onClose={props.onClose}
          onDeleted={props.onClose}
        />
      </div>
    );
  }
  if (!props.step) return null;
  if (props.editMode && props.listing && props.projectId) {
    return (
      <div
        ref={detailRef}
        className={contentClass}
        // Portalled controls bubble through this React boundary, even outside the detail DOM.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <WorkflowStepEditor
          threadRef={props.threadRef}
          {...(props.probeContextThreadId
            ? { probeContextThreadId: props.probeContextThreadId }
            : {})}
          probeContextWorkspaceRoot={props.probeContextWorkspaceRoot}
          probeContextModelRevision={props.probeContextModelRevision}
          projectId={props.projectId}
          listing={props.listing}
          step={props.step}
          lastRunState={
            props.lastRun?.steps.find((entry) => entry.stepId === props.step?.id) ?? null
          }
          onClose={props.onClose}
          onOpenWorkflow={props.onOpenWorkflow}
        />
      </div>
    );
  }
  if (!props.step) return null;
  return (
    <WorkflowStepDetail
      ref={detailRef}
      step={props.step}
      runState={props.stepRun}
      checks={props.checks}
      configuredChecks={props.configuredChecks}
      missingSkills={props.listing?.missingSkills ?? []}
      definitionModel={props.definitionModel}
      threadShell={props.threadShell}
      readiness={
        props.workflowRunMode
          ? (props.currentRun?.preflight ?? undefined)
          : (props.listing?.readiness ?? undefined)
      }
      credentialApprovals={
        props.currentRun?.definition.credentialApprovals ??
        props.listing?.definition?.credentialApprovals
      }
      labels={{
        chatAgentInThisChat: "chat agent, in this chat",
        chatAgent: "chat agent",
        subagent: "subagent",
        unassigned: "Unassigned",
      }}
      driverThreadId={props.currentRun?.driverThreadId}
      onOpenThread={props.onOpenThread}
      threadRef={props.threadRef}
      run={props.workflowRunMode ? props.currentRun : null}
      onRunCreated={props.onRunCreated}
    />
  );
}
