import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProvider,
  type ServerSettings,
  type ThreadId,
  type WorkflowInput,
  type WorkflowListing,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { newThreadId } from "../lib/utils";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  resolveSelectableProviderInstanceEntry,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { useRightPanelStore } from "../rightPanelStore";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironmentProviders } from "../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../state/server";
import { buildThreadRouteParams } from "../threadRoutes";
import { useDraftWorkflowKickoff } from "./draftWorkflowKickoff";
import { isMainDrivingThread } from "./workflowEditing";
import { WorkflowModelField } from "./WorkflowModelField";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { useWorkflowEdit, useWorkflowRuns } from "./workflowState";
import {
  clearWorkflowRunRequest,
  readWorkflowRunRequest,
  recordLastChatPath,
  rememberThreadWorkflow,
  subscribeWorkflowRunRequest,
} from "./workflowUiStore";

const NEW_CHAT_VALUE = "__new_chat__";

export function openStartedWorkflowInThread(
  navigate: ReturnType<typeof useNavigate>,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  workflow: string,
) {
  const ref = scopeThreadRef(environmentId, threadId);
  rememberThreadWorkflow(ref, workflow);
  useRightPanelStore.getState().open(ref, "workflow");
  recordLastChatPath(`/${environmentId}/${threadId}`);
  void navigate({
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(ref),
  });
}

function resolveProjectDefaultModel(
  providers: ReadonlyArray<ServerProvider>,
  settings: ServerSettings,
  projectId: ProjectId,
  projectDefaultSelection: ModelSelection | null | undefined,
): ModelSelection | null {
  const textProviders = providers.filter((provider) => provider.supportsTextGeneration !== false);
  const stored = resolveDefaultProviderModelSelection(textProviders, projectDefaultSelection);
  if (stored) return stored;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(textProviders),
      settings,
      projectId,
    ),
  );
  const active = resolveSelectableProviderInstanceEntry(entries, undefined);
  if (!active) return null;
  const model =
    active.models.find((item) => item.isDefault)?.slug ??
    active.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[active.driverKind];
  return model ? { instanceId: active.instanceId, model } : null;
}

/**
 * Picks the chat that will orchestrate a workflow run (defaulting to a new chat in the
 * workflow's project with its default model and mode) and collects declared inputs.
 */
