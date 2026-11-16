import {
  StepWhat,
  StepRun,
  StepNeeds,
  StepChecks,
  StepPauses,
  StepWait,
} from "./WorkflowStepSections";
import { useConnectionHover } from "./WorkflowConnectionHover";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  ProjectId,
  ScopedThreadRef,
  ThreadId,
  WorkflowListing,
  WorkflowLoop,
  WorkflowLoopUntil,
  WorkflowSkillStep,
  WorkflowStep,
  WorkflowStepCheck,
  WorkflowStepRun,
  WorkflowAttachment,
  WorkflowAttachmentKind,
} from "@t3tools/contracts";
import { MAX_WORKFLOW_LOOP_ROUNDS, MAX_WORKFLOW_STEP_ATTACHMENTS } from "@t3tools/contracts";
import { AlertTriangleIcon, EllipsisIcon, XIcon } from "lucide-react";
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
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../components/ui/menu";
import { WorkflowInspectorSection, WorkflowInspectorRow } from "./WorkflowInspector";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { useWorkflowEdit } from "./workflowState";
import {
  canLoopBack,
  dependenciesOf,
  uniqueLoopId,
  withReadsFrom,
  withoutReadsFrom,
  workflowStepRemovalSummary,
} from "./workflowEditing";
import { isWorkflowSkillStep } from "./workflowStep";
import { WorkflowOutputDetails } from "./WorkflowOutputDetails";
import { WorkflowSkillEditor } from "./WorkflowSkillEditor";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { useEnvironmentProviders } from "../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../state/server";
import { resolveSubagentModels } from "@t3tools/shared/workflowSubagents";

type DraftField = "title" | "note";

const checkDraft = (check: WorkflowStepCheck) => ({ id: randomUUID(), check });

type StepEditorProps = {
  /** The thread whose panel shows this step; its outputs open in the same panel. */
  readonly threadRef: ScopedThreadRef;
  readonly probeContextThreadId?: ThreadId;
  readonly probeContextWorkspaceRoot?: string | null;
  readonly probeContextModelRevision?: string;
  readonly projectId: ProjectId;
  readonly listing: WorkflowListing;
  readonly step: WorkflowStep;
  readonly lastRunState: WorkflowStepRun | null;
  readonly onClose: () => void;
  readonly onOpenWorkflow: (workflow: string, stepId?: string) => void;
};

