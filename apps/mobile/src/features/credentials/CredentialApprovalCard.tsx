import type {
  CredentialApprovalScope,
  CredentialPendingRequest,
  EnvironmentId,
} from "@t3tools/contracts";
import { credentialActorLabel } from "@t3tools/shared/credentialPresentation";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { useAtomCommand } from "../../state/use-atom-command";
import { CredentialBrandMark } from "./CredentialBrandMark";
import { CredentialUnlockSheet } from "./CredentialUnlockSheet";
import {
  settleCredentialDecision,
  unlockAndRetryCredentialDecision,
  type CredentialDecisionOutcome,
} from "./credentialApprovalFlow";
import { approveCredential, denyCredential, unlockCredentials } from "./credentialState";

const SCOPE_LABELS: Record<CredentialApprovalScope, string> = {
  once: "Allow once",
  run: "Allow for this run",
  workflow: "Allow for this workflow",
  thread: "Allow for this thread",
};

export function CredentialApprovalCard({
  environmentId,
  request,
  envVars,
}: {
  readonly environmentId: EnvironmentId;
  readonly request: CredentialPendingRequest;
  readonly envVars: ReadonlyArray<string>;
}) {
  const approve = useAtomCommand(approveCredential, { reportFailure: false, reportDefect: false });
  const deny = useAtomCommand(denyCredential, { reportFailure: false, reportDefect: false });
  const unlock = useAtomCommand(unlockCredentials, { reportFailure: false, reportDefect: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const pending = useRef<(() => Promise<CredentialDecisionOutcome>) | null>(null);
  const inFlight = useRef(false);
  const apply = (result: CredentialDecisionOutcome) => {
    setError(result.kind === "done" ? null : result.message);
    setUnlockOpen(result.kind === "unlock");
    if (result.kind !== "unlock") pending.current = null;
  };
  const answer = async (scope?: CredentialApprovalScope) => {
    if (inFlight.current || pending.current) return;
    const action = () =>
      settleCredentialDecision(() =>
        scope
          ? approve({ environmentId, input: { requestId: request.id, scope } })
          : deny({ environmentId, input: { requestId: request.id } }),
      );
    inFlight.current = true;
    setBusy(true);
    const result = await action().finally(() => {
      inFlight.current = false;
      setBusy(false);
    });
    if (result.kind === "unlock") pending.current = action;
    apply(result);
  };
  const submitPin = async (pin: string) => {
    const retry = pending.current;
    if (!retry || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    apply(
      await unlockAndRetryCredentialDecision(
        () => settleCredentialDecision(() => unlock({ environmentId, input: { pin } })),
        () => (pending.current === retry ? retry() : Promise.resolve({ kind: "done" })),
      ).finally(() => {
        inFlight.current = false;
        setBusy(false);
      }),
    );
  };
  const template = request.templateId ? credentialTemplate(request.templateId) : undefined;
  const name =
    request.kind === "use"
      ? request.credentialName
      : (request.name ?? template?.name ?? "Credentials");
  return (
    <View className="gap-2 rounded-xl border border-border bg-card-alt p-3">
      <View className="flex-row items-center gap-2">
        <CredentialBrandMark
          name={name}
          templateIcon={template?.icon}
          iconOverride={request.kind === "use" ? request.icon : undefined}
          envVars={envVars}
        />
        <AppText className="flex-1 font-t3-medium">{name}</AppText>
      </View>
      <AppText textRole="footnote">{credentialActorLabel(request.caller)}</AppText>
      <AppText textRole="caption" className="text-foreground-muted">
        {[request.caller.workflow, request.caller.stepTitle ?? request.caller.stepId]
          .filter(Boolean)
          .join(" › ")}
        {request.caller.workflow ? " · " : ""}
        {request.caller.threadTitle}
      </AppText>
      {request.kind === "use" ? (
        <>
          {request.commandPreview ? (
            <AppText selectable className="font-mono">
              {request.commandPreview}
            </AppText>
          ) : null}
          <AppText textRole="caption">
            Gets: {envVars.length ? envVars.join(", ") : "credential environment variables"}
          </AppText>
        </>
      ) : (
        <>
          <AppText>{request.reason}</AppText>
          <AppText>Add on desktop or web.</AppText>
        </>
      )}
      {error && !unlockOpen ? <ErrorBanner message={error} /> : null}
      <View className="flex-row flex-wrap gap-2">
        {request.kind === "use"
          ? request.allowedScopes.map((scope) => (
              <Button
                key={scope}
                label={SCOPE_LABELS[scope]}
                tone="primary"
                disabled={busy || unlockOpen}
                onPress={() => void answer(scope)}
              />
            ))
          : null}
        <Button
          label={request.kind === "use" ? "Deny" : "Decline"}
          disabled={busy || unlockOpen}
          onPress={() => void answer()}
        />
      </View>
      {unlockOpen ? (
        <CredentialUnlockSheet
          busy={busy}
          error={error}
          onSubmit={submitPin}
          onClose={() => {
            pending.current = null;
            setUnlockOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </View>
  );
}
