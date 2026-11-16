import { WorkflowWaitBadge } from "./WorkflowWaitBadge";
import { useConnectionHover } from "./WorkflowConnectionHover";
import { WorkflowCredentialSatelliteCard } from "./WorkflowCredentialSatellite";
import { workflowCardKey } from "./workflowCanvasLayout";
import {
  workflowResourceCardKey,
  type ProjectId,
  type ScopedThreadRef,
  type WorkflowDefinition,
  type WorkflowListing,
  type WorkflowLoop,
  type WorkflowRun,
  type WorkflowTrigger,
} from "@t3tools/contracts";
import {
  useEffect,
  useState,
  type DragEventHandler,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { PlusIcon, RotateCcwIcon, WorkflowIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import { WorkflowCanvasCard } from "./WorkflowCanvasCard";
import { WorkflowCanvasEditLayer } from "./WorkflowCanvasEditLayer";
import { WorkflowZoomControls } from "./WorkflowZoomControls";
import { WorkflowExpandedSteps } from "./WorkflowExpandedSteps";
import type { NestedExpansion } from "./workflowExpansion";
import type { WorkflowViewMode } from "./workflowViewPrefs";
import { DOT_GRID, hasVisibleCard, type Camera } from "./canvasCamera";
import {
  connectionLanes,
  feedbackConnectionLanes,
  feedbackConnectionPath,
  skipConnectionPath,
} from "./workflowConnections";
import { canvasSpots, edgeEnds, edgePath, stepIdOfNode } from "./canvasSpots";
import type { RunGraph, RunGraphNode } from "./runGraph";
import type { RunGraphDirection, RunGraphLayout } from "./runGraphLayout";
import { useCanvasCamera } from "./useCanvasCamera";
import { useCanvasGestures } from "./useCanvasGestures";
import { canLoopBack, canReadFrom, uniqueLoopId } from "./workflowEditing";
import { isWorkflowSkillStep, type WorkflowStepChoice } from "./workflowStep";
import { WorkflowStepActivityLine } from "./WorkflowStepActivityLine";
import { WorkflowOutputStrip } from "./WorkflowOutputStrip";
import { useWorkflowCanvasMotion } from "./useWorkflowCanvasMotion";
import { workflowStartInputs } from "./WorkflowStartCardBody";
import { WorkflowNoteCard } from "./WorkflowNoteCard";
import { WorkflowResourceCard } from "./WorkflowResourceCard";
import { attachmentChipCounts } from "./WorkflowAttachmentCard";
import { workflowReadinessForCanvas } from "./workflowState";
import { resourceAttachmentsOf } from "./workflowCredentialAttachments";
import { useThreadShells } from "../state/entities";
import { formatModelSlugName } from "@t3tools/shared/model";
import {
  workflowAnnotationPositions,
  workflowAttachmentId,
  workflowNoteId,
} from "./workflowAnnotations";

type CameraState = ReturnType<typeof useCanvasCamera>;

export function WorkflowPanelCanvas({
  camera: { viewportRef, ...camera },
  ...props
}: {
  readonly threadRef: ScopedThreadRef;
  readonly graph: RunGraph;
  readonly layout: RunGraphLayout;
  readonly visualNodeSizes: ReadonlyMap<
    string,
    { readonly width: number; readonly height: number }
  >;
  readonly direction: RunGraphDirection;
  readonly nodeSize: { readonly width: number; readonly height: number };
  readonly view: Camera;
  readonly camera: Pick<
    CameraState,
    "viewportRef" | "viewport" | "zoomBy" | "resetCamera" | "handlers"
  >;
  readonly canEdit: boolean;
  readonly editMode: boolean;
  readonly showSubagents: boolean;
  readonly dropActive: boolean;
  readonly dropTarget: string | null;
  readonly definition: WorkflowDefinition | null;
  readonly workflowRun: WorkflowRun | null;
  readonly runs: ReadonlyArray<WorkflowRun>;
  readonly selectedListing: WorkflowListing | null;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly resources?: import("./WorkflowStepPicker").WorkflowResourcePickerContext;
  readonly projectId: ProjectId | null;
  readonly busy: boolean;
  readonly canApprove: boolean;
  readonly canResume: boolean;
  readonly enteringNodeIds: ReadonlySet<string>;
  /** ISO timestamp of the workflow's next scheduled run, when one is set. */
  readonly nextRunAt?: string | null;
  /** How the workflow starts: by hand, on a schedule, or from a webhook. */
  readonly triggers?: ReadonlyArray<{ id: string; label: string; enabled: boolean }>;
  readonly onManual?: () => void;
  readonly onTrigger?: () => void;
  readonly trigger: WorkflowTrigger;
  readonly onNew: () => void;
  readonly onBackToWorkflow: () => void;
  readonly onOpenThread: (threadId: string) => void;
  readonly onOpenRun: (runId: string) => void;
  readonly onSelectStep: (stepId: string) => void;
  readonly selectedCanvasItemId: string | null;
  readonly onAddNoteAt: (x: number, y: number) => void;
  readonly canAddNote: boolean;
  readonly onTidy?: (() => void) | undefined;
  readonly onMoveNote: (noteId: string, x: number, y: number) => void;
  /** The start card opens the workflow settings, in every view. */
  readonly onOpenWorkflowSettings: () => void;
  /** Opens a nested-workflow card's workflow in the panel. Absent where nesting can't navigate. */
  readonly onOpenNested?: (workflow: string) => void;
  /** Nested cards opened into their steps, drawn as groups beneath them. */
  readonly expansions?: ReadonlyArray<NestedExpansion>;
  /** Step ids of nested cards whose steps can be listed, so they get the show/hide toggle. */
  readonly expandable?: ReadonlySet<string>;
  readonly onToggleExpand?: (stepId: string) => void;
  /** Opens a step inside an expanded group: its workflow, with that step selected. */
  readonly onOpenExpandedStep?: (workflow: string, stepId: string) => void;
  /** The canvas/outline switch and compact toggle. Absent in previews, which stay one view. */
  readonly viewSwitch?: {
    readonly view: WorkflowViewMode;
    readonly onView: (view: WorkflowViewMode) => void;
    readonly compact: boolean;
    readonly onCompact: (compact: boolean) => void;
  };
  readonly onNodeAppeared: (nodeId: string) => void;
  readonly onActOnRun: (action: "approval" | "resume", stepId: string) => void;
  readonly onInsert: (from: string | null, to: string, choice: WorkflowStepChoice) => void;
  readonly onAppend: (after: string | null, choice: WorkflowStepChoice) => void;
  readonly onMoveCard: (key: string, position: { x: number; y: number }) => void;
  readonly onUnlinkSteps?: (sourceId: string, targetId: string) => void;
  readonly onLinkSteps: (sourceId: string, targetId: string) => void;
  readonly onPutLoop?: (loop: WorkflowLoop) => void;
  readonly onRemoveLoop?: (loopId: string) => void;
  readonly defaultLoopMaxRounds?: number;
  /** A credential satellite's inline actions; the panel owns the vault sheet and edits. */
  readonly onChooseCredential: (stepId: string, attachmentId: string, credentialId: string) => void;
  readonly onAddCredential: (stepId: string, templateId: string) => void;
  readonly onFixCredential: (stepId: string, credentialId: string | undefined) => void;
  readonly onManageCredentials: () => void;
  readonly onRemoveCredential: (stepId: string, attachmentId: string) => void;
  readonly onDragEnter: DragEventHandler<HTMLDivElement>;
  readonly onDragOver: DragEventHandler<HTMLDivElement>;
  readonly onDragLeave: DragEventHandler<HTMLDivElement>;
  readonly onDrop: DragEventHandler<HTMLDivElement>;
}) {
  const { graph, layout, nodeSize } = props;
  const lanes = connectionLanes(graph, layout, props.direction);
  const feedbackLanes = feedbackConnectionLanes(graph, layout, props.direction);
  const { connection, setConnection } = useConnectionHover();
  const hoveredEdge = connection
    ? (graph.edges.find(
        (edge) =>
          edge.sourceStepId === connection.source && edge.targetStepId === connection.target,
      )?.id ?? null)
    : null;
  const setHoveredEdge = (id: string | null) => {
    const edge = graph.edges.find((entry) => entry.id === id);
    setConnection(
      edge?.sourceStepId && edge.targetStepId
        ? { source: edge.sourceStepId, target: edge.targetStepId }
        : null,
    );
  };
  const motionRef = useWorkflowCanvasMotion(graph.nodes[0]?.id ?? null);
  const { width: nodeWidth, height: nodeHeight } = nodeSize;
  const statusById = new Map(graph.nodes.map((node) => [node.id, node.status]));
  const cardKeyById = new Map(graph.nodes.map((node) => [node.id, workflowCardKey(node)]));
  const checksByStep = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === "check" && node.checkFor)
      checksByStep.set(node.checkFor, (checksByStep.get(node.checkFor) ?? 0) + 1);
  }
  const activityThreads = new Map<string, number>();
  const activityRuns =
    props.workflowRun && !props.runs.some((run) => run.id === props.workflowRun!.id)
      ? [...props.runs, props.workflowRun]
      : props.runs;
  for (const run of activityRuns) {
    for (const step of run.steps) {
      if (step.status !== "running" || step.childRunId || !step.threadId) continue;
      activityThreads.set(step.threadId, (activityThreads.get(step.threadId) ?? 0) + 1);
    }
  }
  const editing = props.editMode && props.canEdit && props.definition !== null;
  const runIsActive =
    props.workflowRun?.status === "running" || props.workflowRun?.status === "waiting";
  const latestWorkflowRun = props.runs
    .filter((run) => run.parent === undefined && run.workflow === props.selectedListing?.workflow)
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const latestFinishedRun =
    latestWorkflowRun &&
    latestWorkflowRun.status !== "running" &&
    latestWorkflowRun.status !== "waiting" &&
    latestWorkflowRun.endedAt !== undefined
      ? latestWorkflowRun
      : null;
  // The workflow's own graph starts with one card: the workflow itself. The subagents graph
  // has workflow nodes of its own, so the start card is only the first node of the workflow.
  const startNodeId =
    props.definition !== null && !props.showSubagents
      ? (graph.nodes.find((node) => node.kind === "workflow")?.id ?? null)
      : null;
  // A run shows the values it was started with; the saved workflow only what it asks for.
  const showValues = !props.editMode && props.workflowRun !== null;
  const startInputs = workflowStartInputs({
    definition: props.definition,
    run: props.workflowRun,
    showValues,
  });
  const [linkDrop, setLinkDrop] = useState<{
    sourceId: string;
    x: number;
    y: number;
  } | null>(null);
  const [loopOffer, setLoopOffer] = useState<{
    fromId: string;
    toId: string;
    x: number;
    y: number;
  } | null>(null);
  const [expandedResourceOwners, setExpandedResourceOwners] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [noteDrop, setNoteDrop] = useState<{ x: number; y: number } | null>(null);
  // The "Add note here" and "Make a loop" offers are transient: Escape or any press outside withdraws them.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observe the mounted canvas element and release the observer on cleanup.
  useEffect(() => {
    if (!noteDrop && !loopOffer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNoteDrop(null);
        setLoopOffer(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [noteDrop, loopOffer]);
  const annotations = props.definition
    ? workflowAnnotationPositions({
        definition: props.definition,
        graph,
        layout,
        visualNodeSizes: props.visualNodeSizes,
        direction: props.direction,
        expandedResourceOwners,
      })
    : {
        notes: new Map(),
        resources: new Map(),
        credentials: new Map(),
        width: layout.width,
        height: layout.height,
      };
  const readiness = workflowReadinessForCanvas(
    props.workflowRun,
    props.selectedListing,
    props.editMode,
  );
  const spots = editing
    ? canvasSpots(graph, layout, { width: nodeWidth, height: nodeHeight }, props.direction)
    : [];
  const gestures = useCanvasGestures({
    enabled: props.canEdit && props.definition !== null,
    viewportRef: viewportRef,
    view: props.view,
    graph,
    layout,
    nodeSize,
    direction: props.direction,
    definition: props.definition,
    onPosition: (key, position) => {
      if (key.startsWith("note:")) props.onMoveNote(key.slice(5), position.x, position.y);
      else {
        const reserve =
          props.direction === "horizontal" && lanes.size > 0
            ? (Math.max(...lanes.values()) + 1) * 32 + 24
            : 0;
        props.onMoveCard(key, { ...position, y: Math.max(0, position.y - reserve) });
      }
    },
    onLink: (sourceId, targetId, invalidTargetId, point) => {
      if (targetId !== null) {
        if (props.definition && canLoopBack(props.definition, sourceId, targetId)) {
          setLoopOffer({ fromId: sourceId, toId: targetId, ...point });
        } else {
          props.onLinkSteps(sourceId, targetId);
        }
      } else if (invalidTargetId === null) setLinkDrop({ sourceId, ...point });
    },
  });
  const { gesture, setLinkPreviewElement } = gestures;
  const threadShells = useThreadShells();
  const threadShellsById = new Map(
    threadShells
      .filter((shell) => shell.environmentId === props.threadRef.environmentId)
      .map((shell) => [shell.id, shell] as const),
  );
  const nestedToggle = (node: RunGraphNode) => {
    const stepId = node.workflowStepId;
    if (node.nestedWorkflow === undefined || stepId === undefined) return {};
    if (!props.onToggleExpand || !props.expandable?.has(stepId)) return {};
    const onToggle = props.onToggleExpand;
    return {
      expanded: props.expansions?.some((expansion) => expansion.stepId === stepId) === true,
      onToggleExpand: () => onToggle(stepId),
    };
  };
  const stepNodes = graph.nodes.filter((node) => node.kind === "step");
  const cards = (stepNodes.length > 0 ? stepNodes : graph.nodes).flatMap((node) => {
    const position = layout.positions.get(node.id);
    return position ? [{ ...position, ...(props.visualNodeSizes.get(node.id) ?? nodeSize) }] : [];
  });
  const stepsOffscreen =
    camera.viewport.width > 0 &&
    camera.viewport.height > 0 &&
    cards.length > 0 &&
    !hasVisibleCard(props.view, camera.viewport, cards);
  // Edge endpoints are mirrored onto the path so a card drag can re-route its edges without a
  // React render per pointer move. Only the edit canvas drags cards.
  const dragEdge = (
    from: string | null | undefined,
    to: string | null | undefined,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) =>
    editing && from != null && to != null
      ? {
          "data-canvas-edge-from": from,
          "data-canvas-edge-to": to,
          "data-start-x": start.x,
          "data-start-y": start.y,
          "data-end-x": end.x,
          "data-end-y": end.y,
        }
      : {};

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label="Workflow canvas"
      tabIndex={0}
      className={cn(
        "relative min-h-0 flex-1 touch-none overflow-hidden",
        graph.nodes.length > 0 && "cursor-grab active:cursor-grabbing",
      )}
      style={DOT_GRID}
      onPointerEnter={camera.handlers.onPointerEnter}
      onPointerLeave={camera.handlers.onPointerLeave}
      onWheel={camera.handlers.onWheel}
      onPointerDown={(event) => {
        if (
          noteDrop &&
          !(event.target instanceof Element && event.target.closest("[data-workflow-note-drop]"))
        )
          setNoteDrop(null);
        if (
          loopOffer &&
          !(event.target instanceof Element && event.target.closest("[data-workflow-loop-offer]"))
        )
          setLoopOffer(null);
        camera.handlers.onPointerDown(event);
      }}
      onPointerMove={camera.handlers.onPointerMove}
      onPointerUp={camera.handlers.onPointerUp}
      onPointerCancel={camera.handlers.onPointerCancel}
      onDragEnter={props.onDragEnter}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onContextMenu={(event) => {
        const target = event.target;
        if (
          !editing ||
          !props.canAddNote ||
          !(target instanceof Element) ||
          target.closest("[data-canvas-no-pan], [data-workflow-node]")
        )
          return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        setNoteDrop({
          x: Math.max(0, (event.clientX - bounds.left - props.view.x) / props.view.scale),
          y: Math.max(0, (event.clientY - bounds.top - props.view.y) / props.view.scale),
        });
      }}
    >
      {props.dropActive && props.editMode ? (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed border-primary/50 bg-background/60 text-xs text-muted-foreground">
          {props.dropTarget ? "Replace this step’s skill" : "Drop a SKILL.md to add a step"}
        </div>
      ) : null}
      {graph.nodes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <WorkflowIcon className="size-5 text-muted-foreground" />
          {props.showSubagents ? (
            <>
              <p className="text-sm font-medium">No subagents in this thread yet</p>
              <p className="max-w-64 text-xs text-muted-foreground">
                Work the chat agent hands to subagents shows up here.
              </p>
              <Button variant="outline" size="xs" onClick={props.onBackToWorkflow}>
                Back to workflow
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">No workflows yet</p>
              <Button variant="outline" size="xs" disabled={!props.canEdit} onClick={props.onNew}>
                New workflow
              </Button>
            </>
          )}
        </div>
      ) : (
        <div
          ref={motionRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: annotations.width,
            height: annotations.height,
            transform: `translate(${props.view.x}px, ${props.view.y}px) scale(${props.view.scale})`,
          }}
        >
          <svg
            aria-label="Workflow connections"
            className="absolute inset-0 overflow-visible"
            width={annotations.width}
            height={annotations.height}
          >
            <defs>
              <marker
                id="workflow-feedback-arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 8 5 L 0 9 z" className="fill-primary" />
              </marker>
              <marker
                id="workflow-feedback-arrow-warning"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 8 5 L 0 9 z" className="fill-warning" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const from = layout.positions.get(edge.from);
              const to = layout.positions.get(edge.to);
              if (!from || !to) return null;
              const fromSize =
                props.visualNodeSizes.get(edge.from) ??
                layout.nodeSizes?.get(edge.from) ??
                nodeSize;
              const toSize =
                props.visualNodeSizes.get(edge.to) ?? layout.nodeSizes?.get(edge.to) ?? nodeSize;
              const { start, end } = edgeEnds(from, to, fromSize, props.direction, toSize);
              if (edge.kind === "feedback") {
                const lane = feedbackLanes.get(edge.id) ?? 0;
                const vertical = props.direction === "vertical";
                const highestLane = Math.max(...feedbackLanes.values());
                const rail = vertical
                  ? 16 + (highestLane - lane) * 36
                  : layout.height - 16 - (highestLane - lane) * 36;
                const a = vertical
                  ? { x: from.x, y: from.y + fromSize.height / 2 }
                  : { x: from.x + fromSize.width / 2, y: from.y + fromSize.height };
                const b = vertical
                  ? { x: to.x, y: to.y + toSize.height / 2 }
                  : { x: to.x + toSize.width / 2, y: to.y + toSize.height };
                const labelPos = vertical
                  ? { x: (a.x + b.x) / 8 + rail * 0.75, y: (a.y + b.y) / 2 }
                  : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 8 + rail * 0.75 };
                const labelText = edge.label ?? "↺ loop";
                const title = `${graph.nodes.find((node) => node.id === edge.from)?.title} loops back to ${graph.nodes.find((node) => node.id === edge.to)?.title}`;
                return (
                  <g
                    key={edge.id}
                    data-workflow-loop={edge.loopId}
                    data-tour="loop-arc"
                    onPointerEnter={() => setHoveredEdge(edge.id)}
                    onPointerLeave={() => setHoveredEdge(null)}
                  >
                    <title>{title}</title>
                    <path
                      d={feedbackConnectionPath(a, b, rail, props.direction)}
                      fill="none"
                      strokeWidth={hoveredEdge === edge.id ? 2 : 1.5}
                      markerEnd={
                        edge.exhausted
                          ? "url(#workflow-feedback-arrow-warning)"
                          : "url(#workflow-feedback-arrow)"
                      }
                      className={
                        edge.exhausted
                          ? "stroke-warning"
                          : hoveredEdge === edge.id
                            ? "stroke-primary"
                            : "stroke-primary/80"
                      }
                    />
                    <foreignObject x={labelPos.x - 110} y={labelPos.y - 13} width={220} height={26}>
                      <div
                        className={cn(
                          "group mx-auto flex w-fit max-w-full items-center justify-center gap-1 rounded-full border bg-background px-2 py-0.5 text-2xs",
                          edge.exhausted
                            ? "border-warning/50 text-warning"
                            : "border-primary/40 text-primary",
                        )}
                        data-canvas-no-pan
                      >
                        <button
                          type="button"
                          className="truncate"
                          aria-label={title}
                          onClick={() => edge.sourceStepId && props.onSelectStep(edge.sourceStepId)}
                        >
                          {labelText}
                        </button>
                        {editing && edge.loopId ? (
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label={`Remove ${title}`}
                            onClick={() => props.onRemoveLoop?.(edge.loopId!)}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    </foreignObject>
                  </g>
                );
              }
              if (edge.kind === "skip") {
                const lane = lanes.get(edge.id) ?? 0;
                const vertical = props.direction === "vertical";
                const highestLane = Math.max(...lanes.values());
                const rail = vertical
                  ? layout.width - 16 - (highestLane - lane) * 32
                  : 16 + (highestLane - lane) * 32;
                const a = vertical
                  ? {
                      x: from.x + (props.visualNodeSizes.get(edge.from) ?? nodeSize).width,
                      y: from.y + (props.visualNodeSizes.get(edge.from) ?? nodeSize).height / 2,
                    }
                  : {
                      x: from.x + (props.visualNodeSizes.get(edge.from) ?? nodeSize).width / 2,
                      y: from.y,
                    };
                const b = vertical
                  ? {
                      x: to.x + (props.visualNodeSizes.get(edge.to) ?? nodeSize).width,
                      y: to.y + (props.visualNodeSizes.get(edge.to) ?? nodeSize).height / 2,
                    }
                  : {
                      x: to.x + (props.visualNodeSizes.get(edge.to) ?? nodeSize).width / 2,
                      y: to.y,
                    };
                const label = vertical
                  ? { x: (a.x + b.x) / 8 + rail * 0.75, y: (a.y + b.y) / 2 }
                  : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 8 + rail * 0.75 };
                const title = `${graph.nodes.find((node) => node.id === edge.to)?.title} reads ${graph.nodes.find((node) => node.id === edge.from)?.title}`;
                return (
                  <g
                    key={edge.id}
                    data-tour="reads-arc"
                    onPointerEnter={() => setHoveredEdge(edge.id)}
                    onPointerLeave={() => setHoveredEdge(null)}
                  >
                    <title>{title}</title>
                    <path
                      d={skipConnectionPath(a, b, rail, props.direction)}
                      fill="none"
                      strokeWidth={hoveredEdge === edge.id ? 2 : 1.25}
                      strokeDasharray="5 4"
                      className={
                        hoveredEdge === edge.id ? "stroke-primary" : "stroke-muted-foreground/60"
                      }
                    />
                    <foreignObject x={label.x - 35} y={label.y - 12} width={70} height={28}>
                      <div
                        className="group flex items-center justify-center gap-1 rounded bg-background text-xs text-muted-foreground"
                        data-canvas-no-pan
                      >
                        <button
                          type="button"
                          aria-label={title}
                          onClick={() => edge.targetStepId && props.onSelectStep(edge.targetStepId)}
                        >
                          reads
                        </button>
                        {editing && edge.sourceStepId && edge.targetStepId ? (
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label={`Remove ${title}`}
                            onClick={() =>
                              props.onUnlinkSteps?.(edge.sourceStepId!, edge.targetStepId!)
                            }
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    </foreignObject>
                  </g>
                );
              }
              // A check hangs off its step as a tether, not a flow edge, so it draws like the others.
              const tether = graph.nodes.find((node) => node.id === edge.to)?.kind === "check";
              return (
                <path
                  key={edge.id}
                  data-workflow-edge={edge.id}
                  {...dragEdge(cardKeyById.get(edge.from), cardKeyById.get(edge.to), start, end)}
                  pathLength={1}
                  d={edgePath(start, end, props.direction)}
                  fill="none"
                  strokeWidth={tether ? 1.25 : 1.5}
                  {...(tether ? { strokeDasharray: "3 4" } : {})}
                  className={
                    statusById.get(edge.to) === "running"
                      ? "stroke-primary/60"
                      : tether
                        ? "stroke-muted-foreground/45"
                        : "stroke-muted-foreground/35"
                  }
                />
              );
            })}
            {graph.nodes.flatMap((node) =>
              (node.credentials ?? []).map((entry) => {
                const key = entry.key;
                const position = annotations.credentials.get(key);
                const owner = layout.positions.get(node.id);
                if (!position || !owner) return null;
                const size = props.visualNodeSizes.get(node.id) ?? nodeSize;
                const start = { x: owner.x + size.width / 2, y: owner.y + size.height };
                const end = { x: position.x + 18, y: position.y };
                return (
                  <path
                    key={key}
                    {...dragEdge(workflowCardKey(node), key, start, end)}
                    d={edgePath(start, end, "vertical")}
                    fill="none"
                    strokeWidth={1.25}
                    strokeDasharray="3 4"
                    className="stroke-muted-foreground/45"
                  />
                );
              }),
            )}
            {props.definition?.steps.flatMap((step) => {
              const ownerNode = graph.nodes.find(
                (node) => node.kind === "step" && node.workflowStepId === step.id,
              );
              const ownerPosition = ownerNode ? layout.positions.get(ownerNode.id) : undefined;
              const ownerSize = ownerNode
                ? (props.visualNodeSizes.get(ownerNode.id) ??
                  layout.nodeSizes?.get(ownerNode.id) ??
                  nodeSize)
                : nodeSize;
              if (!ownerPosition || !step.attachments?.length) return [];
              return step.attachments.flatMap((attachment) => {
                const satellite = annotations.resources.get(`${step.id}/${attachment.id}`);
                if (!satellite) return [];
                const start = {
                  x: ownerPosition.x + ownerSize.width / 2,
                  y: ownerPosition.y + ownerSize.height,
                };
                const end = { x: satellite.x + 18, y: satellite.y };
                return (
                  <path
                    key={`uses:${step.id}:${attachment.id}`}
                    {...dragEdge(
                      step.id,
                      workflowResourceCardKey(step.id, attachment.id),
                      start,
                      end,
                    )}
                    d={`M ${start.x} ${start.y} C ${start.x} ${start.y + 8}, ${end.x} ${end.y - 8}, ${end.x} ${end.y}`}
                    fill="none"
                    strokeWidth={1.25}
                    strokeDasharray="3 4"
                    className="stroke-muted-foreground/45"
                  />
                );
              });
            }) ?? null}
            {props.definition?.notes?.flatMap((note) => {
              if (!note.anchorStepId) return [];
              const ownerNode = graph.nodes.find(
                (node) => node.kind === "step" && node.workflowStepId === note.anchorStepId,
              );
              const ownerPosition = ownerNode ? layout.positions.get(ownerNode.id) : undefined;
              const notePosition = annotations.notes.get(note.id);
              if (!ownerPosition || !notePosition) return [];
              const ownerSize = ownerNode
                ? (props.visualNodeSizes.get(ownerNode.id) ??
                  layout.nodeSizes?.get(ownerNode.id) ??
                  nodeSize)
                : nodeSize;
              const start = {
                x: ownerPosition.x + ownerSize.width / 2,
                y: ownerPosition.y + ownerSize.height,
              };
              const end = { x: notePosition.x + 16, y: notePosition.y };
              return (
                <path
                  key={`note:${note.id}`}
                  {...dragEdge(note.anchorStepId, `note:${note.id}`, start, end)}
                  d={`M ${start.x} ${start.y} C ${start.x} ${start.y + 8}, ${end.x} ${end.y - 8}, ${end.x} ${end.y}`}
                  fill="none"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  className="stroke-warning/50"
                />
              );
            }) ?? null}
            <path
              ref={setLinkPreviewElement}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              className="stroke-primary"
            />
          </svg>
          {graph.nodes.map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            const workflowStepId = node.workflowStepId ?? node.approvalFor ?? node.checkFor;
            const step =
              workflowStepId === undefined
                ? undefined
                : props.workflowRun?.steps.find((entry) => entry.stepId === workflowStepId);
            const childThreadShell =
              step?.threadId && step.threadId !== props.workflowRun?.driverThreadId
                ? threadShellsById.get(step.threadId)
                : undefined;
            const subagentModelLabel =
              !props.editMode && childThreadShell?.modelSelection.model
                ? formatModelSlugName(childThreadShell.modelSelection.model)
                : undefined;
            const childRun =
              node.kind === "step" && !props.editMode && step?.childRunId
                ? (props.runs.find((run) => run.id === step.childRunId) ?? null)
                : null;
            const stepDefinitionId = workflowStepId;
            const stepDefinition = props.definition?.steps.find(
              (entry) => entry.id === stepDefinitionId,
            );
            const errors =
              node.kind === "step" && step?.status === "failed"
                ? [
                    step.error,
                    ...(step.checks ?? [])
                      .filter((check) => !check.ok)
                      .map((check) => check.message),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "";
            const blocker = props.selectedListing?.blockers.find(
              (item) => item.stepId === stepDefinition?.id,
            );
            const stepSkill =
              stepDefinition !== undefined && isWorkflowSkillStep(stepDefinition)
                ? stepDefinition.skill
                : null;
            const scope =
              stepSkill !== null
                ? props.selectedListing?.skills.find(
                    (item) => item.name.toLowerCase() === stepSkill.toLowerCase(),
                  )?.scope
                : undefined;
            const stepId = node.kind === "step" ? (workflowStepId ?? stepIdOfNode(node.id)) : null;
            const cardKey = workflowCardKey(node);
            const gestureProps =
              editing && cardKey !== null
                ? {
                    dragging: gesture?.kind === "move" && gesture.cardKey === cardKey,
                    highlighted:
                      graph.edges.some(
                        (edge) =>
                          edge.id === hoveredEdge && (edge.from === node.id || edge.to === node.id),
                      ) ||
                      (gesture?.kind === "link" && gesture.targetId === stepId) ||
                      (props.dropActive && props.dropTarget === stepId),
                    dimmed:
                      gesture?.kind === "link" &&
                      stepId !== null &&
                      !canReadFrom(props.definition!, stepId, gesture.sourceId) &&
                      !canReadFrom(props.definition!, gesture.sourceId, stepId) &&
                      !canLoopBack(props.definition!, gesture.sourceId, stepId),
                    onCardPointerDown: (event: PointerEvent<HTMLDivElement>) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("button:not([data-workflow-drag-surface])")
                      )
                        return;
                      gestures.startMove(cardKey, position, event);
                    },
                    onLinkPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
                      if (stepId !== null) gestures.startLink(stepId, event);
                    },
                    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
                      if (!gestures.consumeClick()) return;
                      event.stopPropagation();
                      event.preventDefault();
                    },
                  }
                : {};
            return (
              <WorkflowCanvasCard
                key={node.id}
                node={node}
                style={{
                  left: position.x,
                  top: position.y,
                  ...(props.visualNodeSizes.get(node.id) ??
                    layout.nodeSizes?.get(node.id) ??
                    nodeSize),
                }}
                onOpen={
                  !node.childThreadId ||
                  node.childThreadId === props.threadRef.threadId ||
                  node.childThreadId === props.workflowRun?.driverThreadId
                    ? null
                    : () => props.onOpenThread(node.childThreadId!)
                }
                error={errors}
                worker={node.worker ?? null}
                {...(subagentModelLabel ? { subagentModelLabel } : {})}
                childRun={childRun}
                {...(node.kind === "workflow" && props.nextRunAt !== undefined
                  ? { nextRunAt: props.nextRunAt }
                  : {})}
                onOpenNested={
                  node.nestedWorkflow !== undefined && props.onOpenNested
                    ? () => props.onOpenNested!(node.nestedWorkflow!)
                    : undefined
                }
                {...nestedToggle(node)}
                appearing={props.enteringNodeIds.has(node.id)}
                onAppearanceEnd={() => props.onNodeAppeared(node.id)}
                onSelectDetail={
                  node.id === startNodeId
                    ? () => props.onOpenWorkflowSettings()
                    : childRun
                      ? () => props.onOpenRun(childRun.id)
                      : node.kind === "approval" && node.approvalFor
                        ? () => props.onSelectStep(node.approvalFor!)
                        : stepDefinition
                          ? () => props.onSelectStep(stepDefinition.id)
                          : null
                }
                start={
                  node.id === startNodeId
                    ? {
                        ...(props.triggers === undefined ? {} : { triggers: props.triggers }),
                        ...(props.onTrigger === undefined ? {} : { onTrigger: props.onTrigger }),
                        ...(props.onManual === undefined ? {} : { onManual: props.onManual }),
                        trigger: props.trigger,
                        inputs: startInputs,
                        showValues,
                        run: showValues ? props.workflowRun : latestFinishedRun,
                      }
                    : null
                }
                editMode={props.editMode}
                direction={props.direction}
                {...(node.kind === "step" &&
                stepDefinition !== undefined &&
                isWorkflowSkillStep(stepDefinition) &&
                stepDefinition.delegation
                  ? { delegation: stepDefinition.delegation }
                  : {})}
                {...(node.kind === "step" && scope ? { scope } : {})}
                {...(node.kind === "step" && stepDefinition
                  ? {
                      chips: attachmentChipCounts({
                        credentials: node.credentials?.length ?? 0,
                        checks: checksByStep.get(stepDefinition.id) ?? 0,
                        attachments: resourceAttachmentsOf(stepDefinition),
                      }),
                    }
                  : {})}
                {...(node.kind === "step" && blocker ? { blocker } : {})}
                selected={
                  props.selectedCanvasItemId !== null &&
                  props.selectedCanvasItemId ===
                    (node.id === startNodeId ? "__workflow__" : workflowStepId)
                }
                highlighted={graph.edges.some(
                  (edge) =>
                    edge.id === hoveredEdge && (edge.from === node.id || edge.to === node.id),
                )}
                {...gestureProps}
                activity={
                  stepDefinition?.waitBefore ? (
                    <WorkflowWaitBadge
                      wait={stepDefinition.waitBefore}
                      resumeAt={step?.waitingFor === "timer" ? step.resumeAt : undefined}
                    />
                  ) : node.kind === "step" &&
                    !props.editMode &&
                    step?.status === "running" &&
                    step.threadId &&
                    step.startedAt &&
                    activityThreads.get(step.threadId) === 1 &&
                    stepDefinition &&
                    isWorkflowSkillStep(stepDefinition) ? (
                    <WorkflowStepActivityLine
                      environmentId={props.threadRef.environmentId}
                      threadId={step.threadId}
                      startedAt={step.startedAt}
                      running
                    />
                  ) : null
                }
                outputs={
                  node.kind === "step" &&
                  step?.outputs &&
                  (step.status === "done" ||
                    (step.status === "waiting" && step.waitingFor === "resume")) ? (
                    <WorkflowOutputStrip
                      threadRef={props.threadRef}
                      outputs={step.outputs}
                      {...(step.threadId ? { resourceThreadId: step.threadId } : {})}
                      {...(step.outputPreviews ? { previews: step.outputPreviews } : {})}
                      onShowAll={() => props.onSelectStep(step.stepId)}
                    />
                  ) : null
                }
                actions={
                  runIsActive &&
                  node.kind === "approval" &&
                  step?.status === "waiting" &&
                  step.waitingFor === "approval" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={props.busy || !props.canApprove}
                      onClick={() => props.onActOnRun("approval", node.approvalFor!)}
                    >
                      Approve
                    </Button>
                  ) : runIsActive &&
                    node.kind === "step" &&
                    step?.status === "waiting" &&
                    !(step.waitingFor === "approval" && stepDefinition?.gate === true) ? (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={
                        props.busy ||
                        (step.waitingFor === "approval" ? !props.canApprove : !props.canResume)
                      }
                      onClick={() =>
                        props.onActOnRun(
                          step.waitingFor === "approval" ? "approval" : "resume",
                          step.stepId,
                        )
                      }
                    >
                      {step.waitingFor === "approval"
                        ? "Approve"
                        : step.waitingFor === "timer"
                          ? "Start now"
                          : "Resume"}
                    </Button>
                  ) : null
                }
              />
            );
          })}
          {props.definition?.steps.flatMap((step) => {
            const ownerNode = graph.nodes.find(
              (node) => node.kind === "step" && node.workflowStepId === step.id,
            );
            if (!ownerNode) return [];
            const attachments = resourceAttachmentsOf(step);
            const expanded = expandedResourceOwners.has(step.id);
            const visible = expanded ? attachments : attachments.slice(0, 3);
            const cards = visible.map((attachment) => {
              const position = annotations.resources.get(`${step.id}/${attachment.id}`);
              if (!position) return null;
              return (
                <WorkflowResourceCard
                  key={attachment.id}
                  attachment={attachment}
                  position={position}
                  editMode={editing}
                  dragging={
                    gesture?.kind === "move" &&
                    gesture.cardKey === workflowResourceCardKey(step.id, attachment.id)
                  }
                  onPointerDown={(event) =>
                    gestures.startMove(
                      workflowResourceCardKey(step.id, attachment.id),
                      position,
                      event,
                    )
                  }
                  onClickCapture={(event) => {
                    if (!gestures.consumeClick()) return;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  {...(readiness?.entries.find(
                    (entry) => entry.stepId === step.id && entry.attachmentId === attachment.id,
                  )
                    ? {
                        readiness: readiness.entries.find(
                          (entry) =>
                            entry.stepId === step.id && entry.attachmentId === attachment.id,
                        )!,
                      }
                    : {})}
                  selected={
                    props.selectedCanvasItemId === workflowAttachmentId(step.id, attachment.id)
                  }
                  onSelect={() => props.onSelectStep(workflowAttachmentId(step.id, attachment.id))}
                />
              );
            });
            if (!expanded && attachments.length > 3) {
              const position = annotations.resources.get(`${step.id}/__more`);
              if (position)
                cards.push(
                  <WorkflowResourceCard
                    key="more"
                    attachment={null}
                    more={attachments.length - 3}
                    position={position}
                    selected={
                      props.selectedCanvasItemId === workflowAttachmentId(step.id, "__more")
                    }
                    onSelect={() =>
                      setExpandedResourceOwners((current) => new Set(current).add(step.id))
                    }
                  />,
                );
            } else if (expanded && attachments.length > 3) {
              const ownerPosition = layout.positions.get(ownerNode.id);
              const ownerSize =
                props.visualNodeSizes.get(ownerNode.id) ??
                layout.nodeSizes?.get(ownerNode.id) ??
                nodeSize;
              if (ownerPosition)
                cards.push(
                  <WorkflowResourceCard
                    key="less"
                    attachment={null}
                    moreLabel="Show fewer resources"
                    position={{
                      x: ownerPosition.x,
                      y: ownerPosition.y + ownerSize.height + 12 + attachments.length * 62,
                    }}
                    selected={false}
                    onSelect={() =>
                      setExpandedResourceOwners((current) => {
                        const next = new Set(current);
                        next.delete(step.id);
                        return next;
                      })
                    }
                  />,
                );
            }
            return cards;
          })}
          {graph.nodes.flatMap((node) =>
            (node.credentials ?? []).map((entry) => {
              const position = annotations.credentials.get(entry.key);
              if (!position) return null;
              return (
                <div
                  key={entry.key}
                  data-canvas-card-key={entry.key}
                  className="absolute w-90"
                  style={{ left: position.x, top: position.y }}
                  data-canvas-no-pan={editing || undefined}
                  onPointerDown={(event) => {
                    if (!editing) return;
                    if (
                      !(event.target instanceof Element) ||
                      event.target.closest("button,input,a")
                    )
                      return;
                    gestures.startMove(entry.key, position, event);
                  }}
                  onClickCapture={(event) => {
                    if (gestures.consumeClick()) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                >
                  <WorkflowCredentialSatelliteCard
                    satellite={entry}
                    environmentId={props.threadRef.environmentId}
                    projectId={props.projectId}
                    canEdit={editing}
                    onChoose={(credentialId) =>
                      entry.attachmentId !== undefined &&
                      props.onChooseCredential(entry.stepId, entry.attachmentId, credentialId)
                    }
                    onAdd={() => props.onAddCredential(entry.stepId, entry.templateId)}
                    onFix={() => props.onFixCredential(entry.stepId, entry.credentialId)}
                    onManage={props.onManageCredentials}
                    onRemove={() => {
                      if (entry.attachmentId !== undefined)
                        props.onRemoveCredential(entry.stepId, entry.attachmentId);
                    }}
                  />
                </div>
              );
            }),
          )}
          {props.definition?.notes?.map((note) => {
            const position = annotations.notes.get(note.id);
            if (!position) return null;
            return (
              <WorkflowNoteCard
                key={note.id}
                note={note}
                position={position}
                selected={props.selectedCanvasItemId === workflowNoteId(note.id)}
                editMode={editing}
                dragging={gesture?.kind === "move" && gesture.cardKey === `note:${note.id}`}
                onPointerDown={(event) => gestures.startMove(`note:${note.id}`, position, event)}
                onClickCapture={(event) => {
                  if (!gestures.consumeClick()) return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onSelect={() => props.onSelectStep(workflowNoteId(note.id))}
              />
            );
          })}
          {noteDrop ? (
            <div
              className="absolute z-30"
              data-canvas-no-pan
              data-workflow-note-drop
              style={{ left: noteDrop.x, top: noteDrop.y }}
            >
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  props.onAddNoteAt(noteDrop.x, noteDrop.y);
                  setNoteDrop(null);
                }}
              >
                <PlusIcon /> Add note here
              </Button>
            </div>
          ) : null}
          {loopOffer && props.definition ? (
            <div
              className="absolute z-30 flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-md"
              data-canvas-no-pan
              data-workflow-loop-offer
              style={{ left: loopOffer.x, top: loopOffer.y }}
            >
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  const id = uniqueLoopId(props.definition!, loopOffer.fromId, loopOffer.toId);
                  props.onPutLoop?.({
                    id,
                    from: loopOffer.fromId,
                    to: loopOffer.toId,
                    maxRounds: props.defaultLoopMaxRounds ?? 3,
                    until: { kind: "step-says-pass" },
                    feedback: true,
                  });
                  props.onSelectStep(loopOffer.fromId);
                  setLoopOffer(null);
                }}
              >
                <RotateCcwIcon /> Make a loop
              </Button>
              {canReadFrom(props.definition, loopOffer.fromId, loopOffer.toId) ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    props.onLinkSteps(loopOffer.toId, loopOffer.fromId);
                    setLoopOffer(null);
                  }}
                >
                  Read from step
                </Button>
              ) : null}
            </div>
          ) : null}
          {props.expansions?.map((expansion) => {
            const origin = layout.positions.get(expansion.nodeId);
            return origin && props.onOpenExpandedStep ? (
              <WorkflowExpandedSteps
                key={expansion.nodeId}
                expansion={expansion}
                origin={origin}
                onOpenStep={props.onOpenExpandedStep}
              />
            ) : null;
          })}
          {editing && props.definition && props.projectId ? (
            <WorkflowCanvasEditLayer
              spots={spots}
              definition={props.definition}
              environmentId={props.threadRef.environmentId}
              projectId={props.projectId}
              workflows={props.workflows}
              {...(props.resources ? { resources: props.resources } : {})}
              workflow={props.selectedListing?.workflow ?? ""}
              emptyTop={nodeHeight + 32}
              layoutWidth={layout.width}
              linkDrop={linkDrop}
              onLinkAddClose={() => setLinkDrop(null)}
              gesture={gesture}
              onInsert={props.onInsert}
              onAppend={props.onAppend}
              onSelectStep={props.onSelectStep}
            />
          ) : null}
        </div>
      )}
      {stepsOffscreen ? (
        <div
          data-canvas-no-pan
          data-workflow-camera-control
          className="absolute inset-x-0 top-3 flex justify-center pointer-events-none"
        >
          <div className="pointer-events-auto">
            <Button variant="secondary" size="xs" onClick={camera.resetCamera}>
              Back to steps
            </Button>
          </div>
        </div>
      ) : null}
      {graph.nodes.length ? (
        <WorkflowZoomControls
          scale={props.view.scale}
          onZoomOut={() => camera.zoomBy(1 / 1.25)}
          onZoomIn={() => camera.zoomBy(1.25)}
          onFit={camera.resetCamera}
          onTidy={props.onTidy}
          {...(props.viewSwitch ? { viewSwitch: props.viewSwitch } : {})}
        />
      ) : null}
    </div>
  );
}
