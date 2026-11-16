import type { AssetResource, ScopedThreadRef, ThreadId, WorkflowRun } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { FileIcon, LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAssetUrlState, useAssetUrlRefresh } from "../assets/assetUrls";
import { openExpandedImagePreview } from "../components/chat/ExpandedImageDialog";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../components/ui/tooltip";
import { useRightPanelStore } from "../rightPanelStore";
import {
  workflowOutputLayout,
  workflowOutputs,
  type WorkflowOutput,
  type WorkflowThumbnailOutput,
} from "./workflowOutputs";

import { WorkflowOutputPreviewButton } from "./WorkflowOutputPreviewButton";

type OutputPreviews = NonNullable<WorkflowRun["steps"][number]["outputPreviews"]>;
const attachmentId = (preview: OutputPreviews[string] | undefined) =>
  preview?.status === "ready" ? preview.attachmentId : null;

const THUMBNAIL_LABEL: Record<WorkflowThumbnailOutput["kind"], string> = {
  url: "Open page",
  image: "Open image",
  html: "Open HTML",
};

/** What shows an output: a captured screenshot, or the file the step wrote. */
function outputResource(
  output: WorkflowOutput,
  preview: OutputPreviews[string] | undefined,
  threadRef: ScopedThreadRef,
  resourceThreadId: ThreadId | undefined,
): AssetResource | null {
  const previewId = attachmentId(preview);
  if (previewId) return { _tag: "attachment", attachmentId: previewId };
  if (output.kind !== "image") return null;
  return {
    _tag: "media-file",
    threadId: resourceThreadId ?? threadRef.threadId,
    path: output.value,
  };
}

function useOpenOutput(props: {
  readonly threadRef: ScopedThreadRef;
  readonly output: WorkflowOutput;
  readonly resource: AssetResource | null;
  readonly src: string | null;
}) {
  const openFile = useRightPanelStore((state) => state.openFile);
  const { output, resource, src, threadRef } = props;
  return () => {
    if (output.kind === "image" && src) {
      openExpandedImagePreview(scopedThreadKey(threadRef), {
        images: [
          {
            src,
            name: output.key,
            actionsSource: {
              kind: "image",
              name: output.key,
              src,
              asset: { environmentId: threadRef.environmentId, resource: resource! },
            },
          },
        ],
        index: 0,
      });
      return;
    }
    openFile(threadRef, output.value);
  };
}

/**
 * The card's one previewable output: a thumbnail of the whole card width, with the
 * button that opens it underneath. The thumbnail repeats the button for the mouse,
 * so it stays out of the tab order and out of the accessibility tree.
 */
function WorkflowOutputThumbnail(props: {
  readonly threadRef: ScopedThreadRef;
  readonly output: WorkflowThumbnailOutput;
  readonly preview?: OutputPreviews[string];
  readonly resourceThreadId?: ThreadId;
  readonly visible: boolean;
}) {
  const { output, threadRef } = props;
  const [broken, setBroken] = useState(false);
  const [retried, setRetried] = useState(false);
  const resource = outputResource(output, props.preview, threadRef, props.resourceThreadId);
  const asset = useAssetUrlState(threadRef.environmentId, props.visible ? resource : null);
  const refresh = useAssetUrlRefresh(threadRef.environmentId, resource);
  const src = !broken && asset._tag === "Success" ? asset.url : null;
  const open = useOpenOutput({ threadRef, output, resource, src });
  const image = (
    <span className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded border bg-muted/30">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => {
            if (retried) {
              setBroken(true);
              return;
            }
            setRetried(true);
            void refresh().catch(() => setBroken(true));
          }}
        />
      ) : output.kind === "url" ? (
        <LinkIcon className="size-4 text-muted-foreground" />
      ) : (
        <FileIcon className="size-4 text-muted-foreground" />
      )}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {output.kind === "url" ? (
        <a
          href={output.value}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          aria-hidden="true"
          className="block w-full overflow-hidden rounded"
        >
          {image}
        </a>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="block w-full overflow-hidden rounded"
          onClick={open}
        >
          {image}
        </button>
      )}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="xs"
          aria-label={`Open output ${output.key}`}
          {...(output.kind === "url"
            ? { render: <a href={output.value} target="_blank" rel="noopener noreferrer" /> }
            : { onClick: open })}
        >
          {THUMBNAIL_LABEL[output.kind]}
        </Button>
        {output.kind === "html" ? (
          <WorkflowOutputPreviewButton
            threadRef={threadRef}
            name={output.key}
            path={output.value}
            {...(props.resourceThreadId ? { resourceThreadId: props.resourceThreadId } : {})}
          />
        ) : null}
      </div>
    </div>
  );
}

