import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { resolvePromptInjectedEffort } from "@t3tools/shared/model";

import { useComposerHandleContext } from "../composerHandleContext";
import { markPromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { readProject } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useDraftWorkflowKickoff } from "./draftWorkflowKickoff";
import { getProviderModelCapabilities } from "../providerModels";
import { DEFAULT_INTERACTION_MODE } from "../types";

export function useWorkflowDraftRun(thread: ScopedThreadRef) {
  const composer = useComposerHandleContext();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const kickoff = useDraftWorkflowKickoff(thread.environmentId, {
    promote: () => markPromotedDraftThreadByRef(thread),
    navigate: () =>
      navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(thread) }),
  });

  const run = async (workflow: string, title: string, inputs?: Record<string, string>) => {
    setError(null);
    const store = useComposerDraftStore.getState();
    const draft = store.getDraftSessionByRef(thread);
    const draftId = store.getDraftIdByRef(thread);
    const context = composer?.current?.getSendContext();
    const project = draft
      ? readProject(scopeProjectRef(thread.environmentId, draft.projectId))
      : null;
    if (!draft || !draftId || !project) {
      setError("This draft no longer points to an available project.");
      return false;
    }
    if (!context?.providerAvailable) {
      setError("Select an available model in the composer before running this workflow.");
      return false;
    }
    const composerDraft = store.getComposerDraft(draftId);
    return kickoff.run({
      ...draft,
      environmentId: thread.environmentId,
      threadId: thread.threadId,
      projectCwd: project.workspaceRoot,
      workflow,
      title,
      ...(inputs === undefined ? {} : { inputs }),
      modelSelection: context.selectedModelSelection,
      promptEffort: context.selectedPromptEffort
        ? resolvePromptInjectedEffort(
            getProviderModelCapabilities(
              context.selectedProviderModels,
              context.selectedModel,
              context.selectedProvider,
            ),
            context.selectedPromptEffort,
          )
        : null,
      runtimeMode: composerDraft?.runtimeMode ?? draft.runtimeMode,
      interactionMode: DEFAULT_INTERACTION_MODE,
    });
  };
  return { run, busy: kickoff.busy, error: error ?? kickoff.error, canRun: kickoff.canRun };
}
