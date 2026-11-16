import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { setShowTourOnNewDevices, useTourClientSettings } from "./tourSettings";
import { useStartTour } from "./useStartTour";

/** Settings → Tiller: replay the tour, and whether this device offers it on first open. */
export function TourSettingsSection() {
  const settings = useTourClientSettings();
  const startTour = useStartTour();
  return (
    <SettingsSection id="tour" title="Tour">
      <SettingsRow
        title="Replay tour"
        description="A 90-second walk through a sample workflow. Nothing in your projects changes."
        control={
          <Button variant="outline" size="xs" onClick={startTour}>
            Replay tour
          </Button>
        }
      />
      <SettingsRow
        title="Show the tour on new devices"
        description="Offer the tour the first time this device opens Tiller. Each device keeps its own choice."
        control={
          <Switch
            checked={settings.showTourOnNewDevices}
            onCheckedChange={(checked) => setShowTourOnNewDevices(checked)}
            aria-label="Show the tour on new devices"
          />
        }
      />
    </SettingsSection>
  );
}
