import type {
  OrchestrationV2ThreadProjection,
  WorkflowDraft,
  WorkflowStep,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export class WorkflowDraftEmptyError extends Schema.TaggedError<WorkflowDraftEmptyError>()(
  "WorkflowDraftEmptyError",
  {},
) {
  override get message(): string {
    return "This thread hasn't handed any work to subagents yet.";
  }
}

type Projection = OrchestrationV2ThreadProjection;
type DraftProjection = {
  thread: Pick<Projection["thread"], "id" | "title">;
  subagents: ReadonlyArray<
    Pick<
      Projection["subagents"][number],
      | "id"
      | "threadId"
      | "runId"
      | "parentNodeId"
      | "prompt"
      | "title"
      | "modelSelection"
      | "workflow"
      | "startedAt"
      | "updatedAt"
    >
  >;
  nodes: ReadonlyArray<
    Pick<Projection["nodes"][number], "id" | "parentNodeId" | "rootNodeId" | "kind" | "startedAt">
  >;
  runs: ReadonlyArray<Pick<Projection["runs"][number], "rootNodeId">>;
  messages: ReadonlyArray<
    Pick<
      Projection["messages"][number],
      "role" | "text" | "notification" | "delegatedCompletion" | "workflowScript" | "createdAt"
    >
  >;
};

const uniqueSlug = (title: string, fallback: string, used: Set<string>) => {
  const base =
    title
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64)
      .replace(/-$/g, "") || fallback;
  let slug = base;
  for (let suffix = 2; used.has(slug); suffix++) {
    const tail = `-${suffix}`;
    slug = `${base.slice(0, 64 - tail.length).replace(/-$/g, "")}${tail}`;
  }
  used.add(slug);
  return slug;
};

/** The projection has no creation field on subagents; node/start time is stable across updates. */
export function draftWorkflowFromThread(input: {
  projection: DraftProjection;
  existingWorkflows: ReadonlyArray<string>;
  existingSkills: ReadonlyArray<string>;
}): Result.Result<WorkflowDraft, WorkflowDraftEmptyError> {
  const { projection } = input;
  const nodes = new Map<string, DraftProjection["nodes"][number]>(
    projection.nodes.map((node) => [node.id, node]),
  );
  const subagentIds = new Set<string>(projection.subagents.map((task) => task.id));
  const tasks = projection.subagents
    .filter((task) => {
      if (
        task.threadId !== projection.thread.id ||
        !task.prompt.trim() ||
        task.workflow !== undefined
      )
        return false;
      const node = nodes.get(task.id);
      if (node !== undefined && node.kind !== "subagent") return false;
      const seen = new Set<string>([task.id]);
      let parentId: string | null = task.parentNodeId;
      while (parentId !== null) {
        if (seen.has(parentId) || subagentIds.has(parentId)) return false;
        seen.add(parentId);
        const parent = nodes.get(parentId);
        if (parent?.kind === "subagent") return false;
        if (parent?.kind === "root_turn") return true;
        if (parent === undefined) return projection.runs.some((run) => run.rootNodeId === parentId);
        parentId = parent.parentNodeId;
      }
      return false;
    })
    .toSorted((a, b) => {
      const started = (task: typeof a) =>
        DateTime.toEpochMillis(nodes.get(task.id)?.startedAt ?? task.startedAt ?? task.updatedAt);
      return started(a) - started(b);
    });
  if (!tasks.length) return Result.fail(new WorkflowDraftEmptyError({}));

  const usedIds = new Set<string>();
  const installed = new Set(input.existingSkills.map((name) => name.toLowerCase()));
  const groups = new Map<string, WorkflowStep[]>();
  const steps = tasks.map((task) => {
    const title = task.title?.trim() || task.prompt.trim().split(/\s+/).slice(0, 8).join(" ");
    const id = uniqueSlug(title, "step", usedIds);
    const step: WorkflowStep = {
      id,
      title,
      skill: id,
      delegation: "subagent",
      readsFrom: [],
      ...(task.modelSelection === undefined ? {} : { model: task.modelSelection }),
    };
    // Missing run ids still have a parent turn; never combine unrelated unknown turns.
    const group = task.runId ?? nodes.get(task.id)?.rootNodeId ?? task.parentNodeId;
    const siblings = groups.get(group) ?? [];
    siblings.push(step);
    groups.set(group, siblings);
    return step;
  });
  const dependencies = new Map<string, ReadonlyArray<string>>();
  let previous: ReadonlyArray<string> = [];
  for (const siblings of groups.values()) {
    for (const step of siblings) dependencies.set(step.id, previous);
    previous = siblings.map((step) => step.id);
  }
  const brief = projection.messages
    .filter(
      (message) =>
        message.role === "user" &&
        !message.notification &&
        !message.delegatedCompletion &&
        !message.workflowScript,
    )
    .toSorted(
      (a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt),
    )[0]?.text;
  const name = projection.thread.title.trim() || "Saved workflow";
  return Result.succeed({
    slug: uniqueSlug(name, "workflow", new Set(input.existingWorkflows)),
    definition: {
      version: 1,
      name,
      ...(brief?.trim() ? { brief } : {}),
      steps: steps.map((step) => ({ ...step, readsFrom: dependencies.get(step.id)! })),
    },
    skills: steps.map((step, index) => ({
      name: step.id,
      content: `---\nname: ${step.id}\ndescription: ${JSON.stringify(step.title)}\n---\n\n${tasks[index]!.prompt}\n`,
      exists: installed.has(step.id.toLowerCase()),
    })),
  });
}
