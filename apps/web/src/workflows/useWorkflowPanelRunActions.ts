import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, WorkflowRun } from "@t3tools/contracts";
import { useState } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { approveWorkflow, resumeWorkflow, stopWorkflow } from "./workflowState";

export function useWorkflowPanelRunActions(environmentId: EnvironmentId, run: WorkflowRun | null) {
  const canStop = useAtomValue(stopWorkflow.permissionAtom(environmentId));
  const canApprove = useAtomValue(approveWorkflow.permissionAtom(environmentId));
  const canResume = useAtomValue(resumeWorkflow.permissionAtom(environmentId));
  const stop = useAtomCommand(stopWorkflow, { label: "stop workflow" });
  const approve = useAtomCommand(approveWorkflow, { label: "approve workflow step" });
  const resume = useAtomCommand(resumeWorkflow, { label: "resume workflow step" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actOnRun = async (action: "stop" | "approval" | "resume", stepId?: string) => {
    if (!run || busy) return;
    setBusy(true);
    setError(null);
    const input = { environmentId, input: { runId: run.id, stepId: stepId ?? "" } };
    const result =
      action === "stop"
        ? await stop({ environmentId, input: { runId: run.id } })
        : action === "approval"
          ? await approve(input)
          : await resume(input);
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return { busy, error, canStop, canApprove, canResume, actOnRun };
}
