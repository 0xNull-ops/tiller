import type { WorkflowListing } from "@t3tools/contracts";
import { WorkflowIcon } from "lucide-react";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

export function WorkflowWelcome(props: {
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly canCreate: boolean;
  readonly onOpen: (workflow: string) => void;
  readonly onNew: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <WorkflowIcon className="size-5 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Choose a workflow</p>
        <p className="text-xs text-muted-foreground">
          Open a saved workflow or create one for this chat.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Select
          value={null}
          onValueChange={(value) => {
            if (value) props.onOpen(value);
          }}
          disabled={props.workflows.length === 0}
        >
          <SelectTrigger size="compact" aria-label="Open workflow">
            <SelectValue>Open workflow</SelectValue>
          </SelectTrigger>
          <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
            {props.workflows.map((listing) => (
              <SelectItem key={listing.workflow} value={listing.workflow}>
                {listing.definition?.name ?? listing.workflow}
                {listing.problem ? " · invalid" : ""}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button size="xs" disabled={!props.canCreate} onClick={props.onNew}>
          New workflow
        </Button>
      </div>
      {props.workflows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No saved workflows in this project yet.</p>
      ) : null}
    </div>
  );
}
