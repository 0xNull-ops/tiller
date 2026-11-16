import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { whenProtectedDataAvailable } from "../../lib/protectedData";
import { createTourIntroStore } from "./tourIntroStore";

const STORAGE_KEY = "tiller.tour-intro.v1";

export const tourIntroStore = createTourIntroStore({
  read: async () => {
    await whenProtectedDataAvailable();
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    const version = raw === null ? null : Number(raw);
    return version === null || Number.isNaN(version) ? null : version;
  },
  write: async (version) => {
    await SecureStore.setItemAsync(STORAGE_KEY, String(version));
  },
});

export function useTourIntro() {
  return useSyncExternalStore(tourIntroStore.subscribe, tourIntroStore.getSnapshot);
}
