import {
  AuthCredentialsManageScope,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { credentialRequestsForThread } from "@t3tools/client-runtime/state/runtime";
import { ScrollView } from "react-native";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { workflowRunsForProject } from "../../workflows/workflowState";
import { credentialListQuery, credentialLive } from "./credentialState";
import { CredentialApprovalCard } from "./CredentialApprovalCard";

export function CredentialThreadApprovals({
  environmentId,
  projectId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}) {
  const canManage = useEnvironmentScope(environmentId, AuthCredentialsManageScope);
  const live = useEnvironmentQuery(canManage ? credentialLive.liveStateAtom(environmentId) : null);
  const list = useEnvironmentQuery(
    canManage ? credentialListQuery({ environmentId, input: {} }) : null,
  );
  const runs = useEnvironmentQuery(
    canManage ? workflowRunsForProject(environmentId, projectId) : null,
  );
  const requests = credentialRequestsForThread(
    canManage ? (live.data?.pending ?? []) : [],
    threadId,
    runs.data?.runs ?? [],
  );
  if (!requests.length) return null;
  return (
    <ScrollView
      style={{ maxHeight: 320 }}
      contentContainerClassName="gap-2 p-3"
      keyboardShouldPersistTaps="handled"
    >
      {requests.map((request) => (
        <CredentialApprovalCard
          key={request.id}
          environmentId={environmentId}
          request={request}
          envVars={
            request.kind === "use"
              ? (list.data?.credentials
                  .find((credential) => credential.id === request.credentialId)
                  ?.fields.map((field) => field.envVar) ?? [])
              : []
          }
        />
      ))}
    </ScrollView>
  );
}
