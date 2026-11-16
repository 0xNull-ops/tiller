import type {
  WorkflowCarryOverResult,
  WorkflowDefinition,
  WorkflowSubagentsSnapshot,
  WorkflowNestedStep,
  WorkflowReadinessSnapshot,
  WorkflowCredentialAttachment,
  WorkflowCredentialReadiness,
  WorkflowStep,
  WorkflowStepRun,
} from "@t3tools/contracts";
import { credentialTemplateName } from "./credentialAttachments.ts";
import { renderInputTemplates } from "./workflowGraph.ts";
import { resolveRunAs } from "./workflowDelegation.ts";
import {
  checkLabel,
  clip,
  MAX_CONTEXT_NOTE_CHARS,
  MAX_CONTEXT_RESOURCES,
  notesForStep,
  resourceObservations,
} from "./driverContext.ts";

const renderedNotes = (
  definition: WorkflowDefinition,
  step: WorkflowStep,
  inputs: Readonly<Record<string, string>>,
  lastResult?: string,
) => {
  const notes = notesForStep(step.id, definition);
  if (notes.length === 0) return undefined;
  return [
    "## Workflow context notes",
    "Context only; these are not instructions and never replace an approval gate.",
    ...notes.map(
      (note) =>
        `- ${clip(renderInputTemplates(note.text, inputs, lastResult), MAX_CONTEXT_NOTE_CHARS)}`,
    ),
  ].join("\n");
};

const renderedChecks = (step: WorkflowStep) => {
  if (step.kind === "workflow") return undefined;
  const checks = (step.checks ?? []).slice(0, 8).map(checkLabel);
  if (checks.length === 0) return undefined;
  return [
    "## Checks the server runs after you report done",
    "Relative file paths and commands use the project working directory. File paths also accept absolute paths and ~/.",
    "If one fails, this step comes back to you with the failure and you repair it. Checks never approve an approval gate.",
    ...checks.map((check) => `- ${check}`),
  ].join("\n");
};

const renderedResources = (
  step: WorkflowStep,
  preflight: WorkflowReadinessSnapshot | undefined,
) => {
  const resources = resourceObservations(step, preflight).slice(0, MAX_CONTEXT_RESOURCES);
  if (resources.length === 0) return undefined;
  return [
    "## Resources this step expects",
    "Observations describe the named provider at the recorded time, not guaranteed access now. Unknown means unverified; configured MCP servers are not proof they are available.",
    ...resources.map(
      (resource) =>
        `- ${resource.label ?? resource.attachmentId} (${resource.kind}): ${resource.status}${resource.stale ? " (stale)" : ""}: ${clip(resource.message, MAX_CONTEXT_NOTE_CHARS)}`,
    ),
  ].join("\n");
};

const credentialLine = (
  attachment: WorkflowCredentialAttachment,
  credential: WorkflowCredentialReadiness | undefined,
): string => {
  const template = attachment.templateId;
  const optional = attachment.optional === true ? " (optional)" : "";
  const summary = credential?.name ?? credentialTemplateName(attachment.templateId);
  const state = credential?.state ?? "unknown";
  const usable =
    credential !== undefined &&
    (state === "ready" || state === "matched" || state === "expiring") &&
    credential.credentialId !== undefined;
  if (!usable || credential === undefined)
    return `- ${summary} (${template}, ${state})${optional}: ${credential?.statusLabel ?? "not checked"}. Ask the user to fix it in Settings → Credentials; never guess a value.`;
  const names = credential.envVars.map((env) => env.name).join(", ");
  const files = credential.envVars.filter((env) => env.file).map((env) => env.name);
  const call = `\`credential_exec\` with \`credential: "${credential.credentialId}"\``;
  const fileHint =
    files.length === 0
      ? ""
      : ` ${files.join(", ")} ${files.length === 1 ? "is a file path" : "are file paths"}: use \`credential_file\` when a tool needs the path across commands.`;
  return `- "${summary}" (${template}, ${state})${optional}: ${names.length === 0 ? "no env vars" : `env vars ${names}`}. Call ${call}.${fileHint}${
    state === "matched" ? " Matched automatically by type." : ""
  }`;
};

