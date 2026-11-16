import type { WorkflowListing, WorkflowRun, WorkflowStepStatus } from "@t3tools/contracts";
import type { RunGraphNode } from "./runGraph";
import { nestedTargetState } from "./workflowNesting";
import { isWorkflowSkillStep } from "./workflowStep";

/** A step inside an expanded group: a smaller card than a canvas step. */
export const EXPANSION_CARD = { width: 176, height: 56 } as const;
const GAP = 12;
const PADDING = 12;
const COLUMNS = 3;

export interface ExpandedStep {
  readonly stepId: string;
  readonly title: string;
  readonly skill: string | null;
  readonly missingSkill: boolean;
  readonly status: WorkflowStepStatus | null;
  /** Offset from the nested card's top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One nested card opened into a group of its workflow's steps. Only one level deep. */
export interface NestedExpansion {
  readonly nodeId: string;
  readonly stepId: string;
  readonly workflow: string;
  readonly name: string;
  /** The nested card's and the group's combined size. The layout reserves this much room. */
  readonly box: { readonly width: number; readonly height: number };
  readonly cardHeight: number;
  readonly steps: ReadonlyArray<ExpandedStep>;
}

/** Whether a nested reference's steps can be listed here. False for self, missing, unreadable or looping ones. */
export function canExpandNested(input: {
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly parentWorkflow: string;
  readonly target: string;
}): boolean {
  return nestedTargetState(input) === "ready";
}

/** Places a nested card's steps in a grid under it. The card stays at the top of the group. */
export function layoutExpansion(input: {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly count: number;
}): { readonly width: number; readonly height: number } {
  if (input.count === 0) return { width: input.cardWidth, height: input.cardHeight };
  const columns = Math.min(COLUMNS, input.count);
  const rows = Math.ceil(input.count / columns);
  const gridWidth = columns * EXPANSION_CARD.width + (columns - 1) * GAP + PADDING * 2;
  const gridHeight = rows * EXPANSION_CARD.height + (rows - 1) * GAP + PADDING * 2;
  return {
    width: Math.max(input.cardWidth, gridWidth),
    height: input.cardHeight + GAP + gridHeight,
  };
}

/**
 * The nested cards the user opened, each with its steps placed in a grid beneath it. A card that
 * can't be opened, or a step that isn't in the list, is left as a plain card.
 */
export function nestedExpansions(input: {
  readonly nodes: ReadonlyArray<RunGraphNode>;
  readonly expandedStepIds: ReadonlySet<string>;
  readonly parentWorkflow: string;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly latestRunOf: (workflow: string) => WorkflowRun | null;
  readonly cardSize: (nodeId: string) => { readonly width: number; readonly height: number };
}): NestedExpansion[] {
  const expansions: NestedExpansion[] = [];
  for (const node of input.nodes) {
    const stepId = node.workflowStepId;
    if (node.nestedWorkflow === undefined || stepId === undefined) continue;
    if (!input.expandedStepIds.has(stepId)) continue;
    if (
      !canExpandNested({
        workflows: input.workflows,
        parentWorkflow: input.parentWorkflow,
        target: node.nestedWorkflow,
      })
    )
      continue;
    const listing = input.workflows.find((item) => item.workflow === node.nestedWorkflow);
    const definition = listing?.definition;
    if (!listing || !definition) continue;
    const run = input.latestRunOf(node.nestedWorkflow);
    const card = input.cardSize(node.id);
    const box = layoutExpansion({
      cardWidth: card.width,
      cardHeight: card.height,
      count: definition.steps.length,
    });
    const columns = Math.min(COLUMNS, definition.steps.length);
    const steps = definition.steps.map((step, index): ExpandedStep => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const skill = isWorkflowSkillStep(step) ? step.skill : null;
      return {
        stepId: step.id,
        title: step.title ?? step.id,
        skill,
        missingSkill: skill !== null && listing.missingSkills.includes(skill),
        status: run?.steps.find((entry) => entry.stepId === step.id)?.status ?? null,
        x: PADDING + column * (EXPANSION_CARD.width + GAP),
        y: card.height + GAP + PADDING + row * (EXPANSION_CARD.height + GAP),
        width: EXPANSION_CARD.width,
        height: EXPANSION_CARD.height,
      };
    });
    expansions.push({
      nodeId: node.id,
      stepId,
      workflow: node.nestedWorkflow,
      name: definition.name,
      box,
      cardHeight: card.height,
      steps,
    });
  }
  return expansions;
}
