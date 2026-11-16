import { ShieldCheckIcon } from "lucide-react";

import type { RunGraphNode, RunGraphStatus } from "./runGraph";

const STATUS_LABEL: Record<RunGraphStatus, string> = {
  pending: "Queued",
  idle: "Draft",
  running: "Running",
  waiting: "Needs you",
  done: "Approved",
  failed: "Failed",
  cancelled: "Stopped",
  skipped: "Skipped",
  blocked: "Blocked",
};

export function WorkflowApprovalCardBody({ node }: { readonly node: RunGraphNode }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <ShieldCheckIcon className="size-3 shrink-0 text-warning" />
        <span className="truncate text-xs font-medium">Approval gate</span>
      </span>
      <span className="truncate text-2xs text-muted-foreground">
        {node.detail ?? STATUS_LABEL[node.status]}
      </span>
    </>
  );
}
