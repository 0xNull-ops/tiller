import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import { useThreadShell } from "../state/entities";
import { useRightPanelStore } from "../rightPanelStore";
import { chooseWorkflowAutoOpen, useWorkflowRuns } from "./workflowState";

// fork(workflows): this watcher is mounted beside the right panel, including while it is closed.
export function WorkflowAutoOpen(props: { readonly threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(props.threadRef);
  const snapshot = useWorkflowRuns(props.threadRef.environmentId, shell?.projectId ?? null);
  const mountedAt = useRef<number | null>(null);
  const opened = useRef(new Set<string>());
  // oxlint-disable-next-line t3code/react-effect-budget -- Opening the right panel is an external store action triggered by observed workflow state.
  useEffect(() => {
    if (mountedAt.current === null) {
      mountedAt.current = Date.now();
      return;
    }
    const slug = chooseWorkflowAutoOpen({
      threadId: props.threadRef.threadId,
      mountedAt: mountedAt.current,
      workflows: snapshot.workflows,
      runs: snapshot.runs,
      opened: opened.current,
    });
    if (slug === null) return;
    opened.current.add(slug);
    useRightPanelStore.getState().open(props.threadRef, "workflow");
  }, [props.threadRef, snapshot.workflows, snapshot.runs]);
  return null;
}
