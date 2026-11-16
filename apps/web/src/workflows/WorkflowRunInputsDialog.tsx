import { useState } from "react";
import type { WorkflowInput, WorkflowListing } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";

/** Asks for a workflow's declared inputs before starting a run. */
export function WorkflowRunInputsDialog(props: {
  readonly listing: WorkflowListing;
  readonly busy: boolean;
  readonly error?: string | null;
  readonly onStart: (inputs: Record<string, string>) => void;
  readonly onClose: () => void;
}) {
  const inputs = props.listing.definition?.inputs ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (props.listing.definition?.inputs ?? []).flatMap((input) =>
        input.defaultValue !== undefined ? [[input.id, input.defaultValue]] : [],
      ),
    ),
  );
  const canRun =
    !props.busy &&
    inputs.every((input) => {
      const value = values[input.id]?.trim() ?? "";
      if (!value) return !input.required;
      if (input.kind !== "url") return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    });

  return (
    <Dialog open onOpenChange={(open) => !open && !props.busy && props.onClose()}>
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canRun)
              props.onStart(
                Object.fromEntries(
                  Object.entries(values).filter(([, value]) => value.trim() !== ""),
                ),
              );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Run “{props.listing.definition?.name ?? props.listing.workflow}”
            </DialogTitle>
            <DialogDescription>
              {inputs.some((input) => input.required)
                ? "Fill in the workflow’s inputs to start. Fields marked * are required."
                : "Fill in the workflow’s inputs to start."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {inputs.length === 0 ? (
              <p className="text-xs text-muted-foreground">This workflow takes no inputs.</p>
            ) : (
              inputs.map((input) => (
                <InputField
                  key={input.id}
                  input={input}
                  disabled={props.busy}
                  value={values[input.id] ?? ""}
                  onChange={(value) => setValues((current) => ({ ...current, [input.id]: value }))}
                />
              ))
            )}
          </div>
          {props.error ? (
            <p role="alert" className="text-xs text-destructive">
              {props.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={props.busy} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canRun}>
              {props.busy ? "Starting…" : "Run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function InputField(props: {
  readonly input: WorkflowInput;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const label = `${props.input.label}${props.input.required ? " *" : ""}`;
  return (
    <label className="block space-y-1 text-xs font-medium">
      {label}
      {props.input.kind === "multiline" ? (
        <Textarea
          aria-label={label}
          size="sm"
          disabled={props.disabled}
          required={props.input.required}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <Input
          aria-label={label}
          type={props.input.kind === "url" ? "url" : "text"}
          disabled={props.disabled}
          required={props.input.required}
          placeholder={props.input.kind === "url" ? "https://…" : undefined}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </label>
  );
}
