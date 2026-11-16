import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import { checkpointFileTotals } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useId, useState, type ReactNode } from "react";

import { ThreadHoverCard, ThreadHoverCardPopup } from "../../../components/ThreadHoverCard";
import { Tooltip, TooltipTrigger } from "../../../components/ui/tooltip";
import { useAssistantMessageText, useThreadCheckpointSummaries } from "../../../state/entities";
import type { JourneyStop } from "../journey";
import { journeyExcerpt, journeyStopPreview } from "../journeyPreview";

type PreviewProps = {
  stop: JourneyStop;
  items: ReadonlyArray<ThreadStructureVisibleTurnItem>;
  threadRef: ScopedThreadRef | null;
};

function JourneyStopPreview({ stop, items, threadRef }: PreviewProps) {
  const preview = journeyStopPreview(stop, items);
  const reply = useAssistantMessageText(threadRef, preview.assistantItemId);
  const checkpoints = useThreadCheckpointSummaries(stop.kind === "checkpoint" ? threadRef : null);
  // A narration flag is not necessarily the final reply that owns a saved checkpoint.
  const checkpoint = checkpoints.find(
    (entry) =>
      preview.assistantMessageId !== undefined &&
      entry.assistantMessageId === preview.assistantMessageId,
  );
  const totals = checkpoint ? checkpointFileTotals(checkpoint) : null;
  const checkpointFiles = checkpoint?.files.slice(0, 4) ?? [];
  const text = preview.text || (reply ? journeyExcerpt(reply) : null);
  return (
    <ThreadHoverCard
      title={`Turn ${stop.turn} · ${stop.label}`}
      footer={
        <div className="text-2xs text-muted-foreground">
          {stop.at !== null ? (
            <time dateTime={new Date(stop.at).toISOString()}>
              {new Date(stop.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
              ·{" "}
            </time>
          ) : null}
          {stop.jumpRowId ? "Click or press Enter to view in chat" : "Chat location unavailable"}
        </div>
      }
    >
      {text ? <p className="line-clamp-5 whitespace-pre-wrap wrap-anywhere">{text}</p> : null}
      {preview.outcome ? <p>{preview.outcome}</p> : null}
      {preview.entries.map((entry) => (
        <div key={entry.id} className="grid gap-0.5">
          <div className="line-clamp-2 font-mono text-2xs wrap-anywhere">{entry.text}</div>
          {entry.detail ? <div>{entry.detail}</div> : null}
        </div>
      ))}
      {preview.omitted > 0 ? <p>+{preview.omitted} more in chat</p> : null}
      {stop.kind === "checkpoint" ? (
        checkpoint ? (
          <div className="grid gap-1 border-t pt-1.5">
            <p>
              {checkpoint.status === "ready"
                ? "Checkpoint saved"
                : `Checkpoint ${checkpoint.status}`}
            </p>
            {totals ? (
              <p>
                {totals.count} changed {totals.count === 1 ? "file" : "files"} · +{totals.additions}{" "}
                −{totals.deletions}
              </p>
            ) : null}
            {checkpointFiles.map((file) => (
              <div key={file.path} className="line-clamp-1 font-mono text-2xs wrap-anywhere">
                {file.path}
              </div>
            ))}
            {totals && totals.count > checkpointFiles.length ? (
              <p>+{totals.count - checkpointFiles.length} more files</p>
            ) : null}
          </div>
        ) : (
          <p>Reply · no saved checkpoint available</p>
        )
      ) : null}
    </ThreadHoverCard>
  );
}

export function JourneyStopMarker({
  stop,
  items,
  threadRef,
  transform,
  disabled,
  onJump,
  children,
}: PreviewProps & {
  transform: string;
  disabled: boolean;
  onJump: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const previewId = useId();
  return (
    <Tooltip disabled={disabled} open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        delay={250}
        disabled={disabled}
        render={
          <g
            transform={transform}
            data-stop={stop.kind}
            data-failed={stop.failed ? "" : undefined}
            role="button"
            tabIndex={0}
            aria-label={`Turn ${stop.turn} · ${stop.label}`}
            aria-describedby={open && !disabled ? previewId : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onJump}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onJump();
              setOpen(false);
            }}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <ThreadHoverCardPopup id={previewId} role="tooltip" side="right" align="end" sideOffset={8}>
        {open && !disabled ? (
          <JourneyStopPreview stop={stop} items={items} threadRef={threadRef} />
        ) : null}
      </ThreadHoverCardPopup>
    </Tooltip>
  );
}
