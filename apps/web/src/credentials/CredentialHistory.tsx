import type { CredentialHistoryEvent, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  historyEventLabel,
  credentialDecisionLabel,
  credentialApproverLabel,
} from "@t3tools/shared/credentialPresentation";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { credentialActorLabel } from "./CredentialApprovalCard";

type CredentialHistoryFilter = "All" | "Uses" | "Approvals" | "Changes";
const filterCredentialHistory = (
  events: ReadonlyArray<CredentialHistoryEvent>,
  filter: CredentialHistoryFilter,
) =>
  events.filter(
    (event) =>
      filter === "All" ||
      (filter === "Changes"
        ? !event.use && event.type !== "approved" && event.type !== "denied"
        : filter === "Uses"
          ? event.use?.result !== "denied" && event.type === "used"
          : event.type === "approved" || event.type === "denied"),
  );

export function CredentialUseEvent({
  event,
  environmentId,
}: {
  readonly event: CredentialHistoryEvent;
  readonly environmentId?: EnvironmentId | undefined;
}) {
  const use = event.use;
  return (
    <div className="min-w-0 space-y-1">
      <p className="flex flex-wrap items-center gap-1 text-sm">
        {event.type === "approved" || event.type === "denied"
          ? use
            ? credentialDecisionLabel(use)
            : historyEventLabel(event.type)
          : use
            ? use.result === "denied"
              ? "Requested by"
              : "Used by"
            : historyEventLabel(event.type)}
        {use ? <Badge variant="outline">{credentialActorLabel(use) || "Agent"}</Badge> : null}
      </p>
      {use ? (
        <>
          <p className="flex flex-wrap gap-1 text-xs text-muted-foreground">
            {use.workflow && environmentId && use.projectId ? (
              <>
                <Link
                  to="/workflows/$environmentId/$projectId/$slug"
                  params={{ environmentId, projectId: use.projectId, slug: use.workflow }}
                  search={use.runId ? { run: use.runId } : {}}
                >
                  {use.workflow}
                </Link>
                {use.stepId ? (
                  <>
                    <span>›</span>
                    <Link
                      to="/workflows/$environmentId/$projectId/$slug"
                      params={{ environmentId, projectId: use.projectId, slug: use.workflow }}
                      search={{ ...(use.runId ? { run: use.runId } : {}), step: use.stepId }}
                    >
                      {use.stepTitle ?? use.stepId}
                    </Link>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {use.workflow}
                {use.stepTitle || use.stepId ? ` › ${use.stepTitle ?? use.stepId}` : ""}
              </>
            )}

            {use.threadId && environmentId ? (
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: use.threadId }}
              >
                {use.threadTitle ?? "Open thread"}
              </Link>
            ) : (
              use.threadTitle
            )}
          </p>
          {use.commandPreview ? (
            <pre className="whitespace-pre-wrap break-all text-xs">{use.commandPreview}</pre>
          ) : null}
          <p className="break-words text-xs text-muted-foreground">
            {credentialDecisionLabel(use)}
            {credentialApproverLabel(use) ? ` · ${credentialApproverLabel(use)}` : ""}
            {event.type === "used"
              ? ` · ${use.exitCode !== undefined && use.exitCode !== null ? `exit ${use.exitCode}` : use.result}`
              : ""}
          </p>
        </>
      ) : event.fieldIds?.length ? (
        <p className="text-xs text-muted-foreground">{event.fieldIds.join(", ")}</p>
      ) : null}
      <time className="text-xs text-muted-foreground" dateTime={event.at}>
        {formatRelativeTimeLabel(event.at)}
      </time>
    </div>
  );
}

export function CredentialHistory({
  events,
  environmentId,
}: {
  readonly events: ReadonlyArray<CredentialHistoryEvent>;
  readonly environmentId?: EnvironmentId | undefined;
}) {
  const [filter, setFilter] = useState<CredentialHistoryFilter>("All");
  const visible = filterCredentialHistory(events, filter);
  return (
    <div className="space-y-2">
      <div role="group" aria-label="History filter" className="flex flex-wrap gap-1">
        {(["All", "Uses", "Approvals", "Changes"] as const).map((value) => (
          <Button
            key={value}
            size="xs"
            variant={filter === value ? "secondary" : "ghost"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      {visible.length ? (
        <ul className="divide-y divide-border">
          {visible.map((event) => (
            <li key={event.id} className="px-3 py-2">
              <CredentialUseEvent event={event} environmentId={environmentId} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          No {filter === "All" ? "history" : filter.toLowerCase()} yet.
        </p>
      )}
    </div>
  );
}
