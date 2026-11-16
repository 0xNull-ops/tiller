import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

export function WorkflowRunButton(props: {
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly busy: boolean;
  readonly onRun: () => void;
}) {
  const buttons = (
    <Button size="xs" disabled={props.disabled || props.busy} onClick={() => props.onRun()}>
      {props.busy ? "Working…" : "Run"}
    </Button>
  );

  return props.disabled && props.disabledReason ? (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{buttons}</TooltipTrigger>
      <TooltipPopup>{props.disabledReason}</TooltipPopup>
    </Tooltip>
  ) : (
    buttons
  );
}