/** One of the card's remaining files and links. */
function WorkflowOutputChip(props: {
  readonly threadRef: ScopedThreadRef;
  readonly output: WorkflowOutput;
  readonly preview?: OutputPreviews[string];
  readonly resourceThreadId?: ThreadId;
  readonly visible: boolean;
}) {
  const { output, threadRef } = props;
  // A chip only shows an image when it opens one, so only images resolve an asset.
  const resource =
    output.kind === "image"
      ? outputResource(output, props.preview, threadRef, props.resourceThreadId)
      : null;
  const asset = useAssetUrlState(threadRef.environmentId, props.visible ? resource : null);
  const src = asset._tag === "Success" ? asset.url : null;
  const open = useOpenOutput({ threadRef, output, resource, src });
  const className =
    "flex max-w-36 min-w-0 items-center gap-1 rounded border px-2 py-1 text-left hover:text-primary";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          output.kind === "url" ? (
            <a
              href={output.value}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
              aria-label={`Open output ${output.key}`}
            />
          ) : (
            <button
              type="button"
              className={className}
              aria-label={`Open output ${output.key}`}
              onClick={open}
            />
          )
        }
      >
        {output.kind === "url" ? (
          <LinkIcon className="size-3 shrink-0" />
        ) : (
          <FileIcon className="size-3 shrink-0" />
        )}
        <span className="min-w-0 truncate text-2xs">{output.key}</span>
      </TooltipTrigger>
      <TooltipPopup>
        {output.value}
        {output.kind === "url" && props.preview?.status === "unavailable"
          ? " · Preview unavailable"
          : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

/** A plain value an agent reported, such as "Syntax check passed". */
function WorkflowOutputText(props: { readonly output: WorkflowOutput }) {
  const { output } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground"
            tabIndex={0}
          />
        }
      >
        <span className="shrink-0">{output.key}:</span>
        <span className="min-w-0 truncate text-foreground">{output.value}</span>
      </TooltipTrigger>
      <TooltipPopup>{output.value}</TooltipPopup>
    </Tooltip>
  );
}

export function WorkflowOutputStrip(props: {
  readonly threadRef: ScopedThreadRef;
  readonly outputs: Readonly<Record<string, string>>;
  readonly resourceThreadId?: ThreadId;
  readonly previews?: OutputPreviews;
  readonly onShowAll: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- Measure committed output elements and update the external canvas layout.
  useEffect(() => {
    if (!element || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, visible]);
  const outputs = workflowOutputs(props.outputs);
  const layout = workflowOutputLayout(outputs);
  const main = layout.main;
  return (
    <div
      ref={setElement}
      data-canvas-no-pan
      data-workflow-outputs
      className="flex min-w-0 flex-col gap-1 py-1"
      onWheel={(event) => event.stopPropagation()}
    >
      {main ? (
        <WorkflowOutputThumbnail
          threadRef={props.threadRef}
          output={main}
          {...(props.resourceThreadId ? { resourceThreadId: props.resourceThreadId } : {})}
          {...(props.previews?.[main.key] ? { preview: props.previews[main.key] } : {})}
          visible={visible}
        />
      ) : null}
      {layout.chips.length > 0 || layout.hidden > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {layout.chips.map((output) => (
            <WorkflowOutputChip
              key={`${output.key}:${output.value}`}
              threadRef={props.threadRef}
              output={output}
              {...(props.resourceThreadId ? { resourceThreadId: props.resourceThreadId } : {})}
              {...(props.previews?.[output.key] ? { preview: props.previews[output.key] } : {})}
              visible={visible}
            />
          ))}
          {layout.hidden > 0 ? (
            <button
              type="button"
              className="shrink-0 text-2xs text-muted-foreground hover:text-primary"
              onClick={props.onShowAll}
            >
              +{layout.hidden} more
            </button>
          ) : null}
        </div>
      ) : null}
      {layout.texts.map((output) => (
        <WorkflowOutputText key={output.key} output={output} />
      ))}
    </div>
  );
}
