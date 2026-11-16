import type { WorkflowListing } from "@t3tools/contracts";

/** Excludes references that would lead back to the workflow being edited. */
export function nestableWorkflows(
  workflows: ReadonlyArray<WorkflowListing>,
  parentWorkflow: string,
): ReadonlyArray<WorkflowListing> {
  const references = new Map(
    workflows.map((listing) => [
      listing.workflow,
      listing.definition?.steps.flatMap((step) =>
        step.kind === "workflow" ? [step.workflow] : [],
      ) ?? [],
    ]),
  );
  return workflows.filter((listing) => {
    if (!listing.definition) return false;
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const loops = (slug: string): boolean => {
      if (slug === parentWorkflow || visiting.has(slug)) return true;
      if (visited.has(slug)) return false;
      visiting.add(slug);
      if ((references.get(slug) ?? []).some(loops)) return true;
      visiting.delete(slug);
      visited.add(slug);
      return false;
    };
    return !loops(listing.workflow);
  });
}

/** What a nested step's reference resolves to, from the parent's point of view. */
export type NestedTargetState = "empty" | "ready" | "self" | "missing" | "unavailable" | "loops";

export function nestedTargetState(input: {
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly parentWorkflow: string;
  readonly target: string;
}): NestedTargetState {
  if (input.target === "") return "empty";
  if (input.target === input.parentWorkflow) return "self";
  const listing = input.workflows.find((item) => item.workflow === input.target);
  if (!listing) return "missing";
  if (!listing.definition) return "unavailable";
  return nestableWorkflows(input.workflows, input.parentWorkflow).some(
    (item) => item.workflow === input.target,
  )
    ? "ready"
    : "loops";
}

/**
 * The panel's breadcrumb: the workflows it opened on the way down, outermost first. Opening a
 * workflow the trail already holds would loop, so that is refused rather than pushed.
 */
export function openNestedTrail(input: {
  readonly trail: ReadonlyArray<string>;
  readonly current: string;
  readonly target: string;
}):
  | { readonly _tag: "open"; readonly trail: ReadonlyArray<string> }
  | { readonly _tag: "refused" } {
  if (input.target === input.current || input.trail.includes(input.target)) {
    return { _tag: "refused" };
  }
  return { _tag: "open", trail: [...input.trail, input.current] };
}
