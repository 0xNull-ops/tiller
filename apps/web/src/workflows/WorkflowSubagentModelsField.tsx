import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_MAX_SUBAGENT_MODELS,
  type EnvironmentId,
  type ProjectId,
  type ServerProvider,
  type WorkflowListing,
  type WorkflowRun,
  type WorkflowSubagentModel,
} from "@t3tools/contracts";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { useEnvironmentProviders } from "../state/environments";
import { mergeEnvironmentSettings, useEnvironmentSettings } from "../hooks/useSettings";
import { EMPTY_SERVER_PROVIDERS } from "../state/server";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { Button } from "../components/ui/button";
import { useEnvironmentQuery } from "../state/query";
import {
  resolveSubagentModels,
  workflowSubagentMissingReason,
} from "@t3tools/shared/workflowSubagents";
import { workflowRead, useWorkflowEdit } from "./workflowState";
import { useWorkflowLiveRefresh } from "./useWorkflowLiveRefresh";
import {
  removeWorkflowSubagentModel,
  resolveWorkflowSubagentSelections,
  toggleResolvedWorkflowSubagentModel,
} from "./workflowSubagentModels";

export function WorkflowSubagentModelsField(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly listing: WorkflowListing;
  readonly disabled?: boolean;
  readonly run?: WorkflowRun | null;
}) {
  const definition = props.run?.definition ?? props.listing.definition;
  const edit = useWorkflowEdit(props.environmentId);
  const preferencesQuery = useEnvironmentQuery(
    workflowRead({
      environmentId: props.environmentId,
      input: { _tag: "preferences" },
    }),
  );
  useWorkflowLiveRefresh(props.environmentId, preferencesQuery.refresh);
  const max =
    preferencesQuery.data?._tag === "preferences"
      ? preferencesQuery.data.preferences.maxSubagentModels
      : DEFAULT_MAX_SUBAGENT_MODELS;
  const providersByEnvironment = useEnvironmentProviders();
  const providers: ReadonlyArray<ServerProvider> =
    providersByEnvironment instanceof Map
      ? (providersByEnvironment.get(props.environmentId) ?? EMPTY_SERVER_PROVIDERS)
      : EMPTY_SERVER_PROVIDERS;
  const rawSettings = useEnvironmentSettings(props.environmentId);
  const settings =
    rawSettings && typeof rawSettings === "object" && "projectSettingsOverrides" in rawSettings
      ? rawSettings
      : mergeEnvironmentSettings(DEFAULT_SERVER_SETTINGS, DEFAULT_CLIENT_SETTINGS);
  const textProviders = providers.filter((provider) => provider.supportsTextGeneration !== false);
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(textProviders),
      settings,
      props.projectId,
    ),
  );
  const resolved = props.run
    ? (props.run.subagents ?? { usable: [], missing: [], fallback: false })
    : resolveSubagentModels(definition?.subagentModels ?? [], providers);
  const selections = resolveWorkflowSubagentSelections(definition?.subagentModels ?? [], providers);
  const hintCount = definition?.subagentModels?.length ?? 0;
  const selectedModels = props.run
    ? resolved.usable.map(({ instanceId, model }) => ({ instanceId, model }))
    : selections.map(({ instanceId, model }) => ({ instanceId, model }));
  const activeEntry = entries[0];
  const model =
    activeEntry?.models.find((candidate) => candidate.isDefault)?.slug ??
    activeEntry?.models[0]?.slug ??
    "";
  const optionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textProviders,
    activeEntry?.instanceId,
    model,
  );
  const disabled = Boolean(props.disabled || !edit.canEdit || props.run != null);
  const save = (hints: ReadonlyArray<WorkflowSubagentModel>) =>
    void edit.run({
      _tag: "meta",
      projectId: props.projectId,
      workflow: props.listing.workflow,
      subagentModels: hints.length ? [...hints] : null,
    });
  const toggle = (instanceId: string, modelName: string) => {
    if (!definition || disabled || edit.busy) return;
    const entry = entries.find((candidate) => candidate.instanceId === instanceId);
    if (!entry) return;
    const next = toggleResolvedWorkflowSubagentModel(
      definition.subagentModels ?? [],
      {
        driver: entry.driverKind,
        instanceId: entry.instanceId,
        model: modelName,
      },
      providers,
      max,
    );
    if (
      next !== null ||
      selections.some((item) => item.instanceId === instanceId && item.model === modelName)
    )
      save(next ?? []);
  };
  const remove = (hint: WorkflowSubagentModel) =>
    save(removeWorkflowSubagentModel(definition?.subagentModels ?? [], hint) ?? []);

  return (
    <div className="min-w-0 space-y-1" onPointerDown={(event) => event.stopPropagation()}>
      {activeEntry ? (
        <ProviderModelPicker
          size="xs"
          environmentId={props.environmentId}
          activeInstanceId={activeEntry.instanceId}
          model={model}
          selectedModels={selectedModels}
          onToggleModel={toggle}
          onInstanceModelChange={toggle}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={optionsByInstance}
          triggerAriaLabel="Subagent models"
          {...(selectedModels.length ? {} : { triggerLabel: "Agent decides" })}
          triggerClassName="min-w-0 max-w-full border-input bg-background text-foreground"
          disabled={disabled || edit.busy}
        />
      ) : (
        <Button type="button" variant="outline" size="xs" disabled>
          Agent decides
        </Button>
      )}
      {hintCount >= max ? (
        <p className="text-2xs text-muted-foreground">
          {hintCount > max
            ? `${hintCount} of ${max} max`
            : `Up to ${max} models (Settings → General)`}
        </p>
      ) : null}
      {resolved.missing.map(({ hint, reason }) => (
        <p key={`${hint.instanceId}:${hint.model}`} className="text-2xs text-warning-foreground">
          {hint.model}:{" "}
          {workflowSubagentMissingReason(
            reason,
            entries.find(
              (entry) => entry.instanceId === hint.instanceId || entry.driverKind === hint.driver,
            )?.displayName,
          )}
          {" · "}
          <Button
            type="button"
            variant="link"
            size="xs"
            disabled={disabled || edit.busy}
            onClick={() => remove(hint)}
          >
            Remove
          </Button>
        </p>
      ))}
      {resolved.fallback ? (
        <p className="text-2xs text-warning-foreground">
          No selected models are available, so the agent decides. The file keeps the choice.
        </p>
      ) : null}
      {edit.error ? (
        <p role="alert" className="text-2xs text-destructive">
          {edit.error}
        </p>
      ) : null}
    </div>
  );
}
