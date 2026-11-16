import { WorkflowScheduleSheet } from "./WorkflowScheduleSheet";
import { minuteTick } from "@t3tools/client-runtime/clock";
import { useSyncExternalStore } from "react";
import { useAtomValue } from "@effect/atom-react";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironmentQuery } from "../state/query";
import { lazy, Suspense, useState } from "react";
import {
  CREDENTIAL_APPROVALS_WARNING,
  workflowScheduleBinding,
  workflowScheduleNextRuns,
  type WorkflowRun,
  type WorkflowScheduleKnobs,
  type EnvironmentId,
  type ProjectId,
  type ScheduledTaskId,
  type ScheduledTask,
  type ScheduledTaskUpsertSchedule,
  type ThreadId,
  type WorkflowListing,
  type WorkflowSuggestedSchedule,
} from "@t3tools/contracts";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useEnvironmentHttpBaseUrl } from "../state/environments";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { useWorkflowSchedules } from "./useWorkflowSchedules";
import { useWorkflowEdit } from "./workflowState";
import { PreApproveCredentialsButton } from "./WorkflowCredentialApprovals";
import { credentialAttachmentsOf } from "./workflowCredentialAttachments";

const WorkflowTaskEditor = lazy(() =>
  import("../components/settings/ScheduledTasksSettings").then((module) => ({
    default: module.ScheduledTaskEditorDialog,
  })),
);

export const WORKFLOW_SCHEDULE_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const when = (value: string) => new Date(value).toLocaleString();

function scheduleText(task: ScheduledTask) {
  if (task.schedule.type === "webhook") return "Webhook";
  if (task.schedule.type === "interval") return `Every ${task.schedule.everyMs / 86_400_000} days`;
  if (task.schedule.type === "once") return `Once at ${when(task.schedule.runAt)}`;
  return `${(task.schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).map((day) => WORKFLOW_SCHEDULE_WEEKDAYS[day]).join(", ")} at ${task.schedule.timeOfDay}`;
}

