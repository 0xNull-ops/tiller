import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Notice } from "../../components/ui/Notice";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { useSettingsEnvironmentFilter } from "../../features/settings/settings-environment-filter";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { editWorkflow, workflowFirstRead } from "../../workflows/workflowState";
export function WorkflowsSettingsScreen() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <SettingsScreen title="Workflows">
      <ScreenScrollView className="flex-1" contentContainerClassName="gap-4 px-5 py-4">
        {selectedTargets.length ? (
          selectedTargets.map((target) => (
            <EnvironmentSettings
              key={target.environmentId}
              environmentId={target.environmentId}
              label={target.label}
            />
          ))
        ) : (
          <Text className="text-foreground-muted">Select a connected environment.</Text>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
function EnvironmentSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const query = useEnvironmentQuery(
    workflowFirstRead({ environmentId: props.environmentId, input: { _tag: "preferences" } }),
  );
  const preferences = query.data?._tag === "preferences" ? query.data.preferences : null;
  const command = useAtomCommand(editWorkflow, { label: "Show built-in workflows" });
  const canEdit = useAtomValue(editWorkflow.permissionAtom(props.environmentId));
  return (
    <View className="gap-3">
      <Text className="font-t3-semibold text-foreground">{props.label}</Text>
      {query.error ? <Notice message={query.error} tone="danger" /> : null}
      <SettingsSwitchRow
        label="Show built-in workflows"
        value={preferences?.showBuiltinWorkflows ?? true}
        disabled={!canEdit || preferences === null}
        onValueChange={(enabled) => {
          void command({
            environmentId: props.environmentId,
            input: { _tag: "preferencesSet", showBuiltinWorkflows: enabled },
          }).then((result) => {
            if (result._tag === "Success") query.refresh();
          });
        }}
      />
    </View>
  );
}
