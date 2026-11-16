import { expect, it } from "vite-plus/test";
import {
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  capStepActivityText,
  deriveStepActivityLabel,
  stepActivityLabel,
} from "./workflowStepActivity";

const THREAD = ThreadId.make("step-thread");
const AT = DateTime.makeUnsafe("2026-10-20T10:00:00.000Z");
const LATER = DateTime.makeUnsafe("2026-10-20T10:00:05.000Z");
const STEP_STARTED_AT = "2026-10-20T10:00:00.000Z";

function baseItem() {
  return {
    id: TurnItemId.make("item-1"),
    threadId: THREAD,
    runId: RunId.make("run-1"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "running" as const,
    title: null,
    startedAt: AT,
    completedAt: null,
    updatedAt: AT,
  };
}

function projected(item: OrchestrationV2TurnItem): OrchestrationV2ProjectedTurnItem {
  return {
    position: 0,
    visibility: "local",
    sourceThreadId: item.threadId,
    sourceItemId: item.id,
    item,
  };
}

function fileChange(
  overrides: Partial<Extract<OrchestrationV2TurnItem, { readonly type: "file_change" }>> = {},
) {
  return {
    ...baseItem(),
    type: "file_change" as const,
    fileName: "index.html",
    ...overrides,
  } satisfies Extract<OrchestrationV2TurnItem, { readonly type: "file_change" }>;
}

function dynamicTool(
  overrides: Partial<Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }>> = {},
) {
  return {
    ...baseItem(),
    type: "dynamic_tool" as const,
    toolName: "Read",
    input: { file_path: "src/app.ts" },
    ...overrides,
  } satisfies Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }>;
}

it("describes the live work of a step in the present tense", () => {
  expect(stepActivityLabel(fileChange())).toBe("Editing index.html");
  expect(stepActivityLabel(dynamicTool())).toBe("Reading src/app.ts");
  expect(
    stepActivityLabel({
      ...baseItem(),
      type: "command_execution",
      input: "vp test run src/workflows",
    }),
  ).toBe("Running vp");
  expect(
    stepActivityLabel({ ...baseItem(), type: "reasoning", text: "hmm", streaming: true }),
  ).toBe("Thinking");
  expect(stepActivityLabel({ ...baseItem(), type: "web_search", results: [] })).toBe(
    "Searching the web",
  );
});

it("shows the newest live item of the step", () => {
  const label = deriveStepActivityLabel({
    items: [
      projected(fileChange({ status: "completed", completedAt: LATER })),
      projected(dynamicTool({ toolName: "Grep", input: { pattern: "useEffect" } })),
    ],
    startedAt: STEP_STARTED_AT,
  });
  expect(label).toBe("Searching useEffect");
});

it("ignores work that started before the step, so an earlier step never leaks into it", () => {
  const label = deriveStepActivityLabel({
    items: [
      projected({
        ...dynamicTool(),
        startedAt: DateTime.makeUnsafe("2026-10-20T09:59:00.000Z"),
      }),
    ],
    startedAt: STEP_STARTED_AT,
  });
  expect(label).toBeNull();
});

it("ignores the driver's own workflow calls", () => {
  const label = deriveStepActivityLabel({
    items: [
      projected(
        dynamicTool({
          toolName: "workflow_step_start",
          input: { runId: "run-1", stepId: "build" },
        }),
      ),
    ],
    startedAt: STEP_STARTED_AT,
  });
  expect(label).toBeNull();
});

it("goes quiet when nothing is running", () => {
  expect(
    deriveStepActivityLabel({
      items: [projected(fileChange({ status: "completed", completedAt: LATER }))],
      startedAt: STEP_STARTED_AT,
    }),
  ).toBeNull();
  expect(
    deriveStepActivityLabel({
      items: [
        projected({
          ...baseItem(),
          type: "system_notice",
          message: "The workspace is ready.",
        }),
      ],
      startedAt: STEP_STARTED_AT,
    }),
  ).toBeNull();
});

it("keeps the line short", () => {
  const long = capStepActivityText(`Editing ${"a".repeat(200)}`);
  expect(long.length).toBeLessThanOrEqual(72);
  expect(long.endsWith("…")).toBe(true);
  expect(capStepActivityText("Editing index.html")).toBe("Editing index.html");
});

it("filters inherited work and namespaced workflow tools, and recognizes patch edits", () => {
  expect(
    deriveStepActivityLabel({
      threadId: THREAD,
      startedAt: STEP_STARTED_AT,
      items: [projected(dynamicTool({ threadId: ThreadId.make("parent") }))],
    }),
  ).toBeNull();
  expect(
    deriveStepActivityLabel({
      threadId: THREAD,
      startedAt: STEP_STARTED_AT,
      items: [projected(dynamicTool({ toolName: "mcp__t3_code__workflow_status" }))],
    }),
  ).toBeNull();
  expect(
    stepActivityLabel(dynamicTool({ toolName: "apply_patch", input: { path: "src/app.ts" } })),
  ).toBe("Editing src/app.ts");
});