function useStepEditor(props: StepEditorProps) {
  const { threadRef } = props;
  const environmentId = threadRef.environmentId;
  const edit = useWorkflowEdit(
    environmentId,
    props.listing,
    props.probeContextThreadId,
    props.probeContextWorkspaceRoot,
    props.probeContextModelRevision,
  );
  const definition = props.listing.definition;
  const { connection, setConnection } = useConnectionHover();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    providersByEnvironment instanceof Map
      ? (providersByEnvironment.get(environmentId) ?? EMPTY_SERVER_PROVIDERS)
      : EMPTY_SERVER_PROVIDERS;
  const [title, setTitle] = useState(props.step.title ?? "");
  const [note, setNote] = useState(props.step.note ?? "");
  const [checks, setChecks] = useState(() =>
    isWorkflowSkillStep(props.step) ? (props.step.checks ?? []).map(checkDraft) : [],
  );
  const focused = useRef(new Set<DraftField>());
  const checksFocused = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveChecks, setConfirmRemoveChecks] = useState(false);
  const [resourceKind, setResourceKind] = useState<WorkflowAttachmentKind | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const stepDraft = useRef<WorkflowStep>(props.step);
  const titleRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const resourcePickerRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize editor fields when the selected step definition changes.
  useEffect(() => {
    stepDraft.current = props.step;
    if (!focused.current.has("title") && document.activeElement !== titleRef.current)
      setTitle(props.step.title ?? "");
    if (!focused.current.has("note") && document.activeElement !== noteRef.current)
      setNote(props.step.note ?? "");
    if (!checksFocused.current)
      setChecks(isWorkflowSkillStep(props.step) ? (props.step.checks ?? []).map(checkDraft) : []);
  }, [props.step]);

  const put = async (patch: Partial<WorkflowStep>) => {
    const previous = stepDraft.current;
    const merged: WorkflowStep = {
      ...stepDraft.current,
      ...patch,
      id: props.step.id,
    } as WorkflowStep;
    stepDraft.current = merged;
    const result = await edit.run({
      _tag: "stepPut",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      step: merged,
    });
    if (result === null && stepDraft.current === merged) stepDraft.current = previous;
    return result;
  };
  const putSkill = (patch: Partial<WorkflowSkillStep>) => {
    if (!isWorkflowSkillStep(props.step)) return Promise.resolve(null);
    return put(patch);
  };
  const commitText = (field: DraftField, draft?: string) => {
    const value = (draft ?? (field === "title" ? title : note)).trim();
    const original = field === "title" ? (props.step.title ?? "") : (props.step.note ?? "");
    if (value === original) return;
    void put(field === "title" ? { title: value || undefined } : { note: value || undefined });
  };
  const keyCommit = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    field: DraftField,
  ) => {
    if (event.key === "Enter" && (field === "title" || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  const insertNoteToken = (token: string) => {
    const textarea = noteRef.current;
    const start = textarea?.selectionStart ?? note.length;
    const end = textarea?.selectionEnd ?? note.length;
    const next = `${note.slice(0, start)}${token}${note.slice(end)}`;
    flushSync(() => setNote(next));
    textarea?.setSelectionRange(start + token.length, start + token.length);
    commitText("note", next);
  };
  const updateCheck = (index: number, check: WorkflowStepCheck) =>
    setChecks((current) => current.map((item, i) => (i === index ? { ...item, check } : item)));
  // A half-filled check stays a local draft until it has a path or command.
  const completeChecks = (list: ReadonlyArray<WorkflowStepCheck>) =>
    list.filter((check) => (check.kind === "file" ? check.path : check.command).trim() !== "");
  const commitChecks = (list: ReadonlyArray<(typeof checks)[number]> = checks) => {
    const next = completeChecks(list.map((draft) => draft.check));
    const existing: ReadonlyArray<WorkflowStepCheck> = isWorkflowSkillStep(props.step)
      ? (props.step.checks ?? [])
      : [];
    if (JSON.stringify(next) !== JSON.stringify(existing))
      void putSkill({ checks: next.length ? next : undefined });
  };
  const removeCheckGroup = () => {
    setChecks([]);
    void putSkill({ checks: undefined });
    setConfirmRemoveChecks(false);
  };
  const deleteStep = async () => {
    const result = await edit.run({
      _tag: "stepRemove",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      stepId: props.step.id,
    });
    if (result) props.onClose();
  };

  if (!definition)
    return { available: false as const, editingSkill, setEditingSkill, environmentId };
  const dependencies = dependenciesOf(definition, props.step.id);
  const hasExplicitReads = props.step.readsFrom !== undefined;
  const availableSources = definition.steps.filter(
    (candidate) => candidate.id !== props.step.id && !dependencies.includes(candidate.id),
  );
  const stepIndex = definition.steps.findIndex((candidate) => candidate.id === props.step.id);
  const outgoingLoop = (definition.loops ?? []).find((loop) => loop.from === props.step.id) ?? null;
  const incomingLoops = (definition.loops ?? []).filter((loop) => loop.to === props.step.id);
  const loopTargets = definition.steps
    .slice(0, Math.max(0, stepIndex))
    .filter((candidate) => canLoopBack(definition, props.step.id, candidate.id));
  const putLoop = (loop: WorkflowLoop) =>
    void edit.run({
      _tag: "loopPut",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      loop,
    });
  const removeLoop = (loopId: string) =>
    void edit.run({
      _tag: "loopRemove",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      loopId,
    });

  const changeDependency = (sourceId: string) => {
    const updated = withReadsFrom(definition, props.step.id, sourceId);
    if (updated) void put({ readsFrom: updated.readsFrom });
  };
  const removeDependency = (sourceId: string) => {
    const updated = withoutReadsFrom(definition, props.step.id, sourceId);
    if (updated) void put({ readsFrom: updated.readsFrom });
  };
  const attachResource = (attachment: WorkflowAttachment) =>
    void put({ attachments: [...(props.step.attachments ?? []), attachment] });
  const removeResource = (attachmentId: string) =>
    void put({
      attachments: (props.step.attachments ?? []).filter((item) => item.id !== attachmentId),
    });
  const copyResource = (target: WorkflowStep, attachment: WorkflowAttachment) => {
    if ((target.attachments?.length ?? 0) >= MAX_WORKFLOW_STEP_ATTACHMENTS) return;
    const copy = { ...attachment, id: `copy-${randomUUID()}` } as WorkflowAttachment;
    void edit.run({
      _tag: "stepPut",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      step: { ...target, attachments: [...(target.attachments ?? []), copy] },
    });
  };
  const checkReadiness = () =>
    edit.run({
      _tag: "probe",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      stepIds: [props.step.id],
      ...(props.probeContextThreadId ? { contextThreadId: props.probeContextThreadId } : {}),
    });
  const resourcePickerContextKey = JSON.stringify([
    props.projectId,
    props.listing.workflow,
    props.step.id,
    isWorkflowSkillStep(props.step) ? (props.step.model ?? null) : null,
    isWorkflowSkillStep(props.step)
      ? (props.step.model ??
        resolveSubagentModels(definition.subagentModels ?? [], providers).usable[0] ??
        null)
      : null,
    props.probeContextThreadId ?? null,
    props.probeContextWorkspaceRoot ?? null,
    props.probeContextModelRevision ?? "",
  ]);

  return {
    available: true as const,
    props,
    threadRef,
    environmentId,
    edit,
    definition,
    connection,
    setConnection,
    title,
    setTitle,
    note,
    setNote,
    checks,
    setChecks,
    focused,
    onChecksFocus: () => {
      checksFocused.current = true;
    },
    onChecksBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        checksFocused.current = false;
    },
    newCheck: () => checkDraft({ kind: "file", path: "" }),
    confirmDelete,
    setConfirmDelete,
    confirmRemoveChecks,
    setConfirmRemoveChecks,
    resourceKind,
    setResourceKind,
    editingSkill,
    setEditingSkill,
    titleRef,
    noteRef,
    resourcePickerRef,
    put,
    putSkill,
    commitText,
    keyCommit,
    insertNoteToken,
    updateCheck,
    commitChecks,
    removeCheckGroup,
    deleteStep,
    dependencies,
    hasExplicitReads,
    availableSources,
    stepIndex,
    outgoingLoop,
    incomingLoops,
    loopTargets,
    putLoop,
    removeLoop,
    changeDependency,
    removeDependency,
    attachResource,
    removeResource,
    copyResource,
    checkReadiness,
    resourcePickerContextKey,
  };
}

export type StepEditorContext = Extract<ReturnType<typeof useStepEditor>, { available: true }>;

export function WorkflowStepEditor(props: StepEditorProps) {
  const context = useStepEditor(props);
  if (context.editingSkill)
    return (
      <WorkflowSkillEditor
        environmentId={context.environmentId}
        projectId={props.projectId}
        name={context.editingSkill}
        onClose={() => context.setEditingSkill(null)}
      />
    );
  if (!context.available)
    return (
      <div data-workflow-detail className="p-3 text-xs text-muted-foreground">
        Workflow definition is unavailable.
      </div>
    );
  const {
    threadRef,
    environmentId,
    edit,
    definition,
    connection,
    setConnection,
    title,
    setTitle,
    note,
    setNote,
    checks,
    setChecks,
    focused,
    confirmDelete,
    setConfirmDelete,
    confirmRemoveChecks,
    setConfirmRemoveChecks,
    resourceKind,
    setResourceKind,
    setEditingSkill,
    titleRef,
    noteRef,
    resourcePickerRef,
    put,
    putSkill,
    commitText,
    keyCommit,
    insertNoteToken,
    updateCheck,
    commitChecks,
    removeCheckGroup,
    deleteStep,
    dependencies,
    hasExplicitReads,
    availableSources,
    stepIndex,
    outgoingLoop,
    incomingLoops,
    loopTargets,
    putLoop,
    removeLoop,
    changeDependency,
    removeDependency,
    attachResource,
    removeResource,
    copyResource,
    checkReadiness,
    resourcePickerContextKey,
  } = context;
  return (
    <section
      data-workflow-detail
      className="space-y-3"
      aria-label={`${props.step.title ?? props.step.id} editor`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {isWorkflowSkillStep(props.step) ? "Skill step" : "Nested workflow"}
          </p>
          <div className="-mx-2.25 rounded-md text-sm font-semibold focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
            <Input
              unstyled
              size="sm"
              placeholder="Step title"
              ref={titleRef}
              aria-label="Step title"
              value={title}
              disabled={!edit.canEdit}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={() => {
                focused.current.add("title");
              }}
              onBlur={(event) => {
                focused.current.delete("title");
                commitText("title", event.currentTarget.value);
              }}
              onKeyDown={(e) => keyCommit(e, "title")}
            />
          </div>
        </div>
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Step actions" />}>
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              variant="destructive"
              disabled={!edit.canEdit || edit.busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete step
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close step editor"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div className="grid max-w-[640px] gap-6 @[1100px]:max-w-none @[1100px]:grid-cols-[minmax(0,640px)_minmax(0,640px)]">
        <StepWhat
          props={props}
          environmentId={environmentId}
          edit={edit}
          note={note}
          setNote={setNote}
          focused={focused}
          setEditingSkill={setEditingSkill}
          noteRef={noteRef}
          put={put}
          putSkill={putSkill}
          commitText={commitText}
          keyCommit={keyCommit}
          insertNoteToken={insertNoteToken}
        />
        <div className="min-w-0 space-y-3">
          <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            How
          </h4>
          <StepRun
            props={props}
            environmentId={environmentId}
            edit={edit}
            definition={definition}
            connection={connection}
            setConnection={setConnection}
            putSkill={putSkill}
            dependencies={dependencies}
            hasExplicitReads={hasExplicitReads}
            availableSources={availableSources}
            changeDependency={changeDependency}
            removeDependency={removeDependency}
          />
          {stepIndex > 0 || incomingLoops.length > 0 ? (
            <WorkflowInspectorSection label="Loop back">
              {outgoingLoop ? (
                <div className="space-y-2 text-xs">
                  <WorkflowInspectorRow label="Repeat from">
                    <Select
                      value={outgoingLoop.to}
                      disabled={!edit.canEdit}
                      onValueChange={(targetId) => {
                        if (targetId) putLoop({ ...outgoingLoop, to: targetId });
                      }}
                    >
                      <SelectTrigger size="xs" aria-label="Loop target step">
                        <SelectValue>
                          {definition.steps.find((s) => s.id === outgoingLoop.to)?.title ??
                            outgoingLoop.to}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                        {loopTargets.map((target) => (
                          <SelectItem key={target.id} value={target.id}>
                            {target.title ?? target.id}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </WorkflowInspectorRow>
                  <WorkflowInspectorRow label="Max rounds">
                    <Input
                      size="sm"
                      type="number"
                      min={1}
                      max={MAX_WORKFLOW_LOOP_ROUNDS}
                      aria-label="Loop max rounds"
                      disabled={!edit.canEdit}
                      value={outgoingLoop.maxRounds}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (
                          Number.isInteger(next) &&
                          next >= 1 &&
                          next <= MAX_WORKFLOW_LOOP_ROUNDS
                        ) {
                          putLoop({ ...outgoingLoop, maxRounds: next });
                        }
                      }}
                    />
                  </WorkflowInspectorRow>
                  <WorkflowInspectorRow label="Stop when">
                    <Select
                      value={outgoingLoop.until.kind}
                      disabled={!edit.canEdit}
                      onValueChange={(kind) => {
                        if (!kind) return;
                        const until: WorkflowLoopUntil =
                          kind === "checks-pass"
                            ? { kind: "checks-pass" }
                            : kind === "condition"
                              ? {
                                  kind: "condition",
                                  text:
                                    outgoingLoop.until.kind === "condition"
                                      ? outgoingLoop.until.text
                                      : "all acceptance criteria pass",
                                }
                              : { kind: "step-says-pass" };
                        putLoop({ ...outgoingLoop, until });
                      }}
                    >
                      <SelectTrigger size="xs" aria-label="Loop stop condition">
                        <SelectValue>
                          {outgoingLoop.until.kind === "checks-pass"
                            ? "Checks pass"
                            : outgoingLoop.until.kind === "condition"
                              ? "Condition passes"
                              : "This step says pass"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                        <SelectItem value="step-says-pass">This step says pass</SelectItem>
                        <SelectItem value="checks-pass">Checks pass</SelectItem>
                        <SelectItem value="condition">Condition passes</SelectItem>
                      </SelectPopup>
                    </Select>
                  </WorkflowInspectorRow>
                  {outgoingLoop.until.kind === "condition" ? (
                    <Input
                      size="sm"
                      aria-label="Loop condition text"
                      placeholder="e.g. score >= 8 and no critical findings"
                      disabled={!edit.canEdit}
                      defaultValue={outgoingLoop.until.text}
                      onBlur={(event) => {
                        const text = event.currentTarget.value.trim();
                        if (
                          text &&
                          outgoingLoop.until.kind === "condition" &&
                          text !== outgoingLoop.until.text
                        ) {
                          putLoop({ ...outgoingLoop, until: { kind: "condition", text } });
                        }
                      }}
                    />
                  ) : null}
                  <label className="flex max-w-[492px] items-center justify-between gap-2 py-1 text-xs">
                    <span>Send feedback to target step</span>
                    <Switch
                      aria-label="Send loop feedback to target step"
                      checked={outgoingLoop.feedback ?? true}
                      disabled={!edit.canEdit}
                      onCheckedChange={(checked) =>
                        putLoop({ ...outgoingLoop, feedback: Boolean(checked) })
                      }
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!edit.canEdit || edit.busy}
                      onClick={() => removeLoop(outgoingLoop.id)}
                    >
                      Remove loop
                    </Button>
                  </div>
                </div>
              ) : loopTargets.length > 0 ? (
                <Select
                  disabled={!edit.canEdit}
                  value={null}
                  onValueChange={(targetId) => {
                    if (!targetId) return;
                    putLoop({
                      id: uniqueLoopId(definition, props.step.id, targetId),
                      from: props.step.id,
                      to: targetId,
                      maxRounds: 2,
                      until: { kind: "step-says-pass" },
                      feedback: true,
                    });
                  }}
                >
                  <SelectTrigger size="xs" aria-label="Loop back to earlier step">
                    <SelectValue placeholder="+ Loop back to earlier step…" />
                  </SelectTrigger>
                  <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                    {loopTargets.map((target) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.title ?? target.id}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
              {incomingLoops.map((loop) => (
                <div
                  key={loop.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 text-2xs"
                >
                  <span className="truncate">
                    ↺ Loops from{" "}
                    {definition.steps.find((s) => s.id === loop.from)?.title ?? loop.from} (up to{" "}
                    {loop.maxRounds}×)
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-tiny"
                    aria-label={`Remove loop ${loop.id}`}
                    disabled={!edit.canEdit || edit.busy}
                    onClick={() => removeLoop(loop.id)}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
            </WorkflowInspectorSection>
          ) : null}
          <StepPauses step={props.step} disabled={!edit.canEdit} onChange={put}>
            <StepWait
              environmentId={environmentId}
              projectId={props.projectId}
              workflow={props.listing.workflow}
              value={props.step.waitBefore}
              disabled={!edit.canEdit}
              onChange={(waitBefore) => void put({ waitBefore })}
            />
          </StepPauses>
          <StepNeeds
            props={props}
            environmentId={environmentId}
            edit={edit}
            definition={definition}
            resourceKind={resourceKind}
            setResourceKind={setResourceKind}
            resourcePickerRef={resourcePickerRef}
            attachResource={attachResource}
            removeResource={removeResource}
            copyResource={copyResource}
            checkReadiness={checkReadiness}
            resourcePickerContextKey={resourcePickerContextKey}
          />
          <StepChecks
            props={props}
            edit={edit}
            checks={checks}
            setChecks={setChecks}
            newCheck={context.newCheck}
            onChecksFocus={context.onChecksFocus}
            onChecksBlur={context.onChecksBlur}
            setConfirmRemoveChecks={setConfirmRemoveChecks}
            updateCheck={updateCheck}
            commitChecks={commitChecks}
            removeCheckGroup={removeCheckGroup}
          />
        </div>
      </div>
      {props.lastRunState ? <LastRun state={props.lastRunState} threadRef={threadRef} /> : null}
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
      <div className="flex justify-end">
        <Button
          variant="ghost-destructive"
          size="xs"
          disabled={!edit.canEdit || edit.busy}
          onClick={() => setConfirmDelete(true)}
        >
          Delete step
        </Button>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{props.step.title ?? props.step.id}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {definition
                ? workflowStepRemovalSummary(definition, props.step.id)
                : "This step will be removed from the saved workflow."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={!edit.canEdit || edit.busy}
              onClick={() => void deleteStep()}
            >
              {edit.busy ? "Deleting…" : "Delete step"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <AlertDialog open={confirmRemoveChecks} onOpenChange={setConfirmRemoveChecks}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all {checks.length} checks?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the Check card and clears the configured checks from this Skill.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={!edit.canEdit || edit.busy}
              onClick={removeCheckGroup}
            >
              Remove checks
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}

function LastRun({ state, threadRef }: { state: WorkflowStepRun; threadRef: ScopedThreadRef }) {
  return (
    <section className="space-y-1 border-t pt-3" aria-label="Last run">
      <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Last run · {state.status}
      </h4>
      {state.summary ? (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{state.summary}</p>
      ) : null}
      {state.outputs && Object.keys(state.outputs).length ? (
        <WorkflowOutputDetails
          threadRef={threadRef}
          {...(state.threadId ? { resourceThreadId: state.threadId } : {})}
          outputs={state.outputs}
          {...(state.outputPreviews ? { previews: state.outputPreviews } : {})}
        />
      ) : null}
      {state.error ? (
        <p className="flex gap-1 text-xs text-destructive">
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
