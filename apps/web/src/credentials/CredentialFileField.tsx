import { useRef, useState } from "react";
import { PaperclipIcon, XIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  base64FromBytes,
  formatBytes,
  validateCredentialFile,
  type CredentialFormFile,
} from "./credentialDraft";

export function CredentialFileField({
  id,
  label,
  description,
  extensions,
  maxBytes,
  value,
  error,
  disabled = false,
  onValueChange,
  onError,
}: {
  readonly id: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly extensions?: ReadonlyArray<string> | undefined;
  readonly maxBytes?: number | undefined;
  readonly value: CredentialFormFile | null;
  readonly error?: string | null | undefined;
  readonly disabled?: boolean | undefined;
  readonly onValueChange: (value: CredentialFormFile | null) => void;
  readonly onError: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const read = (file: File) => {
    const invalid = validateCredentialFile(file.name, file.size, extensions, maxBytes);
    if (invalid !== null) {
      onError(invalid);
      onValueChange(null);
      return;
    }
    void file.arrayBuffer().then(
      (buffer) => {
        onError(null);
        onValueChange({
          base64: base64FromBytes(new Uint8Array(buffer)),
          fileName: file.name,
          size: file.size,
        });
      },
      () => onError("Could not read that file."),
    );
  };

  const choose = (files: FileList | null) => {
    const file = files?.[0];
    if (file) read(file);
  };

  const openPicker = () => {
    inputRef.current?.click();
  };

  const accept = extensions?.map((extension) => `.${extension}`).join(",");

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div
        className={
          dragging
            ? "flex flex-col items-start gap-2 rounded-lg border border-dashed border-ring bg-accent/40 p-3"
            : "flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-3"
        }
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          choose(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          className="sr-only"
          disabled={disabled}
          {...(accept === undefined ? {} : { accept })}
          onChange={(event) => {
            choose(event.target.files);
            event.target.value = "";
          }}
        />
        {value === null ? (
          <>
            <p className="text-xs text-muted-foreground">
              Drop a file here or choose one.
              {extensions !== undefined && extensions.length > 0
                ? ` Accepts ${extensions.map((extension) => `.${extension}`).join(", ")}.`
                : ""}
              {maxBytes === undefined ? "" : ` Up to ${formatBytes(maxBytes)}.`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={openPicker}
            >
              <PaperclipIcon />
              Choose file
            </Button>
          </>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-2">
            <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{value.fileName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(value.size)}
            </span>
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-micro"
              aria-label={`Remove ${value.fileName}`}
              disabled={disabled}
              onClick={() => {
                onError(null);
                onValueChange(null);
              }}
            >
              <XIcon />
            </Button>
          </div>
        )}
      </div>
      {description === undefined ? null : (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error === undefined || error === null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
