import type { NestedExpansion } from "./workflowExpansion";
import { STEP_STATUS_LABEL } from "./WorkflowNestedChildSteps";

/** The gap between an expanded card and its group. Matches the spacing `layoutExpansion` reserves. */
const GROUP_TOP_GAP = 6;

/**
 * An expanded nested card's steps, drawn as a grouped container beneath the card. Read-only: a
 * step opens its own workflow with that step selected, and nothing here can be dragged or edited.
 */
export function WorkflowExpandedSteps(props: {
  readonly expansion: NestedExpansion;
  readonly origin: { readonly x: number; readonly y: number };
  readonly onOpenStep: (workflow: string, stepId: string) => void;
}) {
  const { expansion, origin } = props;
  const top = expansion.cardHeight + GROUP_TOP_GAP;
  return (
    <section
      aria-label={`Steps in ${expansion.name}`}
      data-expanded-group={expansion.nodeId}
      className="absolute rounded-xl border border-dashed border-primary/40 bg-muted/30"
      style={{
        left: origin.x,
        top: origin.y + top,
        width: expansion.box.width,
        height: expansion.box.height - top,
      }}
    >
      {expansion.steps.map((step) => (
        <button
          key={step.stepId}
          type="button"
          data-expanded-step={step.stepId}
          aria-label={`${step.title}${step.status ? `, ${STEP_STATUS_LABEL[step.status]}` : ""}`}
          onClick={() => props.onOpenStep(expansion.workflow, step.stepId)}
          className="absolute flex min-w-0 flex-col justify-center gap-0.5 rounded-md border bg-card px-2 text-left text-xs shadow-xs hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={{
            left: step.x,
            top: step.y - top,
            width: step.width,
            height: step.height,
          }}
        >
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate font-medium">{step.title}</span>
            {step.status ? (
              <span className="shrink-0 text-3xs text-muted-foreground">
                {STEP_STATUS_LABEL[step.status]}
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
            {step.skill ? <span className="truncate font-mono">{step.skill}</span> : null}
            {step.missingSkill ? (
              <span className="shrink-0 rounded bg-destructive/10 px-1 text-destructive">
                Skill missing
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </section>
  );
}
