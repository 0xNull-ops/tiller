import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { useState } from "react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../state/session";

import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { newMessageId } from "../lib/utils";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";

export interface DraftWorkflowKickoffInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly projectCwd: string;
  readonly workflow: string;
  readonly modelSelection: ModelSelection;
  readonly promptEffort?: string | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly title: string;
  readonly inputs?: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly envMode: "local" | "worktree";
  readonly startFromOrigin: boolean;
}

/**
 * The run's inputs as the agent reads them: one line per input, with the value written out
 * as it was given, so nothing is reworded on the way to the workflow.
 */
function formatWorkflowInputs(inputs: Readonly<Record<string, string>>): string {
  return Object.entries(inputs)
    .flatMap(([id, value]) =>
      value.split("\n").map((line, index) => (index === 0 ? `- ${id}: ${line}` : `  ${line}`)),
    )
    .join("\n");
}

export function buildWorkflowKickoffPrompt(input: {
  readonly workflow: string;
  readonly title: string;
  readonly inputs?: Readonly<Record<string, string>>;
}): string {
  const inputs = input.inputs ?? {};
  if (Object.keys(inputs).length === 0)
    return [
      `Run the ${input.title} workflow.`,
      `Use workflow_run for "${input.workflow}" in this chat.`,
    ].join("\n\n");
  return [
    `Run the ${input.title} workflow.`,
    `Inputs:\n${formatWorkflowInputs(inputs)}`,
    `Use workflow_run for "${input.workflow}" in this chat, with the inputs above exactly as given.`,
  ].join("\n\n");
}

export function buildDraftWorkflowBootstrap(input: DraftWorkflowKickoffInput) {
  return {
    createThread: {
      projectId: input.projectId,
      title: input.title,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      branch: input.branch,
      worktreePath: input.worktreePath,
      createdAt: input.createdAt,
    },
    ...(input.envMode === "worktree" && !input.worktreePath && input.branch
      ? {
          prepareWorktree: {
            projectCwd: input.projectCwd,
            baseBranch: input.branch,
            ...(input.startFromOrigin ? { startFromOrigin: true } : {}),
          },
          runSetupScript: true,
        }
      : {}),
  };
}

/** Starts the first real turn for an unsent draft, preserving its normal bootstrap settings. */
export function useDraftWorkflowKickoff(
  environmentId: EnvironmentId,
  actions: {
    readonly promote: (threadId: ThreadId) => void;
    readonly navigate: (threadId: ThreadId) => void | Promise<void>;
  },
) {
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    label: "start workflow in draft",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canStart = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);

  const run = async (input: DraftWorkflowKickoffInput) => {
    if (busy) return false;
    if (!canStart) {
      setError("You don't have permission to start a thread here.");
      return false;
    }
    if (input.envMode === "worktree" && !input.worktreePath && !input.branch) {
      setError("Select a base branch before running in New worktree mode.");
      return false;
    }
    setBusy(true);
    setError(null);
    const result = await startTurn({
      environmentId: input.environmentId,
      input: {
        threadId: input.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: applyClaudePromptEffortPrefix(
            buildWorkflowKickoffPrompt({
              workflow: input.workflow,
              title: input.title,
              ...(input.inputs === undefined ? {} : { inputs: input.inputs }),
            }),
            input.promptEffort,
          ),
          attachments: [],
        },
        modelSelection: input.modelSelection,
        titleSeed: input.title,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        bootstrap: buildDraftWorkflowBootstrap(input),
        createdAt: new Date().toISOString(),
      },
    });
    if (result._tag === "Failure") {
      setBusy(false);
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
    actions.promote(input.threadId);
    await actions.navigate(input.threadId);
    setBusy(false);
    return true;
  };

  return { run, busy, error, canRun: canStart, clearError: () => setError(null) };
}