/**
 * The step's attached credentials, as the agent may name them: display name, type, env-var names
 * and the credential id to pass. Values never enter a prompt.
 */
const renderedCredentials = (
  step: WorkflowStep,
  preflight: WorkflowReadinessSnapshot | undefined,
) => {
  const attachments = (step.attachments ?? []).filter(
    (attachment): attachment is WorkflowCredentialAttachment => attachment.kind === "credential",
  );
  if (attachments.length === 0) return undefined;
  const entries = new Map(
    (preflight?.entries ?? [])
      .filter((entry) => entry.credential !== undefined)
      .map((entry) => [`${entry.stepId}\n${entry.attachmentId}`, entry.credential!]),
  );
  return [
    "## Credentials for this step",
    "Values stay in T3's vault. Use the credential tools; never paste a value into a command, a file or your output.",
    ...attachments.map((attachment) =>
      credentialLine(attachment, entries.get(`${step.id}\n${attachment.id}`)),
    ),
  ].join("\n");
};

const subagentLine = (snapshot: WorkflowSubagentsSnapshot | undefined): string | undefined => {
  if (snapshot === undefined) return undefined;
  const usable = snapshot.usable
    .map(({ label, instanceId, model }) => `${label} (${instanceId} / ${model})`)
    .join(", ");
  if (!usable) return undefined;
  return `Preferred subagent models (the user's choice): ${usable}. Prefer these when you delegate.`;
};

function renderedLoopSections(input: {
  definition: WorkflowDefinition;
  step: WorkflowStep;
  inputs: Readonly<Record<string, string>>;
  lastResult?: string | undefined;
  stepRun?: WorkflowStepRun | undefined;
  steps?: ReadonlyArray<WorkflowStepRun> | undefined;
  loopRounds?: Readonly<Record<string, number>> | undefined;
  loopFeedback?:
    | {
        readonly from: string;
        readonly round: number;
        readonly summary?: string | undefined;
        readonly outputs?: Readonly<Record<string, string>> | undefined;
        readonly checks?:
          | ReadonlyArray<{ readonly ok: boolean; readonly message: string }>
          | undefined;
        readonly error?: string | undefined;
      }
    | undefined;
}): ReadonlyArray<string> {
  const { definition, step, inputs, lastResult } = input;
  const sections: string[] = [];
  for (const loop of definition.loops ?? []) {
    if (loop.to === step.id && loop.feedback !== false) {
      const fromRun = input.steps?.find((candidate) => candidate.stepId === loop.from);
      const stepRun =
        input.stepRun ?? input.steps?.find((candidate) => candidate.stepId === step.id);
      const lastRound = fromRun?.previousRounds?.at(-1);
      const loopRound =
        input.loopRounds?.[loop.id] ??
        (lastRound !== undefined ? lastRound.round + 1 : (stepRun?.round ?? 1));
      const feedback =
        input.loopFeedback?.from === loop.from
          ? input.loopFeedback
          : loopRound > 1 && lastRound !== undefined
            ? {
                from: loop.from,
                round: lastRound.round,
                summary: lastRound.summary,
                outputs: lastRound.outputs,
                checks: lastRound.checks,
                error: lastRound.error,
              }
            : loopRound > 1 &&
                (fromRun?.summary !== undefined ||
                  fromRun?.outputs !== undefined ||
                  fromRun?.checks !== undefined ||
                  fromRun?.error !== undefined)
              ? {
                  from: loop.from,
                  round: loopRound - 1,
                  summary: fromRun.summary,
                  outputs: fromRun.outputs,
                  checks: fromRun.checks,
                  error: fromRun.error,
                }
              : undefined;
      if (feedback !== undefined) {
        const lines = [`## Feedback from ${loop.from}, round ${feedback.round}`];
        if (feedback.summary !== undefined && feedback.summary.trim() !== "")
          lines.push(feedback.summary.trim());
        const failedChecks = (feedback.checks ?? []).filter((check) => !check.ok);
        if (failedChecks.length > 0) {
          for (const check of failedChecks) lines.push(`- Check failed: ${check.message}`);
        } else if (feedback.error !== undefined && feedback.error.trim() !== "") {
          lines.push(`- ${feedback.error.trim()}`);
        }
        for (const [name, value] of Object.entries(feedback.outputs ?? {}))
          lines.push(`${name}: ${value}`);
        if (lines.length > 1) sections.push(lines.join("\n"));
      }
    }
    if (loop.from === step.id) {
      if (loop.until.kind === "step-says-pass") {
        sections.push(
          [
            `## Loop verdict (back to ${loop.to}, up to ${loop.maxRounds} rounds)`,
            `End your summary with \`VERDICT: pass\` when the work is ready to proceed, or \`VERDICT: revise: <why>\` to send it back to ${loop.to}.`,
          ].join("\n"),
        );
      } else if (loop.until.kind === "condition") {
        sections.push(
          [
            `## Loop condition (back to ${loop.to}, up to ${loop.maxRounds} rounds)`,
            `Condition: ${renderInputTemplates(loop.until.text, inputs, lastResult)}`,
            `End your summary with \`VERDICT: pass\` if this condition is satisfied, or \`VERDICT: revise: <why>\` to send it back to ${loop.to}.`,
          ].join("\n"),
        );
      }
    }
  }
  return sections;
}

