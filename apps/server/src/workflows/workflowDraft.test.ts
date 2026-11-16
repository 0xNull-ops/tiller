import { expect, it } from "@effect/vitest";
import { NodeId, RunId, ThreadId, ProviderInstanceId, WorkflowDraft } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { parseFrontmatter } from "./SkillCatalog.ts";
import { draftWorkflowFromThread } from "./workflowDraft.ts";

type Input = Parameters<typeof draftWorkflowFromThread>[0];
type Task = Input["projection"]["subagents"][number];
const isDraft = Schema.is(WorkflowDraft);
const threadId = ThreadId.make("driver");
const at = (second: number) =>
  DateTime.makeUnsafe(`2026-10-20T00:00:${String(second).padStart(2, "0")}.000Z`);
const task = (id: string, run: string | null, second: number, extra: Partial<Task> = {}): Task => ({
  id: NodeId.make(id),
  threadId,
  runId: run === null ? null : RunId.make(run),
  parentNodeId: NodeId.make(`root-${run ?? id}`),
  title: "Build it",
  prompt: `Prompt for ${id}.\nKeep the whole task.`,
  startedAt: at(second),
  updatedAt: at(59),
  ...extra,
});
const input = (subagents: ReadonlyArray<Task>): Input => ({
  projection: {
    thread: { id: threadId, title: "Launch site" },
    subagents,
    nodes: [...new Set(subagents.map((item) => item.parentNodeId))].map((id) => ({
      id,
      parentNodeId: null,
      rootNodeId: id,
      kind: "root_turn",
      startedAt: at(0),
    })),
    runs: [],
    messages: [],
  },
  existingWorkflows: [],
  existingSkills: [],
});

it.effect("orders tasks and connects parallel turn groups to the entire previous group", () =>
  Effect.gen(function* () {
    const source = input([
      task("c", "second", 3),
      task("b", "first", 2),
      task("d", "second", 4),
      task("a", "first", 1),
      task("e", "third", 5),
    ]);
    const draft = yield* Effect.fromResult(draftWorkflowFromThread(source));
    expect(draft.definition.steps.map((step) => step.readsFrom)).toEqual([
      [],
      [],
      ["build-it", "build-it-2"],
      ["build-it", "build-it-2"],
      ["build-it-3", "build-it-4"],
    ]);
    expect(draft.skills.map((skill) => skill.content)).toEqual(
      ["a", "b", "c", "d", "e"].map(
        (id, index) =>
          `---\nname: build-it${index ? `-${index + 1}` : ""}\ndescription: "Build it"\n---\n\nPrompt for ${id}.\nKeep the whole task.\n`,
      ),
    );
    expect(
      draft.definition.steps.every(
        (step) => step.kind !== "workflow" && step.delegation === "subagent",
      ),
    ).toBe(true);
    expect(isDraft(draft)).toBe(true);
  }),
);

it.effect("makes bounded unique slugs, keeps model selection, brief, and skill existence", () =>
  Effect.gen(function* () {
    const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
    const source = input([
      task("a", "first", 1, {
        title: null,
        prompt: "Review the design carefully",
        modelSelection: model,
      }),
      task("b", "first", 2, { title: "Ü".repeat(100) }),
      task("c", "first", 3, { title: "Ü".repeat(100) }),
      task("d", "first", 4, { title: "🎉" }),
      task("e", "first", 5, { title: 'Title: quoted "thing"\nand line' }),
    ]);
    source.existingWorkflows = ["launch-site", "launch-site-2"];
    source.existingSkills = ["REVIEW-THE-DESIGN-CAREFULLY"];
    source.projection.messages = [
      { role: "user", text: "Later", createdAt: at(2) },
      { role: "assistant", text: "Ignore", createdAt: at(0) },
      { role: "user", text: "Build my site", createdAt: at(1) },
    ];
    const draft = yield* Effect.fromResult(draftWorkflowFromThread(source));
    expect(draft.slug).toBe("launch-site-3");
    expect(draft.definition.name).toBe("Launch site");
    expect(draft.definition.brief).toBe("Build my site");
    expect(draft.definition.steps[0]).toMatchObject({
      id: "review-the-design-carefully",
      title: "Review the design carefully",
      model,
    });
    const ids = draft.definition.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length <= 64)).toBe(true);
    expect(draft.skills[0]?.exists).toBe(true);
    expect(draft.skills[1]?.exists).toBe(false);
    expect(parseFrontmatter(draft.skills[0]!.content)).toMatchObject({
      name: ids[0],
      description: "Review the design carefully",
    });
    expect(draft.skills[4]?.content.split("\n")[2]).toBe(
      'description: "Title: quoted \\"thing\\"\\nand line"',
    );
    expect(isDraft(draft)).toBe(true);
  }),
);

it.effect("excludes nested tasks, other threads, blank tasks, and workflow coordinators", () =>
  Effect.gen(function* () {
    const a = task("a", "first", 1);
    const source = input([
      a,
      task("nested", "first", 2, { parentNodeId: a.id }),
      task("elsewhere", "first", 3, { threadId: ThreadId.make("other") }),
      task("empty", "first", 4, { prompt: " " }),
      task("coordinator", "first", 5, { workflow: { phases: [], agents: [] } }),
    ]);
    source.projection.nodes = [
      {
        id: a.parentNodeId,
        parentNodeId: null,
        rootNodeId: a.parentNodeId,
        kind: "root_turn",
        startedAt: at(0),
      },
      {
        id: a.id,
        parentNodeId: a.parentNodeId,
        rootNodeId: a.parentNodeId,
        kind: "subagent",
        startedAt: at(1),
      },
    ];
    const draft = yield* Effect.fromResult(draftWorkflowFromThread(source));
    expect(draft.definition.steps).toHaveLength(1);
    expect(draft.definition).not.toHaveProperty("brief");
  }),
);

it.effect("does not group unrelated tasks whose run ids are missing", () =>
  Effect.gen(function* () {
    const draft = yield* Effect.fromResult(
      draftWorkflowFromThread(input([task("a", null, 1), task("b", null, 2)])),
    );
    expect(draft.definition.steps.map((step) => step.readsFrom)).toEqual([[], ["build-it"]]);
  }),
);

it.effect("explains when a thread has never delegated work", () =>
  Effect.sync(() => {
    const result = draftWorkflowFromThread(input([]));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result))
      expect(result.failure.message).toBe("This thread hasn't handed any work to subagents yet.");
  }),
);
