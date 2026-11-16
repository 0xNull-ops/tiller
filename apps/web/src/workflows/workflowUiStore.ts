import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  WorkflowListing,
} from "@t3tools/contracts";

let createRequested = false;
const createListeners = new Set<() => void>();
let saveRequested: ScopedThreadRef | null = null;
const saveListeners = new Set<() => void>();

export interface WorkflowRunRequest {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly listing: WorkflowListing;
}

let runRequested: WorkflowRunRequest | null = null;
const runListeners = new Set<() => void>();

let lastChatPath: string | null = null;
const rememberedThreadWorkflows = new Map<string, string>();

export function recordLastChatPath(pathname: string) {
  if (
    pathname !== "/" &&
    !pathname.startsWith("/workflows") &&
    !pathname.startsWith("/draft") &&
    pathname !== "/pair"
  ) {
    lastChatPath = pathname;
  }
}

export function readLastChatPath(): string {
  return lastChatPath ?? "/";
}

export function rememberThreadWorkflow(threadRef: ScopedThreadRef, workflow: string) {
  rememberedThreadWorkflows.set(`${threadRef.environmentId}:${threadRef.threadId}`, workflow);
}

export function readRememberedThreadWorkflow(threadRef: ScopedThreadRef | null): string | null {
  if (!threadRef) return null;
  return rememberedThreadWorkflows.get(`${threadRef.environmentId}:${threadRef.threadId}`) ?? null;
}

export function requestWorkflowCreate() {
  createRequested = true;
  createListeners.forEach((listener) => listener());
}

export function consumeWorkflowCreateRequest() {
  const requested = createRequested;
  createRequested = false;
  return requested;
}

export function subscribeWorkflowCreateRequest(listener: () => void) {
  createListeners.add(listener);
  return () => {
    createListeners.delete(listener);
  };
}

export function requestWorkflowSave(threadRef: ScopedThreadRef) {
  saveRequested = threadRef;
  saveListeners.forEach((listener) => listener());
}

export function consumeWorkflowSaveRequest(threadRef: ScopedThreadRef) {
  if (
    saveRequested?.environmentId !== threadRef.environmentId ||
    saveRequested.threadId !== threadRef.threadId
  )
    return false;
  saveRequested = null;
  return true;
}

export function subscribeWorkflowSaveRequest(listener: () => void) {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}

export function requestWorkflowRun(request: WorkflowRunRequest) {
  runRequested = request;
  runListeners.forEach((listener) => listener());
}

export function clearWorkflowRunRequest() {
  runRequested = null;
  runListeners.forEach((listener) => listener());
}

export function readWorkflowRunRequest(): WorkflowRunRequest | null {
  return runRequested;
}

export function subscribeWorkflowRunRequest(listener: () => void) {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

let scheduleRequested: ScopedThreadRef | null = null;
const scheduleListeners = new Set<() => void>();
export function requestWorkflowSchedule(threadRef: ScopedThreadRef) {
  scheduleRequested = threadRef;
  scheduleListeners.forEach((listener) => listener());
}
export function consumeWorkflowScheduleRequest(threadRef: ScopedThreadRef) {
  if (
    scheduleRequested?.environmentId !== threadRef.environmentId ||
    scheduleRequested.threadId !== threadRef.threadId
  )
    return false;
  scheduleRequested = null;
  return true;
}
export function subscribeWorkflowScheduleRequest(listener: () => void) {
  scheduleListeners.add(listener);
  return () => {
    scheduleListeners.delete(listener);
  };
}
