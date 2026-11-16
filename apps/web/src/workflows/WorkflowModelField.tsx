import type { EnvironmentId, ModelSelection, ProjectId, ServerProvider } from "@t3tools/contracts";
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveSelectableProviderInstanceEntry,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { useEnvironmentProviders } from "../state/environments";
import { mergeEnvironmentSettings, useEnvironmentSettings } from "../hooks/useSettings";
import { EMPTY_SERVER_PROVIDERS } from "../state/server";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { Button } from "../components/ui/button";

export function WorkflowModelField(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  value: ModelSelection | undefined;
  inheritedModel?: ModelSelection | undefined;
  resetLabel: string;
  disabled: boolean;
  onChange: (selection: ModelSelection) => void;
  onReset: () => void;
}) {
  const providersByEnvironment = useEnvironmentProviders();
  const providers: ReadonlyArray<ServerProvider> =
    providersByEnvironment instanceof Map
      ? (providersByEnvironment.get(props.environmentId) ?? EMPTY_SERVER_PROVIDERS)
      : EMPTY_SERVER_PROVIDERS;
  const rawSettings = useEnvironmentSettings(props.environmentId);
  const settings: UnifiedSettings =
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
  const selection = props.value ?? props.inheritedModel;
  const activeEntry =
    entries.find((entry) => entry.instanceId === selection?.instanceId) ??
    resolveSelectableProviderInstanceEntry(entries, undefined);
  const activeInstanceId = activeEntry?.instanceId;
  const model =
    selection?.model ??
    activeEntry?.models.find((item) => item.isDefault)?.slug ??
    activeEntry?.models[0]?.slug ??
    (activeEntry ? DEFAULT_MODEL_BY_PROVIDER[activeEntry.driverKind] : "");
  const optionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textProviders,
    activeInstanceId,
    model,
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      {activeEntry ? (
        <ProviderModelPicker
          size="xs"
          environmentId={props.environmentId}
          activeInstanceId={activeEntry.instanceId}
          model={model ?? ""}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={optionsByInstance}
          triggerAriaLabel="Workflow model"
          {...(props.value === undefined
            ? {
                triggerLabel: props.inheritedModel
                  ? `${props.resetLabel} · ${props.inheritedModel.model}`
                  : props.resetLabel,
              }
            : {})}
          triggerClassName="min-w-0 max-w-full border-input bg-background text-foreground"
          disabled={props.disabled}
          onInstanceModelChange={(instanceId, nextModel) =>
            props.onChange({ instanceId, model: nextModel })
          }
        />
      ) : (
        <span className="text-xs text-muted-foreground">
          No text generation providers available.
        </span>
      )}
      {props.value !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={props.disabled}
          onClick={props.onReset}
        >
          {props.resetLabel}
        </Button>
      ) : null}
    </div>
  );
}
