import type {
  EnvironmentId,
  ProjectId,
  WorkflowDefinition,
  WorkflowListing,
} from "@t3tools/contracts";
import { CheckCheckIcon, PlusIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../components/ui/button";
import type { CanvasSpot } from "./canvasSpots";
import type { CanvasGesture } from "./useCanvasGestures";
import { WorkflowStepPicker, type WorkflowResourcePickerContext } from "./WorkflowStepPicker";
import type { WorkflowStepChoice } from "./workflowStep";
import { isWorkflowSkillStep } from "./workflowStep";

const SPOT_SIZE = 22;

/**
 * The saved workflow's edit affordances, drawn in canvas units inside the zoomed layer: a "+"
 * on every connection and after every last step.
 */
export function WorkflowCanvasEditLayer(props: {
  readonly spots: ReadonlyArray<CanvasSpot>;
  readonly definition: WorkflowDefinition;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly workflow: string;
  readonly resources?: WorkflowResourcePickerContext;
  readonly emptyTop: number;
  readonly layoutWidth: number;
  readonly linkDrop: {
    readonly sourceId: string;
    readonly x: number;
    readonly y: number;
  } | null;
  readonly onLinkAddClose: () => void;
  readonly gesture: CanvasGesture;
  readonly onInsert: (
    fromStepId: string | null,
    toStepId: string,
    choice: WorkflowStepChoice,
  ) => void;
  readonly onAppend: (afterStepId: string | null, choice: WorkflowStepChoice) => void;
  readonly onSelectStep: (stepId: string) => void;
}) {
  const linking = props.gesture?.kind === "link";

  return (
    <>
      {props.spots.map((spot) => {
        const owner = props.definition.steps.find((step) => step.id === spot.after);
        const skillOwner = owner && isWorkflowSkillStep(owner) ? owner : null;
        const ownerLabel = skillOwner?.title ?? skillOwner?.skill;
        return (
          <div
            key={spot.key}
            className="absolute"
            style={{
              left: spot.x - SPOT_SIZE / 2,
              top: spot.y - SPOT_SIZE / 2,
              width: SPOT_SIZE,
              height: SPOT_SIZE,
            }}
            data-canvas-no-pan
          >
            <WorkflowStepPicker
              environmentId={props.environmentId}
              projectId={props.projectId}
              workflows={props.workflows}
              workflow={props.workflow}
              {...(props.resources
                ? { resources: { ...props.resources, defaultOwnerId: spot.after } }
                : {})}
              onPick={(choice) =>
                spot.kind === "edge" && spot.toStepId !== null
                  ? props.onInsert(spot.after, spot.toStepId, choice)
                  : props.onAppend(spot.after, choice)
              }
            >
              <button
                type="button"
                aria-label={spot.kind === "edge" ? "Insert a step here" : "Add a step after this"}
                data-canvas-no-pan
                data-tour={spot.kind === "edge" ? "add-step" : undefined}
                className={cn(
                  "flex size-full items-center justify-center rounded-full border bg-background",
                  "text-muted-foreground shadow-xs transition-[opacity,transform,color] duration-200 motion-reduce:transition-none",
                  "hover:border-primary hover:text-primary",
                  spot.kind === "append" && "opacity-60 hover:opacity-100",
                  linking && "pointer-events-none opacity-0",
                )}
              >
                <PlusIcon className="size-3" />
              </button>
            </WorkflowStepPicker>
            {skillOwner && ownerLabel ? (
              <button
                type="button"
                aria-label={`${(skillOwner.checks?.length ?? 0) > 0 ? "Edit checks for" : "Add checks to"} ${ownerLabel}`}
                data-canvas-no-pan
                className="absolute left-1/2 top-6 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:border-primary hover:text-primary"
                onClick={() => props.onSelectStep(skillOwner.id)}
              >
                <CheckCheckIcon className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
      {props.definition.steps.length === 0 ? (
        <div
          className="absolute flex w-44 flex-col items-center gap-2 text-center"
          style={{ left: Math.max(0, props.layoutWidth / 2 - 88), top: props.emptyTop }}
          data-canvas-no-pan
        >
          <WorkflowStepPicker
            environmentId={props.environmentId}
            projectId={props.projectId}
            workflows={props.workflows}
            workflow={props.workflow}
            {...(props.resources ? { resources: props.resources } : {})}
            onPick={(choice) => props.onAppend(null, choice)}
          >
            <Button size="xs" variant="outline" data-canvas-no-pan>
              <PlusIcon /> Add the first step
            </Button>
          </WorkflowStepPicker>
          <span className="text-2xs text-muted-foreground">or drop a SKILL.md here</span>
        </div>
      ) : null}
      {props.linkDrop !== null ? (
        <div
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: props.linkDrop.x, top: props.linkDrop.y }}
          data-canvas-no-pan
        >
          <WorkflowStepPicker
            environmentId={props.environmentId}
            projectId={props.projectId}
            workflows={props.workflows}
            workflow={props.workflow}
            {...(props.resources
              ? { resources: { ...props.resources, defaultOwnerId: props.linkDrop.sourceId } }
              : {})}
            open
            onOpenChange={(open) => {
              if (!open) props.onLinkAddClose();
            }}
            onPick={(choice) => {
              props.onAppend(props.linkDrop!.sourceId, choice);
              props.onLinkAddClose();
            }}
          >
            <Button variant="default" size="icon-micro" aria-label="Add a step after linked source">
              <PlusIcon />
            </Button>
          </WorkflowStepPicker>
        </div>
      ) : null}
    </>
  );
}
