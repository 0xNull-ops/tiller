import { useAtomValue } from "@effect/atom-react";
import type { CredentialPendingRequest, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
} from "../components/ui/dialog";
import { approveCredential, denyCredential, credentialListQuery } from "./credentialState";
import { CredentialApprovalCard } from "./CredentialApprovalCard";
import { CredentialsEnvironmentPanel } from "./CredentialsEnvironmentPanel";
import { settleCredentialCommand, useCredentialGate } from "./useCredentialGate";

export function CredentialRequest({
  environmentId,
  request,
  compact = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly request: CredentialPendingRequest;
  /** The caller's card already names who asks and the command; keep only the actions. */
  readonly compact?: boolean;
}) {
  const gate = useCredentialGate(environmentId);
  const canApprove = useAtomValue(approveCredential.permissionAtom(environmentId));
  const approve = useAtomCommand(approveCredential, { reportFailure: false });
  const deny = useAtomCommand(denyCredential, { reportFailure: false });
  const list = useEnvironmentQuery(
    canApprove ? credentialListQuery({ environmentId, input: {} }) : null,
  );
  const [adding, setAdding] = useState(false);
  const credential =
    request.kind === "use"
      ? list.data?.credentials.find((entry) => entry.id === request.credentialId)
      : undefined;
  return (
    <>
      <CredentialApprovalCard
        request={request}
        envVars={
          credential?.fields
            .filter((field) =>
              field.kind === "text" ? field.value !== undefined : field.secret?.set === true,
            )
            .map((field) => field.envVar) ?? []
        }
        busy={gate.busy || !canApprove}
        error={gate.error}
        compact={compact}
        onApprove={(scope) =>
          void gate.run(() =>
            settleCredentialCommand(() =>
              approve({ environmentId, input: { requestId: request.id, scope } }),
            ),
          )
        }
        onDeny={() =>
          void gate.run(() =>
            settleCredentialCommand(() =>
              deny({ environmentId, input: { requestId: request.id } }),
            ),
          )
        }
        onAdd={() => setAdding(true)}
      />
      {gate.dialog}
      {request.kind === "add" ? (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Add credentials</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <CredentialsEnvironmentPanel environmentId={environmentId} addRequest={request} />
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
