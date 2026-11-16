import { useAtomValue } from "@effect/atom-react";
import {
  WS_METHODS,
  type EnvironmentId,
  type ProjectId,
  type WorkflowEdit,
  type WorkflowEditResult,
  type WorkflowRun,
  type WorkflowsSnapshot,
  type WorkflowListing,
  type WorkflowReadinessEntry,
  type WorkflowReadinessSnapshot,
  type WorkflowReadinessContext,
  type ThreadId,
  WORKFLOW_CREDENTIAL_WARNINGS,
  workflowReadinessSpecification,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import { useState, useSyncExternalStore } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { isWorkflowSkillStep } from "./workflowStep";

const workflowRunsSubscription = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "workflows:runs:live",
  tag: WS_METHODS.workflowsSubscribeRuns,
});
export const workflowRunsLive = Atom.family((environmentId: EnvironmentId) =>
  workflowRunsSubscription({ environmentId, input: {} }),
);
export const stopWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "workflows:stop",
  tag: WS_METHODS.workflowsStop,
});
export const approveWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "workflows:approve",
  tag: WS_METHODS.workflowsApprove,
});
export const resumeWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "workflows:resume",
  tag: WS_METHODS.workflowsResume,
});
export const editWorkflow = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "workflows:edit",
  tag: WS_METHODS.workflowsEdit,
});
/** Skill lists and SKILL.md text, read lazily when the editor or picker opens. */
export const workflowRead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "workflows:read",
  tag: WS_METHODS.workflowsRead,
  staleTimeMs: 2_000,
  idleTtlMs: 60_000,
});

type WorkflowProbeResult = {
  readonly readiness: WorkflowReadinessSnapshot;
  readonly attachmentRevision: string;
};

const workflowProbeResults = new Map<string, WorkflowProbeResult>();
const workflowProbeListeners = new Map<string, Set<() => void>>();
const WORKFLOW_PROBE_RESULT_LIMIT = 100;

function publishWorkflowProbeResult(key: string, result: WorkflowProbeResult) {
  workflowProbeResults.delete(key);
  workflowProbeResults.set(key, result);
  while (workflowProbeResults.size > WORKFLOW_PROBE_RESULT_LIMIT) {
    const oldest = workflowProbeResults.keys().next().value;
    if (oldest === undefined) break;
    workflowProbeResults.delete(oldest);
    for (const listener of workflowProbeListeners.get(oldest) ?? []) listener();
  }
  for (const listener of workflowProbeListeners.get(key) ?? []) listener();
}

export function resetWorkflowProbeReadinessForTests() {
  workflowProbeResults.clear();
}

export const workflowProbeCacheKey = (
  environmentId: EnvironmentId,
  listing: WorkflowListing,
  contextThreadId: ThreadId | null,
  contextWorkspaceRoot: string,
  contextModelRevision: string,
) =>
  JSON.stringify([
    environmentId,
    listing.projectId,
    listing.workflow,
    contextThreadId,
    contextWorkspaceRoot,
    contextModelRevision,
  ]);

export function workflowAttachmentRevision(listing: WorkflowListing): string {
  return listing.definition === null ? "" : workflowReadinessSpecification(listing.definition);
}

/**
 * A credential's state comes from the vault and the attachment, not from a workspace, thread or
 * model. A canvas looking at another context than the one the server recorded would otherwise
 * drop the entry and show "Not checked" — or, on a card, "Credential vault unavailable" — for a
 * credential the server can already see is ready.
 */
const credentialOnlyReadinessCache = new WeakMap<
  WorkflowReadinessSnapshot,
  WorkflowReadinessSnapshot
>();

/** The listing's readiness, if it describes this definition's attachments, not an older revision. */
function listingReadinessForSpecification(
  listing: WorkflowListing,
): WorkflowReadinessSnapshot | undefined {
  const snapshot = listing.readiness;
  return snapshot === undefined ||
    snapshot.context?.specification !== workflowAttachmentRevision(listing)
    ? undefined
    : snapshot;
}

function credentialOnlyReadiness(listing: WorkflowListing): WorkflowReadinessSnapshot | undefined {
  const snapshot = listingReadinessForSpecification(listing);
  if (snapshot === undefined) return undefined;
  const cached = credentialOnlyReadinessCache.get(snapshot);
  if (cached !== undefined) return cached;
  const entries = snapshot.entries.filter((entry) => entry.kind === "credential");
  if (entries.length === 0) return undefined;
  // Drop the context: these entries are the whole truth, and not a snapshot of that workspace.
  const { context: _context, ...rest } = snapshot;
  const credentialOnly: WorkflowReadinessSnapshot = { ...rest, entries, blocksRun: false };
  credentialOnlyReadinessCache.set(snapshot, credentialOnly);
  return credentialOnly;
}

