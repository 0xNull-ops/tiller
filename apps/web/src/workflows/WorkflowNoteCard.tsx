import type { MouseEvent, PointerEvent } from "react";
import { StickyNoteIcon } from "lucide-react";
import type { WorkflowNote } from "@t3tools/contracts";
import { cn } from "~/lib/utils";

export function WorkflowNoteCard(props: {
  readonly note: WorkflowNote;
  readonly position: { readonly x: number; readonly y: number };
  readonly selected: boolean;
  readonly editMode: boolean;
  readonly dragging: boolean;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  readonly onSelect: () => void;
}) {
  return (
    <article
      data-workflow-note-card={props.note.id}
      data-canvas-no-pan
      onPointerDown={props.editMode ? props.onPointerDown : undefined}
      onClickCapture={props.onClickCapture}
      className={cn(
        "absolute flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 shadow-xs",
        "border-warning/40",
        props.selected && "ring-2 ring-primary",
        props.editMode && "select-none cursor-grab active:cursor-grabbing",
        props.dragging && "opacity-80 shadow-lg",
      )}
      style={{ left: props.position.x, top: props.position.y, width: 208, minHeight: 82 }}
    >
      <header className="flex items-center gap-1.5">
        <StickyNoteIcon className="size-3 shrink-0 text-warning" />
        <span className="text-2xs font-medium">Note</span>
      </header>
      <button
        type="button"
        className="line-clamp-3 min-h-8 whitespace-pre-wrap break-words text-left text-2xs text-muted-foreground hover:text-foreground"
        aria-label={`Open note${props.note.text ? `: ${props.note.text.slice(0, 60)}` : " editor"}`}
        onClick={props.onSelect}
      >
        {props.note.text || (props.editMode ? "Write a note…" : "Empty note")}
      </button>
    </article>
  );
}
