import { WorkflowTagsField } from "./WorkflowTagsField";
import { WorkflowCredentialApprovals } from "./WorkflowCredentialApprovals";
import { useEffect, useRef, useState } from "react";
import { EllipsisIcon, PlusIcon, XIcon } from "lucide-react";
import type { EnvironmentId, ProjectId, WorkflowInput, WorkflowListing } from "@t3tools/contracts";
import { randomUUID } from "../lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../components/ui/menu";
import { WorkflowInspectorSection, WorkflowInspectorRow } from "./WorkflowInspector";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useWorkflowEdit } from "./workflowState";
import { WorkflowExecutionSelect } from "./WorkflowExecutionSelect";
import { WorkflowSubagentModelsField } from "./WorkflowSubagentModelsField";

export function WorkflowMetaEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly listing: WorkflowListing;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const edit = useWorkflowEdit(props.environmentId);
  const definition = props.listing.definition;
  const [name, setName] = useState(definition?.name ?? props.listing.workflow);
  const [brief, setBrief] = useState(definition?.brief ?? "");
  const focused = useRef<"name" | "brief" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize editor fields with the selected workflow while preserving active edits.
  useEffect(() => {
    if (focused.current !== "name" && document.activeElement !== nameRef.current)
      setName(definition?.name ?? props.listing.workflow);
    if (focused.current !== "brief" && document.activeElement !== briefRef.current)
      setBrief(definition?.brief ?? "");
  }, [definition, props.listing.workflow]);

  const save = (field: "name" | "brief") => {
    if (!definition) return;
    const value = field === "name" ? name.trim() : brief.trim();
    const old = field === "name" ? definition.name : (definition.brief ?? "");
    if (value === old || (field === "name" && !value)) return;
    void edit.run({
      _tag: "meta",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      ...(field === "name" ? { name: value } : { brief: value || null }),
    });
  };
  const deleteWorkflow = async () => {
    const result = await edit.run({
      _tag: "delete",
      projectId: props.projectId,
      workflow: props.listing.workflow,
    });
    if (result) props.onDeleted();
  };

  return (
    <section data-workflow-detail className="space-y-3" aria-label="Workflow settings">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Workflow</h3>
          <p className="text-2xs text-muted-foreground">{props.listing.workflow}</p>
        </div>
        <div className="flex gap-1">
          <Menu>
            <MenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label="Workflow actions" />}
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                variant="destructive"
                disabled={!edit.canEdit || edit.busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete workflow
              </MenuItem>
            </MenuPopup>
          </Menu>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close workflow editor"
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
        </div>
      </header>
      {!definition ? (
        <p className="text-xs text-muted-foreground">
          {props.listing.problem ?? "Workflow definition is unavailable."}
        </p>
      ) : (
        <>
          <div className="grid max-w-[640px] gap-6 @[1100px]:max-w-none @[1100px]:grid-cols-[minmax(0,640px)_minmax(0,640px)]">
            <div className="min-w-0 space-y-3">
              <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                What
              </h4>
              <label className="grid grid-cols-[120px_minmax(0,360px)] items-start gap-3 text-sm font-semibold">
                <span className="text-2xs font-medium text-muted-foreground">Name</span>
                <Input
                  size="sm"
                  ref={nameRef}
                  aria-label="Workflow name"
                  value={name}
                  disabled={!edit.canEdit}
                  onChange={(event) => setName(event.target.value)}
                  onFocus={() => {
                    focused.current = "name";
                  }}
                  onBlur={() => {
                    focused.current = null;
                    save("name");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <label className="grid grid-cols-[120px_minmax(0,360px)] items-start gap-3 text-xs font-medium">
                <span className="pt-1 text-muted-foreground">Brief</span>
                <Textarea
                  ref={briefRef}
                  aria-label="Workflow brief"
                  size="sm"
                  value={brief}
                  disabled={!edit.canEdit}
                  onChange={(event) => setBrief(event.target.value)}
                  onFocus={() => {
                    focused.current = "brief";
                  }}
                  onBlur={() => {
                    focused.current = null;
                    save("brief");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <WorkflowTagsField
                key={`${props.environmentId}:${props.listing.projectId}:${props.listing.workflow}`}
                environmentId={props.environmentId}
                listing={props.listing}
              />
            </div>
            <div className="min-w-0 space-y-3">
              <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                How
              </h4>
              <WorkflowInspectorSection label="Run">
                <WorkflowInspectorRow label="Credential approvals">
                  <WorkflowCredentialApprovals
                    environmentId={props.environmentId}
                    projectId={props.projectId}
                    workflow={props.listing.workflow}
                    value={definition.credentialApprovals}
                    disabled={!edit.canEdit || edit.busy}
                  />
                </WorkflowInspectorRow>
                <WorkflowInspectorRow label="Run steps with">
                  <WorkflowExecutionSelect
                    environmentId={props.environmentId}
                    listing={props.listing}
                  />
                  <span className="block text-2xs font-normal text-muted-foreground">
                    The chat agent always drives; this tells it how to hand work out. Changes apply
                    to new runs.
                  </span>
                </WorkflowInspectorRow>
                <WorkflowInspectorRow label="Subagent models">
                  <WorkflowSubagentModelsField
                    environmentId={props.environmentId}
                    projectId={props.projectId}
                    listing={props.listing}
                    disabled={!edit.canEdit || edit.busy}
                  />
                </WorkflowInspectorRow>
              </WorkflowInspectorSection>
              <InputsEditor
                inputs={definition.inputs}
                canEdit={edit.canEdit}
                busy={edit.busy}
                onSave={async (inputs) => {
                  const result = await edit.run({
                    _tag: "inputsSet",
                    projectId: props.projectId,
                    workflow: props.listing.workflow,
                    inputs: inputs.map((input) => ({ ...input })),
                  });
                  return result !== null;
                }}
              />
            </div>
          </div>
        </>
      )}
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
      {!edit.canEdit ? (
        <p className="text-2xs text-muted-foreground">
          You don’t have permission to edit this workflow.
        </p>
      ) : null}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{definition?.name ?? props.listing.workflow}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved workflow from this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={!edit.canEdit || edit.busy}
              onClick={() => void deleteWorkflow()}
            >
              {edit.busy ? "Deleting…" : "Delete workflow"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}

/**
 * One declared input. `rowId` is the editor's handle on the row: the id it carries is editable,
 * so it cannot be the row's identity while the user is typing.
 */
type InputRow = {
  readonly rowId: string;
  readonly id: string;
  readonly label: string;
  readonly kind: WorkflowInput["kind"];
  readonly required: boolean;
  readonly defaultValue: string;
};

const INPUT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_INPUT_ID_LENGTH = 64;
const NO_INPUTS: ReadonlyArray<WorkflowInput> = [];

const inputRow = (input: WorkflowInput): InputRow => ({
  rowId: randomUUID(),
  id: input.id,
  label: input.label,
  kind: input.kind,
  required: input.required ?? false,
  defaultValue: input.defaultValue ?? "",
});

/** Empty default fields remove the default without changing whitespace in nonempty values. */
const normalizedInput = (input: WorkflowInput): WorkflowInput => ({
  id: input.id.trim(),
  label: input.label.trim(),
  kind: input.kind,
  ...(input.required ? { required: true } : {}),
  ...(input.defaultValue !== undefined && input.defaultValue !== ""
    ? { defaultValue: input.defaultValue }
    : {}),
});

/** An id no other row uses, so a new input never collides with the ones already declared. */
function freshInputId(rows: ReadonlyArray<InputRow>): string {
  const taken = new Set(rows.map((row) => row.id));
  let index = rows.length + 1;
  while (taken.has(`input${index}`)) index += 1;
  return `input${index}`;
}

/** What the server would refuse: an unusable id, an empty label, or the same id twice. */
function inputProblems(rows: ReadonlyArray<InputRow>): ReadonlyArray<string> {
  const problems: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const name = row.label.trim() === "" ? `Input ${index + 1}` : row.label.trim();
    if (row.id.length > MAX_INPUT_ID_LENGTH || !INPUT_ID_PATTERN.test(row.id))
      problems.push(
        `${name} needs an id that starts with a letter, then letters, digits, "-" or "_", up to ${MAX_INPUT_ID_LENGTH} characters.`,
      );
    if (row.label.trim() === "") problems.push(`${name} needs a label.`);
    if (row.kind === "url" && row.defaultValue !== "") {
      let validUrl = false;
      try {
        const url = new URL(row.defaultValue);
        validUrl = url.protocol === "http:" || url.protocol === "https:";
      } catch {
        validUrl = false;
      }
      if (!validUrl) problems.push(`${name} needs an http(s) URL as its default.`);
    }
    if (seen.has(row.id)) problems.push(`Two inputs share the id "${row.id}".`);
    seen.add(row.id);
  });
  return Array.from(new Set(problems));
}

function InputsEditor(props: {
  readonly inputs: ReadonlyArray<WorkflowInput> | undefined;
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly onSave: (inputs: ReadonlyArray<WorkflowInput>) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<ReadonlyArray<InputRow>>(() =>
    (props.inputs ?? NO_INPUTS).map(inputRow),
  );
  const focused = useRef(false);
  // The saved list and the list the server last sent, so an unrelated update neither
  // resends the same inputs nor drops what the user is still editing.
  const savedKey = useRef<string | null>(
    JSON.stringify((props.inputs ?? NO_INPUTS).map(normalizedInput)),
  );
  const seenKey = useRef(JSON.stringify(props.inputs ?? NO_INPUTS));
  const incoming = props.inputs ?? NO_INPUTS;
  const incomingKey = JSON.stringify(incoming);
  const problems = inputProblems(rows);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize editor fields with the selected workflow while preserving active edits.
  useEffect(() => {
    if (focused.current) return;
    if (incomingKey === seenKey.current) return;
    seenKey.current = incomingKey;
    savedKey.current = JSON.stringify(incoming.map(normalizedInput));
    setRows(incoming.map(inputRow));
  }, [incoming, incomingKey]);

  const commit = async (next: ReadonlyArray<InputRow>) => {
    // A half-typed row is never sent: the server would refuse the whole list.
    if (!props.canEdit || inputProblems(next).length > 0) return;
    const inputs = next.map(normalizedInput);
    const key = JSON.stringify(inputs);
    if (key === savedKey.current) return;
    savedKey.current = key;
    const accepted = await props.onSave(inputs);
    // A refused save is worth repeating, so the next attempt is not skipped as unchanged.
    if (!accepted) savedKey.current = null;
  };
  const update = (rowId: string, patch: Partial<Omit<InputRow, "rowId">>) => {
    const next = rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row));
    setRows(next);
    return next;
  };
  const remove = (rowId: string) => {
    const next = rows.filter((row) => row.rowId !== rowId);
    setRows(next);
    void commit(next);
  };
  const add = () => {
    const next: ReadonlyArray<InputRow> = [
      ...rows,
      {
        rowId: randomUUID(),
        id: freshInputId(rows),
        label: `Input ${rows.length + 1}`,
        kind: "text",
        required: false,
        defaultValue: "",
      },
    ];
    setRows(next);
    void commit(next);
  };

  return (
    <section
      aria-label="Inputs"
      className="space-y-2 border-t pt-3"
      onFocusCapture={() => {
        focused.current = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          focused.current = false;
      }}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Inputs · {rows.length}
        </h4>
        <Button variant="ghost" size="xs" disabled={!props.canEdit || props.busy} onClick={add}>
          <PlusIcon /> Add input
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          This workflow asks for nothing when it runs.
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.rowId} className="flex flex-wrap items-center gap-2 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Input
              size="sm"
              aria-label={`Input ${index + 1} id`}
              placeholder="id"
              value={row.id}
              disabled={!props.canEdit}
              onChange={(event) => update(row.rowId, { id: event.target.value })}
              onBlur={() => void commit(rows)}
            />
            <Input
              size="sm"
              aria-label={`Input ${index + 1} label`}
              placeholder="Label"
              value={row.label}
              disabled={!props.canEdit}
              onChange={(event) => update(row.rowId, { label: event.target.value })}
              onBlur={() => void commit(rows)}
            />
            <Select
              value={row.kind}
              disabled={!props.canEdit}
              onValueChange={(kind) =>
                void commit(update(row.rowId, { kind: kind as WorkflowInput["kind"] }))
              }
            >
              <SelectTrigger size="xs" aria-label={`Input ${index + 1} kind`}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="url">URL</SelectItem>
                <SelectItem value="multiline">Multi-line</SelectItem>
              </SelectPopup>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Checkbox
                aria-label={`Required for input ${index + 1}`}
                checked={row.required}
                disabled={!props.canEdit}
                onCheckedChange={(checked) =>
                  void commit(update(row.rowId, { required: checked === true }))
                }
              />
              Required
            </label>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove input ${index + 1}`}
              disabled={!props.canEdit || props.busy}
              onClick={() => remove(row.rowId)}
            >
              <XIcon />
            </Button>
          </div>
          <label className="flex w-full items-center gap-2 text-2xs text-muted-foreground">
            Default
            <Input
              size="sm"
              aria-label={`Input ${index + 1} default`}
              placeholder={row.kind === "url" ? "https://…" : "Optional"}
              maxLength={4000}
              value={row.defaultValue}
              disabled={!props.canEdit}
              onChange={(event) => update(row.rowId, { defaultValue: event.target.value })}
              onBlur={() => void commit(rows)}
            />
          </label>
        </div>
      ))}
      {problems.length > 0 ? (
        <ul role="alert" className="space-y-0.5 text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
