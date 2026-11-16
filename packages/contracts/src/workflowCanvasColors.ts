import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const WorkflowCanvasColor = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i));

/**
 * The colour a user picked for each kind of workflow canvas attachment. A key that is absent keeps
 * the default in apps/web/src/workflows/workflowCanvasColors.ts.
 */
export const WorkflowCanvasColors = Schema.Struct({
  credential: Schema.optionalKey(WorkflowCanvasColor),
  mcp: Schema.optionalKey(WorkflowCanvasColor),
  check: Schema.optionalKey(WorkflowCanvasColor),
  login: Schema.optionalKey(WorkflowCanvasColor),
}).pipe(
  // Client settings decode as one blob, so a single unreadable entry (a hand-edited store, or a
  // value from a build that offered other colours) must not fail the read and drop every setting
  // with it. Defaults are the safe answer: the canvas still gets a readable colour.
  Schema.catchDecoding(() => Effect.succeedSome({})),
);
