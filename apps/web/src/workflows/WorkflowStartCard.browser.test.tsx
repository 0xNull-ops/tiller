import { useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowTrigger,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import "~/index.css";

import { render, type Screen } from "../../test/render";
import { WorkflowPanelCanvas } from "./WorkflowPanelCanvas";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { layoutRunGraph, RUN_GRAPH_NODE } from "./runGraphLayout";
import { workflowAnnotationLayoutSizes, workflowCardSizes } from "./workflowOutputs";

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("parent"));

const definition: WorkflowDefinition = {
  version: 2,
  name: "Launch site",
  inputs: [
    { id: "appName", label: "App name", kind: "text", required: true },
    { id: "siteUrl", label: "Site URL", kind: "url" },
  ],
  steps: [
    { id: "research", skill: "research" },
    { id: "build", skill: "build" },
  ],
};

const run: WorkflowRun = {
  id: "run-one",
  projectId: ProjectId.make("project"),
  workflow: "launch",
  driverThreadId: ThreadId.make("starter"),
  status: "running",
  startedAt: "2026-10-19T12:00:00.000Z",
  definition,
  inputs: { appName: "T3 Code", siteUrl: "https://t3.codes" },
  skills: [],
  steps: [],
};

const nodeSize = { ...RUN_GRAPH_NODE, height: 112 };

const onOpenWorkflowSettings = vi.fn();

function setup() {
  onOpenWorkflowSettings.mockReset();
}

