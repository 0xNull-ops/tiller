import { WorkflowConnectionHover } from "./WorkflowConnectionHover";
import { useCredentialActivity } from "../credentials/useCredentialActivity";
import { workflowCanvasLayout } from "./workflowCanvasLayout";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  CredentialId,
  MAX_WORKFLOW_NOTES,
  MAX_WORKFLOW_STEP_ATTACHMENTS,
  workflowScheduleBinding,
} from "@t3tools/contracts";
import type {
  Credential,
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  ThreadId,
  WorkflowNote,
  WorkflowTrigger,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, PlusIcon, StickyNoteIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  useProject,
  useThreadProjection,
  useThreadShell,
  useThreadShells,
} from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { workflowAnnotationLayoutSizes, workflowCardSizes } from "./workflowOutputs";
import { WorkflowConfirmDialog } from "./WorkflowConfirmDialog";
import { WorkflowNewDialog } from "./WorkflowNewDialog";
import { WorkflowSaveDialog } from "./WorkflowSaveDialog";
import { WorkflowExecutionControl } from "./WorkflowExecutionControl";
import { WorkflowPanelHeader } from "./WorkflowPanelHeader";
import { WorkflowCredentialsSheet } from "./WorkflowCredentialsSheet";
import {
  bindCredentialAttachment,
  credentialAttachmentsFor,
} from "./workflowCredentialAttachments";
import { WorkflowPanelCanvas } from "./WorkflowPanelCanvas";
import { WorkflowInspectorLayout } from "./WorkflowInspectorLayout";
import { WorkflowNestTrail } from "./WorkflowNestTrail";
import { WorkflowOutline } from "./WorkflowOutline";
import { WorkflowZoomControls } from "./WorkflowZoomControls";
import {
  setActiveWorkflowViewKey,
  setWorkflowView,
  useWorkflowView,
  workflowViewKey,
  type WorkflowViewMode,
  type WorkflowViewPref,
} from "./workflowViewPrefs";
import { WorkflowPanelDetails } from "./WorkflowPanelDetails";
import { useWorkflowSchedules } from "./useWorkflowSchedules";
import { WorkflowSchedulePanel } from "./WorkflowSchedulePanel";
import { openStartedWorkflowInThread, WorkflowRunDialog } from "./WorkflowRunDialog";
import { WorkflowRunInputsDialog } from "./WorkflowRunInputsDialog";
import { useWorkflowPanelRunActions } from "./useWorkflowPanelRunActions";
import { useWorkflowSkillDrop } from "./useWorkflowSkillDrop";
import { WorkflowStepPicker } from "./WorkflowStepPicker";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { buildRunGraph } from "./runGraph";
import { connectionLayout } from "./workflowConnections";
import { layoutRunGraph, RUN_GRAPH_NODE, type RunGraphDirection } from "./runGraphLayout";
import {
  useWorkflowListingReadiness,
  useWorkflowRuns,
  workflowReadinessForCanvas,
} from "./workflowState";
import { isWorkflowSkillStep } from "./workflowStep";
import { openNestedTrail } from "./workflowNesting";
import { canExpandNested, nestedExpansions } from "./workflowExpansion";
import { workflowAnnotationPositions, workflowNoteId } from "./workflowAnnotations";
import { randomUUID } from "../lib/utils";
import {
  chooseCanvasView,
  definitionChanged,
  isMainDrivingThread,
  relatedWorkflowRuns,
  workflowStepRemovalSummary,
} from "./workflowEditing";
import { useWorkflowCanvasEdits } from "./useWorkflowCanvasEdits";
import { useWorkflowDraftRun } from "./useWorkflowDraftRun";
import { WorkflowWelcome } from "./WorkflowWelcome";
import {
  consumeWorkflowScheduleRequest,
  subscribeWorkflowScheduleRequest,
  consumeWorkflowCreateRequest,
  consumeWorkflowSaveRequest,
  readRememberedThreadWorkflow,
  subscribeWorkflowCreateRequest,
  subscribeWorkflowSaveRequest,
} from "./workflowUiStore";
import { useCanvasCamera } from "./useCanvasCamera";
import "./WorkflowPanel.css";

/** Below this canvas width, about three cards side by side, steps stack vertically. */
const VERTICAL_BELOW_WIDTH = 720;

/** Compact cards: about two thirds of a full card, so more of a large workflow fits on screen. */
const COMPACT_NODE = { width: 168, height: 72, columnGap: 40, rowGap: 12 } as const;

/** Saved workflow runs and the work a thread delegated share the same canvas. */
export function WorkflowPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  return <ThreadWorkflowPanel key={scopedThreadKey(threadRef)} threadRef={threadRef} />;
}

/**
 * Standalone project-scoped workflow canvas used by the full-screen workflow page.
 * Shares the canvas, header, and details panel with the thread-scoped panel while
 * showing all runs of the workflow across chats in the project.
 */
export function WorkflowProjectPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
  readonly projectName?: string | null;
  readonly runId?: string | null;
  readonly stepId?: string | null;
  readonly onSelectWorkflow?: (workflow: string) => void;
  readonly onSelectRun?: (runId: string | null) => void;
  readonly onBack?: () => void;
  readonly onDeleted?: () => void;
}) {
  return (
    <WorkflowWorkspace
      key={`${props.environmentId}:${props.projectId}:${props.workflow}:${props.stepId ?? ""}`}
      threadRef={null}
      environmentId={props.environmentId}
      projectId={props.projectId}
      initialWorkflow={props.workflow}
      initialRunId={props.runId ?? null}
      initialStepId={props.stepId ?? null}
      projectName={props.projectName ?? null}
      {...(props.onSelectWorkflow ? { onSelectWorkflowRoute: props.onSelectWorkflow } : {})}
      {...(props.onSelectRun ? { onSelectRunRoute: props.onSelectRun } : {})}
      {...(props.onBack ? { onBack: props.onBack } : {})}
      {...(props.onDeleted ? { onDeletedRoute: props.onDeleted } : {})}
    />
  );
}

function ThreadWorkflowPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  return <WorkflowWorkspace threadRef={threadRef} environmentId={threadRef.environmentId} />;
}

