// fork(scenes): opens a new Theme Studio thread the way "New thread" does for any project.
import { scopeProjectRef } from "@t3tools/client-runtime/environment";

import { stackedThreadToast, toastManager } from "../../../components/ui/toast";
import { useNewThreadHandler } from "../../../hooks/useHandleNewThread";
import { usePrimaryEnvironmentId } from "../../../state/environments";
import { ensureStudioProject } from "./studioProject";

export function useOpenThemeStudio(): (() => Promise<void>) | null {
  const environmentId = usePrimaryEnvironmentId();
  const handleNewThread = useNewThreadHandler();
  if (environmentId === null) return null;
  return async () => {
    try {
      const project = await ensureStudioProject(environmentId);
      await handleNewThread(scopeProjectRef(environmentId, project.id));
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t open Theme Studio",
          description: error instanceof Error ? error.message : "Try again.",
        }),
      );
    }
  };
}
