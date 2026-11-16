import {
  MAX_WORKFLOW_INPUTS,
  MAX_WORKFLOW_LOOP_ROUNDS,
  MAX_WORKFLOW_LOOPS,
  MAX_WORKFLOW_NESTING_EDGES,
  MAX_WORKFLOW_NOTES,
  MAX_WORKFLOW_STEP_ATTACHMENTS,
  MAX_WORKFLOW_STEP_CHECKS,
  MAX_WORKFLOW_STEPS,
  type WorkflowDefinition,
  type WorkflowLoop,
  type WorkflowStepRun,
} from "@t3tools/contracts";

export function stepDependencies(
  definition: WorkflowDefinition,
  stepId: string,
): ReadonlyArray<string> {
  const index = definition.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return [];
  const step = definition.steps[index]!;
  return step.readsFrom ?? (index === 0 ? [] : [definition.steps[index - 1]!.id]);
}

/** The saved workflows a definition's workflow steps reference, distinct, in order. */
function workflowReferences(definition: WorkflowDefinition): ReadonlyArray<string> {
  const slugs: string[] = [];
  for (const step of definition.steps)
    if (step.kind === "workflow" && !slugs.includes(step.workflow)) slugs.push(step.workflow);
  return slugs;
}

export function validateWorkflow(
  definition: WorkflowDefinition,
  options: { allowEmpty?: boolean } = {},
): ReadonlyArray<string> {
  const problems: string[] = [];
  const steps = definition.steps;
  const ids = new Set<string>();
  if (steps.length === 0 && !options.allowEmpty)
    problems.push("A workflow must have at least one step.");
  if (steps.length > MAX_WORKFLOW_STEPS)
    problems.push(`A workflow can have at most ${MAX_WORKFLOW_STEPS} steps.`);
  const inputIds = new Set<string>();
  if ((definition.inputs?.length ?? 0) > MAX_WORKFLOW_INPUTS)
    problems.push(`A workflow can have at most ${MAX_WORKFLOW_INPUTS} inputs.`);
  for (const input of definition.inputs ?? []) {
    if (inputIds.has(input.id)) problems.push(`Input id "${input.id}" is duplicated.`);
    inputIds.add(input.id);
  }
  if ((definition.notes?.length ?? 0) > MAX_WORKFLOW_NOTES)
    problems.push(`A workflow can have at most ${MAX_WORKFLOW_NOTES} notes.`);
  const noteIds = new Set<string>();
  for (const note of definition.notes ?? []) {
    if (noteIds.has(note.id)) problems.push(`Note id "${note.id}" is duplicated.`);
    noteIds.add(note.id);
  }
  for (const step of steps) {
    if (ids.has(step.id)) problems.push(`Step id "${step.id}" is duplicated.`);
    ids.add(step.id);
    if (step.kind !== "workflow" && (step.checks?.length ?? 0) > MAX_WORKFLOW_STEP_CHECKS) {
      problems.push(`Step "${step.id}" has more than ${MAX_WORKFLOW_STEP_CHECKS} checks.`);
    }
    if ((step.attachments?.length ?? 0) > MAX_WORKFLOW_STEP_ATTACHMENTS)
      problems.push(
        `Step "${step.id}" has more than ${MAX_WORKFLOW_STEP_ATTACHMENTS} attachments.`,
      );
    const attachmentIds = new Set<string>();
    for (const attachment of step.attachments ?? []) {
      if (attachmentIds.has(attachment.id))
        problems.push(`Step "${step.id}" has more than one attachment named "${attachment.id}".`);
      attachmentIds.add(attachment.id);
    }
    for (const dependency of step.readsFrom ?? []) {
      if (dependency === step.id) problems.push(`Step "${step.id}" reads from itself.`);
      else if (!steps.some((candidate) => candidate.id === dependency)) {
        problems.push(`Step "${step.id}" reads from "${dependency}", which isn't a step.`);
      }
    }
  }
  for (const note of definition.notes ?? []) {
    if (note.anchorStepId !== undefined && !ids.has(note.anchorStepId))
      problems.push(`Note "${note.id}" is anchored to "${note.anchorStepId}", which isn't a step.`);
  }
  const loops = definition.loops ?? [];
  if (loops.length > MAX_WORKFLOW_LOOPS)
    problems.push(`A workflow can have at most ${MAX_WORKFLOW_LOOPS} loops.`);
  const loopIds = new Set<string>();
  const validLoops: Array<{ loop: WorkflowLoop; toIndex: number; fromIndex: number }> = [];
  for (const loop of loops) {
    if (loopIds.has(loop.id)) problems.push(`Loop id "${loop.id}" is duplicated.`);
    loopIds.add(loop.id);
    if (
      !Number.isInteger(loop.maxRounds) ||
      loop.maxRounds < 1 ||
      loop.maxRounds > MAX_WORKFLOW_LOOP_ROUNDS
    ) {
      problems.push(
        `Loop "${loop.id}" maxRounds must be between 1 and ${MAX_WORKFLOW_LOOP_ROUNDS}.`,
      );
    }
    if (loop.until.kind === "condition" && loop.until.text.trim() === "") {
      problems.push(`Loop "${loop.id}" condition must not be empty.`);
    }
    const fromIndex = steps.findIndex((candidate) => candidate.id === loop.from);
    const toIndex = steps.findIndex((candidate) => candidate.id === loop.to);
    if (fromIndex < 0)
      problems.push(`Loop "${loop.id}" starts from "${loop.from}", which isn't a step.`);
    if (toIndex < 0) problems.push(`Loop "${loop.id}" jumps to "${loop.to}", which isn't a step.`);
    if (fromIndex >= 0 && toIndex >= 0) {
      if (toIndex >= fromIndex) {
        problems.push(
          `Loop "${loop.id}" must jump back to an earlier step ("${loop.to}" must come before "${loop.from}").`,
        );
      } else {
        validLoops.push({ loop, toIndex, fromIndex });
      }
    }
  }
  for (let i = 0; i < validLoops.length; i++) {
    const a = validLoops[i]!;
    for (let j = i + 1; j < validLoops.length; j++) {
      const b = validLoops[j]!;
      if (a.fromIndex === b.fromIndex) {
        problems.push(
          `Loops "${a.loop.id}" and "${b.loop.id}" cannot both loop from step "${a.loop.from}".`,
        );
      } else if (
        (a.toIndex < b.toIndex && b.toIndex < a.fromIndex && a.fromIndex < b.fromIndex) ||
        (b.toIndex < a.toIndex && a.toIndex < b.fromIndex && b.fromIndex < a.fromIndex)
      ) {
        problems.push(
          `Loops "${a.loop.id}" and "${b.loop.id}" cross each other; loops must nest or be disjoint.`,
        );
      }
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string): void => {
    if (state.get(id) === "visited") return;
    if (state.get(id) === "visiting") {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id];
      const key = [...new Set(cycle)].sort().join(",");
      if (!reported.has(key)) {
        reported.add(key);
        problems.push(`Workflow has a dependency cycle involving steps ${cycle.join(", ")}.`);
      }
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    const step = steps.find((candidate) => candidate.id === id);
    if (step)
      for (const dependency of stepDependencies(definition, id)) {
        if (steps.some((candidate) => candidate.id === dependency)) visit(dependency);
      }
    stack.pop();
    state.set(id, "visited");
  };
  for (const step of steps) visit(step.id);
  return problems;
}

/**
 * Rejects a save when the project's workflows would include each other in a loop, or nest
 * deeper than MAX_WORKFLOW_NESTING_EDGES. `project` holds every saved definition with the one
 * being saved already in place; null marks a file that can't be read, which pre-flight reports
 * separately as a missing workflow.
 */
export function validateNesting(
  project: ReadonlyMap<string, WorkflowDefinition | null>,
): ReadonlyArray<string> {
  const problems: string[] = [];
  const references = (slug: string): ReadonlyArray<string> => {
    const definition = project.get(slug);
    return definition === null || definition === undefined
      ? []
      : [
          ...workflowReferences(definition),
          ...(definition.startAfter ?? []).map((trigger) => trigger.workflow),
        ];
  };
  // Cycles first, so the depth walk below only follows forward edges.
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const visit = (slug: string): void => {
    const seen = state.get(slug);
    if (seen === "visited") return;
    if (seen === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(slug)), slug];
      problems.push(`Workflows can't include each other in a loop: ${cycle.join(" -> ")}.`);
      return;
    }
    state.set(slug, "visiting");
    stack.push(slug);
    for (const target of references(slug)) visit(target);
    stack.pop();
    state.set(slug, "visited");
  };
  for (const slug of project.keys()) visit(slug);
  if (problems.length) return problems;
  const chains = new Map<string, ReadonlyArray<string>>();
  const longestChain = (slug: string): ReadonlyArray<string> => {
    const cached = chains.get(slug);
    if (cached !== undefined) return cached;
    let best: ReadonlyArray<string> = [slug];
    for (const target of references(slug)) {
      const chain = [slug, ...longestChain(target)];
      if (chain.length > best.length) best = chain;
    }
    chains.set(slug, best);
    return best;
  };
  for (const slug of project.keys()) {
    const chain = longestChain(slug);
    if (chain.length - 1 > MAX_WORKFLOW_NESTING_EDGES)
      problems.push(
        `Workflows can nest two levels deep at most (root -> child -> grandchild); ${chain.join(" -> ")} goes further.`,
      );
  }
  return problems;
}

