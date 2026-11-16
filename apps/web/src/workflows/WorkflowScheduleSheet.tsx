import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { DialogBackdrop, DialogPortal, DialogViewport } from "../components/ui/dialog";
import { Button } from "../components/ui/button";

/** The sheet surface, shared with the tour's read-only preview of it. */
export const WORKFLOW_SCHEDULE_SHEET_CLASS =
  "relative row-start-2 flex max-h-full w-[min(64rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl";

export function WorkflowScheduleSheet(props: { children: ReactNode }) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport>
        <DialogPrimitive.Popup className={WORKFLOW_SCHEDULE_SHEET_CLASS}>
          {props.children}
          <DialogPrimitive.Close
            render={<Button variant="ghost" size="xs" />}
            className="absolute right-4 top-4"
          >
            Close
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}
