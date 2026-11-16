import { describe, expect, it } from "vite-plus/test";

import {
  isScratchWorkflow,
  splitScratchWorkflows,
  workflowScratchThreadId,
} from "./workflowScratch.ts";

function workflow(origin?: { readonly threadId: string } | null) {
  return {
    definition:
      origin === undefined
        ? { version: 2, name: "Mascot" }
        : { version: 2, name: "Mascot", origin },
  };
}

describe("isScratchWorkflow", () => {
  it("treats a definition without an origin as an ordinary workflow", () => {
    expect(isScratchWorkflow(workflow())).toBe(false);
    expect(workflowScratchThreadId(workflow())).toBeNull();
  });

  it("treats an unreadable definition as ordinary", () => {
    const unreadable = { definition: null };
    expect(isScratchWorkflow(unreadable)).toBe(false);
    expect(workflowScratchThreadId(unreadable)).toBeNull();
  });

  it("treats a workflow-first origin as scratch and keeps the creating thread", () => {
    const scratch = workflow({ threadId: "thread-1" });
    expect(isScratchWorkflow(scratch)).toBe(true);
    expect(workflowScratchThreadId(scratch)).toBe("thread-1");
  });

  it("does not treat an explicit null origin as scratch", () => {
    expect(isScratchWorkflow(workflow(null))).toBe(false);
  });

  it("treats an origin without a readable thread as scratch without a link", () => {
    const scratch = { definition: { version: 3, origin: {} } };
    expect(isScratchWorkflow(scratch)).toBe(true);
    expect(workflowScratchThreadId(scratch)).toBeNull();
  });

  it("treats a non-object origin as ordinary", () => {
    expect(isScratchWorkflow({ definition: { origin: "workflow-first" } })).toBe(false);
  });
});

describe("splitScratchWorkflows", () => {
  it("keeps input order inside each group", () => {
    const ordinaryA = workflow();
    const scratchA = workflow({ threadId: "thread-1" });
    const ordinaryB = workflow();
    const scratchB = workflow({ threadId: "thread-2" });

    const groups = splitScratchWorkflows([ordinaryA, scratchA, ordinaryB, scratchB]);

    expect(groups.regular).toEqual([ordinaryA, ordinaryB]);
    expect(groups.scratch).toEqual([scratchA, scratchB]);
  });

  it("returns an empty scratch group when every workflow is ordinary", () => {
    const groups = splitScratchWorkflows([workflow()]);
    expect(groups.regular).toHaveLength(1);
    expect(groups.scratch).toEqual([]);
  });

  it("returns an empty regular group when only scratch workflows exist", () => {
    const groups = splitScratchWorkflows([workflow({ threadId: "thread-1" })]);
    expect(groups.regular).toEqual([]);
    expect(groups.scratch).toHaveLength(1);
  });

  it("returns two empty groups for no workflows", () => {
    expect(splitScratchWorkflows([])).toEqual({ regular: [], scratch: [] });
  });
});
