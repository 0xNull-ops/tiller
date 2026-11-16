import { useSyncExternalStore } from "react";

/** How a workflow is drawn: the canvas, or the outline list for large workflows. */
export type WorkflowViewMode = "canvas" | "outline";

export interface WorkflowViewPref {
  readonly mode: WorkflowViewMode;
  /** Smaller cards on the canvas. Positions saved in the workflow never move. */
  readonly compact: boolean;
  /** Nested steps opened into a group of their workflow's steps. Not part of the workflow file. */
  readonly expanded: ReadonlyArray<string>;
}

export const DEFAULT_WORKFLOW_VIEW: WorkflowViewPref = {
  mode: "canvas",
  compact: false,
  expanded: [],
};

export const WORKFLOW_VIEW_STORAGE_KEY = "tiller.workflowViews";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** A parsed preference, or the default when the stored value is missing or unreadable. */
export function parseWorkflowViewPref(value: unknown): WorkflowViewPref {
  if (typeof value !== "object" || value === null) return DEFAULT_WORKFLOW_VIEW;
  const { mode, compact, expanded } = value as Record<string, unknown>;
  return {
    mode: mode === "outline" ? "outline" : "canvas",
    compact: compact === true,
    expanded: Array.isArray(expanded) ? expanded.filter((id) => typeof id === "string") : [],
  };
}

export function readStoredWorkflowViews(storage: Storage | null): Record<string, WorkflowViewPref> {
  try {
    const raw = storage?.getItem(WORKFLOW_VIEW_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, parseWorkflowViewPref(value)]),
    );
  } catch {
    return {};
  }
}

export function writeStoredWorkflowViews(
  storage: Storage | null,
  views: Record<string, WorkflowViewPref>,
): void {
  try {
    storage?.setItem(WORKFLOW_VIEW_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Private windows and full storage keep the view for this session only.
  }
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let views: Record<string, WorkflowViewPref> | null = null;
const listeners = new Set<() => void>();

function current(): Record<string, WorkflowViewPref> {
  views ??= readStoredWorkflowViews(browserStorage());
  return views;
}

export function workflowViewKey(input: {
  readonly environmentId: string;
  readonly projectId: string;
  readonly workflow: string;
}): string {
  return `${input.environmentId}/${input.projectId}/${input.workflow}`;
}

function readWorkflowView(key: string): WorkflowViewPref {
  return current()[key] ?? DEFAULT_WORKFLOW_VIEW;
}

export function setWorkflowView(key: string, patch: Partial<WorkflowViewPref>): void {
  const next = { ...readWorkflowView(key), ...patch };
  views = { ...current(), [key]: next };
  writeStoredWorkflowViews(browserStorage(), views);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The view a workflow was last drawn in, kept per workflow across reloads. */
export function useWorkflowView(key: string): WorkflowViewPref {
  return useSyncExternalStore(
    subscribe,
    () => readWorkflowView(key),
    () => DEFAULT_WORKFLOW_VIEW,
  );
}

/** The workflow the panel is showing, so the command palette can change its view. */
let activeKey: string | null = null;
export function setActiveWorkflowViewKey(key: string | null): void {
  activeKey = key;
}
/** Changes the view of the workflow on screen. False when the panel isn't showing one. */
export function changeActiveWorkflowView(
  update: (current: WorkflowViewPref) => Partial<WorkflowViewPref>,
): boolean {
  if (activeKey === null) return false;
  setWorkflowView(activeKey, update(readWorkflowView(activeKey)));
  return true;
}
