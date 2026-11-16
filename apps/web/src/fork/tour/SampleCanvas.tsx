import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EMPTY_CREDENTIAL_LIVE_STATE } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import "../../workflows/WorkflowPanel.css";
import { buildWorkflowRunGraph } from "../../workflows/buildWorkflowRunGraph";
import { layoutRunGraph, RUN_GRAPH_NODE } from "../../workflows/runGraphLayout";
import { useCanvasCamera } from "../../workflows/useCanvasCamera";
import { workflowAnnotationPositions } from "../../workflows/workflowAnnotations";
import { workflowCanvasLayout } from "../../workflows/workflowCanvasLayout";
import { connectionLayout } from "../../workflows/workflowConnections";
import { workflowAnnotationLayoutSizes, workflowCardSizes } from "../../workflows/workflowOutputs";
import { WorkflowPanelCanvas } from "../../workflows/WorkflowPanelCanvas";
import {
  nextWeekdayNine,
  SAMPLE_READINESS,
  SAMPLE_SCHEDULE_LABEL,
  SAMPLE_WORKFLOW,
} from "./sampleWorkflow";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("tour-sample"), ThreadId.make("tour-sample"));
const PROJECT_ID = ProjectId.make("tour-sample");
const NODE_SIZE = { ...RUN_GRAPH_NODE, height: 112 };
const TRIGGERS = [{ id: "sample-schedule", label: SAMPLE_SCHEDULE_LABEL, enabled: true }];
const NO_STEPS = new Set<string>();
const noop = () => {};

/**
 * The real workflow canvas over the bundled sample. Every handler is a no-op and no hook here
 * reaches the server, so nothing the user does on it can change a project.
 */
export function SampleCanvas(props: {
  readonly run: WorkflowRun | null;
  readonly definition?: WorkflowDefinition;
  /** Shows the "+" controls without making anything editable. */
  readonly editPreview: boolean;
}) {
  const definition = props.definition ?? SAMPLE_WORKFLOW;
  const sample = props.definition === undefined;
  const direction = "horizontal";
  const graph = buildWorkflowRunGraph(props.run, definition, [], new Map(), {
    live: EMPTY_CREDENTIAL_LIVE_STATE,
    history: [],
    ...(sample ? { readiness: SAMPLE_READINESS } : {}),
    approval: "ask",
  });
  const visualNodeSizes = workflowCardSizes(graph, props.run, NODE_SIZE, true);
  const layout = connectionLayout(
    graph,
    workflowCanvasLayout(
      graph,
      layoutRunGraph(
        graph,
        NODE_SIZE,
        direction,
        workflowAnnotationLayoutSizes(visualNodeSizes, graph, definition),
      ),
      undefined,
      visualNodeSizes,
    ),
    direction,
  );
  const extent = workflowAnnotationPositions({
    definition,
    graph,
    layout,
    visualNodeSizes,
    direction,
    expandedResourceOwners: new Set(),
  });
  const content = props.editPreview ? { ...extent, width: extent.width + 56 } : extent;
  const { viewportRef, viewport, view, zoomBy, resetCamera, handlers } = useCanvasCamera({
    content,
    enabled: true,
  });
  const [nextRunAt] = useState(() => nextWeekdayNine(new Date()).toISOString());
  return (
    <WorkflowPanelCanvas
      threadRef={THREAD_REF}
      graph={graph}
      layout={layout}
      visualNodeSizes={visualNodeSizes}
      direction={direction}
      nodeSize={NODE_SIZE}
      view={view}
      camera={{ viewportRef, viewport, zoomBy, resetCamera, handlers }}
      canEdit={props.editPreview}
      editMode={props.editPreview}
      showSubagents={false}
      dropActive={false}
      dropTarget={null}
      definition={definition}
      workflowRun={props.run}
      runs={props.run ? [props.run] : []}
      selectedListing={null}
      projectId={PROJECT_ID}
      workflows={[]}
      busy={false}
      canApprove={false}
      canResume={false}
      enteringNodeIds={NO_STEPS}
      nextRunAt={sample ? nextRunAt : null}
      triggers={sample ? TRIGGERS : []}
      trigger={sample ? "schedule" : (definition.trigger ?? "manual")}
      onNew={noop}
      onBackToWorkflow={noop}
      onOpenThread={noop}
      onOpenRun={noop}
      onSelectStep={noop}
      selectedCanvasItemId={null}
      onAddNoteAt={noop}
      canAddNote={false}
      onMoveNote={noop}
      onOpenWorkflowSettings={noop}
      onNodeAppeared={noop}
      onActOnRun={noop}
      onInsert={noop}
      onAppend={noop}
      onMoveCard={noop}
      onLinkSteps={noop}
      onChooseCredential={noop}
      onAddCredential={noop}
      onFixCredential={noop}
      onManageCredentials={noop}
      onRemoveCredential={noop}
      onDragEnter={noop}
      onDragOver={noop}
      onDragLeave={noop}
      onDrop={noop}
    />
  );
}