const credentialEntryKey = (entry: WorkflowReadinessEntry) =>
  `${entry.stepId}\n${entry.attachmentId}`;

const credentialMergeCache = new WeakMap<
  WorkflowReadinessSnapshot,
  { readonly source: WorkflowReadinessSnapshot; readonly merged: WorkflowReadinessSnapshot }
>();

/** Merge newer vault readiness while preserving the probe snapshot freshness timestamp. */
function withFreshCredentialEntries(
  base: WorkflowReadinessSnapshot,
  listing: WorkflowListing,
): WorkflowReadinessSnapshot {
  // Undefined means the listing belongs to another definition revision, so its state is stale.
  const server = listingReadinessForSpecification(listing);
  if (server === undefined) return base;
  // Stable identity per (probe result, server snapshot): this feeds a store selector every render.
  const cached = credentialMergeCache.get(base);
  if (cached?.source === server) return cached.merged;
  const fresh = credentialOnlyReadiness(listing)?.entries ?? [];
  const freshByKey = new Map(fresh.map((entry) => [credentialEntryKey(entry), entry]));
  const baseKeys = new Set(base.entries.map(credentialEntryKey));
  let replaced = false;
  const entries = base.entries.map((entry) => {
    const replacement = freshByKey.get(credentialEntryKey(entry));
    if (replacement === undefined || replacement === entry) return entry;
    replaced = true;
    return replacement;
  });
  // An attachment the probe never saw (its file arrived after the check) still shows its state.
  const added = fresh.filter((entry) => !baseKeys.has(credentialEntryKey(entry)));
  const warnings = mergeCredentialWarnings(base.warnings ?? [], server.warnings ?? []);
  const changed = replaced || added.length > 0 || !sameStrings(warnings, base.warnings ?? []);
  const merged = changed ? { ...base, entries: [...entries, ...added], warnings } : base;
  credentialMergeCache.set(base, { source: server, merged });
  return merged;
}

/** Other probe warnings stay; the listing's credential advisories replace any the probe carried. */
function mergeCredentialWarnings(
  probe: ReadonlyArray<string>,
  server: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const isCredential = (warning: string) => WORKFLOW_CREDENTIAL_WARNINGS.includes(warning);
  return [
    ...new Set([
      ...probe.filter((warning) => !isCredential(warning)),
      ...server.filter(isCredential),
    ]),
  ];
}

function sameStrings(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function workflowReadinessForListing(
  listing: WorkflowListing,
  probeResult: WorkflowProbeResult | null,
  context: WorkflowReadinessContext | null,
): WorkflowReadinessSnapshot | undefined {
  if (!context) return undefined;
  const matchesContext = (snapshot: WorkflowReadinessSnapshot | undefined) =>
    snapshot?.context !== undefined &&
    snapshot.context.threadId === context.threadId &&
    snapshot.context.workspaceRoot === context.workspaceRoot &&
    snapshot.context.specification === context.specification &&
    context.specification === workflowAttachmentRevision(listing) &&
    JSON.stringify(snapshot.context.model ?? null) === JSON.stringify(context.model ?? null);
  const serverSnapshot = listing.readiness;
  if (
    !probeResult ||
    probeResult.attachmentRevision !== workflowAttachmentRevision(listing) ||
    !matchesContext(probeResult.readiness)
  )
    return matchesContext(serverSnapshot) ? serverSnapshot : credentialOnlyReadiness(listing);
  if (
    serverSnapshot?.evaluatedAt &&
    probeResult.readiness.evaluatedAt &&
    matchesContext(serverSnapshot) &&
    serverSnapshot.evaluatedAt > probeResult.readiness.evaluatedAt
  )
    return serverSnapshot;
  return withFreshCredentialEntries(probeResult.readiness, listing);
}

export function workflowReadinessForCanvas(
  run: WorkflowRun | null,
  listing: WorkflowListing | null,
  editMode: boolean,
): WorkflowReadinessSnapshot | undefined {
  return editMode || run === null ? listing?.readiness : run.preflight;
}

export function workflowRunProgress(run: WorkflowRun) {
  const checkedSkills = run.definition.steps
    .filter(isWorkflowSkillStep)
    .filter((step) => (step.checks?.length ?? 0) > 0);
  const configuredChecks = checkedSkills.reduce(
    (count, step) => count + (step.checks?.length ?? 0),
    0,
  );
  const passedChecks = checkedSkills.reduce((count, step) => {
    const results = run.steps.find((state) => state.stepId === step.id)?.checks ?? [];
    return count + results.filter((result) => result.ok).length;
  }, 0);
  return {
    workDone: run.steps.filter((step) => step.status === "done" || step.status === "skipped")
      .length,
    workTotal: run.definition.steps.length,
    checksPassed: passedChecks,
    checksTotal: configuredChecks,
  };
}

export function useWorkflowListingReadiness(
  environmentId: EnvironmentId,
  listing: WorkflowListing | null,
  contextThreadId: ThreadId | null,
  contextWorkspaceRoot: string | null,
  contextModelRevision: string,
): WorkflowListing | null {
  const key =
    listing && contextWorkspaceRoot !== null
      ? workflowProbeCacheKey(
          environmentId,
          listing,
          contextThreadId,
          contextWorkspaceRoot,
          contextModelRevision,
        )
      : null;
  const result = useSyncExternalStore(
    (listener) => {
      if (key === null) return () => {};
      const listeners = workflowProbeListeners.get(key) ?? new Set<() => void>();
      listeners.add(listener);
      workflowProbeListeners.set(key, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) workflowProbeListeners.delete(key);
      };
    },
    () => (key === null ? null : (workflowProbeResults.get(key) ?? null)),
    () => null,
  );
  if (!listing) return null;
  const readiness = workflowReadinessForListing(
    listing,
    result,
    contextWorkspaceRoot === null
      ? null
      : {
          ...(contextThreadId === null ? {} : { threadId: contextThreadId }),
          workspaceRoot: contextWorkspaceRoot,
          specification: workflowAttachmentRevision(listing),
          ...(contextModelRevision === "null" || contextModelRevision === ""
            ? {}
            : {
                model: JSON.parse(contextModelRevision) as NonNullable<
                  WorkflowReadinessContext["model"]
                >,
              }),
        },
  );
  return readiness === listing.readiness ? listing : { ...listing, readiness };
}

