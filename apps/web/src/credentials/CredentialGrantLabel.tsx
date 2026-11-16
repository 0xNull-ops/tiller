import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { CredentialGrant, EnvironmentId } from "@t3tools/contracts";
import { useThreadShell } from "../state/entities";

export function CredentialGrantLabel({
  grant,
  environmentId,
  projectTitle,
}: {
  readonly grant: CredentialGrant;
  readonly environmentId?: EnvironmentId | undefined;
  /** The project's name, so a workflow pre-approval says where it applies. */
  readonly projectTitle?: string | undefined;
}) {
  const shell = useThreadShell(
    environmentId !== undefined && grant.kind === "approval"
      ? scopeThreadRef(environmentId, grant.threadId)
      : null,
  );
  if (grant.kind === "workflow-preapproval")
    return (
      <p>
        Pre-approved for workflow {grant.workflow}
        {projectTitle === undefined ? null : ` · ${projectTitle}`}
      </p>
    );
  return (
    <p>
      Allowed for this {grant.scope} ·{" "}
      {grant.scope === "workflow"
        ? grant.workflow
        : grant.scope === "run"
          ? `${grant.workflow ?? "Workflow"} · ${grant.runId}`
          : (shell?.title ?? grant.threadId)}
    </p>
  );
}