function Canvas(props: {
  readonly run: WorkflowRun | null;
  readonly editMode: boolean;
  readonly trigger: WorkflowTrigger;
  readonly definition?: WorkflowDefinition;
  readonly direction?: "horizontal" | "vertical";
  readonly onSelectStep?: (id: string) => void;
  readonly nextRunAt?: string | null;
  readonly triggers?: ReadonlyArray<{ id: string; label: string; enabled: boolean }>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasDefinition = props.definition ?? definition;
  const direction = props.direction ?? "horizontal";
  const graph = buildWorkflowRunGraph(props.run, canvasDefinition);
  const visualNodeSizes = workflowCardSizes(graph, props.run, nodeSize, !props.editMode);
  const layout = layoutRunGraph(
    graph,
    nodeSize,
    direction,
    workflowAnnotationLayoutSizes(visualNodeSizes, graph, canvasDefinition),
  );
  return (
    <div style={{ display: "flex", width: direction === "vertical" ? 360 : 800, height: 600 }}>
      <WorkflowPanelCanvas
        threadRef={threadRef}
        graph={graph}
        layout={layout}
        visualNodeSizes={visualNodeSizes}
        direction={direction}
        nodeSize={nodeSize}
        view={{ x: 0, y: 0, scale: 1 }}
        camera={{
          viewportRef,
          viewport: { width: 800, height: 600 },
          zoomBy: () => {},
          resetCamera: () => {},
          handlers: {
            onPointerEnter: () => {},
            onPointerLeave: () => {},
            onWheel: () => {},
            onPointerDown: () => {},
            onPointerMove: () => {},
            onPointerUp: () => {},
            onPointerCancel: () => {},
          },
        }}
        canEdit
        editMode={props.editMode}
        showSubagents={false}
        dropActive={false}
        dropTarget={null}
        definition={canvasDefinition}
        workflowRun={props.run}
        runs={props.run ? [props.run] : []}
        selectedListing={null}
        projectId={ProjectId.make("project")}
        workflows={[]}
        busy={false}
        canApprove
        canResume
        enteringNodeIds={new Set()}
        trigger={props.trigger}
        {...(props.triggers === undefined ? {} : { triggers: props.triggers })}
        {...(props.nextRunAt === undefined ? {} : { nextRunAt: props.nextRunAt })}
        onNew={() => {}}
        onBackToWorkflow={() => {}}
        onOpenThread={() => {}}
        onOpenRun={() => {}}
        onSelectStep={props.onSelectStep ?? (() => {})}
        selectedCanvasItemId={null}
        onAddNoteAt={() => {}}
        canAddNote
        onMoveNote={() => {}}
        onOpenWorkflowSettings={onOpenWorkflowSettings}
        onNodeAppeared={() => {}}
        onActOnRun={() => {}}
        onInsert={() => {}}
        onAppend={() => {}}
        onMoveCard={() => {}}
        onLinkSteps={() => {}}
        onChooseCredential={() => {}}
        onAddCredential={() => {}}
        onFixCredential={() => {}}
        onManageCredentials={() => {}}
        onRemoveCredential={() => {}}
        onDragEnter={() => {}}
        onDragOver={() => {}}
        onDragLeave={() => {}}
        onDrop={() => {}}
      />
    </div>
  );
}

function startCard(screen: Screen): HTMLElement {
  const card = screen.container.querySelector("[data-workflow-start-card]");
  if (card === null) throw new Error("the start card is missing");
  return card as HTMLElement;
}

it("shows the values the run started with on the start card", async () => {
  setup();
  await using screen = await render(<Canvas run={run} editMode={false} trigger="manual" />);

  const card = startCard(screen);
  expect(card.textContent).toContain("Launch site");
  expect(card.textContent).toContain("Start");
  expect(card.textContent).toContain("App name");
  expect(card.textContent).toContain("T3 Code");
  expect(card.textContent).toContain("Site URL");
  expect(card.textContent).toContain("https://t3.codes");
});

it("shows the declared inputs, not the last run's values, while editing", async () => {
  setup();
  const lastRun: WorkflowRun = {
    ...run,
    inputs: { appName: "Old name", siteUrl: "https://old.example" },
  };
  await using screen = await render(<Canvas run={lastRun} editMode trigger="manual" />);

  const card = startCard(screen);
  expect(card.textContent).toContain("App name");
  expect(card.textContent).toContain("Site URL");
  expect(card.textContent).not.toContain("Old name");
  expect(card.textContent).not.toContain("https://old.example");
});

it("shows the triggers and the next scheduled run", async () => {
  setup();
  await using screen = await render(
    <Canvas
      run={run}
      editMode={false}
      trigger="schedule"
      triggers={[{ id: "schedule-one", label: "Every 60m", enabled: true }]}
      nextRunAt="2099-01-01T00:00:00.000Z"
    />,
  );

  const card = startCard(screen);
  expect(card.textContent).toContain("Manual");
  expect(card.textContent).toContain("Every 60m");
  expect(card.textContent).toContain("Next:");
});

it("shows owner resources and notes in a narrow run without exposing edit controls", async () => {
  const onSelectStep = vi.fn();
  const annotatedDefinition: WorkflowDefinition = {
    ...definition,
    version: 3,
    notes: [{ id: "reminder", text: "Check screenshots before release." }],
    steps: definition.steps.map((step) =>
      step.id === "research"
        ? {
            ...step,
            attachments: ["Node 22", "macOS", "Xcode 17", "Vercel", "App Store Connect"].map(
              (requirement, index) => ({
                id: `requirement-${index}`,
                kind: "requirement" as const,
                requirement,
              }),
            ),
          }
        : step,
    ),
  };
  const annotatedRun = { ...run, definition: annotatedDefinition };
  await using screen = await render(
    <Canvas
      run={annotatedRun}
      definition={annotatedDefinition}
      editMode={false}
      trigger="manual"
      direction="vertical"
      onSelectStep={onSelectStep}
    />,
  );
  expect(screen.container.querySelectorAll("[data-workflow-resource-card]")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Open Node 22 resource" })).toBeDefined();
  const expand = screen.getByRole("button", { name: "Show 2 more resources" });
  await userEvent.click(expand);
  expect(screen.container.querySelectorAll("[data-workflow-resource-card]")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Show fewer resources" })).toBeDefined();
  expect(screen.container.querySelector('[aria-label="Move note"]')).toBeNull();
  const note = screen.container.querySelector<HTMLButtonElement>(
    '[aria-label="Open note: Check screenshots before release."]',
  );
  expect(note).not.toBeNull();
  note!.focus();
  await userEvent.keyboard("{Enter}");
  expect(onSelectStep).toHaveBeenCalledWith("note/reminder");
});
