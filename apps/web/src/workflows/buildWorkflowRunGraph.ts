import {
  stepCredentialActivity,
  EMPTY_CREDENTIAL_LIVE_STATE,
} from "@t3tools/client-runtime/state/runtime";
import type {
  CredentialLiveState,
  CredentialHistoryEvent,
  WorkflowReadinessSnapshot,
} from "@t3tools/contracts";
import type { WorkflowDefinition, WorkflowRun } from "@t3tools/contracts";
import type { RunGraph, RunGraphNode } from "./runGraph";
import { enclosingLoopForStep } from "./workflowEditing";
import { isWorkflowNestedStep, isWorkflowSkillStep } from "./workflowStep";
import { workflowCredentialSatellites } from "./workflowCredentialAttachments";

export function buildWorkflowRunGraph(
  run: WorkflowRun | null,
  definition: WorkflowDefinition = run!.definition,
  missingSkills: ReadonlyArray<string> = [],
  scopes: ReadonlyMap<string, "project" | "global"> = new Map(),
  credentials: {
    readonly live: CredentialLiveState;
    readonly history: ReadonlyArray<CredentialHistoryEvent>;
    /** Pre-flight observations: a draft's listing readiness, or the run's own preflight. */
    readonly readiness?: WorkflowReadinessSnapshot | undefined;
    readonly approval?: WorkflowDefinition["credentialApprovals"];
  } = { live: EMPTY_CREDENTIAL_LIVE_STATE, history: [] },
): RunGraph {
  const nodes: RunGraphNode[] = [
    {
      id: run?.id ?? `draft:${definition.name}`,
      kind: "workflow",
      title: definition.name,
      detail: run?.workflow ?? "Draft",
      status: run === null ? "idle" : run.status === "stopped" ? "cancelled" : run.status,
      childThreadId: null,
    },
  ];
  const edges: RunGraph["edges"][number][] = [];
  const rootId = run?.id ?? `draft:${definition.name}`;
  const statesById = new Map(run?.steps.map((step) => [step.stepId, step]));
  const checksByStep = new Map(
    definition.steps.map((step) => [step.id, isWorkflowSkillStep(step) ? (step.checks ?? []) : []]),
  );
  // Only a rendered Check card can be the visual output of a step (including forward references).
  const terminalId = new Map(
    definition.steps.map((step) => [
      step.id,
      checksByStep.get(step.id)!.length > 0 ? `${rootId}:check:${step.id}` : `${rootId}:${step.id}`,
    ]),
  );
  for (const [index, step] of definition.steps.entries()) {
    const state = statesById.get(step.id);
    const id = `${rootId}:${step.id}`;
    const gated = step.gate === true;
    const checksFailed =
      !state?.checking &&
      (state?.status === "ready" || state?.status === "failed" || state?.status === "done") &&
      state.checks?.some((result) => !result.ok) === true;
    const approvalId = `${rootId}:approval:${step.id}`;
    const checkId = `${rootId}:check:${step.id}`;
    const dependencies = step.readsFrom ?? (index === 0 ? [] : [definition.steps[index - 1]!.id]);
    const skillLabel = isWorkflowSkillStep(step)
      ? `${step.skill}${scopes.get(step.skill.toLowerCase()) ? ` · ${scopes.get(step.skill.toLowerCase())}` : ""}${missingSkills.includes(step.skill) ? " · skill missing" : ""}`
      : `workflow ${step.workflow}`;
    const credentialEntries = workflowCredentialSatellites({
      step,
      entries: credentials.readiness?.entries ?? [],
      activity: run
        ? stepCredentialActivity(credentials.live, credentials.history, run.id, step.id)
        : [],
      approval: credentials.approval ?? definition.credentialApprovals,
    });
    const asking = credentialEntries.some((entry) => entry.state === "asking");
    const enclosingLoop = enclosingLoopForStep(definition, step.id);
    const round =
      (enclosingLoop ? run?.loopRounds?.[enclosingLoop.id] : undefined) ??
      state?.round ??
      (run !== null && enclosingLoop !== null ? 1 : undefined);
    const maxRounds = enclosingLoop?.maxRounds;
    const loopExhausted = state?.loopExhausted === true;
    nodes.push({
      id,
      kind: "step",
      credentials: credentialEntries,
      workflowStepId: step.id,
      ...(isWorkflowNestedStep(step) ? { nestedWorkflow: step.workflow } : {}),
      title: step.title ?? step.id,
      detail: `${skillLabel}${state?.checking ? " · validating" : state?.status === "ready" && !checksFailed ? " · ready" : ""}${(state?.attempts ?? 0) > 1 ? ` · attempt ${state!.attempts}` : ""}`,
      ...(round !== undefined ? { round } : {}),
      ...(maxRounds !== undefined ? { maxRounds } : {}),
      ...(loopExhausted ? { loopExhausted: true } : {}),
      status: asking
        ? "waiting"
        : state?.checking
          ? "running"
          : checksFailed
            ? "failed"
            : gated && state?.status === "waiting" && state.waitingFor === "approval"
              ? "pending"
              : state?.status === "ready"
                ? "idle"
                : state?.status === "queued" || state === undefined
                  ? "pending"
                  : state.status,
      childThreadId: state?.threadId ?? null,
      worker: asking
        ? "Needs approval"
        : state?.checking
          ? "Validating"
          : checksFailed
            ? "Checks failed"
            : state?.status === "running" && state.threadId !== null
              ? state.threadId === run?.driverThreadId
                ? "chat agent"
                : "subagent"
              : null,
    });
    const targetId = gated ? approvalId : id;
    for (const from of dependencies.length === 0
      ? [rootId]
      : dependencies.map((dependency) => terminalId.get(dependency) ?? `${rootId}:${dependency}`)) {
      const sourceStepId = dependencies.find((dependency) => terminalId.get(dependency) === from);
      edges.push({
        id: `${from}->${targetId}`,
        from,
        to: targetId,
        kind:
          sourceStepId === undefined || sourceStepId === definition.steps[index - 1]?.id
            ? "spine"
            : "skip",
        ...(sourceStepId === undefined ? {} : { sourceStepId, targetStepId: step.id }),
      });
    }
    if (gated) {
      const dependenciesSatisfied = dependencies.every((dependency) => {
        const dependencyState = statesById.get(dependency);
        const dependencyChecks = checksByStep.get(dependency) ?? [];
        return (
          dependencyState?.status === "skipped" ||
          (dependencyState?.status === "done" &&
            (dependencyChecks.length === 0 ||
              (dependencyState.checks?.length === dependencyChecks.length &&
                dependencyState.checks.every((result) => result.ok))))
        );
      });
      const approved =
        state?.status === "ready" ||
        state?.status === "running" ||
        state?.status === "done" ||
        state?.status === "failed" ||
        ((state?.attempts ?? 0) > 0 && state?.waitingFor !== "approval") ||
        (state?.status === "waiting" && state.waitingFor === "resume");
      const approvalWaiting = state?.status === "waiting" && state.waitingFor === "approval";
      const stopped = run?.status === "stopped";
      const skipped = state?.status === "skipped";
      const ended = run?.status === "done" || run?.status === "failed";
      const blocked =
        run !== null &&
        !dependenciesSatisfied &&
        !approved &&
        !stopped &&
        !skipped &&
        !ended &&
        !approvalWaiting;
      nodes.splice(nodes.length - 1, 0, {
        id: approvalId,
        kind: "approval",
        approvalFor: step.id,
        title: "Approval",
        detail:
          run === null
            ? "Required · Draft"
            : approved
              ? "Approved"
              : stopped
                ? "Run stopped"
                : skipped
                  ? "Step skipped"
                  : ended
                    ? "Run ended"
                    : blocked
                      ? "Blocked by earlier steps"
                      : approvalWaiting
                        ? "Waiting for approval"
                        : "Approval required",
        status: approved
          ? "done"
          : stopped
            ? "cancelled"
            : skipped
              ? "skipped"
              : ended
                ? "cancelled"
                : blocked
                  ? "blocked"
                  : approvalWaiting
                    ? "waiting"
                    : "idle",
        childThreadId: null,
      });
      edges.push({ id: `${approvalId}->${id}`, from: approvalId, to: id });
    }
    const configuredChecks = checksByStep.get(step.id)!;
    if (configuredChecks.length > 0) {
      const results = state?.checks ?? [];
      const failed = checksFailed;
      const allVerified =
        results.length === configuredChecks.length && results.every((result) => result.ok);
      const checking = state?.checking !== undefined;
      const stopped = run?.status === "stopped";
      const ended = run?.status === "done" || run?.status === "failed";
      const status = stopped
        ? "cancelled"
        : checking
          ? "running"
          : failed
            ? "failed"
            : (state?.status === "done" ||
                  (state?.status === "waiting" && state.waitingFor === "resume")) &&
                allVerified
              ? "done"
              : ended
                ? "cancelled"
                : "pending";
      const attempt = state?.attempts ?? 0;
      const failures = results.filter((result) => !result.ok).length;
      nodes.push({
        id: checkId,
        kind: "check",
        checkFor: step.id,
        title: "Check",
        detail: stopped
          ? "Stopped"
          : checking
            ? `Checking · attempt ${Math.max(1, attempt)}`
            : failed
              ? `${failures} failed · attempt ${attempt}`
              : status === "done"
                ? `Passed · ${configuredChecks.length} ${configuredChecks.length === 1 ? "check" : "checks"}`
                : ended
                  ? "Ended · results unverified"
                  : run === null
                    ? `Draft · ${configuredChecks.length} ${configuredChecks.length === 1 ? "check" : "checks"}`
                    : "Pending",
        status,
        childThreadId: null,
      });
      edges.push({ id: `${id}->${checkId}`, from: id, to: checkId });
    }
  }
  const liveRun = run !== null && (run.status === "running" || run.status === "waiting");
  for (const loop of definition.loops ?? []) {
    const fromStep = definition.steps.find((item) => item.id === loop.from);
    const toStep = definition.steps.find((item) => item.id === loop.to);
    if (!fromStep || !toStep) continue;
    const from = terminalId.get(loop.from) ?? `${rootId}:${loop.from}`;
    const to = toStep.gate ? `${rootId}:approval:${loop.to}` : `${rootId}:${loop.to}`;
    const fromState = statesById.get(loop.from);
    const round = run?.loopRounds?.[loop.id] ?? fromState?.round ?? (run !== null ? 1 : undefined);
    const exhausted =
      fromState?.loopExhausted === true || run?.exhaustedLoops?.includes(loop.id) === true;
    const untilLabel =
      loop.until.kind === "checks-pass"
        ? "checks pass"
        : loop.until.kind === "condition"
          ? loop.until.text
          : `${fromStep.title ?? loop.from} passes`;
    const label = exhausted
      ? `↺ ${loop.maxRounds}/${loop.maxRounds} · exhausted`
      : liveRun && round !== undefined
        ? `↺ round ${round}/${loop.maxRounds}`
        : `↺ up to ${loop.maxRounds}× · until ${untilLabel}`;
    edges.push({
      id: `loop:${loop.id}`,
      kind: "feedback",
      from,
      to,
      sourceStepId: loop.from,
      targetStepId: loop.to,
      loopId: loop.id,
      label,
      ...(round !== undefined ? { round } : {}),
      maxRounds: loop.maxRounds,
      ...(exhausted ? { exhausted: true } : {}),
    });
  }
  return { nodes, edges };
}
