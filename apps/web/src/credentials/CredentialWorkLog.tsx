import type { EnvironmentId, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { credentialWorkLogSummary } from "./credentialWorkLogSummary";
import { CredentialBrandIcon } from "./CredentialBrandIcon";
import { useCredentialActivity } from "./useCredentialActivity";

export const isCredentialToolItem = (item: OrchestrationV2TurnItem | undefined) =>
  item?.type === "dynamic_tool" &&
  /(?:^|[_./:])credential_(?:list|exec|file|request)$/.test(item.toolName ?? "");
/** Only allowlisted metadata and the history's redacted command reach the timeline. */
export function CredentialWorkLog({
  item,
  environmentId,
}: {
  readonly item: OrchestrationV2TurnItem;
  readonly environmentId: EnvironmentId;
}) {
  const { history } = useCredentialActivity(environmentId);
  if (item.type !== "dynamic_tool") return null;
  const summary = credentialWorkLogSummary(item, history);
  const list = summary.action === "Listed credentials";
  return (
    <div
      className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
      data-credential-work-log
    >
      {list ? null : <CredentialBrandIcon name={summary.name} size="sm" />}
      <span className="min-w-0 truncate">
        {list ? "Listed credentials" : `${summary.action} ${summary.name}`}
        {summary.commandPreview ? ` · ${summary.commandPreview}` : ""}
        {summary.exitCode !== undefined && summary.exitCode !== null
          ? ` · exit ${summary.exitCode}`
          : ""}
      </span>
    </div>
  );
}
