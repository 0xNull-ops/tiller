import * as Schema from "effect/Schema";

import { useLocalStorage, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { DEFAULT_TOUR_CLIENT_SETTINGS, TOUR_VERSION, type TourClientSettings } from "./tourState";

export const TOUR_SETTINGS_STORAGE_KEY = "tiller:tour:v1";

const TourClientSettingsSchema = Schema.Struct({
  tourCompletedVersion: Schema.NullOr(Schema.Number),
  showTourOnNewDevices: Schema.Boolean,
});

function updateTourSettings(patch: Partial<TourClientSettings>) {
  writeLocalStorageValue(
    TOUR_SETTINGS_STORAGE_KEY,
    (current: TourClientSettings) => ({ ...current, ...patch }),
    DEFAULT_TOUR_CLIENT_SETTINGS,
    TourClientSettingsSchema,
  );
}

/** Skipping and finishing both count: the offer stays away until the version changes. */
export function markTourCompleted() {
  updateTourSettings({ tourCompletedVersion: TOUR_VERSION });
}

export function setShowTourOnNewDevices(showTourOnNewDevices: boolean) {
  updateTourSettings({ showTourOnNewDevices });
}

export function useTourClientSettings(): TourClientSettings {
  const [settings] = useLocalStorage(
    TOUR_SETTINGS_STORAGE_KEY,
    DEFAULT_TOUR_CLIENT_SETTINGS,
    TourClientSettingsSchema,
  );
  return settings;
}
