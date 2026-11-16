import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import {
  EnvironmentId,
  ProjectId,
  type WorkflowAttachment,
  type WorkflowCredentialAttachment,
  type WorkflowCredentialReadiness,
  type WorkflowRun,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { enclosingLoopForStep } from "@t3tools/client-runtime/workflows/loops";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { runElapsedLabel, type WorkflowElapsedTone } from "@t3tools/shared/workflowElapsed";
import { workflowSubagentMissingReason } from "@t3tools/shared/workflowSubagents";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import type { StaticScreenProps } from "@react-navigation/native";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { ScreenContent } from "../components/ui/ScreenContent";
import { ScreenScrollView } from "../components/ui/ScreenScrollView";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironmentQuery } from "../state/query";
import { CredentialBrandMark } from "../features/credentials/CredentialBrandMark";
import { useAdaptiveWorkspaceLayout } from "../features/layout/AdaptiveWorkspaceLayout";
import { useVisibleSecondClock } from "../features/threads/use-visible-second-clock";
import { cn } from "../lib/cn";
import { SavedWorkflowsSection } from "./SavedWorkflowsSection";
import {
  approveWorkflow,
  resumeWorkflow,
  stopWorkflow,
  workflowRunsForProject,
} from "./workflowState";
import {
  canStopWorkflowRun,
  workflowRunStepActions,
  workflowRunStepStatusLabel,
} from "./runActions";
import { workflowCredentialRow, type WorkflowCredentialTone } from "./workflowCredentials";

type WorkflowRunsTarget = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly threadId: string;
};

