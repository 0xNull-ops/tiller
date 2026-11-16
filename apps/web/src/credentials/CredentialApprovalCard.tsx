import type { CredentialApprovalScope, CredentialPendingRequest } from "@t3tools/contracts";
import { credentialCallerLabel } from "@t3tools/client-runtime/state/runtime";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { Button } from "../components/ui/button";
import { CredentialBrandIcon } from "./CredentialBrandIcon";

const EMPTY_ENV_VARS: ReadonlyArray<string> = [];

const credentialScopeLabel: Record<CredentialApprovalScope, string> = {
  run: "Allow for this run",
  once: "Allow once",
  workflow: "Allow for this workflow",
  thread: "Allow for this thread",
};
export { credentialActorLabel } from "@t3tools/shared/credentialPresentation";

export function CredentialApprovalCard({
  request,
  envVars = EMPTY_ENV_VARS,
  busy = false,
  error = null,
  compact = false,
  onApprove,
  onDeny,
  onAdd,
}: {
  readonly request: CredentialPendingRequest;
  readonly envVars?: ReadonlyArray<string>;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly compact?: boolean;
  readonly onApprove: (scope: CredentialApprovalScope) => void;
  readonly onDeny: () => void;
  readonly onAdd: () => void;
}) {
  const template = request.templateId ? credentialTemplate(request.templateId) : undefined;
  const name =
    request.kind === "use"
      ? request.credentialName
      : (request.name ?? template?.name ?? "credentials");
  return (
    <section
      aria-label={`Credential request: ${name}`}
      className={
        compact ? "space-y-2" : "space-y-2 rounded-lg border border-warning/50 bg-card p-3"
      }
    >
      {compact ? null : (
        <>
          <div className="flex items-start gap-2">
            <CredentialBrandIcon
              name={name}
              templateIcon={template?.icon}
              iconOverride={request.kind === "use" ? request.icon : undefined}
              size="sm"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {request.kind === "use"
                  ? `${credentialCallerLabel(request.caller)} (${request.caller.model}) wants to use ${template?.name && template.name !== name ? `${template.name} ` : ""}${name}`
                  : `${credentialCallerLabel(request.caller)} asks you to add ${template?.name ?? name} credentials. Reason: ${request.reason}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {[request.caller.workflow, request.caller.stepTitle ?? request.caller.stepId]
                  .filter(Boolean)
                  .join(" › ")}
                {request.caller.workflow ? " · " : ""}
                {request.caller.threadTitle}
              </p>
            </div>
          </div>
          {request.kind === "use" && request.commandPreview ? (
            <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
              {request.commandPreview}
            </pre>
          ) : null}
          {request.kind === "use" ? (
            <p className="break-words text-xs text-muted-foreground">
              Gets: {envVars.length ? envVars.join(", ") : "credential environment variables"}
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {request.kind === "use" ? (
          request.allowedScopes.map((scope, index) => (
            <Button
              key={scope}
              size="xs"
              variant={index === 0 ? "default" : "outline"}
              disabled={busy}
              onClick={() => onApprove(scope)}
            >
              {credentialScopeLabel[scope]}
            </Button>
          ))
        ) : (
          <Button size="xs" disabled={busy} onClick={onAdd}>
            Add…
          </Button>
        )}
        <Button size="xs" variant="ghost" disabled={busy} onClick={onDeny}>
          {request.kind === "use" ? "Deny" : "Decline"}
        </Button>
      </div>
    </section>
  );
}
