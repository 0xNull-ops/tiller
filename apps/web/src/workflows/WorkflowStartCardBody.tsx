import type { WorkflowDefinition, WorkflowRun, WorkflowTrigger } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { WorkflowRunElapsed } from "./WorkflowRunElapsed";

/** One declared input of a workflow, with the value a run was started with when there is one. */
export interface WorkflowStartInput {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly value: string | null;
}

/**
 * The inputs a start card shows. A run shows the values it was started with; the saved
 * workflow shows only what it asks for, so the draft never shows another run's values.
 */
export function workflowStartInputs(input: {
  readonly definition: WorkflowDefinition | null;
  readonly run: WorkflowRun | null;
  readonly showValues: boolean;
}): ReadonlyArray<WorkflowStartInput> {
  const declared = input.definition?.inputs ?? [];
  const values = input.showValues ? (input.run?.inputs ?? {}) : {};
  return declared.map((declaredInput) => ({
    id: declaredInput.id,
    label: declaredInput.label,
    required: declaredInput.required ?? false,
    value: values[declaredInput.id] ?? null,
  }));
}

/**
 * The first card of a workflow: what the workflow asks for, how it starts, and when it
 * runs next. The list of inputs scrolls, so a workflow with many of them still fits.
 */
export function WorkflowStartCardBody(props: {
  readonly triggers?: ReadonlyArray<{ id: string; label: string; enabled: boolean }>;
  readonly onManual?: () => void;
  readonly onTrigger?: () => void;
  readonly name: string;
  readonly statusDotClass: string;
  readonly statusLabel: string;
  readonly trigger: WorkflowTrigger;
  readonly nextRunAt: string | null;
  readonly inputs: ReadonlyArray<WorkflowStartInput>;
  readonly showValues: boolean;
  /** The run on the canvas: its timer replaces the status word. */
  readonly run?: WorkflowRun | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-workflow-start-card>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", props.statusDotClass)} />
        <span className="truncate text-xs font-medium">{props.name}</span>
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-3xs font-medium text-primary">
          Start
        </span>
        {props.run ? (
          <WorkflowRunElapsed run={props.run} className="ml-auto shrink-0 text-3xs" />
        ) : (
          <span className="ml-auto shrink-0 text-3xs text-muted-foreground">
            {props.statusLabel}
          </span>
        )}
      </span>
      <div className="flex flex-wrap gap-1 text-2xs" data-canvas-no-pan data-tour="start-triggers">
        {[{ id: "manual", label: "Manual", enabled: true }, ...(props.triggers ?? [])].map(
          (trigger) => (
            <button
              type="button"
              key={trigger.id}
              className={cn("rounded-full border px-1.5 py-0.5", !trigger.enabled && "opacity-40")}
              onClick={(event) => {
                event.stopPropagation();
                if (trigger.id === "manual") props.onManual?.();
                else props.onTrigger?.();
              }}
            >
              {trigger.label}
            </button>
          ),
        )}
        <button
          type="button"
          className="rounded-full border border-dashed px-1.5 py-0.5"
          onClick={(event) => {
            event.stopPropagation();
            props.onTrigger?.();
          }}
        >
          + Trigger
        </button>
      </div>
      {props.nextRunAt ? (
        <span className="text-3xs text-muted-foreground">
          Next: {new Date(props.nextRunAt).toLocaleString()}
        </span>
      ) : null}
      <span
        className="flex max-h-12 min-h-0 flex-col gap-0.5 overflow-y-auto"
        data-canvas-no-pan
        onWheel={(event) => event.stopPropagation()}
      >
        {props.inputs.length === 0 ? (
          <span className="text-2xs text-muted-foreground">No inputs</span>
        ) : (
          props.inputs.map((input) => (
            <span key={input.id} className="flex min-w-0 items-baseline gap-1 text-2xs">
              <span className="truncate text-muted-foreground">{input.label}</span>
              {input.required ? <span className="shrink-0 text-destructive">*</span> : null}
              {props.showValues ? (
                <span className="truncate text-foreground">{input.value ?? "not set"}</span>
              ) : null}
            </span>
          ))
        )}
      </span>
    </div>
  );
}
