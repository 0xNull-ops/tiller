import type { RefObject } from "react";
import { BracesIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";

type WorkflowInsertValue = {
  readonly token: string;
  /** What the token stands for, named the way the workflow names it. */
  readonly label: string;
};

/** A quiet way to see and insert the `{{...}}` tokens a workflow offers, in place of a paragraph. */
export function WorkflowInsertValueMenu(props: {
  readonly values: ReadonlyArray<WorkflowInsertValue>;
  readonly onInsert: (token: string) => void;
  readonly disabled?: boolean;
  /** Where focus lands once a value is picked, so typing continues where it left off. */
  readonly returnFocus?: RefObject<HTMLElement | null>;
}) {
  if (props.values.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-tiny"
            aria-label="Insert a value"
            disabled={props.disabled}
          />
        }
      >
        <BracesIcon />
      </MenuTrigger>
      <MenuPopup align="start" width="content" finalFocus={props.returnFocus ?? false}>
        {props.values.map((value) => (
          <MenuItem key={value.token} onClick={() => props.onInsert(value.token)}>
            <code className="font-mono text-2xs">{value.token}</code>
            <span className="truncate text-2xs text-muted-foreground">{value.label}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
