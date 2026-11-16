import type { WorkflowDefinition } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { enclosingLoopForStep, loopRangeStepIds } from "./loops.ts";

describe("workflow loop membership", () => {
  it("includes parallel branches in the innermost loop while keeping closing steps in their own loop", () => {
    const definition: WorkflowDefinition = {
      version: 3,
      name: "Nested",
      loops: [
        {
          id: "outer",
          from: "qa",
          to: "draft",
          maxRounds: 3,
          until: { kind: "step-says-pass" },
        },
        {
          id: "inner",
          from: "review",
          to: "draft",
          maxRounds: 2,
          until: { kind: "step-says-pass" },
        },
      ],
      steps: [
        { id: "draft", skill: "draft" },
        { id: "review", skill: "review" },
        { id: "side", skill: "side", readsFrom: ["draft"] },
        { id: "qa", skill: "qa", readsFrom: ["review"] },
      ],
    };

    expect([...loopRangeStepIds(definition, definition.loops![1]!)]).toEqual([
      "draft",
      "review",
      "side",
    ]);
    expect([...loopRangeStepIds(definition, definition.loops![0]!)]).toEqual([
      "draft",
      "review",
      "side",
      "qa",
    ]);
    expect(enclosingLoopForStep(definition, "draft")?.id).toBe("inner");
    expect(enclosingLoopForStep(definition, "review")?.id).toBe("inner");
    expect(enclosingLoopForStep(definition, "side")?.id).toBe("inner");
    expect(enclosingLoopForStep(definition, "qa")?.id).toBe("outer");
  });
});
