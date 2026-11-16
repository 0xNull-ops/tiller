import type { EnvironmentId, WorkflowListing } from "@t3tools/contracts";
import { UsersIcon } from "lucide-react";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useWorkflowEdit } from "./workflowState";
import { definitionDelegation } from "./workflowStep";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";

export function WorkflowExecutionSelect(props: {
  readonly environmentId: EnvironmentId;
  readonly listing: WorkflowListing;
  readonly compact?: boolean;
  readonly disabled?: boolean;
}) {
  const edit = useWorkflowEdit(props.environmentId);
  const execution = definitionDelegation(props.listing.definition) ?? "auto";
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      // The header and editor share this control; its portal must not dismiss open settings.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Select
        value={execution}
        disabled={props.disabled || !edit.canEdit || edit.busy || props.listing.definition === null}
        onValueChange={(value) => {
          if (value !== "auto" && value !== "prefer-subagents" && value !== "always-subagents")
            return;
          void edit.run({
            _tag: "meta",
            projectId: props.listing.projectId,
            workflow: props.listing.workflow,
            execution: value === "auto" ? null : value,
          });
        }}
      >
        <SelectTrigger
          aria-label={props.compact ? "Workflow execution" : "Run steps"}
          size={props.compact ? "compact" : "default"}
          variant={props.compact ? "ghost" : "default"}
        >
          {props.compact ? <UsersIcon className="size-3" /> : null}
          <SelectValue>
            {execution === "prefer-subagents"
              ? "Prefer subagents"
              : execution === "always-subagents"
                ? "Always subagents"
                : "Agent decides"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
          <SelectItem value="auto">Agent decides</SelectItem>
          <SelectItem value="prefer-subagents">Prefer subagents</SelectItem>
          <SelectItem value="always-subagents">Always subagents</SelectItem>
        </SelectPopup>
      </Select>
      {edit.error ? (
        <p role="alert" className="text-2xs font-normal text-destructive">
          {edit.error}
        </p>
      ) : null}
    </div>
  );
}
