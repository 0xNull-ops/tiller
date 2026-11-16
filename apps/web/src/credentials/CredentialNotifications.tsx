import { workflowRunsLive } from "../workflows/workflowState";
import type { EnvironmentId, CredentialLiveState } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { credentialCallerLabel } from "@t3tools/client-runtime/state/runtime";
import { useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { toastManager } from "../components/ui/toast";
import { credentialLive } from "./credentialState";

function EnvironmentCredentialNotifications({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const live = useEnvironmentQuery(credentialLive.liveStateAtom(environmentId));
  const runs = useEnvironmentQuery(workflowRunsLive(environmentId));
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const toasts = useRef(new Map<string, string>());
  const seen = useRef(new Set<string>());
  const pending: CredentialLiveState["pending"] = live.data?.pending ?? [];
  // oxlint-disable-next-line t3code/react-effect-budget -- Credential live updates and browser notifications are external effects tied to this component lifetime.
  useEffect(() => {
    const ids = new Set(pending.map((request) => request.id));
    for (const [id, toast] of toasts.current) {
      if (!ids.has(id)) {
        toastManager.close(toast);
        toasts.current.delete(id);
      }
    }
    for (const request of pending) {
      if (seen.current.has(request.id)) continue;
      if (
        params.environmentId === environmentId &&
        (params.threadId === request.caller.threadId ||
          runs.data?.runs.some(
            (run) => run.id === request.caller.runId && run.driverThreadId === params.threadId,
          ))
      )
        continue;
      seen.current.add(request.id);
      const id = toastManager.add({
        type: "warning",
        title:
          request.kind === "use"
            ? `Review credential use: ${request.credentialName}`
            : `${credentialCallerLabel(request.caller)} asks for credentials`,
        description: request.caller.threadTitle,
        timeout: 0,
        actionProps: {
          children: "Review",
          onClick: () => {
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: request.caller.threadId },
            });
            toastManager.close(id);
          },
        },
      });
      toasts.current.set(request.id, id);
    }
  }, [pending, environmentId, params.environmentId, params.threadId, navigate, runs.data]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Credential live updates and browser notifications are external effects tied to this component lifetime.
  useEffect(() => {
    const current = toasts.current;
    return () => {
      for (const id of current.values()) toastManager.close(id);
    };
  }, []);
  return null;
}

export function CredentialNotifications() {
  const { environments } = useEnvironments();
  return environments
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => (
      <EnvironmentCredentialNotifications
        key={environment.environmentId}
        environmentId={environment.environmentId}
      />
    ));
}
