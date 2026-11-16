import { MAX_WORKFLOW_LOOPS, workflowSemanticDefinition } from "@t3tools/contracts";
export { enclosingLoopForStep } from "@t3tools/client-runtime/workflows/loops";
import type {
  WorkflowDefinition,
  WorkflowListing,
  WorkflowRun,
  WorkflowStep,
} from "@t3tools/contracts";

/** Lowercase letters, digits and dashes, matching WorkflowSlug; empty when nothing usable is left. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function unique(base: string, taken: ReadonlySet<string>, fallback: string): string {
  const root = slugify(base) || fallback;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function uniqueStepId(definition: WorkflowDefinition, base: string): string {
  return unique(base, new Set(definition.steps.map((step) => step.id)), "step");
}

export function uniqueWorkflowSlug(
  workflows: ReadonlyArray<WorkflowListing>,
  name: string,
): string {
  return unique(name, new Set(workflows.map((item) => item.workflow)), "workflow");
}

/** Keep chosen draft steps and drop explicit edges that point to removed steps. */
export function keepWorkflowSteps(
  definition: WorkflowDefinition,
  keptStepIds: ReadonlySet<string>,
): WorkflowDefinition {
  const steps = definition.steps
    .filter((step) => keptStepIds.has(step.id))
    .map((step) =>
      step.readsFrom === undefined
        ? step
        : {
            ...step,
            readsFrom: step.readsFrom.filter((id) => keptStepIds.has(id)),
          },
    );
  const loops = definition.loops?.filter(
    (loop) => keptStepIds.has(loop.from) && keptStepIds.has(loop.to),
  );
  return {
    ...definition,
    steps,
    ...(definition.loops === undefined ? {} : { loops: loops?.length ? loops : undefined }),
  };
}

/** "frontend-design" → "Frontend design". */
export function titleFromSkill(skill: string): string {
  const words = skill.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a step reads from, with the implicit "the step before it" spelled out. */
export function dependenciesOf(definition: WorkflowDefinition, stepId: string): string[] {
  const index = definition.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return [];
  const step = definition.steps[index]!;
  return [...(step.readsFrom ?? (index === 0 ? [] : [definition.steps[index - 1]!.id]))];
}

/** Explains the definition fields stepRemove will remove or detach before the user confirms. */
export function workflowStepRemovalSummary(definition: WorkflowDefinition, stepId: string): string {
  const step = definition.steps.find((entry) => entry.id === stepId);
  if (!step) return "This step will be removed from the saved workflow.";
  const dependents = definition.steps
    .filter((entry) => entry.id !== stepId && dependenciesOf(definition, entry.id).includes(stepId))
    .map((entry) => entry.title ?? entry.id);
  const anchoredNotes = (definition.notes ?? []).filter(
    (note) => note.anchorStepId === stepId,
  ).length;
  const attachedLoops = (definition.loops ?? []).filter(
    (loop) => loop.from === stepId || loop.to === stepId,
  ).length;
  const effects = [
    dependents.length
      ? `It will detach ${dependents.length} dependent step${dependents.length === 1 ? "" : "s"}: ${dependents.join(", ")}.`
      : "",
    step.gate ? "Its approval gate will be removed." : "",
    "checks" in step && step.checks?.length
      ? `Its Check card and ${step.checks.length} configured check${step.checks.length === 1 ? "" : "s"} will be removed.`
      : "",
    step.attachments?.length
      ? `${step.attachments.length} attached resource${step.attachments.length === 1 ? "" : "s"} will be detached.`
      : "",
    anchoredNotes
      ? `${anchoredNotes} anchored note${anchoredNotes === 1 ? "" : "s"} will remain and be detached from this step.`
      : "",
    attachedLoops
      ? `${attachedLoops} loop${attachedLoops === 1 ? "" : "s"} attached to this step will be removed.`
      : "",
  ].filter(Boolean);
  return effects.length ? effects.join(" ") : "This step will be removed from the saved workflow.";
}

export function uniqueLoopId(definition: WorkflowDefinition, fromId: string, toId: string): string {
  return unique(
    `${fromId}-to-${toId}`,
    new Set((definition.loops ?? []).map((loop) => loop.id)),
    "loop",
  );
}

/** Whether a feedback loop from `fromId` back to an earlier `toId` is valid without crossing other loops. */
export function canLoopBack(definition: WorkflowDefinition, fromId: string, toId: string): boolean {
  const fromIndex = definition.steps.findIndex((step) => step.id === fromId);
  const toIndex = definition.steps.findIndex((step) => step.id === toId);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= fromIndex) return false;
  const existingForFrom = (definition.loops ?? []).find((loop) => loop.from === fromId);
  const others = (definition.loops ?? []).filter((loop) => loop.from !== fromId);
  if (!existingForFrom && others.length >= MAX_WORKFLOW_LOOPS) return false;
  for (const other of others) {
    const otherFromIndex = definition.steps.findIndex((step) => step.id === other.from);
    const otherToIndex = definition.steps.findIndex((step) => step.id === other.to);
    if (otherFromIndex < 0 || otherToIndex < 0 || otherToIndex >= otherFromIndex) continue;
    if (toIndex === otherToIndex && fromIndex === otherFromIndex) return false;
    const nested =
      (toIndex >= otherToIndex && fromIndex < otherFromIndex) ||
      (otherToIndex >= toIndex && otherFromIndex < fromIndex);
    const disjoint = fromIndex < otherToIndex || otherFromIndex < toIndex;
    if (!nested && !disjoint) return false;
  }
  return true;
}

