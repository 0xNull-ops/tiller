import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CheckIcon, CircleDashedIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../state/query";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { toastManager } from "../components/ui/toast";
import { workflowRead, useWorkflowEdit } from "./workflowState";
import { useWorkflowLiveRefresh } from "./useWorkflowLiveRefresh";
import { ComposerControl } from "../components/chat/ComposerControl";
import { Separator } from "../components/ui/separator";
import { cn } from "~/lib/utils";
import { draftWorkflowFirstChoice, setDraftWorkflowFirstChoice } from "./workflowFirstDraftState";

export function WorkflowFirstComposerControl(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId | undefined;
  isDraft?: boolean | undefined;
  size: "sm" | "xs";
}) {
  const query = useEnvironmentQuery(
    props.threadId === undefined || props.isDraft
      ? null
      : workflowRead({
          environmentId: props.environmentId,
          input: { _tag: "workflowFirst", threadId: props.threadId },
        }),
  );
  const defaultQuery = useEnvironmentQuery(
    props.isDraft
      ? workflowRead({ environmentId: props.environmentId, input: { _tag: "preferences" } })
      : null,
  );
  const command = useWorkflowEdit(props.environmentId);
  const [draftChoice, setDraftChoice] = useState<{
    readonly threadId: ThreadId;
    readonly enabled: boolean;
  } | null>(null);
  useWorkflowLiveRefresh(props.environmentId, query.refresh);
  if (props.threadId === undefined) return null;
  const savedState = query.data?._tag === "workflowFirst" ? query.data.enabled : null;
  const defaultEnabled =
    defaultQuery.data?._tag === "preferences"
      ? defaultQuery.data.preferences.workflowFirstForNewThreads
      : null;
  const enabled = props.isDraft
    ? draftChoice?.threadId === props.threadId
      ? draftChoice.enabled
      : (draftWorkflowFirstChoice(props.threadId) ?? defaultEnabled)
    : savedState;
  const toggle = async () => {
    if (props.isDraft) {
      if (enabled === null) return;
      const next = !enabled;
      setDraftWorkflowFirstChoice(props.threadId!, next);
      setDraftChoice({ threadId: props.threadId!, enabled: next });
      return;
    }
    if (query.data?._tag !== "workflowFirst") return;
    const result = await command.run(
      {
        _tag: "workflowFirstSet",
        threadId: props.threadId!,
        enabled: !query.data.enabled,
      },
      (message) => {
        toastManager.add({
          type: "error",
          title: "Could not update Workflow-first",
          description: message,
        });
      },
    );
    if (result === null) return;
    query.refresh();
  };
  return (
    <>
      <Separator
        orientation="vertical"
        className={cn("mx-0.5 hidden sm:block", props.size === "xs" ? "h-3.5!" : "h-4")}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              size={props.size}
              type="button"
              aria-label="Workflow-first"
              aria-pressed={enabled === null ? undefined : enabled}
              aria-busy={enabled === null || command.busy}
              disabled={
                enabled === null ||
                (props.isDraft
                  ? !command.canEdit || command.busy
                  : savedState === null || !command.canEdit || command.busy)
              }
              onClick={() => void toggle()}
              className="aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:shadow-xs aria-pressed:hover:bg-primary/15"
            />
          }
        >
          {enabled === true ? (
            <CheckIcon aria-hidden="true" className="size-3" />
          ) : enabled === null ? (
            <CircleDashedIcon aria-hidden="true" className="size-3" />
          ) : null}
          Workflow-first
        </TooltipTrigger>
        <TooltipPopup>Check saved workflows before multi-step work</TooltipPopup>
      </Tooltip>
    </>
  );
}
