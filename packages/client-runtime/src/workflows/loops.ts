import type { WorkflowDefinition, WorkflowLoop } from "@t3tools/contracts";

/** Step IDs reset when a loop repeats: the inclusive to..from range plus steps that do not depend on `from` and read only inside it. */
export function loopRangeStepIds(
  definition: WorkflowDefinition,
  loop: Pick<WorkflowLoop, "from" | "to">,
): ReadonlySet<string> {
  const toIndex = definition.steps.findIndex((step) => step.id === loop.to);
  const fromIndex = definition.steps.findIndex((step) => step.id === loop.from);
  if (toIndex < 0 || fromIndex < 0 || toIndex >= fromIndex) return new Set();
  const dependsOnFrom = new Set<string>([loop.from]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [index, step] of definition.steps.entries()) {
      if (dependsOnFrom.has(step.id)) continue;
      const deps = step.readsFrom ?? (index === 0 ? [] : [definition.steps[index - 1]!.id]);
      if (deps.some((dep) => dependsOnFrom.has(dep))) {
        dependsOnFrom.add(step.id);
        changed = true;
      }
    }
  }
  const inRange = new Set(definition.steps.slice(toIndex, fromIndex + 1).map((step) => step.id));
  changed = true;
  while (changed) {
    changed = false;
    for (const [index, step] of definition.steps.entries()) {
      if (inRange.has(step.id) || dependsOnFrom.has(step.id)) continue;
      const deps = step.readsFrom ?? (index === 0 ? [] : [definition.steps[index - 1]!.id]);
      if (deps.length > 0 && deps.every((dep) => inRange.has(dep))) {
        inRange.add(step.id);
        changed = true;
      }
    }
  }
  return inRange;
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
