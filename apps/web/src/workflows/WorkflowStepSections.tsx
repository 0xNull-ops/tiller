import { useWorkflowSchedules } from "./useWorkflowSchedules";
import { workflowScheduleBinding } from "@t3tools/contracts";
import { WaitControl } from "./WaitControl";
import { Popover, PopoverTrigger, PopoverPopup } from "../components/ui/popover";
import type { StepEditorContext } from "./WorkflowStepEditor";
import type { WorkflowStep } from "@t3tools/contracts";
import { MAX_WORKFLOW_STEP_ATTACHMENTS, MAX_WORKFLOW_STEP_CHECKS } from "@t3tools/contracts";
import { EllipsisIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "../components/ui/menu";
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
import { Textarea } from "../components/ui/textarea";
import { isWorkflowSkillStep } from "./workflowStep";
import { WorkflowModelField } from "./WorkflowModelField";
import { WorkflowNestedStepFields } from "./WorkflowNestedStepFields";
import { WorkflowSkillSection } from "./WorkflowSkillSection";
import { WorkflowAttachmentAddForm } from "./WorkflowAttachmentAddForm";
import { WorkflowInsertValueMenu } from "./WorkflowInsertValueMenu";
import { attachmentLabel, readinessDisplay } from "./WorkflowResourceCard";
import { credentialEnvVarSummary } from "./workflowCredentialAttachments";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";

export function StepWhat({
  props,
  environmentId,
  edit,
  note,
  setNote,
  focused,
  setEditingSkill,
  noteRef,
  put,
  putSkill,
  commitText,
  keyCommit,
  insertNoteToken,
}: Pick<
  StepEditorContext,
  | "props"
  | "environmentId"
  | "edit"
  | "note"
  | "setNote"
  | "focused"
  | "setEditingSkill"
  | "noteRef"
  | "put"
  | "putSkill"
  | "commitText"
  | "keyCommit"
  | "insertNoteToken"
>) {
  const schedules = useWorkflowSchedules(environmentId, props.projectId, props.listing.workflow);
  const carryOverResult = schedules.tasks.some(
    (task) => workflowScheduleBinding(task)?.carryOver === true,
  );
  return (
    <div className="min-w-0 space-y-3">
      <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">What</h4>
      {isWorkflowSkillStep(props.step) ? (
        <WorkflowSkillSection
          environmentId={environmentId}
          projectId={props.projectId}
          listing={props.listing}
          step={props.step}
          onChangeSkill={(name) => void putSkill({ skill: name })}
          onOpenEditor={setEditingSkill}
        />
      ) : (
        <WorkflowNestedStepFields
          environmentId={environmentId}
          projectId={props.projectId}
          workflow={props.listing.workflow}
          parentInputs={props.listing.definition?.inputs ?? []}
          step={props.step}
          onChange={async (patch) => (await put(patch)) !== null}
          disabled={!edit.canEdit || edit.busy}
          onOpenWorkflow={props.onOpenWorkflow}
        />
      )}
      <div className="grid grid-cols-[120px_minmax(0,360px)] items-start gap-3 text-xs font-medium">
        <span className="flex items-center gap-1 pt-1 text-muted-foreground">
          Note
          <WorkflowInsertValueMenu
            values={[
              ...(props.listing.definition?.inputs ?? []).map((input) => ({
                token: `{{input.${input.id}}}`,
                label: input.label,
              })),
              ...(carryOverResult
                ? [{ token: "{{last.result}}", label: "Last scheduled result" }]
                : []),
            ]}
            onInsert={insertNoteToken}
            disabled={!edit.canEdit}
            returnFocus={noteRef}
          />
        </span>
        <Textarea
          ref={noteRef}
          aria-label="Step note"
          size="sm"
          placeholder="Instruction for this step, on top of the skill"
          value={note}
          disabled={!edit.canEdit}
          onChange={(event) => setNote(event.target.value)}
          onFocus={() => {
            focused.current.add("note");
          }}
          onBlur={(event) => {
            focused.current.delete("note");
            commitText("note", event.currentTarget.value);
          }}
          onKeyDown={(e) => keyCommit(e, "note")}
        />
      </div>
    </div>
  );
}

export function StepRun({
  props,
  environmentId,
  edit,
  definition,
  connection,
  setConnection,
  putSkill,
  dependencies,
  hasExplicitReads,
  availableSources,
  changeDependency,
  removeDependency,
}: Pick<
  StepEditorContext,
  | "props"
  | "environmentId"
  | "edit"
  | "definition"
  | "connection"
  | "setConnection"
  | "putSkill"
  | "dependencies"
  | "hasExplicitReads"
  | "availableSources"
  | "changeDependency"
  | "removeDependency"
>) {
  return (
    <WorkflowInspectorSection label="Run">
      {isWorkflowSkillStep(props.step) ? (
        <>
          <WorkflowInspectorRow label="Runs in">
            <Select
              value={props.step.delegation ?? "default"}
              disabled={!edit.canEdit}
              onValueChange={(value) =>
                void putSkill({
                  delegation: value === "default" ? undefined : (value as "subagent" | "self"),
                })
              }
            >
              <SelectTrigger size="xs" variant="ghost" aria-label="Run this step">
                <SelectValue>
                  {props.step.delegation === "subagent"
                    ? "Subagent"
                    : props.step.delegation === "self"
                      ? "In the chat thread"
                      : "Workflow default"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                <SelectItem value="default">Workflow default</SelectItem>
                <SelectItem value="subagent">Subagent</SelectItem>
                <SelectItem value="self">In the chat thread</SelectItem>
              </SelectPopup>
            </Select>
          </WorkflowInspectorRow>
          <WorkflowInspectorRow label="Model">
            <WorkflowModelField
              environmentId={environmentId}
              projectId={props.projectId}
              value={props.step.model}
              resetLabel="Workflow’s subagent models"
              disabled={!edit.canEdit}
              onChange={(model) => void putSkill({ model })}
              onReset={() => void putSkill({ model: undefined })}
            />
            <span className="block text-2xs font-normal text-muted-foreground">
              Overrides the workflow’s subagent models.
            </span>
          </WorkflowInspectorRow>
        </>
      ) : null}
      <WorkflowInspectorRow label="Reads from">
        <section className="space-y-1" aria-label="Reads from">
          <div className="flex flex-wrap items-center gap-1.5">
            {dependencies.map((id) => (
              <span
                key={id}
                onPointerEnter={() => setConnection({ source: id, target: props.step.id })}
                onPointerLeave={() => setConnection(null)}
                style={
                  connection?.source === id && connection.target === props.step.id
                    ? { outline: "1px solid var(--primary)" }
                    : undefined
                }
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-1 text-2xs"
              >
                {definition.steps.find((candidate) => candidate.id === id)?.title ?? id}
                <Button
                  variant="ghost"
                  size="icon-tiny"
                  aria-label={`Remove dependency ${id}`}
                  disabled={!edit.canEdit}
                  onClick={() => removeDependency(id)}
                >
                  <XIcon />
                </Button>
              </span>
            ))}
            {availableSources.length > 0 ? (
              <Select
                disabled={!edit.canEdit}
                value={null}
                onValueChange={(value) => {
                  if (value) changeDependency(value);
                }}
              >
                <SelectTrigger size="xs" aria-label="Add dependency">
                  <SelectValue placeholder="+ add" />
                </SelectTrigger>
                <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                  {availableSources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.title ?? source.id}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
          </div>
          {!hasExplicitReads ? (
            <p className="text-2xs text-muted-foreground">Default: the step before it</p>
          ) : null}
        </section>
      </WorkflowInspectorRow>
    </WorkflowInspectorSection>
  );
}

export function StepNeeds({
  props,
  environmentId,
  edit,
  definition,
  resourceKind,
  setResourceKind,
  resourcePickerRef,
  attachResource,
  removeResource,
  copyResource,
  checkReadiness,
  resourcePickerContextKey,
}: Pick<
  StepEditorContext,
  | "props"
  | "environmentId"
  | "edit"
  | "definition"
  | "resourceKind"
  | "setResourceKind"
  | "resourcePickerRef"
  | "attachResource"
  | "removeResource"
  | "copyResource"
  | "checkReadiness"
  | "resourcePickerContextKey"
>) {
  return (
    <WorkflowInspectorSection
      label="Needs"
      aria-label="Resources"
      count={props.step.attachments?.length ?? 0}
      hint={
        (props.step.attachments?.length ?? 0) === 0
          ? "None. Steps run as soon as they’re ready."
          : undefined
      }
      action={
        <div className="flex items-center gap-1">
          {(props.step.attachments?.length ?? 0) > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={!edit.canEdit || edit.busy}
              onClick={() => void checkReadiness()}
            >
              Check readiness
            </Button>
          ) : null}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label="Add resource"
                  disabled={
                    !edit.canEdit ||
                    edit.busy ||
                    (props.step.attachments?.length ?? 0) >= MAX_WORKFLOW_STEP_ATTACHMENTS
                  }
                />
              }
            >
              <PlusIcon /> Add
            </MenuTrigger>
            <MenuPopup align="end">
              {(
                [
                  ["requirement", "Requirement"],
                  ["service-login", "Service login"],
                  ["mcp-connection", "MCP connection"],
                ] as const
              ).map(([kind, label]) => (
                <MenuItem key={kind} onClick={() => setResourceKind(kind)}>
                  {label}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </div>
      }
    >
      {(props.step.attachments ?? []).map((attachment) => {
        const readiness = props.listing.readiness?.entries.find(
          (entry) => entry.stepId === props.step.id && entry.attachmentId === attachment.id,
        );
        const status = readiness?.status ?? "unknown";
        const credential = attachment.kind === "credential" ? readiness?.credential : undefined;
        return (
          <div key={attachment.id} className="flex min-w-0 items-center gap-2 py-1 text-xs">
            <span
              aria-hidden="true"
              className={
                credential
                  ? credential.state === "ready" || credential.state === "matched"
                    ? "size-1.5 shrink-0 rounded-full bg-success"
                    : credential.state === "expiring" || credential.state === "choose"
                      ? "size-1.5 shrink-0 rounded-full bg-warning"
                      : "size-1.5 shrink-0 rounded-full bg-destructive"
                  : status === "available"
                    ? "size-1.5 shrink-0 rounded-full bg-success"
                    : status === "missing" || status === "error"
                      ? "size-1.5 shrink-0 rounded-full bg-destructive"
                      : "size-1.5 shrink-0 rounded-full bg-muted-foreground"
              }
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {attachmentLabel(attachment)}
            </span>
            <span className="min-w-0 truncate text-2xs text-muted-foreground">
              {credential ? (
                <>
                  {credential.statusLabel}
                  {credential.envVars.length > 0
                    ? ` · ${credentialEnvVarSummary(credential.envVars)}`
                    : ""}
                  {credential.optional ? " · optional" : ""}
                  {credential.name ? ` · ${credential.name}` : ""}
                </>
              ) : (
                <>
                  {readinessDisplay(attachment, status)}
                  {readiness?.stale ? " · stale" : ""}
                  {readiness?.message ? ` · ${readiness.message}` : " · Not checked"}
                </>
              )}
            </span>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${attachmentLabel(attachment)} actions`}
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  disabled={!edit.canEdit || edit.busy}
                  onClick={() => removeResource(attachment.id)}
                >
                  Detach
                </MenuItem>
                {definition.steps.some((target) => target.id !== props.step.id) ? (
                  <MenuSub>
                    <MenuSubTrigger
                      aria-label={`Copy ${attachmentLabel(attachment)} to step`}
                      disabled={!edit.canEdit || edit.busy}
                    >
                      Copy to step
                    </MenuSubTrigger>
                    <MenuSubPopup>
                      {definition.steps
                        .filter((target) => target.id !== props.step.id)
                        .map((target) => (
                          <MenuItem
                            key={target.id}
                            disabled={
                              (target.attachments?.length ?? 0) >= MAX_WORKFLOW_STEP_ATTACHMENTS
                            }
                            onClick={() => copyResource(target, attachment)}
                          >
                            {target.title ?? target.id}
                          </MenuItem>
                        ))}
                    </MenuSubPopup>
                  </MenuSub>
                ) : null}
              </MenuPopup>
            </Menu>
          </div>
        );
      })}
      {resourceKind ? (
        <div className="space-y-2 rounded-md bg-muted/30 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">
              {resourceKind === "requirement"
                ? "Requirement"
                : resourceKind === "service-login"
                  ? "Service login"
                  : "MCP connection"}
            </span>
            <Button variant="ghost" size="xs" onClick={() => setResourceKind(null)}>
              Cancel
            </Button>
          </div>
          <WorkflowAttachmentAddForm
            key={`${resourcePickerContextKey}:${resourceKind}`}
            count={props.step.attachments?.length ?? 0}
            disabled={!edit.canEdit || edit.busy}
            typePickerRef={resourcePickerRef}
            selectedKind={resourceKind}
            hideTypePicker
            onAdd={attachResource}
            environmentId={environmentId}
            listing={props.listing}
            stepId={props.step.id}
            {...(props.probeContextThreadId ? { contextThreadId: props.probeContextThreadId } : {})}
            workspaceRoot={props.probeContextWorkspaceRoot}
            modelRevision={props.probeContextModelRevision}
          />
        </div>
      ) : null}
      {(props.step.attachments?.length ?? 0) >= MAX_WORKFLOW_STEP_ATTACHMENTS ? (
        <p className="text-2xs text-muted-foreground">
          This step already has the maximum of {MAX_WORKFLOW_STEP_ATTACHMENTS} resources.
        </p>
      ) : null}
    </WorkflowInspectorSection>
  );
}

export function StepChecks({
  props,
  edit,
  checks,
  setChecks,
  newCheck,
  onChecksFocus,
  onChecksBlur,
  setConfirmRemoveChecks,
  updateCheck,
  commitChecks,
  removeCheckGroup,
}: Pick<
  StepEditorContext,
  | "props"
  | "edit"
  | "checks"
  | "setChecks"
  | "newCheck"
  | "onChecksFocus"
  | "onChecksBlur"
  | "setConfirmRemoveChecks"
  | "updateCheck"
  | "commitChecks"
  | "removeCheckGroup"
>) {
  return (
    <section
      className="space-y-2 border-t pt-3"
      aria-label="Checks"
      onFocusCapture={onChecksFocus}
      onBlurCapture={onChecksBlur}
    >
      {!isWorkflowSkillStep(props.step) ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Checks · {checks.length}
            </h4>
            {checks.length === 0 ? (
              <span className="text-2xs text-muted-foreground">
                No checks. A failure won’t block the run.
              </span>
            ) : null}
            <div className="flex gap-1.5">
              {checks.length > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!edit.canEdit || edit.busy}
                  onClick={() =>
                    checks.length > 1 ? setConfirmRemoveChecks(true) : removeCheckGroup()
                  }
                >
                  Remove checks
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="xs"
                aria-label="Add check"
                disabled={!edit.canEdit || checks.length >= MAX_WORKFLOW_STEP_CHECKS}
                onClick={() => setChecks((current) => [...current, newCheck()])}
              >
                <PlusIcon /> Add
              </Button>
            </div>
          </div>
          {checks.map(({ id, check }, index) => (
            <div key={id} className="flex items-center gap-2 py-1">
              <Select
                value={check.kind}
                disabled={!edit.canEdit}
                onValueChange={(kind) =>
                  updateCheck(
                    index,
                    kind === "file" ? { kind: "file", path: "" } : { kind: "command", command: "" },
                  )
                }
              >
                <SelectTrigger size="xs" aria-label={`Check type ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                  <SelectItem value="file">File</SelectItem>
                  <SelectItem value="command">Command</SelectItem>
                </SelectPopup>
              </Select>
              {check.kind === "file" ? (
                <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
                  <div className="col-span-2 min-w-0">
                    <Input
                      size="sm"
                      aria-label={`Check file path ${index + 1}`}
                      placeholder="Project-relative path"
                      value={check.path}
                      disabled={!edit.canEdit}
                      onChange={(e) => updateCheck(index, { ...check, path: e.target.value })}
                      onBlur={() => commitChecks()}
                    />
                  </div>
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    aria-label={`Minimum bytes ${index + 1}`}
                    placeholder="Min bytes"
                    value={check.minBytes ?? ""}
                    disabled={!edit.canEdit}
                    onChange={(e) =>
                      updateCheck(index, {
                        ...check,
                        minBytes: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    onBlur={() => commitChecks()}
                  />
                </div>
              ) : (
                <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
                  <div className="col-span-2 min-w-0">
                    <Input
                      size="sm"
                      aria-label={`Check command ${index + 1}`}
                      placeholder="Command"
                      value={check.command}
                      disabled={!edit.canEdit}
                      onChange={(e) => updateCheck(index, { ...check, command: e.target.value })}
                      onBlur={() => commitChecks()}
                    />
                  </div>
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    aria-label={`Timeout seconds ${index + 1}`}
                    placeholder="Timeout s"
                    value={check.timeoutSec ?? ""}
                    disabled={!edit.canEdit}
                    onChange={(e) =>
                      updateCheck(index, {
                        ...check,
                        timeoutSec: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    onBlur={() => commitChecks()}
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove check ${index + 1}`}
                disabled={!edit.canEdit}
                onClick={() => {
                  const next = checks.filter((_, i) => i !== index);
                  setChecks(next);
                  commitChecks(next);
                }}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

export function StepPauses({
  step,
  disabled,
  onChange,
  children,
}: {
  step: WorkflowStep;
  disabled: boolean;
  onChange: (patch: Partial<WorkflowStep>) => unknown;
  children: React.ReactNode;
}) {
  return (
    <WorkflowInspectorSection label="Pauses">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <Switch
            aria-label="Wait for approval before this step"
            checked={step.gate ?? false}
            disabled={disabled}
            onCheckedChange={(checked) => void onChange({ gate: Boolean(checked) })}
          />
          Approve before
        </label>
        <label className="flex items-center gap-1.5">
          <Switch
            aria-label="Wait for me after this step"
            checked={step.pauseAfter ?? false}
            disabled={disabled}
            onCheckedChange={(checked) => void onChange({ pauseAfter: Boolean(checked) })}
          />
          Review after
        </label>
        {children}
      </div>
    </WorkflowInspectorSection>
  );
}

export function StepWait({
  environmentId,
  projectId,
  workflow,
  ...props
}: React.ComponentProps<typeof WaitControl> & {
  environmentId: StepEditorContext["environmentId"];
  projectId: StepEditorContext["props"]["projectId"];
  workflow: string;
}) {
  const { tasks } = useWorkflowSchedules(environmentId, projectId, workflow);
  const timeZone = tasks
    .map(workflowScheduleBinding)
    .find((binding) => binding?.timeZone)?.timeZone;
  const label =
    props.value?.kind === "delay"
      ? `${props.value.minutes} min`
      : props.value?.kind === "until"
        ? props.value.timeOfDay
        : "None";
  return (
    <Popover>
      <PopoverTrigger render={<Button size="xs" variant="outline" />}>Wait: {label}</PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="start">
        <WaitControl {...props} timeZone={timeZone} />
      </PopoverPopup>
    </Popover>
  );
}
