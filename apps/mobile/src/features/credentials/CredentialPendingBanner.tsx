import { AuthCredentialsManageScope, type EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { credentialLive } from "./credentialState";

function CredentialPendingBanner({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const selectThread = useSelectWorkspaceDetail();
  const canManage = useEnvironmentScope(environmentId, AuthCredentialsManageScope);
  const live = useEnvironmentQuery(canManage ? credentialLive.liveStateAtom(environmentId) : null);
  const requests = canManage ? (live.data?.pending ?? []) : [];
  const first = requests[0];
  if (!first) return null;
  return (
    <View className="px-4 py-2">
      <Button
        label={`${requests.length} credential ${requests.length === 1 ? "request" : "requests"}`}
        onPress={() =>
          selectThread({
            name: "Thread",
            params: { environmentId, threadId: first.caller.threadId },
          })
        }
      />
    </View>
  );
}

export function CredentialPendingBanners({
  environments,
}: {
  readonly environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>;
}) {
  return (
    <>
      {environments.map(({ environmentId }) => (
        <CredentialPendingBanner key={environmentId} environmentId={environmentId} />
      ))}
    </>
  );
}