function WorkflowWorkspace({
  threadRef,
  ...props
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId | null;
  readonly initialWorkflow?: string | null;
  readonly initialRunId?: string | null;
  readonly initialStepId?: string | null;
  readonly projectName?: string | null;
  readonly onSelectWorkflowRoute?: (workflow: string) => void;
  readonly onSelectRunRoute?: (runId: string | null) => void;
  readonly onBack?: () => void;
  readonly onDeletedRoute?: () => void;
}) {
  const { environmentId } = props;
  const pageMode = threadRef === null;
  const fallbackRef = threadRef ?? scopeThreadRef(environmentId, "" as ThreadId);
  const shell = useThreadShell(threadRef);
  const draft = useComposerDraftStore((store) =>
    threadRef ? store.getDraftSessionByRef(threadRef) : null,
  );
  const projection =
    useThreadProjection(!threadRef || (!shell && draft) ? null : threadRef)?.projection ?? null;
  const projectId = pageMode
    ? (props.projectId ?? null)
    : (shell?.projectId ?? draft?.projectId ?? null);
  const project = useProject(projectId === null ? null : scopeProjectRef(environmentId, projectId));
  const draftRun = useWorkflowDraftRun(fallbackRef);
  const runsQuery = useWorkflowRuns(environmentId, projectId);
  const [pickedRunId, setPickedRunId] = useState<string | null>(props.initialRunId ?? null);
  const [prevInitialRunId, setPrevInitialRunId] = useState<string | null | undefined>(
    props.initialRunId,
  );
  if (props.initialRunId !== prevInitialRunId) {
    setPrevInitialRunId(props.initialRunId);
    setPickedRunId(props.initialRunId ?? null);
  }
  const [runInputsOpen, setRunInputsOpen] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const runs = threadRef ? relatedWorkflowRuns(runsQuery.runs, threadRef.threadId) : runsQuery.runs;
  const rootRuns = runs.filter((run) => run.parent === undefined);
  const pickedRun = runsQuery.runs.find((run) => run.id === pickedRunId) ?? null;
  const [editing, setEditing] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(
    () => props.initialWorkflow ?? readRememberedThreadWorkflow(threadRef),
  );
  const [showSubagents, setShowSubagents] = useState<boolean | null>(null);
  const [saveOpen, setSaveOpen] = useState(() =>
    threadRef ? consumeWorkflowSaveRequest(threadRef) : false,
  );
  const [selectedStepId, setSelectedStepId] = useState<string | null>(props.initialStepId ?? null);
  // Workflows the panel opened on the way down to the one on screen, outermost first.
  const [nestTrail, setNestTrail] = useState<ReadonlyArray<string>>([]);
  const workflows = runsQuery.workflows;
  const latestThreadRun = rootRuns.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const selectedListingFromServer =
    selectedWorkflow !== null
      ? (workflows.find((entry) => entry.workflow === selectedWorkflow) ?? null)
      : threadRef
        ? (workflows.find((entry) => entry.workflow === latestThreadRun?.workflow) ??
          workflows
            .filter((entry) => entry.editedByThreadId === threadRef.threadId)
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
          null)
        : null;
  const allShells = useThreadShells();
  const listingRuns = selectedListingFromServer
    ? rootRuns
        .filter((entry) => entry.workflow === selectedListingFromServer.workflow)
        .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))
    : [];
  const probeThreadCandidate =
    threadRef?.threadId ??
    pickedRun?.driverThreadId ??
    listingRuns[0]?.driverThreadId ??
    selectedListingFromServer?.editedByThreadId ??
    null;
  const probeThreadShell =
    probeThreadCandidate && Array.isArray(allShells)
      ? (allShells.find(
          (entry) =>
            entry.environmentId === environmentId &&
            entry.id === probeThreadCandidate &&
            entry.projectId === projectId &&
            entry.deletedAt === null &&
            entry.archivedAt === null,
        ) ?? null)
      : null;
  const probeContextThreadId = probeThreadShell?.id ?? null;
  const probeContextWorkspaceRoot =
    probeThreadShell?.worktreePath ?? project?.workspaceRoot ?? null;
  const probeContextModelRevision = JSON.stringify(probeThreadShell?.modelSelection ?? null);
  const selectedListing = useWorkflowListingReadiness(
    environmentId,
    selectedListingFromServer,
    probeContextThreadId,
    probeContextWorkspaceRoot,
    probeContextModelRevision,
  );
  const hasSubagents = (projection?.subagents.length ?? 0) > 0;
  const subagentsView = pageMode
    ? false
    : (showSubagents ?? (selectedListing === null && hasSubagents));
  const welcome = selectedListing === null && pickedRun === null && !subagentsView;
  // Each workflow remembers its own view. Saved workflows only: subagents have no definition to switch.
  const viewKey =
    selectedListing && !subagentsView
      ? workflowViewKey({
          environmentId,
          projectId: projectId ?? "",
          workflow: selectedListing.workflow,
        })
      : null;
  const workflowView = useWorkflowView(viewKey ?? "");
  const workflowViewSwitch =
    viewKey === null
      ? undefined
      : {
          view: workflowView.mode,
          onView: (mode: WorkflowViewMode) => setWorkflowView(viewKey, { mode }),
          compact: workflowView.compact,
          onCompact: (compact: boolean) =>
            setWorkflowView(viewKey, { compact } satisfies Partial<WorkflowViewPref>),
        };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The command palette acts on the workflow the panel shows.
  useEffect(() => {
    setActiveWorkflowViewKey(viewKey);
    return () => setActiveWorkflowViewKey(null);
  }, [viewKey]);
  const runsForWorkflow = rootRuns.filter((entry) => entry.workflow === selectedListing?.workflow);
  const latestRun =
    runsForWorkflow.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  const canvasView = chooseCanvasView({
    listing: selectedListing,
    runs: pickedRun?.parent ? [...runsForWorkflow, pickedRun] : runsForWorkflow,
    pickedRunId,
    editing,
  });
  const workflowRun =
    canvasView.mode === "run"
      ? canvasView.run
      : canvasView.mode === "edit"
        ? canvasView.lastRun
        : null;
  const definition = canvasView.mode === "none" ? null : canvasView.definition;
  const parentRun = workflowRun?.parent
    ? (runsQuery.runs.find((run) => run.id === workflowRun.parent!.runId) ?? null)
    : null;
  const editMode = canvasView.mode === "edit" && !subagentsView;
  const selectedStep = definition?.steps.find((step) => step.id === selectedStepId) ?? null;
  const noteId = selectedStepId?.startsWith("note/") ? selectedStepId.slice("note/".length) : null;
  const selectedNote = noteId
    ? (definition?.notes?.find((note) => note.id === noteId) ?? null)
    : null;
  const attachmentMatch = selectedStepId?.match(/^attachment\/([^/]+)\/([^/]+)$/);
  const selectedResource = attachmentMatch
    ? (() => {
        const owner = definition?.steps.find((step) => step.id === attachmentMatch[1]);
        const attachment = owner?.attachments?.find((entry) => entry.id === attachmentMatch[2]);
        return owner && attachment ? { owner, attachment } : null;
      })()
    : null;
  const selectedStepRun = workflowRun?.steps.find((step) => step.stepId === selectedStepId) ?? null;
  const stepChecks = selectedStepRun?.checks ?? [];
  const configuredStepChecks =
    selectedStep && isWorkflowSkillStep(selectedStep) ? (selectedStep.checks ?? []) : [];
  const selectedStepThreadRef = selectedStepRun?.threadId
    ? scopeThreadRef(environmentId, selectedStepRun.threadId)
    : null;
  const selectedStepShell = useThreadShell(selectedStepThreadRef);
  const driverThreadRef =
    workflowRun && (pageMode || workflowRun.driverThreadId !== threadRef?.threadId)
      ? scopeThreadRef(environmentId, workflowRun.driverThreadId)
      : null;
  const driverShell = useThreadShell(driverThreadRef);
  const projectDriverThreads =
    pageMode && projectId && Array.isArray(allShells)
      ? allShells
          .filter(
            (entry) =>
              entry.environmentId === environmentId &&
              entry.projectId === projectId &&
              entry.deletedAt === null &&
              entry.archivedAt === null &&
              isMainDrivingThread(entry, runsQuery.runs),
          )
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((entry) => ({ id: entry.id, title: entry.title || "Untitled chat" }))
      : undefined;
  const effectiveThreadRef =
    threadRef ??
    scopeThreadRef(
      environmentId,
      workflowRun?.driverThreadId ?? selectedListing?.editedByThreadId ?? ("" as ThreadId),
    );
  // Run definitions are immutable; credential satellite positions belong to the saved canvas.
  const layoutDefinition =
    definition && !editMode && selectedListing?.definition
      ? {
          ...definition,
          layout: {
            ...Object.fromEntries(
              Object.entries(definition.layout ?? {}).filter(
                ([key]) => !key.startsWith("credential:"),
              ),
            ),
            ...Object.fromEntries(
              Object.entries(selectedListing.definition.layout ?? {}).filter(([key]) =>
                key.startsWith("credential:"),
              ),
            ),
          },
        }
      : definition;
  const edit = useWorkflowCanvasEdits({
    environmentId,
    projectId,
    workflow: selectedListing?.workflow ?? null,
    definition: layoutDefinition,
    canEdit: editMode,
    onRunCreated: (runId) => {
      setPickedRunId(runId);
      props.onSelectRunRoute?.(runId);
      setEditing(false);
      setRunInputsOpen(false);
    },
  });
  const selectedResourceOwnerId = selectedStepId?.match(/^attachment\/([^/]+)\//)?.[1];
  const selectedOwnerId = selectedResourceOwnerId ?? selectedStep?.id ?? null;
  const addWorkflowResource = (
    owner: NonNullable<typeof definition>["steps"][number],
    attachment: import("@t3tools/contracts").WorkflowAttachment,
  ) => {
    if (!edit.editable || !definition || !selectedListing || !projectId) return false;
    return edit
      .run({
        _tag: "stepPut",
        projectId,
        workflow: selectedListing.workflow,
        step: { ...owner, attachments: [...(owner.attachments ?? []), attachment] },
      })
      .then((result) => result !== null);
  };
  // One write for a whole multi-select, so the step never lands half-attached.
  const attachCredentials = (
    owner: NonNullable<typeof definition>["steps"][number],
    credentials: ReadonlyArray<Credential>,
  ) => {
    if (!edit.editable || !definition || !selectedListing || !projectId) return false;
    const existing = owner.attachments ?? [];
    const additions = credentialAttachmentsFor({
      step: owner,
      credentials,
      limit: MAX_WORKFLOW_STEP_ATTACHMENTS,
      newId: () => `resource-${randomUUID()}`,
    });
    if (additions.length === 0) return false;
    return edit
      .run({
        _tag: "stepPut",
        projectId,
        workflow: selectedListing.workflow,
        step: { ...owner, attachments: [...existing, ...additions] },
      })
      .then((result) => result !== null);
  };
  const patchCredentialAttachment = (
    stepId: string,
    attachmentId: string,
    patch: (
      attachment: import("@t3tools/contracts").WorkflowCredentialAttachment,
    ) => import("@t3tools/contracts").WorkflowCredentialAttachment | null,
  ) => {
    if (!edit.editable || !definition || !selectedListing || !projectId) return;
    const owner = definition.steps.find((step) => step.id === stepId);
    const attachment = owner?.attachments?.find((entry) => entry.id === attachmentId);
    if (!owner || !attachment || attachment.kind !== "credential") return;
    const next = patch(attachment);
    if (next === null) return;
    void edit.run({
      _tag: "stepPut",
      projectId,
      workflow: selectedListing.workflow,
      step: {
        ...owner,
        attachments: (owner.attachments ?? []).map((entry) =>
          entry.id === attachmentId ? next : entry,
        ),
      },
    });
  };
  const removeCredentialAttachment = (stepId: string, attachmentId: string) => {
    if (!edit.editable || !definition || !selectedListing || !projectId) return;
    const owner = definition.steps.find((step) => step.id === stepId);
    if (!owner) return;
    void edit.run({
      _tag: "stepPut",
      projectId,
      workflow: selectedListing.workflow,
      step: {
        ...owner,
        attachments: (owner.attachments ?? []).filter((entry) => entry.id !== attachmentId),
      },
    });
  };
  const [credentialSheet, setCredentialSheet] = useState<{
    readonly stepId: string | null;
    readonly templateId: string | null;
    readonly credentialId: CredentialId | null;
  } | null>(null);
  const openCredentialSheet = (input: {
    readonly stepId?: string | null;
    readonly templateId?: string | null;
    readonly credentialId?: CredentialId | null;
  }) =>
    setCredentialSheet({
      stepId: input.stepId ?? null,
      templateId: input.templateId ?? null,
      credentialId: input.credentialId ?? null,
    });
  const resourcePickerProps =
    selectedListing && definition
      ? {
          listing: selectedListing,
          owners: definition.steps,
          disabled: !editMode || !edit.editable || edit.busy,
          contextThreadId: probeContextThreadId,
          workspaceRoot: probeContextWorkspaceRoot,
          modelRevision: probeContextModelRevision,
          onAdd: addWorkflowResource,
          onAttachCredentials: attachCredentials,
          onNewCredential: (
            owner: NonNullable<typeof definition>["steps"][number],
            templateId: string | null,
          ) => openCredentialSheet({ stepId: owner.id, templateId }),
          onOpenCredential: (
            _owner: NonNullable<typeof definition>["steps"][number],
            credentialId: string,
          ) => openCredentialSheet({ credentialId: CredentialId.make(credentialId) }),
          onManageCredentials: () => openCredentialSheet({}),
        }
      : undefined;
  const [newOpen, setNewOpen] = useState(() => consumeWorkflowCreateRequest());
  const [, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(() =>
    threadRef ? consumeWorkflowScheduleRequest(threadRef) : false,
  );
  const detailRef = useRef<HTMLDivElement>(null);
  // Schedule data for the selected workflow. The slug narrows the upstream
  // subscription so even an idle hook read returns the right "next run" chip.
  const schedules = useWorkflowSchedules(
    environmentId,
    selectedListing?.projectId ?? null,
    selectedListing?.workflow ?? null,
  );
  const enabledSchedules = schedules.tasks.filter((task) => task.enabled);
  const workflowTrigger: WorkflowTrigger = enabledSchedules.some(
    (task) => task.schedule.type !== "webhook",
  )
    ? "schedule"
    : enabledSchedules.length > 0
      ? "webhook"
      : (definition?.trigger ?? "manual");
  const credentialActivity = useCredentialActivity(environmentId, workflowRun?.startedAt);
  const canvasReadiness = workflowReadinessForCanvas(workflowRun, selectedListing, editMode);
  const graph = (() => {
    if (definition && !subagentsView) {
      const scopes = new Map(
        (selectedListing?.skills ?? []).map((skill) => [skill.name.toLowerCase(), skill.scope]),
      );
      return buildWorkflowRunGraph(
        canvasView.mode === "run" ? canvasView.run : workflowRun,
        definition,
        selectedListing?.missingSkills ?? [],
        scopes,
        {
          ...credentialActivity,
          readiness: canvasReadiness,
          approval: definition.credentialApprovals,
        },
      );
    }
    if (workflowRun && !subagentsView) {
      return buildWorkflowRunGraph(workflowRun, workflowRun.definition, [], new Map(), {
        ...credentialActivity,
        readiness: canvasReadiness,
        approval: workflowRun.definition.credentialApprovals,
      });
    }
    return buildRunGraph(projection);
  })();
  const nodeIds = graph.nodes.map((node) => node.id);
  const [nodeAnimationState, setNodeAnimationState] = useState<{
    ids: ReadonlyArray<string>;
    known: ReadonlySet<string>;
    entering: ReadonlySet<string>;
  }>(() => ({ ids: nodeIds, known: new Set(nodeIds), entering: new Set() }));
  if (
    nodeIds.length !== nodeAnimationState.ids.length ||
    nodeIds.some((id, index) => id !== nodeAnimationState.ids[index])
  ) {
    const known = new Set([...nodeAnimationState.known, ...nodeIds]);
    setNodeAnimationState({
      ids: nodeIds,
      known,
      entering: new Set(nodeIds.filter((id) => !nodeAnimationState.known.has(id))),
    });
  }
  // The workflow's cards are taller than the subagents' cards: the start card lists the
  // workflow's inputs, and the other cards keep the same shape in every view.
  const nodeSize = subagentsView
    ? RUN_GRAPH_NODE
    : workflowView.compact
      ? COMPACT_NODE
      : { ...RUN_GRAPH_NODE, height: 112 };
  // Steps run top to bottom in a narrow panel and left to right in a wide one, so they stay
  // legible. Width alone decides, so opening the step editor below doesn't flip the layout.
  const [direction, setDirection] = useState<RunGraphDirection>("horizontal");
  const visualNodeSizes = workflowCardSizes(graph, workflowRun, nodeSize, !subagentsView);
  // The latest run of each nested workflow, for the statuses of its steps on an expanded card.
  const latestRunOf = (slug: string) =>
    runsQuery.runs
      .filter((run) => run.workflow === slug)
      .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  const expansions = nestedExpansions({
    nodes: graph.nodes,
    expandedStepIds: new Set(workflowView.expanded),
    parentWorkflow: selectedListing?.workflow ?? "",
    workflows,
    latestRunOf,
    cardSize: (nodeId) => visualNodeSizes.get(nodeId) ?? nodeSize,
  });
  // An expanded card reserves its whole group in the layout; the card itself keeps its size.
  const reservedSizes = new Map(visualNodeSizes);
  for (const expansion of expansions) reservedSizes.set(expansion.nodeId, expansion.box);
  const expandable = new Set(
    graph.nodes.flatMap((node) =>
      node.nestedWorkflow !== undefined &&
      node.workflowStepId !== undefined &&
      canExpandNested({
        workflows,
        parentWorkflow: selectedListing?.workflow ?? "",
        target: node.nestedWorkflow,
      })
        ? [node.workflowStepId]
        : [],
    ),
  );
  const cardSizes = workflowAnnotationLayoutSizes(reservedSizes, graph, definition);
  const canvasDefinition = definition
    ? { ...definition, layout: edit.layout, ...(editMode ? { notes: edit.notes } : {}) }
    : definition;
  const layout = connectionLayout(
    graph,
    workflowCanvasLayout(
      graph,
      layoutRunGraph(graph, nodeSize, direction, cardSizes),
      canvasDefinition?.layout,
      reservedSizes,
    ),
    direction,
  );
  const annotationExtent = canvasDefinition
    ? workflowAnnotationPositions({
        definition: canvasDefinition,
        graph,
        layout,
        visualNodeSizes,
        direction,
        expandedResourceOwners: new Set(),
      })
    : { width: layout.width, height: layout.height };
  // Leave room past the last card for its "+".
  const content =
    editMode && direction === "vertical"
      ? { width: annotationExtent.width, height: annotationExtent.height + 56 }
      : editMode
        ? { width: annotationExtent.width + 56, height: annotationExtent.height }
        : annotationExtent;
  const { viewportRef, viewport, view, zoomBy, resetCamera, handlers } = useCanvasCamera({
    content,
    enabled: !welcome && graph.nodes.length > 0,
  });
  const nextDirection =
    viewport.width > 0 && viewport.width < VERTICAL_BELOW_WIDTH ? "vertical" : "horizontal";
  if (direction !== nextDirection) setDirection(nextDirection);
  const previousDirection = useRef<RunGraphDirection | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the canvas with external store state and committed DOM measurements.
  useEffect(() => {
    if (previousDirection.current !== null && previousDirection.current !== direction)
      resetCamera();
    previousDirection.current = direction;
  }, [direction, resetCamera]);
  const navigate = useNavigate();
  const runActions = useWorkflowPanelRunActions(environmentId, workflowRun);
  const skillDrop = useWorkflowSkillDrop({
    editable: edit.editable,
    listing: selectedListing,
    graph,
    layout,
    view,
    nodeSize,
    onDropSkill: edit.dropSkill,
    onError: setActionError,
    onConfirm: setConfirm,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the canvas with external store state and committed DOM measurements.
  useEffect(
    () =>
      subscribeWorkflowCreateRequest(() => {
        if (consumeWorkflowCreateRequest()) setNewOpen(true);
      }),
    [],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Listen for schedule requests from the external command palette.
  useEffect(
    () =>
      subscribeWorkflowScheduleRequest(() => {
        if (threadRef && consumeWorkflowScheduleRequest(threadRef)) setScheduleOpen(true);
      }),
    [threadRef],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the canvas with external store state and committed DOM measurements.
  useEffect(
    () =>
      subscribeWorkflowSaveRequest(() => {
        if (threadRef && consumeWorkflowSaveRequest(threadRef)) setSaveOpen(true);
      }),
    [threadRef],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the canvas with external store state and committed DOM measurements.
  useEffect(() => {
    if (!selectedStepId) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setSelectedStepId(null);
    };
    const outsideClick = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (
        detailRef.current?.contains(event.target) ||
        event.target.closest(
          "[data-workflow-inspector], [data-workflow-camera-control], [data-workflow-step-card], [data-workflow-note-card], [data-workflow-resource-card]",
        )
      )
        return;
      setSelectedStepId(null);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outsideClick);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outsideClick);
    };
  }, [selectedStepId]);

  const removeStep = edit.removeStep;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the canvas with external store state and committed DOM measurements.
  useEffect(() => {
    if (
      !editMode ||
      !selectedStepId ||
      selectedStepId === "__workflow__" ||
      selectedStepId.startsWith("note/") ||
      selectedStepId.startsWith("attachment/")
    )
      return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      event.preventDefault();
      const stepId = selectedStepId;
      setConfirm({
        title: "Delete workflow step?",
        description: definition
          ? workflowStepRemovalSummary(definition, stepId)
          : "This step will be removed from the saved workflow.",
        confirmLabel: "Delete step",
        onConfirm: () => {
          void removeStep(stepId);
          setSelectedStepId(null);
          setConfirm(null);
        },
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [definition, editMode, selectedStepId, removeStep]);

  const openThread = (threadId: string) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId as ThreadId)),
    });
  };

  const latestChanged =
    editMode && latestRun && selectedListing?.definition
      ? definitionChanged(latestRun.definition, selectedListing.definition)
      : false;

  const addNote = async (x?: number, y?: number) => {
    if (!editMode || !selectedListing || !definition) return;
    const id = `note-${randomUUID()}`;
    const note: WorkflowNote = {
      id,
      text: "",
      ...(x === undefined || y === undefined ? {} : { x, y }),
    };
    const result = await edit.run({
      _tag: "notePut",
      projectId: selectedListing.projectId,
      workflow: selectedListing.workflow,
      note,
    });
    if (result) setSelectedStepId(workflowNoteId(id));
  };

  // The start card opens the workflow settings in every view, a run included. The details
  // slot shows the meta editor for that selection, so it asks for the editable view there.
  const workflowSettingsOpen = selectedStepId === "__workflow__";

  const startRun = async (inputs?: Record<string, string>) => {
    if (!selectedListing || !threadRef) return;
    if (shell) await edit.startRun(threadRef.threadId, inputs);
    else if (
      draftRun &&
      (await draftRun.run(
        selectedListing.workflow,
        selectedListing.definition?.name ?? selectedListing.workflow,
        inputs,
      ))
    )
      setRunInputsOpen(false);
  };

  const workflowName = (slug: string) =>
    workflows.find((entry) => entry.workflow === slug)?.definition?.name ?? slug;
  const openNested = (target: string, stepId?: string) => {
    if (selectedWorkflow === null) return;
    const next = openNestedTrail({ trail: nestTrail, current: selectedWorkflow, target });
    if (next._tag === "refused") return;
    setNestTrail(next.trail);
    setSelectedWorkflow(target);
    setPickedRunId(null);
    setShowSubagents(false);
    if (stepId !== undefined) setEditing(true);
    setSelectedStepId(stepId ?? null);
    resetCamera();
  };
  // The outline opens a step several levels down in one move; the chain starts at the workflow on screen.
  const outlineRunFor = (slug: string) =>
    slug === selectedWorkflow ? workflowRun : latestRunOf(slug);
  const openChain = (chain: ReadonlyArray<string>, stepId: string) => {
    const target = chain[chain.length - 1];
    if (selectedWorkflow === null || chain[0] !== selectedWorkflow || target === undefined) return;
    setNestTrail(chain.slice(0, -1));
    setSelectedWorkflow(target);
    setPickedRunId(null);
    setShowSubagents(false);
    setSelectedStepId(stepId);
    resetCamera();
  };
  const backToTrail = (index: number) => {
    const target = nestTrail[index];
    if (target === undefined) return;
    setNestTrail(nestTrail.slice(0, index));
    setSelectedWorkflow(target);
    setPickedRunId(null);
    setSelectedStepId(null);
    resetCamera();
  };
  const openRun = (runId: string) => {
    const run = runsQuery.runs.find((entry) => entry.id === runId);
    if (!run) return;
    setNestTrail([]);
    setSelectedWorkflow(run.workflow);
    props.onSelectWorkflowRoute?.(run.workflow);
    setPickedRunId(run.id);
    props.onSelectRunRoute?.(run.id);
    setEditing(false);
    setShowSubagents(false);
    setSelectedStepId(null);
    resetCamera();
  };

  const driverChat =
    workflowRun && (pageMode || workflowRun.driverThreadId !== threadRef?.threadId)
      ? {
          id: workflowRun.driverThreadId,
          title: driverShell?.title || workflowRun.driverThreadId,
        }
      : null;

  return (
    <WorkflowConnectionHover>
      <WorkflowPanelHeader
        environmentId={environmentId}
        onFit={graph.nodes.length > 0 ? resetCamera : undefined}
        workflows={workflows}
        selected={selectedListing}
        runs={rootRuns}
        run={workflowRun}
        editMode={editMode}
        showSubagents={subagentsView}
        subagentsAvailable={!pageMode}
        canEdit={edit.canEdit}
        hasProject={projectId !== null}
        busy={runActions.busy || edit.busy || (draftRun?.busy ?? false)}
        canRun={pageMode ? projectId !== null : shell !== null || (draftRun?.canRun ?? false)}
        {...(props.onBack ? { onBack: props.onBack } : {})}
        {...(props.projectName ? { projectName: props.projectName } : {})}
        {...(driverChat
          ? {
              driverChat,
              onOpenDriverChat: () => openThread(driverChat.id),
            }
          : {})}
        onSelectWorkflow={(id) => {
          setRunInputsOpen(false);
          setNestTrail([]);
          setSelectedWorkflow(id);
          props.onSelectWorkflowRoute?.(id);
          setPickedRunId(null);
          props.onSelectRunRoute?.(null);
          setEditing(false);
          setShowSubagents(false);
          setSelectedStepId(null);
          resetCamera();
        }}
        onSelectRun={(id) => {
          setPickedRunId(id);
          props.onSelectRunRoute?.(id);
          setEditing(false);
          setSelectedStepId(null);
          resetCamera();
        }}
        executionControl={
          selectedListing?.definition ? (
            <WorkflowExecutionControl
              key={selectedListing.workflow}
              environmentId={environmentId}
              listing={selectedListing}
              run={canvasView.mode === "run" ? workflowRun : null}
            />
          ) : null
        }
        stepAction={
          projectId ? (
            <div className="flex items-center gap-1">
              <WorkflowStepPicker
                environmentId={environmentId}
                projectId={projectId}
                workflows={workflows}
                workflow={selectedListing?.workflow ?? ""}
                {...(resourcePickerProps
                  ? { resources: { ...resourcePickerProps, defaultOwnerId: selectedOwnerId } }
                  : {})}
                onPick={(choice) => void edit.addStep(choice)}
              >
                <Button variant="outline" size="icon-xs" aria-label="Add a step">
                  <PlusIcon />
                </Button>
              </WorkflowStepPicker>
              {editMode ? (
                <Button
                  variant="outline"
                  size="icon-xs"
                  aria-label="Add note"
                  disabled={
                    !edit.editable ||
                    edit.busy ||
                    (definition?.notes?.length ?? 0) >= MAX_WORKFLOW_NOTES
                  }
                  onClick={() => void addNote()}
                >
                  <StickyNoteIcon />
                </Button>
              ) : null}
            </div>
          ) : null
        }
        onNew={() => setNewOpen(true)}
        {...(!pageMode
          ? {
              onToggleSubagents: () => {
                setShowSubagents(!subagentsView);
                setSelectedStepId(null);
                resetCamera();
              },
              onSaveAsWorkflow: () => setSaveOpen(true),
            }
          : {})}
        canStop={runActions.canStop}
        onStop={() => void runActions.actOnRun("stop")}
        onRun={() => {
          if (pageMode) setRunDialogOpen(true);
          else if (selectedListing?.definition?.inputs?.length) setRunInputsOpen(true);
          else void startRun();
        }}
        onEditWorkflow={() => {
          setPickedRunId(null);
          props.onSelectRunRoute?.(null);
          setEditing(true);
        }}
        latestRun={latestRun}
        changedSinceRun={latestChanged}
        onOpenLastRun={() => {
          if (!latestRun) return;
          setPickedRunId(latestRun.id);
          props.onSelectRunRoute?.(latestRun.id);
          setEditing(false);
        }}
        rerunOf={canvasView.mode === "run" ? canvasView.run.rerunOf : null}
        onOpenBlocker={(stepId) => setSelectedStepId(stepId ?? "__workflow__")}
        onSchedule={() => {
          if (projectId !== null && selectedListing !== null) setScheduleOpen(true);
        }}
        canSchedule={pageMode ? projectId !== null : shell !== null && projectId !== null}
        scheduleDisabledReason={
          !pageMode && shell === null ? "Send the first message to schedule this workflow." : null
        }
        {...(projectId !== null && edit.canEdit
          ? {
              onRefresh: () => void edit.refresh(workflowRun?.id ?? null),
            }
          : {})}
      />
      {parentRun && !subagentsView ? (
        <div className="border-b px-2 py-1">
          <Button
            variant="ghost"
            size="xs"
            aria-label="Back to parent workflow"
            onClick={() => openRun(parentRun.id)}
          >
            <ArrowLeftIcon /> Back to {parentRun.definition.name}
          </Button>
        </div>
      ) : null}
      {pickedRunId && pickedRun === null ? (
        <p role="status" className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          Opening workflow run…
        </p>
      ) : null}
      {selectedListing?.problem ? (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {selectedListing.problem}
        </p>
      ) : null}
      {runsQuery.error ? (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {runsQuery.error}
        </p>
      ) : null}
      {runActions.error ? (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {runActions.error}
        </p>
      ) : null}
      {edit.error ? (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
      {draftRun?.error ? (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {draftRun.error}
        </p>
      ) : null}
      <WorkflowNestTrail
        trail={nestTrail}
        current={selectedWorkflow ?? ""}
        nameOf={workflowName}
        onBackTo={backToTrail}
      />
      <WorkflowInspectorLayout
        surface={pageMode ? "page" : "thread"}
        inspectorKey={selectedStepId}
        inspector={
          selectedStep || selectedNote || selectedResource || workflowSettingsOpen ? (
            <WorkflowPanelDetails
              detailRef={detailRef}
              threadRef={effectiveThreadRef}
              probeContextThreadId={probeContextThreadId}
              probeContextWorkspaceRoot={probeContextWorkspaceRoot}
              probeContextModelRevision={probeContextModelRevision}
              projectId={projectId}
              listing={selectedListing}
              definitionModel={definition?.model}
              selectedStepId={selectedStepId}
              step={selectedStep}
              note={selectedNote}
              resource={selectedResource}
              editMode={editMode || workflowSettingsOpen}
              lastRun={latestRun}
              stepRun={selectedStepRun}
              checks={stepChecks}
              configuredChecks={configuredStepChecks}
              threadShell={selectedStepShell}
              currentRun={workflowRun}
              workflowRunMode={canvasView.mode === "run"}
              onClose={() => setSelectedStepId(null)}
              onDeleted={() => {
                setSelectedStepId(null);
                setNestTrail([]);
                setSelectedWorkflow(null);
                props.onDeletedRoute?.();
              }}
              onOpenThread={openThread}
              onOpenWorkflow={openNested}
              onRunCreated={(runId) => {
                setPickedRunId(runId);
                props.onSelectRunRoute?.(runId);
                setEditing(false);
              }}
            />
          ) : null
        }
      >
        {welcome ? (
          <WorkflowWelcome
            workflows={workflows}
            canCreate={edit.canEdit && projectId !== null}
            onNew={() => setNewOpen(true)}
            onOpen={(slug) => {
              setNestTrail([]);
              setSelectedWorkflow(slug);
              props.onSelectWorkflowRoute?.(slug);
              setPickedRunId(null);
              props.onSelectRunRoute?.(null);
              setEditing(true);
              setShowSubagents(false);
            }}
          />
        ) : workflowView.mode === "outline" && !subagentsView && definition && selectedListing ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <WorkflowOutline
              workflow={selectedListing.workflow}
              definition={definition}
              workflows={workflows}
              runFor={outlineRunFor}
              missingSkills={selectedListing.missingSkills}
              selectedStepId={selectedStepId}
              onSelectRow={(row) =>
                row.chain.length <= 1
                  ? setSelectedStepId(row.stepId)
                  : openChain(row.chain, row.stepId)
              }
            />
            <WorkflowZoomControls
              scale={view.scale}
              onZoomOut={() => undefined}
              onZoomIn={() => undefined}
              onFit={() => undefined}
              showCamera={false}
              {...(workflowViewSwitch ? { viewSwitch: workflowViewSwitch } : {})}
            />
          </div>
        ) : (
          <WorkflowPanelCanvas
            {...(workflowViewSwitch ? { viewSwitch: workflowViewSwitch } : {})}
            threadRef={effectiveThreadRef}
            graph={graph}
            layout={layout}
            visualNodeSizes={visualNodeSizes}
            direction={direction}
            nodeSize={nodeSize}
            view={view}
            camera={{ viewportRef, viewport, zoomBy, resetCamera, handlers }}
            onOpenNested={openNested}
            expansions={expansions}
            expandable={expandable}
            onToggleExpand={(stepId) =>
              viewKey !== null &&
              setWorkflowView(viewKey, {
                expanded: workflowView.expanded.includes(stepId)
                  ? workflowView.expanded.filter((id) => id !== stepId)
                  : [...workflowView.expanded, stepId],
              })
            }
            onOpenExpandedStep={openNested}
            canEdit={edit.canEdit}
            editMode={editMode}
            showSubagents={subagentsView}
            dropActive={skillDrop.dropActive}
            dropTarget={skillDrop.dropTarget}
            definition={canvasDefinition}
            workflowRun={workflowRun}
            runs={runsQuery.runs}
            selectedListing={selectedListing}
            workflows={workflows}
            {...(resourcePickerProps ? { resources: resourcePickerProps } : {})}
            projectId={projectId}
            busy={runActions.busy}
            canApprove={runActions.canApprove}
            triggers={[
              ...schedules.tasks.map((task) => {
                const binding = workflowScheduleBinding(task);
                const baseLabel =
                  task.schedule.type === "webhook"
                    ? "Webhook"
                    : task.schedule.type === "interval"
                      ? `Every ${task.schedule.everyMs / 60000}m`
                      : task.schedule.type === "fixed_time"
                        ? task.schedule.timeOfDay
                        : "Once";
                const hints = [
                  binding?.carryOver ? "↻ carry-over" : "",
                  binding?.rotate ? `↻ rotates ${binding.rotate.inputId}` : "",
                ].filter(Boolean);
                return {
                  id: task.id,
                  label: [baseLabel, ...hints].join(" · "),
                  enabled: task.enabled,
                };
              }),
              ...(selectedListing?.definition?.startAfter ?? []).map((trigger) => ({
                id: `after:${trigger.workflow}`,
                label: `After ${trigger.workflow}`,
                enabled: trigger.enabled !== false,
              })),
            ]}
            onManual={() => {
              if (pageMode) setRunDialogOpen(true);
              else if (selectedListing?.definition?.inputs?.length) setRunInputsOpen(true);
              else void startRun();
            }}
            onTrigger={() => setScheduleOpen(true)}
            canResume={runActions.canResume}
            enteringNodeIds={nodeAnimationState.entering}
            {...(schedules.nextRunAt !== null ? { nextRunAt: schedules.nextRunAt } : {})}
            trigger={workflowTrigger}
            onNew={() => setNewOpen(true)}
            onBackToWorkflow={() => setShowSubagents(false)}
            onOpenThread={openThread}
            onOpenRun={openRun}
            onSelectStep={setSelectedStepId}
            selectedCanvasItemId={selectedStepId}
            onAddNoteAt={(x, y) => void addNote(x, y)}
            canAddNote={editMode && (definition?.notes?.length ?? 0) < MAX_WORKFLOW_NOTES}
            onTidy={
              edit.canEdit && definition && !subagentsView
                ? () => void edit.setLayout({}, true)
                : undefined
            }
            onMoveNote={(id, x, y) => void edit.moveNote(id, x, y)}
            onOpenWorkflowSettings={() => setSelectedStepId("__workflow__")}
            onNodeAppeared={(nodeId) =>
              setNodeAnimationState((current) => {
                const entering = new Set(current.entering);
                entering.delete(nodeId);
                return { ...current, entering };
              })
            }
            onActOnRun={(action, stepId) => void runActions.actOnRun(action, stepId)}
            onInsert={(from, to, choice) => void edit.insertBetween(from, to, choice)}
            onAppend={(after, choice) => void edit.addStep(choice, after)}
            onMoveCard={(key, position) => void edit.setLayout({ [key]: position })}
            onUnlinkSteps={(sourceId, targetId) => void edit.unlinkSteps(sourceId, targetId)}
            onLinkSteps={(sourceId, targetId) => void edit.linkSteps(sourceId, targetId)}
            onPutLoop={(loop) => void edit.putLoop(loop)}
            onRemoveLoop={(loopId) => void edit.removeLoop(loopId)}
            defaultLoopMaxRounds={3}
            onChooseCredential={(stepId, attachmentId, credentialId) =>
              patchCredentialAttachment(stepId, attachmentId, (attachment) =>
                bindCredentialAttachment(attachment, credentialId),
              )
            }
            onAddCredential={(stepId, templateId) => openCredentialSheet({ stepId, templateId })}
            onFixCredential={(_stepId, credentialId) =>
              openCredentialSheet({
                credentialId: credentialId === undefined ? null : CredentialId.make(credentialId),
              })
            }
            onManageCredentials={() => openCredentialSheet({})}
            onRemoveCredential={(stepId, attachmentId) =>
              removeCredentialAttachment(stepId, attachmentId)
            }
            onDragEnter={skillDrop.onDragEnter}
            onDragOver={skillDrop.onDragOver}
            onDragLeave={skillDrop.onDragLeave}
            onDrop={(event) => void skillDrop.onDrop(event)}
          />
        )}
      </WorkflowInspectorLayout>
      {projectId ? (
        <WorkflowNewDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          environmentId={environmentId}
          projectId={projectId}
          workflows={workflows}
          onCreated={(slug) => {
            setNestTrail([]);
            setSelectedWorkflow(slug);
            props.onSelectWorkflowRoute?.(slug);
            setPickedRunId(null);
            props.onSelectRunRoute?.(null);
            setEditing(true);
            setShowSubagents(false);
          }}
        />
      ) : null}
      {projectId && threadRef && saveOpen ? (
        <WorkflowSaveDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          environmentId={environmentId}
          projectId={projectId}
          threadId={threadRef.threadId}
          onCreated={(slug) => {
            setNestTrail([]);
            setSelectedWorkflow(slug);
            setPickedRunId(null);
            setShowSubagents(false);
            setEditing(true);
          }}
        />
      ) : null}
      <WorkflowConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? "Confirm workflow change"}
        description={confirm?.description ?? ""}
        {...(confirm ? { confirmLabel: confirm.confirmLabel } : {})}
        onCancel={() => {
          setConfirm(null);
        }}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
      />
      {runInputsOpen && selectedListing ? (
        <WorkflowRunInputsDialog
          key={selectedListing.workflow}
          listing={selectedListing}
          busy={edit.busy || (draftRun?.busy ?? false)}
          error={edit.error ?? draftRun?.error ?? null}
          onStart={(inputs) => void startRun(inputs)}
          onClose={() => setRunInputsOpen(false)}
        />
      ) : null}
      {runDialogOpen && projectId !== null && selectedListing !== null ? (
        <WorkflowRunDialog
          key={selectedListing.workflow}
          environmentId={environmentId}
          projectId={projectId}
          listing={selectedListing}
          onClose={() => setRunDialogOpen(false)}
          onStarted={({ threadId }) => {
            openStartedWorkflowInThread(
              navigate,
              environmentId,
              threadId,
              selectedListing.workflow,
            );
          }}
        />
      ) : null}
      <WorkflowCredentialsSheet
        environmentId={environmentId}
        open={credentialSheet !== null}
        onOpenChange={(open) => {
          if (!open) setCredentialSheet(null);
        }}
        presetTemplateId={credentialSheet?.templateId ?? null}
        focusCredentialId={credentialSheet?.credentialId ?? null}
        onCredentialCreated={(credential) => {
          const target = credentialSheet?.stepId ?? null;
          setCredentialSheet(null);
          if (target === null) return;
          const owner = definition?.steps.find((step) => step.id === target);
          if (owner) void attachCredentials(owner, [credential]);
        }}
      />
      {scheduleOpen &&
      projectId !== null &&
      selectedListing !== null &&
      (pageMode || shell !== null) ? (
        <WorkflowSchedulePanel
          runs={runsForWorkflow}
          onOpenRun={(id) => {
            setPickedRunId(id);
            setScheduleOpen(false);
          }}
          environmentId={environmentId}
          projectId={projectId}
          workflow={selectedListing}
          driverThreadId={shell?.id ?? null}
          {...(projectDriverThreads ? { driverThreads: projectDriverThreads } : {})}
          onClose={() => setScheduleOpen(false)}
        />
      ) : null}
    </WorkflowConnectionHover>
  );
}