/** The target step with `sourceId` added to what it reads from, or null when nothing changes. */
export function withReadsFrom(
  definition: WorkflowDefinition,
  targetId: string,
  sourceId: string,
): WorkflowStep | null {
  const target = definition.steps.find((step) => step.id === targetId);
  if (target === undefined || !canReadFrom(definition, targetId, sourceId)) return null;
  const current = dependenciesOf(definition, targetId);
  if (current.includes(sourceId)) return null;
  return { ...target, readsFrom: [...current, sourceId] };
}

/** Whether adding source → target keeps the dependency graph acyclic. */
export function canReadFrom(
  definition: WorkflowDefinition,
  targetId: string,
  sourceId: string,
): boolean {
  if (targetId === sourceId) return false;
  const steps = new Set(definition.steps.map((step) => step.id));
  if (!steps.has(targetId) || !steps.has(sourceId)) return false;
  const pending = [...dependenciesOf(definition, sourceId)];
  const seen = new Set<string>();
  while (pending.length) {
    const dependency = pending.pop()!;
    if (dependency === targetId) return false;
    if (seen.has(dependency)) continue;
    seen.add(dependency);
    pending.push(...dependenciesOf(definition, dependency));
  }
  return !dependenciesOf(definition, targetId).includes(sourceId);
}

export function withoutReadsFrom(
  definition: WorkflowDefinition,
  targetId: string,
  sourceId: string,
): WorkflowStep | null {
  const target = definition.steps.find((step) => step.id === targetId);
  if (target === undefined) return null;
  const current = dependenciesOf(definition, targetId);
  if (!current.includes(sourceId)) return null;
  return { ...target, readsFrom: current.filter((id) => id !== sourceId) };
}

/**
 * Inserting a new step on the connection from `fromId` (null: the workflow's start) to `toId`.
 * The new step goes after `fromId` in order. A follower that names its inputs explicitly is
 * rewired to read from the new step instead, so the new step really sits between the two.
 */
export function insertBetween(
  definition: WorkflowDefinition,
  fromId: string | null,
  toId: string,
  newStepId: string,
): { after: string | null; rewired: WorkflowStep | null } {
  const to = definition.steps.find((step) => step.id === toId);
  const rewired =
    to?.readsFrom === undefined
      ? null
      : {
          ...to,
          readsFrom:
            fromId === null
              ? [...to.readsFrom, newStepId]
              : to.readsFrom.map((id) => (id === fromId ? newStepId : id)),
        };
  return { after: fromId, rewired };
}