export function WorkflowSchedulePanel(props: {
  readonly suggestedSchedule?: WorkflowSuggestedSchedule | undefined;
  readonly runs?: ReadonlyArray<WorkflowRun>;
  readonly onOpenRun?: (runId: string) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: WorkflowListing;
  readonly driverThreadId: ThreadId | null;
  readonly driverThreads?: ReadonlyArray<{ readonly id: ThreadId; readonly title: string }>;
  readonly onClose: () => void;
}) {
  const { tasks, isPending, error } = useWorkflowSchedules(
    props.environmentId,
    props.projectId,
    props.workflow.workflow,
  );
  const edit = useWorkflowEdit(props.environmentId);
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "Run workflow schedule",
  });
  const rotateToken = useAtomCommand(serverEnvironment.rotateScheduledTaskWebhookToken, {
    label: "Rotate workflow webhook",
  });
  const canRunNow = useAtomValue(
    serverEnvironment.runScheduledTaskNow.permissionAtom(props.environmentId),
  );
  const canRotate = useAtomValue(
    serverEnvironment.rotateScheduledTaskWebhookToken.permissionAtom(props.environmentId),
  );
  const [afterWorkflow, setAfterWorkflow] = useState("");
  const [afterWhen, setAfterWhen] = useState<"succeeded" | "finished">("succeeded");
  const httpBaseUrl = useEnvironmentHttpBaseUrl(props.environmentId);
  const [pickedDriverThreadId, setPickedDriverThreadId] = useState<ThreadId | null>(
    props.driverThreads?.[0]?.id ?? null,
  );
  const effectiveDriverThreadId =
    props.driverThreadId ?? pickedDriverThreadId ?? props.driverThreads?.[0]?.id ?? null;
  const [testBody, setTestBody] = useState("{}");
  const [testOutcome, setTestOutcome] = useState<string | null>(null);
  const [advancedTask, setAdvancedTask] = useState<ScheduledTask | null>(null);
  const [editingId, setEditingId] = useState<ScheduledTaskId | null>(null);
  const [kind, setKind] = useState<"interval" | "weekly" | "webhook">(
    props.suggestedSchedule?.schedule.type === "fixed_time"
      ? "weekly"
      : props.suggestedSchedule?.schedule.type === "webhook"
        ? "webhook"
        : "interval",
  );
  const [days, setDays] = useState(
    props.suggestedSchedule?.schedule.type === "interval"
      ? String(props.suggestedSchedule.schedule.everyMs / 86_400_000)
      : "30",
  );
  const [unit, setUnit] = useState(86_400_000);
  const [knobs, setKnobs] = useState<WorkflowScheduleKnobs>(
    props.suggestedSchedule?.knobs ?? { overlap: "skip" },
  );
  const [rotateDraft, setRotateDraft] = useState(
    props.suggestedSchedule?.knobs.rotate?.values.join("\n") ?? "",
  );
  const [time, setTime] = useState(
    props.suggestedSchedule?.schedule.type === "fixed_time"
      ? props.suggestedSchedule.schedule.timeOfDay
      : "09:00",
  );
  const [weekdays, setWeekdays] = useState<ReadonlyArray<number>>(
    props.suggestedSchedule?.schedule.type === "fixed_time"
      ? (props.suggestedSchedule.schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6])
      : [1],
  );
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const previewNow = useSyncExternalStore(
    minuteTick.subscribe,
    minuteTick.getSnapshot,
    minuteTick.getSnapshot,
  );
  const fields = props.workflow.definition?.inputs ?? [];
  const target = { projectId: props.projectId, workflow: props.workflow.workflow };
  const warnings = props.workflow.readiness?.warnings ?? [];
  const credentialApprovals = props.workflow.definition?.credentialApprovals ?? "once-per-run";
  const hasCredentialAttachments = (props.workflow.definition?.steps ?? []).some(
    (step) => credentialAttachmentsOf(step).length > 0,
  );
  const parseRotateValues = (raw: string) =>
    raw
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  const rotatePreviewValues = knobs.rotate ? parseRotateValues(rotateDraft) : [];

  const add = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!effectiveDriverThreadId || !edit.canEdit || edit.busy) return;
    const schedule: ScheduledTaskUpsertSchedule =
      kind === "interval"
        ? { type: "interval", everyMs: Number(days) * unit }
        : kind === "weekly"
          ? { type: "fixed_time", timeOfDay: time, weekdays }
          : { type: "webhook" };
    const submittedKnobs: WorkflowScheduleKnobs =
      knobs.rotate === undefined
        ? knobs
        : rotatePreviewValues.length > 0
          ? {
              ...knobs,
              rotate: {
                ...knobs.rotate,
                values: rotatePreviewValues,
              },
            }
          : (() => {
              const { rotate: _rotate, ...rest } = knobs;
              return rest;
            })();
    await edit.run({
      _tag: "scheduleAdd",
      ...(editingId === null ? {} : { id: editingId }),
      ...target,
      driverThreadId: effectiveDriverThreadId,
      schedule,
      inputs,
      knobs: submittedKnobs,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <WorkflowScheduleSheet>
        <DialogHeader>
          <DialogTitle>Workflow schedules</DialogTitle>
          <DialogDescription>
            {props.workflow.definition?.name ?? props.workflow.workflow}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {warnings.length > 0 ||
            (hasCredentialAttachments && credentialApprovals !== "pre-approved") ? (
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <p className="text-xs font-medium">Scheduled runs need your attention</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {(warnings.length > 0 ? warnings : [CREDENTIAL_APPROVALS_WARNING]).map(
                    (warning) => (
                      <li key={warning}>{warning}</li>
                    ),
                  )}
                </ul>
                {hasCredentialAttachments ? (
                  <PreApproveCredentialsButton
                    environmentId={props.environmentId}
                    projectId={props.projectId}
                    workflow={props.workflow.workflow}
                    preApproved={credentialApprovals === "pre-approved"}
                  />
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                Couldn’t load schedules.
              </p>
            ) : null}
            {isPending ? <p className="text-xs text-muted-foreground">Loading schedules…</p> : null}
            {!isPending && !error && tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No schedules yet.</p>
            ) : null}
            <section className="space-y-2 text-xs">
              <h3>After workflow</h3>
              {(props.workflow.definition?.startAfter ?? []).map((trigger) => (
                <div key={trigger.workflow} className="flex items-center gap-2">
                  <span>
                    After {trigger.workflow} · {trigger.when}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!edit.canEdit || edit.busy}
                    onClick={() =>
                      void edit.run({
                        _tag: "triggerSet",
                        ...target,
                        afterWorkflow: trigger.workflow,
                        when: trigger.when,
                        enabled: trigger.enabled === false,
                      })
                    }
                  >
                    {trigger.enabled === false ? "Enable" : "Disable"}
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={!edit.canEdit || edit.busy}
                    onClick={() =>
                      void edit.run({
                        _tag: "triggerSet",
                        ...target,
                        afterWorkflow: trigger.workflow,
                        when: null,
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Input
                aria-label="After workflow slug"
                value={afterWorkflow}
                onChange={(event) => setAfterWorkflow(event.target.value)}
                placeholder="workflow-slug"
              />
              <select
                aria-label="After workflow outcome"
                value={afterWhen}
                onChange={(event) => setAfterWhen(event.target.value as "succeeded" | "finished")}
              >
                <option value="succeeded">Succeeded</option>
                <option value="finished">Finished</option>
              </select>
              <Button
                size="xs"
                variant="outline"
                disabled={
                  !edit.canEdit || edit.busy || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(afterWorkflow)
                }
                onClick={() =>
                  void edit.run({ _tag: "triggerSet", ...target, afterWorkflow, when: afterWhen })
                }
              >
                Add after-workflow trigger
              </Button>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section>
                {" "}
                {effectiveDriverThreadId === null ? (
                  <p className="text-xs text-muted-foreground">
                    {props.driverThreads
                      ? "Start a chat in this project before adding a schedule."
                      : "Send the first message in this chat before adding a schedule."}
                  </p>
                ) : (
                  <form className="space-y-3 border-t pt-3" onSubmit={(event) => void add(event)}>
                    <h3 className="text-sm font-medium">
                      {editingId ? "Edit schedule" : "Add schedule"}
                    </h3>
                    {editingId ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel editing
                      </Button>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Every hour",
                        "Every day 09:00",
                        "Weekdays 09:00",
                        "Every Monday",
                        "Every 15 minutes",
                        "Custom",
                      ].map((preset, index) => (
                        <Button
                          key={preset}
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            if (index === 0 || index === 4) {
                              setKind("interval");
                              setUnit(60_000);
                              setDays(index === 0 ? "60" : "15");
                            } else if (index < 4) {
                              setKind("weekly");
                              setTime("09:00");
                              setWeekdays(
                                index === 1
                                  ? [0, 1, 2, 3, 4, 5, 6]
                                  : index === 2
                                    ? [1, 2, 3, 4, 5]
                                    : [1],
                              );
                            }
                          }}
                        >
                          {preset}
                        </Button>
                      ))}
                    </div>
                    {props.driverThreadId === null &&
                    props.driverThreads &&
                    props.driverThreads.length > 0 ? (
                      <label className="block space-y-1 text-xs">
                        Driving chat
                        <Select
                          value={effectiveDriverThreadId}
                          onValueChange={(value) => {
                            if (value) setPickedDriverThreadId(value as ThreadId);
                          }}
                        >
                          <SelectTrigger aria-label="Schedule driving chat">
                            <SelectValue>
                              {props.driverThreads.find((t) => t.id === effectiveDriverThreadId)
                                ?.title ?? "Untitled chat"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                            {props.driverThreads.map((thread) => (
                              <SelectItem key={thread.id} value={thread.id}>
                                {thread.title}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </label>
                    ) : null}
                    <label className="block space-y-1 text-xs">
                      Repeat
                      <Select
                        value={kind}
                        onValueChange={(value) => {
                          if (value) setKind(value);
                        }}
                      >
                        <SelectTrigger aria-label="Schedule frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                          <SelectItem value="interval">Every N days</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="webhook">Webhook</SelectItem>
                        </SelectPopup>
                      </Select>
                    </label>
                    {kind === "interval" ? (
                      <label className="block space-y-1 text-xs">
                        Every
                        <Input
                          aria-label="Interval in days"
                          type="number"
                          min={unit === 60_000 ? 1 : 1}
                          step={1}
                          required
                          value={days}
                          onChange={(event) => setDays(event.target.value)}
                        />
                        <select
                          aria-label="Interval unit"
                          value={unit}
                          onChange={(event) => setUnit(Number(event.target.value))}
                        >
                          <option value={60000}>minutes</option>
                          <option value={3600000}>hours</option>
                          <option value={86400000}>days</option>
                        </select>
                      </label>
                    ) : null}
                    {kind === "weekly" ? (
                      <div className="space-y-2">
                        <fieldset className="flex flex-wrap gap-2">
                          <legend className="mb-1 text-xs">Days</legend>
                          {WORKFLOW_SCHEDULE_WEEKDAYS.map((label, day) => (
                            <label key={label} className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={weekdays.includes(day)}
                                onChange={(event) =>
                                  setWeekdays(
                                    event.target.checked
                                      ? [...weekdays, day].toSorted()
                                      : weekdays.filter((entry) => entry !== day),
                                  )
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </fieldset>
                        <label className="block space-y-1 text-xs">
                          Time
                          <Input
                            aria-label="Schedule time"
                            type="time"
                            required
                            value={time}
                            onChange={(event) => setTime(event.target.value)}
                          />
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Weekly times use the server’s local time.
                        </p>
                      </div>
                    ) : null}
                    <details>
                      <summary className="text-xs">More knobs</summary>
                      <div className="space-y-2 py-2 text-xs">
                        <label>
                          Only between{" "}
                          <Input
                            type="time"
                            value={knobs.window?.from ?? ""}
                            onChange={(event) =>
                              setKnobs({
                                ...knobs,
                                window: {
                                  from: event.target.value,
                                  to: knobs.window?.to ?? "18:00",
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          and{" "}
                          <Input
                            type="time"
                            value={knobs.window?.to ?? ""}
                            onChange={(event) =>
                              setKnobs({
                                ...knobs,
                                window: {
                                  from: knobs.window?.from ?? "09:00",
                                  to: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Ends after runs{" "}
                          <Input
                            type="number"
                            min={1}
                            value={knobs.ends?.afterRuns ?? ""}
                            onChange={(event) =>
                              setKnobs({
                                ...knobs,
                                ends: event.target.value
                                  ? { afterRuns: Number(event.target.value) }
                                  : {},
                              })
                            }
                          />
                        </label>
                        <label>
                          Ends on{" "}
                          <Input
                            type="date"
                            value={knobs.ends?.at?.slice(0, 10) ?? ""}
                            onChange={(event) =>
                              setKnobs({
                                ...knobs,
                                ends: {
                                  ...knobs.ends,
                                  at: event.target.value
                                    ? `${event.target.value}T23:59:59.999Z`
                                    : undefined,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          When still running{" "}
                          <select
                            value={knobs.overlap ?? "skip"}
                            onChange={(event) =>
                              setKnobs({
                                ...knobs,
                                overlap: event.target.value as "skip" | "queue" | "start",
                              })
                            }
                          >
                            <option value="skip">Skip</option>
                            <option value="queue">Queue one</option>
                            <option value="start">Start anyway</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label="Carry over the last result"
                            checked={knobs.carryOver ?? false}
                            onChange={(event) =>
                              setKnobs({
                                ...knobs,
                                carryOver: event.target.checked ? true : undefined,
                              })
                            }
                          />
                          <span>
                            Carry over the last result (exposes{" "}
                            <code className="font-mono">{"{{last.result}}"}</code>)
                          </span>
                        </label>
                        {fields.length > 0 ? (
                          <div className="space-y-1.5 border-t pt-2">
                            <label className="block space-y-1">
                              Rotate an input through a list
                              <select
                                aria-label="Rotate input field"
                                value={knobs.rotate?.inputId ?? ""}
                                onChange={(event) => {
                                  const inputId = event.target.value;
                                  if (!inputId) setRotateDraft("");
                                  const parsed = parseRotateValues(rotateDraft);
                                  setKnobs({
                                    ...knobs,
                                    rotate: inputId
                                      ? {
                                          inputId,
                                          values: parsed.length > 0 ? parsed : [""],
                                          next: 0,
                                        }
                                      : undefined,
                                  });
                                }}
                              >
                                <option value="">None</option>
                                {fields.map((field) => (
                                  <option key={field.id} value={field.id}>
                                    {field.label} ({field.id})
                                  </option>
                                ))}
                              </select>
                            </label>
                            {knobs.rotate ? (
                              <>
                                <Textarea
                                  aria-label="Rotate input values"
                                  placeholder="One value per line"
                                  value={rotateDraft}
                                  onChange={(event) => {
                                    const raw = event.target.value;
                                    setRotateDraft(raw);
                                    const values = parseRotateValues(raw);
                                    setKnobs({
                                      ...knobs,
                                      rotate: {
                                        ...knobs.rotate!,
                                        values: values.length > 0 ? values : [""],
                                        next: 0,
                                      },
                                    });
                                  }}
                                />
                                {rotatePreviewValues.length > 0 ? (
                                  <p className="text-muted-foreground">
                                    Next:{" "}
                                    {
                                      rotatePreviewValues[
                                        (knobs.rotate.next ?? 0) % rotatePreviewValues.length
                                      ]
                                    }
                                  </p>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </details>
                    <p className="text-xs text-muted-foreground">
                      {kind === "webhook"
                        ? "Starts when a webhook arrives."
                        : kind === "interval"
                          ? `Runs every ${days} ${unit === 60000 ? "minutes" : unit === 3600000 ? "hours" : "days"}.`
                          : `Runs at ${time} on ${weekdays.map((day) => WORKFLOW_SCHEDULE_WEEKDAYS[day]).join(", ")}.`}{" "}
                      {knobs.window ? `Only between ${knobs.window.from}–${knobs.window.to}.` : ""}{" "}
                      {knobs.ends?.afterRuns ? `Ends after ${knobs.ends.afterRuns} runs.` : ""}
                    </p>
                    {kind !== "webhook" && Number(days) > 0 && weekdays.length > 0 ? (
                      <details className="text-xs">
                        <summary>Next 5 · browser timezone estimate until saved</summary>
                        <ol>
                          {workflowScheduleNextRuns(
                            kind === "interval"
                              ? { type: "interval", everyMs: Number(days) * unit }
                              : { type: "fixed_time", timeOfDay: time, weekdays },
                            `${previewNow}:00Z`,
                            new Intl.DateTimeFormat().resolvedOptions().timeZone,
                          ).map((at) => (
                            <li key={at}>{when(at)}</li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                    {fields.map((field) => (
                      <label key={field.id} className="block space-y-1 text-xs">
                        {field.label}
                        {field.required ? " *" : ""}
                        {field.kind === "multiline" ? (
                          <Textarea
                            aria-label={`Scheduled ${field.label}`}
                            required={field.required}
                            value={inputs[field.id] ?? ""}
                            onChange={(event) =>
                              setInputs({ ...inputs, [field.id]: event.target.value })
                            }
                          />
                        ) : (
                          <Input
                            aria-label={`Scheduled ${field.label}`}
                            type={field.kind === "url" ? "url" : "text"}
                            required={field.required}
                            value={inputs[field.id] ?? ""}
                            onChange={(event) =>
                              setInputs({ ...inputs, [field.id]: event.target.value })
                            }
                          />
                        )}
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      This chat’s agent drives each scheduled run. The server must be running.
                    </p>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        size="xs"
                        disabled={
                          !edit.canEdit || edit.busy || (kind === "weekly" && weekdays.length === 0)
                        }
                      >
                        {edit.busy ? "Saving…" : editingId ? "Save schedule" : "Add schedule"}
                      </Button>
                    </div>
                  </form>
                )}
              </section>
              <aside>
                {" "}
                <ul className="space-y-3">
                  {tasks.map((task) => {
                    const binding = workflowScheduleBinding(task);
                    const address = task.webhook ? webhookAddress(task.webhook, httpBaseUrl) : null;
                    return (
                      <li key={task.id} className="space-y-1 rounded-lg border p-3">
                        <p className="text-sm font-medium">
                          {scheduleText(task)}
                          {task.enabled ? "" : " · Paused"}
                        </p>
                        {task.enabled && task.nextRunAt ? (
                          <p className="text-xs text-muted-foreground">
                            Next: {when(task.nextRunAt)}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          Runs: {task.runCount} · Last run: {task.lastRunStatus}
                          {task.lastRunAt ? ` · ${when(task.lastRunAt)}` : ""}
                        </p>
                        {binding?.window ? (
                          <p className="text-xs text-muted-foreground">
                            Window: {binding.window.from}–{binding.window.to}
                          </p>
                        ) : null}
                        {binding?.carryOver ? (
                          <p className="text-xs text-muted-foreground">
                            Carry-over: passes last finished result ({"{{last.result}}"})
                          </p>
                        ) : null}
                        {binding?.rotate && binding.rotate.values.length > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Rotate {binding.rotate.inputId}: next is{" "}
                            {
                              binding.rotate.values[
                                (binding.rotate.next ?? 0) % binding.rotate.values.length
                              ]
                            }
                          </p>
                        ) : null}
                        {task.schedule.type !== "webhook" && task.nextRunAt ? (
                          <details className="text-xs">
                            <summary>
                              Next 5 runs · {binding?.timeZone ?? "server local time"}
                            </summary>
                            <ol>
                              {[
                                task.nextRunAt,
                                ...workflowScheduleNextRuns(
                                  task.schedule,
                                  task.nextRunAt,
                                  binding?.timeZone ??
                                    new Intl.DateTimeFormat().resolvedOptions().timeZone,
                                  4,
                                ),
                              ].map((at) => (
                                <li key={at}>{when(at)}</li>
                              ))}
                            </ol>
                          </details>
                        ) : null}
                        <details className="text-xs">
                          <summary>History</summary>
                          {(props.runs ?? [])
                            .filter((run) => run.scheduleTaskId === task.id)
                            .slice(0, 10)
                            .map((run) => (
                              <button
                                type="button"
                                key={run.id}
                                onClick={() => props.onOpenRun?.(run.id)}
                                className="block"
                              >
                                {when(run.startedAt)} · {run.status}
                              </button>
                            ))}
                        </details>
                        {task.lastRunError ? (
                          <p role="alert" className="text-sm text-destructive">
                            {task.lastRunError}
                          </p>
                        ) : null}
                        {address ? (
                          <div className="space-y-1">
                            <Input
                              aria-label="Webhook URL"
                              readOnly
                              value={address.address}
                              onFocus={(event) => event.currentTarget.select()}
                            />
                            {address.note ? (
                              <p className="text-xs text-muted-foreground">{address.note}</p>
                            ) : null}
                          </div>
                        ) : null}
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!edit.canEdit || edit.busy}
                          onClick={() => setAdvancedTask(task)}
                        >
                          Webhook security and runtime…
                        </Button>
                        {task.schedule.type === "webhook" ? (
                          <WorkflowTriggerDeliveries
                            environmentId={props.environmentId}
                            task={task}
                          />
                        ) : null}
                        {task.schedule.type === "webhook" ? (
                          <div className="space-y-2">
                            <Textarea
                              aria-label="Test webhook JSON"
                              value={testBody}
                              onChange={(event) => setTestBody(event.target.value)}
                            />
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={!edit.canEdit || edit.busy}
                              onClick={async () => {
                                const result = await edit.run({
                                  _tag: "scheduleTest",
                                  ...target,
                                  id: task.id,
                                  body: testBody,
                                });
                                setTestOutcome(result?.webhookOutcome ?? "Test could not be sent");
                              }}
                            >
                              Send test
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              Unsigned test through the server’s webhook pipeline. Signature checks
                              and filters still apply.
                            </p>
                            {testOutcome ? (
                              <p role="status" className="text-xs">
                                {testOutcome}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={!edit.canEdit || edit.busy}
                            onClick={() => {
                              setEditingId(task.id);
                              setPickedDriverThreadId(task.threadId);
                              setInputs({ ...binding?.inputs });
                              setKnobs(binding ?? {});
                              setRotateDraft(
                                binding?.rotate ? binding.rotate.values.join("\n") : "",
                              );
                              if (task.schedule.type === "interval") {
                                setKind("interval");
                                setUnit(60000);
                                setDays(String(task.schedule.everyMs / 60000));
                              } else if (task.schedule.type === "fixed_time") {
                                setKind("weekly");
                                setTime(task.schedule.timeOfDay);
                                setWeekdays([...(task.schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6])]);
                              } else setKind("webhook");
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={!canRunNow}
                            onClick={() =>
                              void runNow({
                                environmentId: props.environmentId,
                                input: { id: task.id },
                              })
                            }
                          >
                            Run now
                          </Button>
                          {address ? (
                            <>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => void navigator.clipboard.writeText(address.address)}
                              >
                                Copy URL
                              </Button>
                              <Button
                                variant="outline"
                                size="xs"
                                disabled={!canRotate}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Rotate this webhook URL? The current URL stops working.",
                                    )
                                  )
                                    void rotateToken({
                                      environmentId: props.environmentId,
                                      input: { id: task.id },
                                    });
                                }}
                              >
                                Rotate token
                              </Button>
                            </>
                          ) : null}
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={!edit.canEdit || edit.busy}
                            onClick={() =>
                              void edit.run({
                                _tag: "scheduleSetEnabled",
                                ...target,
                                id: task.id,
                                enabled: !task.enabled,
                              })
                            }
                          >
                            {task.enabled ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            variant="destructive"
                            size="xs"
                            disabled={!edit.canEdit || edit.busy}
                            onClick={() =>
                              window.confirm("Delete this workflow schedule?") &&
                              void edit.run({ _tag: "scheduleRemove", ...target, id: task.id })
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            </div>
            {edit.error ? (
              <p role="alert" className="text-xs text-destructive">
                {edit.error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        {advancedTask ? (
          <Suspense fallback={<p className="p-4 text-xs">Loading task settings…</p>}>
            <WorkflowTaskEditor
              initialEnvironmentId={props.environmentId}
              task={advancedTask}
              onClose={() => setAdvancedTask(null)}
            />
          </Suspense>
        ) : null}
      </WorkflowScheduleSheet>
    </Dialog>
  );
}

function WorkflowTriggerDeliveries(props: { environmentId: EnvironmentId; task: ScheduledTask }) {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTaskWebhookDeliveries({
      environmentId: props.environmentId,
      input: { id: props.task.id, acceptAnyOutcome: true },
    }),
  );
  return (
    <details className="text-xs">
      <summary>Recent deliveries</summary>
      {query.error ? (
        <p role="alert">Couldn’t load deliveries.</p>
      ) : (
        <pre className="max-h-40 overflow-auto">
          {JSON.stringify(query.data?.deliveries.slice(0, 10) ?? [], null, 2)}
        </pre>
      )}
    </details>
  );
}
