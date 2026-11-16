import type { EnvironmentId } from "@t3tools/contracts";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { Badge } from "../components/ui/badge";
import { CredentialBrandIcon } from "../credentials/CredentialBrandIcon";
import { CredentialRequest } from "../credentials/CredentialRequest";
import { credentialActorLabel } from "../credentials/CredentialApprovalCard";
import { CredentialUseEvent } from "../credentials/CredentialHistory";
import { useCredentialActivity } from "../credentials/useCredentialActivity";

/** The step detail's "Credential use" history, below the Needs block. */
export function WorkflowStepCredentialUse({
  environmentId,
  runId,
  stepId,
  since,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: string;
  readonly stepId: string;
  readonly since: string;
}) {
  const activity = useCredentialActivity(environmentId, since);
  const events = activity.history.filter(
    (event) => event.use?.runId === runId && event.use.stepId === stepId,
  );
  const active = activity.live.active.filter(
    (entry) => entry.caller.runId === runId && entry.caller.stepId === stepId,
  );
  const pending = activity.live.pending.filter(
    (request) => request.caller.runId === runId && request.caller.stepId === stepId,
  );
  return (
    <section className="mt-4 space-y-2" aria-label="Credential use">
      <h4 className="text-xs font-medium">Credential use</h4>
      {activity.error ? (
        <p role="alert" className="text-xs text-destructive">
          {activity.error}
        </p>
      ) : null}
      {pending.map((request) => (
        <CredentialRequest key={request.id} environmentId={environmentId} request={request} />
      ))}
      {active.map((entry) => (
        <div key={entry.id} className="space-y-1 border-t py-2">
          <div className="flex items-center gap-2">
            <CredentialBrandIcon
              name={entry.credentialName}
              templateIcon={credentialTemplate(entry.templateId)?.icon}
              iconOverride={entry.icon}
              size="sm"
            />
            <span className="text-xs font-medium">{entry.credentialName}</span>
            <Badge variant="info">In use</Badge>
          </div>
          <Badge variant="outline">{credentialActorLabel(entry.caller)}</Badge>
          {entry.commandPreview ? (
            <pre className="whitespace-pre-wrap break-all text-xs">{entry.commandPreview}</pre>
          ) : null}
          <time dateTime={entry.startedAt} className="text-xs text-muted-foreground">
            Started {entry.startedAt}
          </time>
        </div>
      ))}
      {events.map((event) => (
        <div key={event.id} className="space-y-1 border-t py-2">
          <div className="flex items-center gap-2">
            <CredentialBrandIcon name={event.credentialName ?? "Credential"} size="sm" />
            <p className="text-xs font-medium">{event.credentialName}</p>
          </div>
          <CredentialUseEvent event={event} environmentId={environmentId} />
        </div>
      ))}
      {!events.length && !pending.length && !active.length ? (
        <p className="text-xs text-muted-foreground">No credential use recorded for this step.</p>
      ) : null}
    </section>
  );
}
