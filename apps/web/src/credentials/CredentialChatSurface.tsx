import type { ScopedThreadRef } from "@t3tools/contracts";
import { useThreadShell } from "../state/entities";
import { WorkflowAutoOpen } from "../workflows/WorkflowAutoOpen";
import { useWorkflowRuns } from "../workflows/workflowState";
import { useEnvironmentQuery } from "../state/query";
import { credentialLive } from "./credentialState";
import { CredentialRequest } from "./CredentialRequest";

export function CredentialChatSurface({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const runs = useWorkflowRuns(threadRef.environmentId, shell?.projectId ?? null);
  const live = useEnvironmentQuery(credentialLive.liveStateAtom(threadRef.environmentId));
  const pending = (live.data?.pending ?? []).filter(
    (request) =>
      request.caller.threadId === threadRef.threadId ||
      runs.runs.some(
        (run) => run.id === request.caller.runId && run.driverThreadId === threadRef.threadId,
      ),
  );
  return (
    <>
      <WorkflowAutoOpen threadRef={threadRef} />
      {pending.length ? (
        <div className="mb-2 max-h-80 space-y-2 overflow-y-auto" aria-label="Credential approvals">
          {pending.map((request) => (
            <CredentialRequest
              key={request.id}
              environmentId={threadRef.environmentId}
              request={request}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