export function WorkflowRunsScreen({ route }: StaticScreenProps<WorkflowRunsTarget>) {
  const target = route.params;
  const environmentId = EnvironmentId.make(target.environmentId);
  const projectId = ProjectId.make(target.projectId);
  const runsQuery = useEnvironmentQuery(workflowRunsForProject(environmentId, projectId));
  const snapshot = runsQuery.data;
  const runs = (snapshot?.runs ?? [])
    .filter((run) => run.projectId === projectId && run.driverThreadId === target.threadId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const { layout } = useAdaptiveWorkspaceLayout();
  const navigation = useNavigation();

  return (
    <ScreenContent insetHorizontal={layout.usesSplitView}>
      <ScreenScrollView
        className="flex-1 bg-screen"
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerClassName="gap-4 px-5 py-4"
      >
        {runsQuery.error ? <Notice message={runsQuery.error} tone="danger" /> : null}
        {runsQuery.isPending && snapshot === null ? (
          <Text className="py-8 text-center text-sm text-foreground-muted">
            Loading workflow runs…
          </Text>
        ) : (
          <>
            <SavedWorkflowsSection
              environmentId={environmentId}
              projectId={projectId}
              workflows={snapshot?.workflows ?? []}
            />
            {runs.length === 0 ? (
              <EmptyState
                variant="plain"
                title="No saved workflow runs"
                detail="Runs started by this chat will appear here. The saved workflow canvas is available on web and desktop."
              />
            ) : (
              <>
                <View className="gap-2">
                  <Text textRole="headline" className="font-t3-bold text-foreground">
                    Runs in this chat
                  </Text>
                  {runs.map((run) => (
                    <RunListItem
                      key={run.id}
                      run={run}
                      selected={selectedRun?.id === run.id}
                      onPress={() => setSelectedRunId(run.id)}
                    />
                  ))}
                </View>
                {selectedRun ? (
                  <WorkflowRunDetails
                    environmentId={environmentId}
                    run={selectedRun}
                    onOpenDriverChat={() =>
                      navigation.dispatch(
                        StackActions.push("Thread", {
                          environmentId: target.environmentId,
                          threadId: selectedRun.driverThreadId,
                        }),
                      )
                    }
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </ScreenScrollView>
    </ScreenContent>
  );
}

function RunListItem(props: {
  readonly run: WorkflowRun;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const definition = props.run.definition;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      className={`rounded-2xl border p-4 ${props.selected ? "border-primary bg-card" : "border-border bg-card"}`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-t3-semibold text-foreground">{definition.name}</Text>
          <Text className="text-xs text-foreground-muted">
            {definition.steps.length} work steps · {new Date(props.run.startedAt).toLocaleString()}
          </Text>
        </View>
        <RunStatus status={props.run.status} />
      </View>
    </Pressable>
  );
}

function RunStatus({ status }: { readonly status: WorkflowRun["status"] }) {
  const label = status === "waiting" ? "Needs you" : status[0]!.toUpperCase() + status.slice(1);
  return (
    <Text className="rounded-full bg-subtle px-2.5 py-1 text-xs font-t3-medium text-foreground-muted">
      {label}
    </Text>
  );
}

function WorkflowRunDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly run: WorkflowRun;
  readonly onOpenDriverChat: () => void;
}) {
  const canStop = useAtomValue(stopWorkflow.permissionAtom(props.environmentId));
  const canApprove = useAtomValue(approveWorkflow.permissionAtom(props.environmentId));
  const canResume = useAtomValue(resumeWorkflow.permissionAtom(props.environmentId));
  const stop = useAtomCommand(stopWorkflow, { label: "stop workflow" });
  const approve = useAtomCommand(approveWorkflow, { label: "approve workflow step" });
  const resume = useAtomCommand(resumeWorkflow, { label: "resume workflow step" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = props.run.status === "running" || props.run.status === "waiting";
  const nowMs = useVisibleSecondClock(live);
  const elapsed = runElapsedLabel(props.run, nowMs);

  const act = async (kind: "stop" | "approve" | "resume", stepId?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const input = { environmentId: props.environmentId, input: { runId: props.run.id } };
    const result =
      kind === "stop"
        ? await stop(input)
        : kind === "approve"
          ? await approve({ ...input, input: { ...input.input, stepId: stepId! } })
          : await resume({ ...input, input: { ...input.input, stepId: stepId! } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const stepActions = workflowRunStepActions(props.run);
  return (
    <View className="gap-4 rounded-2xl border border-border bg-card p-4">
      <View className="gap-1">
        <Text textRole="headline" className="font-t3-bold text-foreground">
          {props.run.definition.name}
        </Text>
        {elapsed.text ? (
          <Text
            className={cn("text-sm font-t3-medium tabular-nums", ELAPSED_TONE_CLASS[elapsed.tone])}
          >
            {elapsed.text}
          </Text>
        ) : null}
        {props.run.subagents ? (
          <View className="gap-1">
            <Text className="text-xs text-foreground-muted">
              Subagent models
              {props.run.subagents.usable.length > 0
                ? `: ${props.run.subagents.usable.map((model) => model.label).join(", ")}`
                : props.run.subagents.missing.length === 0
                  ? ": Agent decides"
                  : ""}
            </Text>
            {props.run.subagents.missing.map(({ hint, reason }) => (
              <Text
                key={`${hint.instanceId}:${hint.model}`}
                className="text-xs text-warning-foreground"
              >
                {hint.model}: {workflowSubagentMissingReason(reason)}
                {props.run.subagents?.fallback ? "; so the agent decides" : ""}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {props.run.error ? <Notice message={props.run.error} tone="danger" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {(props.run.definition.loops?.length ?? 0) > 0 ? (
        <View className="gap-1 rounded-xl border border-border p-3">
          <Text className="font-t3-semibold text-foreground">Loops</Text>
          {props.run.definition.loops!.map((loop) => (
            <Text key={loop.id} className="text-xs text-foreground-muted">
              ↺ {loop.from} → {loop.to} · up to {loop.maxRounds}×
              {props.run.exhaustedLoops?.includes(loop.id) ? " · exhausted" : ""}
            </Text>
          ))}
        </View>
      ) : null}
      {(props.run.definition.notes?.length ?? 0) > 0 ? (
        <View className="gap-2 rounded-xl border border-border p-3">
          <Text className="font-t3-semibold text-foreground">Workflow notes</Text>
          {props.run.definition.notes!.map((note) => (
            <View key={note.id} className="gap-1 rounded-lg bg-subtle p-2">
              {note.anchorStepId ? (
                <Text className="text-2xs text-foreground-muted">
                  {props.run.definition.steps.find((step) => step.id === note.anchorStepId)
                    ?.title ?? note.anchorStepId}
                </Text>
              ) : null}
              <Text selectable className="text-sm text-foreground">
                {note.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {(props.run.preflight?.entries.length ?? 0) > 0 ? (
        <View className="gap-2 rounded-xl border border-border p-3">
          <Text className="font-t3-semibold text-foreground">Readiness at run start</Text>
          {props.run.preflight!.entries.map((entry) => {
            const step = props.run.definition.steps.find((item) => item.id === entry.stepId);
            const attachment = step?.attachments?.find((item) => item.id === entry.attachmentId);
            return (
              <View
                key={`${entry.stepId}/${entry.attachmentId}`}
                className="gap-1 rounded-lg bg-subtle p-2"
              >
                <Text className="text-sm font-t3-medium text-foreground">
                  {step?.title ?? entry.stepId} ·{" "}
                  {attachment ? workflowAttachmentLabel(attachment) : entry.kind}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {entry.status}
                  {entry.stale ? " · stale" : ""} · {entry.message}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      <View className="gap-2">
        {props.run.steps.map((step) => {
          const definition = props.run.definition.steps.find((item) => item.id === step.stepId);
          const enclosingLoop = enclosingLoopForStep(props.run.definition, step.stepId);
          const stepRound =
            (enclosingLoop ? props.run.loopRounds?.[enclosingLoop.id] : undefined) ?? step.round;
          return (
            <View key={step.stepId} className="gap-1 rounded-xl bg-subtle p-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="min-w-0 flex-1 font-t3-medium text-foreground">
                  {definition?.title ?? step.stepId}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {stepRound !== undefined && enclosingLoop
                    ? `Round ${stepRound}/${enclosingLoop.maxRounds} · `
                    : stepRound !== undefined
                      ? `Round ${stepRound} · `
                      : ""}
                  {workflowRunStepStatusLabel(step)}
                </Text>
              </View>
              {step.loopExhausted ? (
                <Text className="text-xs text-warning-foreground">
                  Loop reached max rounds; continued with last output
                </Text>
              ) : null}
              {step.threadId ? (
                <Text className="text-xs text-foreground-muted">
                  Working in thread {step.threadId}
                </Text>
              ) : null}
              {step.summary ? (
                <Text className="text-sm text-foreground-muted">{step.summary}</Text>
              ) : null}
              {step.error ? (
                <Text className="text-sm text-danger-foreground">{step.error}</Text>
              ) : null}
              {step.checks?.map((check) => (
                <Text
                  key={`${step.stepId}-check-${JSON.stringify(check.check)}`}
                  className="text-xs text-foreground-muted"
                >
                  {check.ok ? "Passed" : "Failed"}: {check.message}
                </Text>
              ))}
              {definition?.attachments?.map((attachment) => {
                const readiness = props.run.preflight?.entries.find(
                  (entry) => entry.stepId === step.stepId && entry.attachmentId === attachment.id,
                );
                if (attachment.kind === "credential") {
                  return (
                    <WorkflowCredentialAttachmentRow
                      key={attachment.id}
                      attachment={attachment}
                      readiness={readiness?.credential}
                    />
                  );
                }
                return (
                  <View key={attachment.id} className="gap-0.5 border-t border-border pt-2">
                    <Text className="text-xs font-t3-medium text-foreground">
                      {workflowAttachmentLabel(attachment)} ·{" "}
                      {attachment.kind === "mcp-connection"
                        ? readiness?.status === "available"
                          ? "Connected"
                          : readiness?.status === "error"
                            ? "Not available"
                            : readiness?.status === "missing" &&
                                readiness.message.startsWith("Needs sign-in")
                              ? "Needs sign-in"
                              : readiness?.status === "unknown" &&
                                  readiness.message.startsWith("Configured in ")
                                ? "Configured · not verified"
                                : (readiness?.status ?? "Not checked")
                        : (readiness?.status ?? "Not checked")}
                      {readiness?.stale ? " · stale" : ""}
                    </Text>
                    {readiness?.message ? (
                      <Text className="text-xs text-foreground-muted">{readiness.message}</Text>
                    ) : null}
                  </View>
                );
              })}
              {step.outputs && Object.keys(step.outputs).length > 0 ? (
                <View className="gap-1 pt-1">
                  {Object.entries(step.outputs).map(([name, value]) => (
                    <Text key={name} selectable className="text-xs text-foreground">
                      {name}: {value}
                    </Text>
                  ))}
                </View>
              ) : null}
              {step.previousRounds && step.previousRounds.length > 0 ? (
                <View className="gap-1 border-t border-border pt-2">
                  <Text className="text-xs font-t3-medium text-foreground-muted">
                    Previous rounds
                  </Text>
                  {step.previousRounds.map((previous) => (
                    <Text key={previous.round} className="text-xs text-foreground-muted">
                      Round {previous.round} ({previous.verdict ?? previous.status}):{" "}
                      {previous.summary ?? previous.error ?? "Completed"}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {stepActions.map((action) => {
        const enabled = action.kind === "approve" ? canApprove : canResume;
        return (
          <Button
            key={`${action.kind}-${action.stepId}`}
            label={
              action.kind === "approve"
                ? "Approve"
                : props.run.steps.find((step) => step.stepId === action.stepId)?.waitingFor ===
                    "timer"
                  ? "Start now"
                  : "Resume"
            }
            tone="primary"
            disabled={!enabled || busy}
            loading={busy}
            onPress={() => void act(action.kind, action.stepId)}
          />
        );
      })}
      {canStop && canStopWorkflowRun(props.run) ? (
        <Button
          label="Stop run"
          tone="danger"
          disabled={busy}
          loading={busy}
          onPress={() => void act("stop")}
        />
      ) : null}
      <Button label="Open driving chat" tone="text" onPress={props.onOpenDriverChat} />
    </View>
  );
}

const ELAPSED_TONE_CLASS: Readonly<Record<WorkflowElapsedTone, string>> = {
  running: "text-primary-text",
  waiting: "text-warning-foreground",
  done: "text-foreground-muted",
};

const TONE_CLASS: Readonly<Record<WorkflowCredentialTone, string>> = {
  ready: "text-foreground-muted",
  neutral: "text-foreground-muted",
  expiring: "text-warning-foreground",
  attention: "text-danger-foreground",
};

function WorkflowCredentialAttachmentRow(props: {
  readonly attachment: WorkflowCredentialAttachment;
  readonly readiness: WorkflowCredentialReadiness | undefined;
}) {
  const row = workflowCredentialRow(props.attachment, props.readiness);
  return (
    <View className="flex-row items-center gap-2 border-t border-border pt-2">
      <CredentialBrandMark
        name={row.name}
        templateIcon={row.templateIcon}
        iconOverride={row.iconOverride}
        envVars={row.envVars}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className="text-xs font-t3-medium text-foreground">
          {row.name}
        </Text>
        <Text className={cn("text-xs", TONE_CLASS[row.tone])}>{row.statusLabel}</Text>
      </View>
    </View>
  );
}

function workflowAttachmentLabel(attachment: WorkflowAttachment): string {
  if (attachment.label) return attachment.label;
  switch (attachment.kind) {
    case "requirement":
      return attachment.requirement;
    case "service-login":
      return attachment.service;
    case "mcp-connection":
      return attachment.server;
    case "credential":
      return credentialTemplate(attachment.templateId)?.name ?? attachment.templateId;
  }
}