const INPUT_TEMPLATE = /\{\{\s*input\.([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g;
const LAST_RESULT_TEMPLATE = /\{\{\s*last\.result\s*\}\}/g;

/** Replaces {{input.<id>}} and {{last.result}} in briefs, notes and prompts; an unknown reference is left as written. */
export function renderInputTemplates(
  text: string,
  inputs: Readonly<Record<string, string>>,
  lastResult?: string,
): string {
  const withInputs = text.replace(INPUT_TEMPLATE, (whole, id: string) =>
    inputs[id] === undefined ? whole : inputs[id]!,
  );
  const resolvedLast = lastResult ?? inputs["last.result"];
  return resolvedLast === undefined
    ? withInputs
    : withInputs.replace(LAST_RESULT_TEMPLATE, () => resolvedLast);
}

/**
 * Renders one mapped value for a child run. A reference to an input the run wasn't given
 * becomes an empty string, so the child's required-input check fails honestly instead of
 * receiving the literal template.
 */
export function renderInputValue(
  value: string,
  inputs: Readonly<Record<string, string>>,
  lastResult?: string,
): string {
  const resolvedLast = lastResult ?? inputs["last.result"] ?? "";
  return value
    .replace(INPUT_TEMPLATE, (_whole, id: string) => inputs[id] ?? "")
    .replace(LAST_RESULT_TEMPLATE, () => resolvedLast);
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/** Fill omitted inputs once at run creation so templates and pinned runs share the same values. */
export function resolveRunInputs(
  declared: WorkflowDefinition["inputs"],
  inputs: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  const resolved = { ...inputs };
  for (const input of declared ?? [])
    if (!Object.hasOwn(inputs, input.id) && input.defaultValue !== undefined)
      resolved[input.id] = input.defaultValue;
  return resolved;
}

/** Required inputs must be filled, url inputs must be http(s) addresses, unknown keys are refused. */
export function validateRunInputs(
  definition: WorkflowDefinition,
  inputs: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  const problems: string[] = [];
  const declared = new Set((definition.inputs ?? []).map((input) => input.id));
  for (const id of Object.keys(inputs))
    if (!declared.has(id)) problems.push(`"${id}" isn't an input of this workflow.`);
  for (const input of definition.inputs ?? []) {
    const value = inputs[input.id];
    if (value === undefined || value.trim() === "") {
      if (input.required) problems.push(`Input "${input.label}" is required.`);
      continue;
    }
    if (input.kind === "url" && !isHttpUrl(value))
      problems.push(`Input "${input.label}" must be an http(s) URL, such as https://example.com.`);
  }
  return problems;
}

export function nextActions(
  definition: WorkflowDefinition,
  steps: ReadonlyArray<WorkflowStepRun>,
): {
  start: ReadonlyArray<string>;
  awaitApproval: ReadonlyArray<string>;
  finished: "done" | "failed" | null;
} {
  const runs = new Map(steps.map((step) => [step.stepId, step]));
  if (steps.some((step) => step.status === "failed"))
    return { start: [], awaitApproval: [], finished: "failed" };
  if (
    definition.steps.every((step) => {
      const status = runs.get(step.id)?.status;
      return status === "done" || status === "skipped";
    })
  )
    return { start: [], awaitApproval: [], finished: "done" };

  const start: string[] = [];
  const awaitApproval: string[] = [];
  for (const step of definition.steps) {
    if (runs.get(step.id)?.status !== "queued") continue;
    if (
      !stepDependencies(definition, step.id).every((id) => {
        const status = runs.get(id)?.status;
        return status === "done" || status === "skipped";
      })
    )
      continue;
    (step.gate ? awaitApproval : start).push(step.id);
  }
  return { start, awaitApproval, finished: null };
}

/**
 * Steps reset when `loop` repeats: the inclusive range from `to` through `from` in step order,
 * plus any step that does not transitively depend on `from` and reads only from inside the range.
 */
export function loopRangeStepIds(
  definition: WorkflowDefinition,
  loop: Pick<WorkflowLoop, "from" | "to">,
): ReadonlySet<string> {
  const toIndex = definition.steps.findIndex((step) => step.id === loop.to);
  const fromIndex = definition.steps.findIndex((step) => step.id === loop.from);
  if (toIndex < 0 || fromIndex < 0 || toIndex > fromIndex) return new Set();
  const dependsOnFrom = new Set<string>([loop.from]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of definition.steps) {
      if (dependsOnFrom.has(step.id)) continue;
      if (stepDependencies(definition, step.id).some((dep) => dependsOnFrom.has(dep))) {
        dependsOnFrom.add(step.id);
        changed = true;
      }
    }
  }
  const range = new Set<string>(
    definition.steps.slice(toIndex, fromIndex + 1).map((step) => step.id),
  );
  changed = true;
  while (changed) {
    changed = false;
    for (const step of definition.steps) {
      if (range.has(step.id) || dependsOnFrom.has(step.id)) continue;
      const deps = stepDependencies(definition, step.id);
      if (deps.length > 0 && deps.every((dep) => range.has(dep))) {
        range.add(step.id);
        changed = true;
      }
    }
  }
  return range;
}

const VERDICT_LINE = /\bVERDICT\s*:\s*(pass|revise)(?:[ \t]*(?:—|--|-|:)[ \t]*([^\r\n]+))?/gi;

/**
 * Parses `VERDICT: pass` or `VERDICT: revise — <why>` from a step's summary or outputs.
 * When missing, defaults to `pass` so an agent that forgets the marker cannot loop forever.
 */
export function parseStepVerdict(
  summary?: string,
  outputs?: Readonly<Record<string, string>>,
): { readonly verdict: "pass" | "revise"; readonly reason?: string } {
  const texts = [summary ?? "", ...Object.values(outputs ?? {})];
  let found: { verdict: "pass" | "revise"; reason?: string } | null = null;
  for (const text of texts) {
    for (const match of text.matchAll(VERDICT_LINE)) {
      const verdict = match[1]!.toLowerCase() === "revise" ? "revise" : "pass";
      const reason = match[2]?.trim();
      found = { verdict, ...(reason ? { reason } : {}) };
    }
    if (found !== null) break;
  }
  return found ?? { verdict: "pass" };
}

/** Innermost loop whose range contains `stepId`, or null when the step is not in a loop. */
export function enclosingLoopForStep(
  definition: WorkflowDefinition,
  stepId: string,
): WorkflowLoop | null {
  const ownLoop = (definition.loops ?? []).find((loop) => loop.from === stepId);
  if (ownLoop !== undefined) return ownLoop;
  let chosen: { readonly loop: WorkflowLoop; readonly size: number } | null = null;
  for (const loop of definition.loops ?? []) {
    const range = loopRangeStepIds(definition, loop);
    if (!range.has(stepId)) continue;
    if (chosen === null || range.size < chosen.size) {
      chosen = { loop, size: range.size };
    }
  }
  return chosen?.loop ?? null;
}
