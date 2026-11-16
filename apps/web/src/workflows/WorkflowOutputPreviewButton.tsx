import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EyeIcon } from "lucide-react";
import { useState } from "react";
import { isBrowserPreviewFile, openFileInPreview } from "../browser/openFileInPreview";
import { usePreviewAvailable } from "../browser/previewRuntime";
import { Button } from "../components/ui/button";
import { assetEnvironment } from "../state/assets";
import { useEnvironmentHttpBaseUrl } from "../state/environments";
import { useFilesystemReadAccess } from "../state/filesystem";
import { previewEnvironment } from "../state/preview";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { useAtomValue } from "@effect/atom-react";

export function WorkflowOutputPreviewButton(props: {
  readonly threadRef: ScopedThreadRef;
  readonly resourceThreadId?: ThreadId;
  readonly name: string;
  readonly path: string;
}) {
  const { threadRef } = props;
  const available = usePreviewAvailable(threadRef.environmentId);
  const canOperate = useAtomValue(previewEnvironment.open.permissionAtom(threadRef.environmentId));
  const { canReadFiles } = useFilesystemReadAccess(threadRef.environmentId);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = async () => {
    if (!httpBaseUrl || !available || !canOperate || !canReadFiles) return;
    setBusy(true);
    setError(null);
    const result = await openFileInPreview({
      threadRef,
      filePath: props.path,
      // Media assets resolve relative paths in the producing thread's workspace.
      workspaceRoot: undefined,
      httpBaseUrl,
      createAssetUrl: (input) => {
        const resource = input.input.resource;
        return createAssetUrl({
          ...input,
          input: {
            resource:
              resource._tag === "media-file" || resource._tag === "workspace-file"
                ? { ...resource, threadId: props.resourceThreadId ?? threadRef.threadId }
                : resource,
          },
        });
      },
      openPreview,
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Unable to open preview.");
    }
  };
  if (
    !isBrowserPreviewFile(props.path) ||
    !available ||
    !canOperate ||
    !canReadFiles ||
    !httpBaseUrl
  )
    return null;
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="ghost"
        size="xs"
        aria-label={`Preview output ${props.name}`}
        disabled={busy}
        onClick={() => void preview()}
      >
        <EyeIcon /> {busy ? "Opening…" : "Preview"}
      </Button>
      {error ? (
        <span role="alert" className="text-2xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
