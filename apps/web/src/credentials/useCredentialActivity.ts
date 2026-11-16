import { useAtomValue } from "@effect/atom-react";
import { EMPTY_CREDENTIAL_LIVE_STATE } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../state/query";
import {
  createCredential,
  credentialHistoryQuery,
  credentialHistoryWindowQuery,
  credentialLive,
} from "./credentialState";

export function useCredentialActivity(environmentId: EnvironmentId, since?: string) {
  const permitted = useAtomValue(createCredential.permissionAtom(environmentId));
  const live = useEnvironmentQuery(permitted ? credentialLive.liveStateAtom(environmentId) : null);
  const history = useEnvironmentQuery(
    permitted
      ? since
        ? credentialHistoryWindowQuery({ environmentId, input: { since } })
        : credentialHistoryQuery({ environmentId, input: { limit: 200 } })
      : null,
  );
  return {
    live: live.data ?? EMPTY_CREDENTIAL_LIVE_STATE,
    history: history.data?.events ?? [],
    error: live.error ?? history.error,
  };
}
