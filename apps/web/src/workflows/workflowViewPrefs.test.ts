import { expect, it } from "vite-plus/test";
import {
  DEFAULT_WORKFLOW_VIEW,
  parseWorkflowViewPref,
  readStoredWorkflowViews,
  WORKFLOW_VIEW_STORAGE_KEY,
  writeStoredWorkflowViews,
} from "./workflowViewPrefs";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

it("keeps the canvas view and cards at full size when nothing is stored or it is unreadable", () => {
  expect(readStoredWorkflowViews(null)).toEqual({});
  expect(readStoredWorkflowViews(memory())).toEqual({});
  expect(readStoredWorkflowViews(memory({ [WORKFLOW_VIEW_STORAGE_KEY]: "{not json" }))).toEqual({});
  expect(parseWorkflowViewPref("outline")).toEqual(DEFAULT_WORKFLOW_VIEW);
  expect(parseWorkflowViewPref({ mode: "grid", compact: "yes" })).toEqual(DEFAULT_WORKFLOW_VIEW);
  expect(parseWorkflowViewPref({ mode: "canvas", expanded: ["kit", 3] })).toEqual({
    mode: "canvas",
    compact: false,
    expanded: ["kit"],
  });
});

it("round-trips each workflow's view through storage", () => {
  const storage = memory();
  writeStoredWorkflowViews(storage, {
    "env/project/brand-kit": { mode: "outline", compact: true, expanded: ["kit"] },
  });
  expect(readStoredWorkflowViews(storage)).toEqual({
    "env/project/brand-kit": { mode: "outline", compact: true, expanded: ["kit"] },
  });
});
