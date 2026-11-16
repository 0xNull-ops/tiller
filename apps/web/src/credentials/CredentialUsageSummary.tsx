import type { CredentialHistoryEvent, CredentialId, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironmentQuery } from "../state/query";
import { credentialHistoryWindowQuery } from "./credentialState";

export function CredentialUsageSummary({
  environmentId,
  credentialId,
  events,
}: {
  readonly environmentId?: EnvironmentId | undefined;
  readonly credentialId: CredentialId;
  readonly events: ReadonlyArray<CredentialHistoryEvent>;
}) {
  const [since] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const query = useEnvironmentQuery(
    environmentId
      ? credentialHistoryWindowQuery({ environmentId, input: { credentialId, since } })
      : null,
  );
  const count = (environmentId ? (query.data?.events ?? []) : events).filter(
    (event) => event.type === "used" && event.use?.result !== "denied" && event.at >= since,
  ).length;
  return (
    <p className="text-xs text-muted-foreground">
      {environmentId && !query.data
        ? query.error
          ? "Use count unavailable"
          : "Loading uses…"
        : `Used ${count}×`}{" "}
      · 7 days
    </p>
  );
}
