import type { AssetResource, ScopedThreadRef, ThreadId, WorkflowRun } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { fileBasename } from "@t3tools/shared/path";
import { CodeIcon, EyeIcon, FileIcon, ImageIcon, LinkIcon, TypeIcon } from "lucide-react";
import { useAssetUrlState } from "../assets/assetUrls";
import { openExpandedImagePreview } from "../components/chat/ExpandedImageDialog";
import { Button } from "../components/ui/button";
import { useRightPanelStore } from "../rightPanelStore";
import { workflowOutputs, type WorkflowOutput } from "./workflowOutputs";

import { WorkflowOutputPreviewButton } from "./WorkflowOutputPreviewButton";

type OutputPreviews = NonNullable<WorkflowRun["steps"][number]["outputPreviews"]>;

type OutputKind = WorkflowOutput["kind"];

const HTML_EXTENSION = /\.html?$/i;

const isProse = (value: string) => /\s/.test(value);

/**
 * Agents report short prose as outputs too. A value with whitespace is prose,
 * even when it mentions a path, so it must not be dressed up as a file.
 */
const outputKind = (output: WorkflowOutput): OutputKind =>
  output.kind === "text" || isProse(output.value) ? "text" : output.kind;

const fileExtension = (value: string): string => {
  const base = fileBasename(value);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toUpperCase();
};

const typeLabel = (kind: OutputKind, value: string): string => {
  if (kind === "url") return "Link";
  if (kind === "text") return "Text";
  const extension = fileExtension(value);
  if (kind === "image") return extension === "" ? "Image" : extension;
  return extension === "" ? "File" : extension;
};

const kindIcon = (kind: OutputKind, value: string) => {
  if (kind === "url") return <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  if (kind === "image") return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  if (kind === "text") return <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  if (HTML_EXTENSION.test(value))
    return <CodeIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  return <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />;
};

export function WorkflowOutputDetails(props: {
  readonly threadRef: ScopedThreadRef;
  /** The thread that worked the step; output assets resolve against its workspace. */
  readonly resourceThreadId?: ThreadId;
  readonly outputs: Readonly<Record<string, string>>;
  readonly previews?: OutputPreviews;
}) {
  const outputs = workflowOutputs(props.outputs);
  if (outputs.length === 0) return null;
  return (
    <div data-workflow-output-details>
      <h4 className="text-xs font-medium">Outputs</h4>
      <ul className="mt-1 space-y-1">
        {outputs.map((output) => (
          <li
            key={output.key}
            data-workflow-output={output.key}
            className="rounded-md border bg-muted/20 px-2 py-1.5"
          >
            <WorkflowOutputRow
              threadRef={props.threadRef}
              {...(props.resourceThreadId ? { resourceThreadId: props.resourceThreadId } : {})}
              output={output}
              {...(props.previews?.[output.key] ? { preview: props.previews[output.key] } : {})}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkflowOutputRow(props: {
  readonly threadRef: ScopedThreadRef;
  readonly resourceThreadId?: ThreadId;
  readonly output: WorkflowOutput;
  readonly preview?: OutputPreviews[string];
}) {
  const { threadRef, output } = props;
  const openFile = useRightPanelStore((state) => state.openFile);
  const kind = outputKind(output);
  const previewId = props.preview?.status === "ready" ? props.preview.attachmentId : null;
  // A captured screenshot stands in for the artifact; a local image falls back to
  // the file the step wrote.
  const resource: AssetResource | null =
    previewId !== null
      ? { _tag: "attachment", attachmentId: previewId }
      : kind === "image"
        ? {
            _tag: "media-file",
            threadId: props.resourceThreadId ?? threadRef.threadId,
            path: output.value,
          }
        : null;
  const asset = useAssetUrlState(threadRef.environmentId, resource);
  const src = asset._tag === "Success" ? asset.url : null;
  const base = kind === "text" || kind === "url" ? null : fileBasename(output.value);
  const directory = base === null ? "" : output.value.slice(0, output.value.length - base.length);
  return (
    <div className="flex items-start gap-2">
      {src !== null ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-12 w-20 shrink-0 rounded border bg-muted/30 object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {kindIcon(kind, output.value)}
            <span className="truncate text-xs font-medium">{output.key}</span>
            <span className="shrink-0 rounded bg-muted px-1 text-2xs text-muted-foreground">
              {typeLabel(kind, output.value)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {kind === "url" ? (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Open output ${output.key}`}
                render={<a href={output.value} target="_blank" rel="noopener noreferrer" />}
              >
                Open
              </Button>
            ) : kind === "image" ? (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Preview output ${output.key}`}
                disabled={src === null}
                onClick={() => {
                  if (src === null) return;
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
                }}
              >
                <EyeIcon /> Preview
              </Button>
            ) : kind === "text" ? null : (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Open output ${output.key}`}
                onClick={() => openFile(threadRef, output.value)}
              >
                Open
              </Button>
            )}
            {kind === "html" || kind === "file" ? (
              <WorkflowOutputPreviewButton
                threadRef={threadRef}
                name={output.key}
                path={output.value}
                {...(props.resourceThreadId ? { resourceThreadId: props.resourceThreadId } : {})}
              />
            ) : null}
          </span>
        </div>
        {kind === "text" ? (
          <p className="mt-1 whitespace-pre-wrap break-words text-2xs text-muted-foreground">
            {output.value}
          </p>
        ) : kind === "url" ? (
          <p className="mt-1 font-mono break-all text-2xs text-muted-foreground">{output.value}</p>
        ) : (
          <p className="mt-1 font-mono break-all text-2xs">
            <span className="text-muted-foreground">{directory}</span>
            <span>{base}</span>
          </p>
        )}
        {kind === "url" && props.preview?.status === "unavailable" ? (
          <p className="mt-0.5 text-2xs text-muted-foreground">Screenshot unavailable</p>
        ) : null}
        {kind === "image" && asset._tag === "Failure" ? (
          <p className="mt-0.5 text-2xs text-muted-foreground">Preview unavailable</p>
        ) : null}
      </div>
    </div>
  );
}