/** Whether this client may edit workflows in the environment, for hiding write actions. */
export function useWorkflowEditPermission(environmentId: EnvironmentId): boolean {
  return useAtomValue(editWorkflow.permissionAtom(environmentId));
}

/**
 * Sends canvas edits one at a time. The result arrives through the workflows stream, so
 * callers only need to know whether it worked; a refusal is kept as plain words to show.
 */
export function useWorkflowEdit(
  environmentId: EnvironmentId,
  listing?: WorkflowListing,
  probeContextThreadId?: ThreadId | null,
  probeContextWorkspaceRoot?: string | null,
  probeContextModelRevision = "",
) {
  const canEdit = useWorkflowEditPermission(environmentId);
  const send = useAtomCommand(editWorkflow, { label: "edit workflow", reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    edit: WorkflowEdit,
    onFailure?: (message: string) => void,
  ): Promise<WorkflowEditResult | null> => {
    setBusy(true);
    setError(null);
    const result = await send({ environmentId, input: edit });
    setBusy(false);
    if (result._tag === "Success") {
      if (edit._tag === "probe" && listing && result.value?.readiness) {
        const contextThreadId = probeContextThreadId ?? null;
        if (probeContextWorkspaceRoot == null) return result.value;
        const key = workflowProbeCacheKey(
          environmentId,
          listing,
          contextThreadId,
          probeContextWorkspaceRoot,
          probeContextModelRevision,
        );
        publishWorkflowProbeResult(key, {
          readiness: result.value.readiness,
          attachmentRevision: workflowAttachmentRevision(listing),
        });
      }
      return result.value;
    }
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      onFailure?.(message);
    }
    return null;
  };
  return { canEdit, busy, error, clearError: () => setError(null), run };
}

const EMPTY_SNAPSHOT: WorkflowsSnapshot = { workflows: [], runs: [] };
export function useWorkflowRuns(environmentId: EnvironmentId, projectId: ProjectId | null) {
  const query = useEnvironmentQuery(workflowRunsLive(environmentId));
  const snapshot = query.data ?? EMPTY_SNAPSHOT;
  return {
    ...query,
    // The live stream stays waiting after every chunk, so only the first snapshot counts as loading.
    isPending: query.isPending && query.data === null,
    workflows:
      projectId === null ? [] : snapshot.workflows.filter((item) => item.projectId === projectId),
    runs: projectId === null ? [] : snapshot.runs.filter((run) => run.projectId === projectId),
  };
}

export function chooseWorkflowAutoOpen(input: {
  threadId: string;
  mountedAt: number;
  workflows: ReadonlyArray<WorkflowListing>;
  runs: ReadonlyArray<WorkflowRun>;
  opened: ReadonlySet<string>;
}): string | null {
  const candidates = [
    ...input.workflows
      .filter(
        (item) =>
          item.editedByThreadId === input.threadId && Date.parse(item.updatedAt) > input.mountedAt,
      )
      .map((item) => item.workflow),
    ...input.runs
      .filter(
        (run) =>
          run.driverThreadId === input.threadId && Date.parse(run.startedAt) > input.mountedAt,
      )
      .map((run) => run.workflow),
  ];
  return candidates.find((slug) => !input.opened.has(slug)) ?? null;
}
