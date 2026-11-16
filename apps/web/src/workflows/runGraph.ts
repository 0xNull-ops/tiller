import type { WorkflowCredentialSatellite } from "./workflowCredentialAttachments";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import {
  deriveWorkflowGroups,
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
  type RuntimeSubagentStatus,
} from "@t3tools/client-runtime/state/subagentRuntime";

export type RunGraphStatus =
  | "pending"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled"
  | "idle"
  | "skipped"
  | "blocked";

export interface RunGraphNode {
  id: string;
  kind: "turn" | "task" | "workflow" | "phase" | "agent" | "step" | "approval" | "check";
  /** Explicit workflow identity; canvas node IDs can contain colons in both parts. */
  workflowStepId?: string;
  /** The workflow a nested-workflow step runs, when this card is one. */
  nestedWorkflow?: string;
  /** The executable step this derived approval node guards. */
  approvalFor?: string;
  /** The Skill whose configured checks this derived card represents. */
  checkFor?: string;
  title: string;
  detail: string | null;
  status: RunGraphStatus;
  childThreadId: string | null;
  worker?: string | null;
  /** One card per credential the step uses: readiness before a run, live activity during one. */
  credentials?: ReadonlyArray<WorkflowCredentialSatellite>;
  /** 1-based loop round when the step is inside a loop. */
  round?: number;
  /** Max rounds of the enclosing loop when the step is inside a loop. */
  maxRounds?: number;
  /** True when this step's loop reached maxRounds without satisfying its until condition. */
  loopExhausted?: boolean;
}

export interface RunGraphEdge {
  id: string;
  kind?: "spine" | "skip" | "feedback";
  sourceStepId?: string;
  targetStepId?: string;
  loopId?: string;
  label?: string;
  round?: number;
  maxRounds?: number;
  exhausted?: boolean;
  from: string;
  to: string;
}

export interface RunGraph {
  nodes: ReadonlyArray<RunGraphNode>;
  edges: ReadonlyArray<RunGraphEdge>;
}

function graphStatus(status: RuntimeSubagentStatus): RunGraphStatus {
  return status === "completed" ? "done" : status === "interrupted" ? "cancelled" : status;
}

export function buildRunGraph(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "subagents"> | null,
): RunGraph {
  if (projection === null || projection.subagents.length === 0) return { nodes: [], edges: [] };

  const runtime = [...projectedSubagentsToRuntime(projection.subagents)].sort(
    (a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id),
  );
  const groups = new Map(deriveWorkflowGroups(runtime).map((group) => [group.workflow.id, group]));
  const byRun = new Map<string, RuntimeSubagent[]>();
  const runBySubagent = new Map<string, string | null>(
    projection.subagents.map((agent) => [agent.id, agent.runId]),
  );
  for (const agent of runtime) {
    if (agent.kind === "workflow_agent") continue;
    const runId = runBySubagent.get(agent.id);
    if (runId === null || runId === undefined) continue;
    const children = byRun.get(runId) ?? [];
    children.push(agent);
    byRun.set(runId, children);
  }

  const nodes: RunGraphNode[] = [];
  const edges: RunGraphEdge[] = [];
  const turnIds = new Map<string, string>();
  const connect = (from: string, to: string) => {
    edges.push({ id: `${from}->${to}`, from, to });
  };
  const addAgent = (agent: RuntimeSubagent, kind: RunGraphNode["kind"]) => {
    nodes.push({
      id: agent.id,
      kind,
      title: agent.title,
      detail: agent.model,
      status: graphStatus(agent.status),
      childThreadId: agent.childThreadId,
    });
  };

  for (const run of [...projection.runs].sort(
    (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
  )) {
    const children = byRun.get(run.id);
    if (children === undefined) continue;
    const id = `turn:${run.id}`;
    turnIds.set(run.id, id);
    nodes.push({
      id,
      kind: "turn",
      title: `Turn ${run.ordinal}`,
      detail: null,
      status: children.some((child) => isActiveSubagentStatus(child.status))
        ? "running"
        : children.some((child) => child.status === "failed")
          ? "failed"
          : "done",
      childThreadId: null,
    });
  }

  for (const agent of runtime) {
    if (agent.kind === "workflow_agent") continue;
    addAgent(agent, agent.kind === "workflow" ? "workflow" : "task");
    const runId = runBySubagent.get(agent.id);
    const turnId = runId == null ? undefined : turnIds.get(runId);
    if (turnId !== undefined) connect(turnId, agent.id);
    const group = groups.get(agent.id);
    if (group === undefined) continue;

    let previousId = agent.id;
    for (const phase of group.phases) {
      const id = `${agent.id}:phase:${phase.index}`;
      nodes.push({
        id,
        kind: "phase",
        title: phase.title,
        detail: phase.members.length === 0 ? null : `${phase.settledCount}/${phase.members.length}`,
        status: phase.state,
        childThreadId: null,
      });
      connect(previousId, id);
      previousId = id;
      for (const member of phase.members) {
        addAgent(member, "agent");
        connect(id, member.id);
      }
    }
    for (const member of group.unphasedMembers) {
      addAgent(member, "agent");
      connect(agent.id, member.id);
    }
  }
  return { nodes, edges };
}
