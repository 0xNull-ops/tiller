import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { CredentialsEnvironmentPanel } from "./CredentialsEnvironmentPanel";

export function CredentialsSettings() {
  const { environment, connectedEnvironments } = useSettingsScope();
  const target = environment ?? connectedEnvironments[0] ?? null;
  return (
    <SettingsPageContainer>
      {target === null ? (
        <p className="text-sm text-muted-foreground">
          Connect an environment to add credentials to it.
        </p>
      ) : (
        <CredentialsEnvironmentPanel environmentId={target.environmentId} />
      )}
    </SettingsPageContainer>
  );
}
