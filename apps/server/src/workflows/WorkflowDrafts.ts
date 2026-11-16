import type { ProjectId, ThreadId, WorkflowDraft } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as WorkflowRunner from "./WorkflowRunner.ts";
import { draftWorkflowFromThread, type WorkflowDraftEmptyError } from "./workflowDraft.ts";

export class WorkflowDraftReadError extends Schema.TaggedError<WorkflowDraftReadError>()(
  "WorkflowDraftReadError",
  { threadId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read this thread's delegated work. Check that it belongs to this project.";
  }
}

type DraftError =
  | WorkflowDraftEmptyError
  | WorkflowDraftReadError
  | Effect.Error<ReturnType<WorkflowRunner.WorkflowRunner["Service"]["workflowSlugs"]>>
  | Effect.Error<ReturnType<WorkflowRunner.WorkflowRunner["Service"]["skillList"]>>;

export class WorkflowDrafts extends Context.Service<
  WorkflowDrafts,
  {
    readonly draftFromThread: (input: {
      projectId: ProjectId;
      threadId: ThreadId;
    }) => Effect.Effect<WorkflowDraft, DraftError>;
  }
>()("t3/workflows/WorkflowDrafts") {}

export const layer = Layer.effect(
  WorkflowDrafts,
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const runner = yield* WorkflowRunner.WorkflowRunner;
    const draftFromThread: WorkflowDrafts["Service"]["draftFromThread"] = Effect.fn(
      "WorkflowDrafts.draftFromThread",
    )(function* (input) {
      // This reads only needed V2 records through the existing transcript/import boundary.
      const projection = yield* threads
        .getThreadRecords(input.threadId, ["subagents", "nodes", "runs", "messages"])
        .pipe(
          Effect.mapError(
            (cause) => new WorkflowDraftReadError({ threadId: input.threadId, cause }),
          ),
        );
      if (projection.thread.projectId !== input.projectId || projection.thread.deletedAt !== null)
        return yield* new WorkflowDraftReadError({
          threadId: input.threadId,
          cause: "Thread is unavailable in this project.",
        });
      const existingWorkflows = yield* runner.workflowSlugs(input.projectId);
      const skills = yield* runner.skillList({ projectId: input.projectId });
      return yield* Effect.fromResult(
        draftWorkflowFromThread({
          projection,
          existingWorkflows,
          existingSkills: skills.map((skill) => skill.name),
        }),
      );
    });
    return WorkflowDrafts.of({ draftFromThread });
  }),
);
