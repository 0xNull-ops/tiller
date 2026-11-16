import { createFileRoute } from "@tanstack/react-router";

import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { WorkflowGeneralSettings } from "../workflows/WorkflowGeneralSettings";
import { WorkflowCanvasColorsSettings } from "../workflows/WorkflowCanvasColorsSettings";
import { TourSettingsSection } from "../fork/tour/TourSettingsSection";

function SettingsWorkflowsRoute() {
  const { environment, connectedEnvironments } = useSettingsScope();
  const target = environment ?? connectedEnvironments[0] ?? null;
  return (
    <SettingsPageContainer>
      {target ? (
        <WorkflowGeneralSettings environmentId={target.environmentId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Connect an environment to configure workflows.
        </p>
      )}
      <WorkflowCanvasColorsSettings />
      <TourSettingsSection />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/_chat/settings/workflows")({
  component: SettingsWorkflowsRoute,
});
