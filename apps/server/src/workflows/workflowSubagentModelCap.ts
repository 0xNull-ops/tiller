import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class WorkflowSubagentModelCapError extends Schema.TaggedError<WorkflowSubagentModelCapError>()(
  "WorkflowSubagentModelCapError",
  { cap: Schema.Number },
) {
  override get message(): string {
    return `This workflow can have up to ${this.cap} subagent models (Settings → General).`;
  }
}

export const assertSubagentModelCap = (count: number, cap: number) =>
  count <= cap ? Effect.void : Effect.fail(new WorkflowSubagentModelCapError({ cap }));