export function WorkflowRunDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly listing: WorkflowListing;
  readonly onClose: () => void;
  readonly onStarted?: (result: { readonly runId?: string; readonly threadId: ThreadId }) => void;
}) {
  const projects = useProjects();
  const project =
    projects.find(
      (candidate) =>
        candidate.environmentId === props.environmentId && candidate.id === props.projectId,
    ) ?? null;
  const shells = useThreadShells();
  const runsQuery = useWorkflowRuns(props.environmentId, props.projectId);
  const projectThreads = shells
    .filter(
      (thread) =>
        thread.environmentId === props.environmentId &&
        thread.projectId === props.projectId &&
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        isMainDrivingThread(thread, runsQuery.runs),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const rawSettings = useEnvironmentSettings(props.environmentId);
  const settings: ServerSettings =
    rawSettings && typeof rawSettings === "object" && "projectSettingsOverrides" in rawSettings
      ? rawSettings
      : DEFAULT_SERVER_SETTINGS;
  const providersByEnvironment = useEnvironmentProviders();
  const providers: ReadonlyArray<ServerProvider> =
    providersByEnvironment instanceof Map
      ? (providersByEnvironment.get(props.environmentId) ?? EMPTY_SERVER_PROVIDERS)
      : EMPTY_SERVER_PROVIDERS;
  const resolvedProject = resolveProjectSettings(settings, props.projectId, project).settings;
  const projectDefaultModel = resolveProjectDefaultModel(
    providers,
    settings,
    props.projectId,
    resolvedProject.defaultModelSelection,
  );
  const fallbackModel = props.listing.definition?.model ?? projectDefaultModel;

  const [driverChoice, setDriverChoice] = useState<string>(NEW_CHAT_VALUE);
  const [modelOverride, setModelOverride] = useState<ModelSelection | undefined>(undefined);
  const [interactionMode, setInteractionMode] = useState<ProviderInteractionMode>("default");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(resolvedProject.defaultRuntimeMode);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (props.listing.definition?.inputs ?? []).flatMap((input) =>
        input.defaultValue !== undefined ? [[input.id, input.defaultValue]] : [],
      ),
    ),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const edit = useWorkflowEdit(props.environmentId);
  const kickoff = useDraftWorkflowKickoff(props.environmentId, {
    promote: () => {},
    navigate: () => {},
  });

  const busy = edit.busy || kickoff.busy;
  const inputs = props.listing.definition?.inputs ?? [];
  const effectiveModel = modelOverride ?? fallbackModel;
  const isNewChat = driverChoice === NEW_CHAT_VALUE;

  const inputsValid = inputs.every((input) => {
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

  const canRun =
    !busy &&
    inputsValid &&
    (isNewChat ? project !== null && effectiveModel !== null : driverChoice.length > 0);

  const selectedDriverThread = projectThreads.find((thread) => thread.id === driverChoice) ?? null;
  const newChatLabel = `New chat in ${project?.title ?? "project"}`;
  const defaultModelResetLabel = fallbackModel
    ? `Default (${fallbackModel.model})`
    : "Project default";

  const start = async () => {
    if (!canRun) return;
    setLocalError(null);
    const cleanInputs = Object.fromEntries(
      Object.entries(values)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    if (!isNewChat) {
      const threadId = driverChoice as ThreadId;
      const result = await edit.run({
        _tag: "runStart",
        projectId: props.projectId,
        workflow: props.listing.workflow,
        driverThreadId: threadId,
        ...(Object.keys(cleanInputs).length > 0 ? { inputs: cleanInputs } : {}),
      });
      if (result !== null) {
        props.onStarted?.({
          ...(result.runId !== undefined ? { runId: result.runId } : {}),
          threadId,
        });
        props.onClose();
      }
      return;
    }
    if (!project || !effectiveModel) {
      setLocalError("Select an available model before starting a new chat.");
      return;
    }
    const threadId = newThreadId();
    const ok = await kickoff.run({
      environmentId: props.environmentId,
      projectId: props.projectId,
      threadId,
      projectCwd: project.workspaceRoot,
      workflow: props.listing.workflow,
      title: props.listing.definition?.name ?? props.listing.workflow,
      modelSelection: effectiveModel,
      runtimeMode,
      interactionMode,
      ...(Object.keys(cleanInputs).length > 0 ? { inputs: cleanInputs } : {}),
      createdAt: new Date().toISOString(),
      branch: null,
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
    });
    if (ok) {
      props.onStarted?.({ threadId });
      props.onClose();
    }
  };

  const errorMessage = localError ?? edit.error ?? kickoff.error;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Run “{props.listing.definition?.name ?? props.listing.workflow}”
            </DialogTitle>
            <DialogDescription>
              Choose which chat drives this workflow run
              {inputs.length > 0 ? " and fill in its inputs." : "."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-6">
            <div className="space-y-1 text-xs">
              <span className="font-medium">Driving chat</span>
              <Select
                value={driverChoice}
                onValueChange={(value) => {
                  if (value) setDriverChoice(value);
                }}
              >
                <SelectTrigger aria-label="Driving chat">
                  <SelectValue>
                    {isNewChat ? newChatLabel : selectedDriverThread?.title || "Untitled chat"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                  <SelectItem value={NEW_CHAT_VALUE}>{newChatLabel}</SelectItem>
                  {projectThreads.map((thread) => (
                    <SelectItem key={thread.id} value={thread.id}>
                      {thread.title || "Untitled chat"}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            {isNewChat ? (
              <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
                <div className="space-y-1 text-xs">
                  <span className="font-medium">Model</span>
                  <WorkflowModelField
                    environmentId={props.environmentId}
                    projectId={props.projectId}
                    value={modelOverride}
                    resetLabel={defaultModelResetLabel}
                    disabled={busy}
                    onChange={setModelOverride}
                    onReset={() => setModelOverride(undefined)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1 text-xs">
                    <span className="font-medium">Mode</span>
                    <Select
                      value={interactionMode}
                      onValueChange={(value) => {
                        if (value === "default" || value === "plan") setInteractionMode(value);
                      }}
                    >
                      <SelectTrigger size="compact" aria-label="Chat mode">
                        <SelectValue>{interactionMode === "plan" ? "Plan" : "Build"}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                        <SelectItem value="default">Build</SelectItem>
                        <SelectItem value="plan">Plan</SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                  <div className="space-y-1 text-xs">
                    <span className="font-medium">Permissions</span>
                    <Select
                      value={runtimeMode}
                      onValueChange={(value) => {
                        if (value === "full-access" || value === "approval-required")
                          setRuntimeMode(value);
                      }}
                    >
                      <SelectTrigger size="compact" aria-label="Runtime permissions">
                        <SelectValue>
                          {runtimeMode === "full-access" ? "Full access" : "Supervised"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
                        <SelectItem value="full-access">Full access</SelectItem>
                        <SelectItem value="approval-required">Supervised</SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                </div>
              </div>
            ) : null}

            {inputs.length > 0 ? (
              <div className="space-y-2.5 border-t pt-2.5">
                {inputs.map((input) => (
                  <RunDialogInputField
                    key={input.id}
                    input={input}
                    disabled={busy}
                    value={values[input.id] ?? ""}
                    onChange={(value) =>
                      setValues((current) => ({ ...current, [input.id]: value }))
                    }
                  />
                ))}
              </div>
            ) : null}

            {errorMessage ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canRun}>
              {busy ? "Starting…" : "Run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function RunDialogInputField(props: {
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
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </label>
  );
}

/**
 * Mounts the global Run workflow dialog requested from the command palette or workflows home page
 * and opens the workflow canvas when the run starts.
 */
export function WorkflowRunDialogHost() {
  const navigate = useNavigate();
  const request = useSyncExternalStore(subscribeWorkflowRunRequest, readWorkflowRunRequest);
  if (!request) return null;
  return (
    <WorkflowRunDialog
      key={`${request.environmentId}:${request.projectId}:${request.listing.workflow}`}
      environmentId={request.environmentId}
      projectId={request.projectId}
      listing={request.listing}
      onClose={clearWorkflowRunRequest}
      onStarted={({ threadId }) => {
        openStartedWorkflowInThread(
          navigate,
          request.environmentId,
          threadId,
          request.listing.workflow,
        );
      }}
    />
  );
}