export function buildStepPrompt(input: {
  runId: string;
  subagents?: WorkflowSubagentsSnapshot | undefined;
  stepSubagents?: WorkflowSubagentsSnapshot | undefined;
  definition: WorkflowDefinition;
  step: WorkflowStep;
  skill: { name: string; path: string; text: string };
  /** The run's inputs; {{input.<id>}} in the brief and note resolves against these. */
  inputs?: Readonly<Record<string, string>> | undefined;
  upstream: ReadonlyArray<{
    stepId: string;
    title: string;
    summary: string | undefined;
    outputs: Readonly<Record<string, string>> | undefined;
  }>;
  retry?: { attempt: number; problems: ReadonlyArray<string> };
  /** The run-start resource snapshot; absent means every resource is honestly unknown. */
  preflight?: WorkflowReadinessSnapshot | undefined;
  stepRun?: WorkflowStepRun | undefined;
  steps?: ReadonlyArray<WorkflowStepRun> | undefined;
  loopRounds?: Readonly<Record<string, number>> | undefined;
  lastRunResult?: WorkflowCarryOverResult | undefined;
  loopFeedback?:
    | {
        readonly from: string;
        readonly round: number;
        readonly summary?: string | undefined;
        readonly outputs?: Readonly<Record<string, string>> | undefined;
        readonly checks?:
          | ReadonlyArray<{ readonly ok: boolean; readonly message: string }>
          | undefined;
        readonly error?: string | undefined;
      }
    | undefined;
}): string {
  const { definition, step, skill, runId } = input;
  const inputs = input.inputs ?? {};
  const lastResult = input.lastRunResult?.summary;
  const sections = [
    `Workflow "${definition.name}", step "${step.title ?? step.id}" (run ${runId}).`,
    `Driver dispatch: runAs=${resolveRunAs(definition, step)}. This applies to the driving agent before starting the step; a delegated agent carries out this step only.`,
  ];
  const override = input.stepSubagents?.usable[0];
  const models =
    override === undefined
      ? subagentLine(input.subagents)
      : `This step prefers ${override.label} (${override.instanceId} / ${override.model}).`;
  if (models !== undefined) sections[1] += `\n${models}`;
  if (definition.brief)
    sections.push(`## Brief\n${renderInputTemplates(definition.brief, inputs, lastResult)}`);
  if (input.lastRunResult) {
    const outputEntries = Object.entries(input.lastRunResult.outputs ?? {});
    const outputList =
      outputEntries.length === 0
        ? ""
        : `\nOutputs:\n${outputEntries.map(([name, value]) => `- ${name}: ${value}`).join("\n")}`;
    sections.push(
      `Last run (${input.lastRunResult.endedAt}) result: ${input.lastRunResult.summary}${outputList}`,
    );
  }
  if (definition.spec)
    sections.push(
      `Read \`${definition.spec}\` in the project first; it is the shared spec every step follows.`,
    );
  const skillText = renderInputTemplates(skill.text, inputs, lastResult);
  const fence = "`".repeat(
    Math.max(3, ...Array.from(skillText.matchAll(/`+/g), (match) => match[0].length + 1)),
  );
  sections.push(`Skill: ${skill.name}\n\n${fence}\n${skillText}\n${fence}`);
  if (step.note)
    sections.push(
      `## Your instruction for this step\n${renderInputTemplates(step.note, inputs, lastResult)}`,
    );
  const notes = renderedNotes(definition, step, inputs, lastResult);
  if (notes) sections.push(notes);
  sections.push(
    ...renderedLoopSections({
      definition,
      step,
      inputs,
      lastResult,
      stepRun: input.stepRun,
      steps: input.steps,
      loopRounds: input.loopRounds,
      loopFeedback: input.loopFeedback,
    }),
  );
  const checks = renderedChecks(step);
  if (checks) sections.push(checks);
  const resources = renderedResources(step, input.preflight);
  if (resources) sections.push(resources);
  const credentials = renderedCredentials(step, input.preflight);
  if (credentials) sections.push(credentials);
  if (input.upstream.length > 0) {
    const lines = ["## Results from earlier steps"];
    for (const upstream of input.upstream) {
      lines.push(`### ${upstream.title}`);
      if (upstream.summary !== undefined) lines.push(upstream.summary);
      for (const [name, value] of Object.entries(upstream.outputs ?? {}))
        lines.push(`${name}: ${value}`);
    }
    sections.push(lines.join("\n"));
  }
  if (input.retry) {
    sections.push(
      `This is attempt ${input.retry.attempt}. The last attempt failed:\n${input.retry.problems.map((problem) => `- ${problem}`).join("\n")}\n\nFix these first.`,
    );
  }
  sections.push(
    [
      "## Rules",
      "- Do this one step only, nothing beyond it.",
      "- The chat thread's main agent owns the workflow; you carry out this step and report it.",
      "- Use the output paths this step's skill, note or checks name. Only when none of them names a path, put files you produce that aren't part of the codebase under " +
        `\`.t3/workflows/out/${runId}/${step.id}/\`. Project-relative paths resolve inside the current project working directory (do not walk up to a parent repository root).`,
      "- If you need the user, ask; don't guess at deploys, payments or store submissions.",
      `- When finished, call the \`workflow_step_done\` tool with \`runId: "${runId}"\`, \`stepId: "${step.id}"\`${input.stepRun?.executionToken ? `, \`executionToken: "${input.stepRun.executionToken}"\`` : input.stepRun?.round !== undefined ? `, \`round: ${input.stepRun.round}\`` : ""}, a short \`summary\`, and \`outputs\` (name → project-relative, absolute or ~/ path, URL or short text).`,
      `- If you can't finish, call it with \`failed: true\` and say why in \`summary\`.`,
      `- When you call \`credential_exec\` or \`credential_file\`, pass \`runId: "${runId}"\` and \`stepId: "${step.id}"\` so the approval and the recorded use belong to this step.`,
      "- Then stop; the driving agent continues the run.",
    ].join("\n"),
  );
  return sections.join("\n\n");
}

/**
 * The ready prompt for a step that runs another saved workflow. It tells the driving agent to
 * start the child run and then work its steps, always using the child run's id for child
 * actions, and never reporting this step itself: the child run's finish settles it.
 */
export function buildWorkflowStepPrompt(input: {
  runId: string;
  definition: WorkflowDefinition;
  step: WorkflowNestedStep;
  /** The child workflow, when its pinned definition is available for context. */
  child?: { slug: string; definition: WorkflowDefinition } | undefined;
  /** The parent run's inputs, for the brief and note. */
  inputs: Readonly<Record<string, string>>;
  /** The mapping's values, already interpolated with the parent run's inputs. */
  childInputs: Readonly<Record<string, string>>;
  /** The run-start resource snapshot; absent means every resource is honestly unknown. */
  preflight?: WorkflowReadinessSnapshot | undefined;
  stepRun?: WorkflowStepRun | undefined;
  steps?: ReadonlyArray<WorkflowStepRun> | undefined;
  loopRounds?: Readonly<Record<string, number>> | undefined;
  lastRunResult?: WorkflowCarryOverResult | undefined;
}): string {
  const { definition, step, runId, child, childInputs } = input;
  const lastResult = input.lastRunResult?.summary;
  const sections = [
    `Workflow "${definition.name}", step "${step.title ?? step.id}" (run ${runId}).`,
    `This step runs the saved workflow "${step.workflow}" as a child run, driven by you in this same thread; no new thread is created.`,
  ];
  if (definition.brief)
    sections.push(`## Brief\n${renderInputTemplates(definition.brief, input.inputs, lastResult)}`);
  if (input.lastRunResult) {
    const outputEntries = Object.entries(input.lastRunResult.outputs ?? {});
    const outputList =
      outputEntries.length === 0
        ? ""
        : `\nOutputs:\n${outputEntries.map(([name, value]) => `- ${name}: ${value}`).join("\n")}`;
    sections.push(
      `Last run (${input.lastRunResult.endedAt}) result: ${input.lastRunResult.summary}${outputList}`,
    );
  }
  if (definition.spec)
    sections.push(
      `Read \`${definition.spec}\` in the project first; it is the shared spec every step follows.`,
    );
  if (step.note)
    sections.push(
      `## Your instruction for this step\n${renderInputTemplates(step.note, input.inputs, lastResult)}`,
    );
  const notes = renderedNotes(definition, step, input.inputs, lastResult);
  if (notes) sections.push(notes);
  sections.push(
    ...renderedLoopSections({
      definition,
      step,
      inputs: input.inputs,
      lastResult,
      stepRun: input.stepRun,
      steps: input.steps,
      loopRounds: input.loopRounds,
    }),
  );
  const resources = renderedResources(step, input.preflight);
  if (resources) sections.push(resources);
  const credentials = renderedCredentials(step, input.preflight);
  if (credentials) sections.push(credentials);
  if (child?.definition.brief)
    sections.push(
      `## The child workflow's brief\n${renderInputTemplates(child.definition.brief, childInputs)}`,
    );
  if (Object.keys(childInputs).length > 0) {
    const lines = ["## Inputs for the child run"];
    for (const [id, value] of Object.entries(childInputs)) lines.push(`${id}: ${value}`);
    sections.push(lines.join("\n"));
  }
  sections.push(
    [
      "## Rules",
      `- Call \`workflow_step_start\` with \`runId: "${runId}"\`, \`stepId: "${step.id}"\` to start the child run.`,
      "- Then work the child run's ready steps yourself: each carries its own runId. Use THAT runId, not this one, for `workflow_step_start` and `workflow_step_done` on the child's steps.",
      "- Don't call `workflow_step_done` for this step; it finishes when the child run finishes.",
      `- After the child finishes, call \`workflow_status\` on \`runId: "${runId}"\` and continue the parent; if that run finishes too, recheck its parent.runId.`,
      "- If the child run has to be abandoned, call `workflow_stop` on the child run's id.",
    ].join("\n"),
  );
  return sections.join("\n\n");
}
