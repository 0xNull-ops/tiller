import type {
  WorkflowDefinition,
  WorkflowListing,
  WorkflowRun,
  WorkflowStepStatus,
} from "@t3tools/contracts";
import { isWorkflowNestedStep, isWorkflowSkillStep } from "./workflowStep";

/** The status filter's choices; `not-run` covers steps a run hasn't reached yet. */
export type OutlineFilter =
  | "all"
  | "running"
  | "needs-you"
  | "done"
  | "failed"
  | "not-run"
  | "missing-skill";

export interface OutlineRow {
  /** Stable across renders: the path of step ids from the root, so the same step keeps its key. */
  readonly key: string;
  readonly depth: number;
  /** The workflow whose definition holds this step. */
  readonly workflow: string;
  /** Workflows from the root down to this step's workflow, inclusive. */
  readonly chain: ReadonlyArray<string>;
  readonly stepId: string;
  readonly title: string;
  readonly skill: string | null;
  /** The workflow a nested step runs. */
  readonly nested: string | null;
  /** Whether a nested step's steps are listed beneath it. False for a cycle or unreadable file. */
  readonly canExpand: boolean;
  readonly expanded: boolean;
  readonly missingSkill: boolean;
  readonly status: WorkflowStepStatus | null;
  readonly loop: "start" | "inside" | "end" | null;
  /** Reads something other than the step before it. */
  readonly branch: boolean;
}

export interface OutlineInput {
  readonly workflow: string;
  readonly definition: WorkflowDefinition;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  /** The latest run of a workflow, when one exists; its steps supply each row's status. */
  readonly runFor: (workflow: string) => WorkflowRun | null;
  /** Keys of nested steps the user expanded. */
  readonly expanded: ReadonlySet<string>;
  readonly query: string;
  readonly filter: OutlineFilter;
  readonly missingSkills: ReadonlyArray<string>;
}

const STATUS_FILTER: Record<Exclude<OutlineFilter, "all" | "missing-skill">, string[]> = {
  running: ["running"],
  "needs-you": ["waiting"],
  done: ["done"],
  failed: ["failed"],
  "not-run": ["queued", "ready"],
};

function matchesFilter(row: OutlineRow, filter: OutlineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "missing-skill") return row.missingSkill;
  if (filter === "not-run")
    return row.status === null || STATUS_FILTER["not-run"].includes(row.status);
  return row.status !== null && STATUS_FILTER[filter].includes(row.status);
}

/**
 * The outline's rows in order, with nested workflows as expandable branches. A search lists every
 * matching step at any depth, so it expands the branches itself.
 */
export function buildOutlineRows(input: OutlineInput): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const searching = input.query.trim() !== "";
  const needle = input.query.trim().toLowerCase();
  const walk = (
    workflow: string,
    definition: WorkflowDefinition,
    depth: number,
    prefix: string,
    path: ReadonlyArray<string>,
  ) => {
    const run = input.runFor(workflow);
    const statusOf = (stepId: string) =>
      run?.steps.find((step) => step.stepId === stepId)?.status ?? null;
    const indexOf = (stepId: string) => definition.steps.findIndex((step) => step.id === stepId);
    definition.steps.forEach((step, index) => {
      const key = `${prefix}${step.id}`;
      const nested = isWorkflowNestedStep(step) ? step.workflow : null;
      const childDefinition =
        nested === null
          ? null
          : (input.workflows.find((item) => item.workflow === nested)?.definition ?? null);
      const canExpand = nested !== null && childDefinition !== null && !path.includes(nested);
      const expanded = canExpand && (searching || input.expanded.has(key));
      const skill = isWorkflowSkillStep(step) ? step.skill : null;
      const loop = (definition.loops ?? []).reduce<OutlineRow["loop"]>((found, entry) => {
        if (found !== null) return found;
        const from = indexOf(entry.from);
        const to = indexOf(entry.to);
        if (index === to) return "start";
        if (index === from) return "end";
        return from > to && index > to && index < from ? "inside" : null;
      }, null);
      const reads = step.readsFrom;
      const previous = index > 0 ? definition.steps[index - 1]!.id : null;
      const branch =
        reads !== undefined && (reads.length > 1 || (reads.length === 1 && reads[0] !== previous));
      const row: OutlineRow = {
        key,
        depth,
        workflow,
        chain: [...path, workflow],
        stepId: step.id,
        title: step.title ?? step.id,
        skill,
        nested,
        canExpand,
        expanded,
        missingSkill: skill !== null && input.missingSkills.includes(skill),
        status: statusOf(step.id),
        loop,
        branch,
      };
      const text = `${row.title} ${skill ?? ""} ${nested ?? ""}`.toLowerCase();
      if ((!needle || text.includes(needle)) && matchesFilter(row, input.filter)) rows.push(row);
      if (expanded && nested !== null && childDefinition !== null) {
        walk(nested, childDefinition, depth + 1, `${key}/`, [...path, workflow]);
      }
    });
  };
  walk(input.workflow, input.definition, 0, "", []);
  return rows;
}