/** A skill's name from a dropped SKILL.md: frontmatter `name:`, else the file name. */
export function skillNameFromFile(text: string, fileName: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  const named = frontmatter
    ?.split(/\r?\n/)
    .map((line) => /^name:\s*(.*)$/.exec(line)?.[1])
    .find((value) => value !== undefined)
    ?.trim()
    .replace(/^["']|["']$/g, "");
  const base = fileName.replace(/\.md$/i, "");
  const name = slugify(named || (base.toUpperCase() === "SKILL" ? "" : base));
  return name || null;
}

export function skillTemplate(name: string, description: string): string {
  return `---
name: ${name}
description: ${description || `What ${name} does and when to use it.`}
---

# ${titleFromSkill(name)}

## Goal

Describe the result this skill produces.

## Steps

1. …

## Done when

- …
`;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

export function definitionChanged(a: WorkflowDefinition, b: WorkflowDefinition | null): boolean {
  return (
    b !== null && stable(workflowSemanticDefinition(a)) !== stable(workflowSemanticDefinition(b))
  );
}

const live = (run: WorkflowRun) => run.status === "running" || run.status === "waiting";

export type CanvasView =
  | { readonly mode: "run"; readonly run: WorkflowRun; readonly definition: WorkflowDefinition }
  | {
      readonly mode: "edit";
      readonly definition: WorkflowDefinition;
      /** The latest run, overlaid on the steps it shares with the saved workflow. */
      readonly lastRun: WorkflowRun | null;
    }
  | { readonly mode: "none" };

/**
 * A live run, or a run the user picked, shows as the run. Otherwise the canvas is the saved
 * workflow, which the user edits; `editing` asks for that view even while a run is live.
 */
export function chooseCanvasView(input: {
  listing: WorkflowListing | null;
  runs: ReadonlyArray<WorkflowRun>;
  pickedRunId: string | null;
  editing: boolean;
}): CanvasView {
  const runs = input.runs
    .filter((run) => input.listing === null || run.workflow === input.listing.workflow)
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
  const picked = runs.find((run) => run.id === input.pickedRunId) ?? null;
  const latest = runs[0] ?? null;
  const definition = input.listing?.definition ?? null;
  if (!input.editing && picked !== null)
    return { mode: "run", run: picked, definition: picked.definition };
  if (!input.editing && latest !== null && (live(latest) || definition === null))
    return { mode: "run", run: latest, definition: latest.definition };
  if (definition !== null) return { mode: "edit", definition, lastRun: latest };
  return { mode: "none" };
}

/** A delegated step's thread can still open the workflow that owns its child run. */
export function relatedWorkflowRuns(runs: ReadonlyArray<WorkflowRun>, threadId: string) {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const related = new Set<string>();
  for (const run of runs) {
    if (run.driverThreadId !== threadId && !run.steps.some((step) => step.threadId === threadId))
      continue;
    let ancestor: WorkflowRun | undefined = run;
    while (ancestor && !related.has(ancestor.id)) {
      related.add(ancestor.id);
      ancestor = ancestor.parent ? byId.get(ancestor.parent.runId) : undefined;
    }
  }
  return runs.filter((run) => related.has(run.id));
}

/**
 * Only top-level user chats can drive a workflow; subagent threads and workflow step child
 * threads are excluded from the driving chat selector.
 */
export function isMainDrivingThread(
  thread: {
    readonly id: string;
    readonly title?: string | null;
    readonly lineage?: {
      readonly parentThreadId?: string | null;
      readonly relationshipToParent?: string | null;
    } | null;
  },
  runs: ReadonlyArray<WorkflowRun> = [],
): boolean {
  if (thread.id.startsWith("thread:delegated-task:")) return false;
  if (thread.lineage?.relationshipToParent === "subagent") return false;
  if (thread.lineage?.parentThreadId != null) return false;
  if (/^Workflow ".+", step ".+"/.test(thread.title ?? "")) return false;
  for (const run of runs) {
    if (
      run.steps.some((step) => step.threadId === thread.id && step.threadId !== run.driverThreadId)
    ) {
      return false;
    }
  }
  return true;
}
