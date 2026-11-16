/**
 * Delivered as outbound provider user text because the cleanup keeps every
 * provider adapter on its upstream shape. Each block is self-contained and
 * short: it is prepended to every ordinary user turn while the thread is on,
 * not injected once into a system prompt.
 */
const workflowFirstRules = `1. For substantial, multi-step work, first call workflow_list with includeScratch: false for the current project. If a saved Tiller canvas workflow is a reasonable fit, propose it by name and wait for approval before workflow_run, unless the user already authorized running it.
2. If none fits, build the canvas now: call workflow_save with empty steps, then workflow_step_put per step so the user watches it grow. Do this before presenting a plan or asking for confirmation. Requests like "ask me before saving" describe approval gates in the workflow: set gate: true on the step that performs that action, rather than withholding canvas creation. Inspect appropriate skills with workflow_skill_list and workflow_skill_read; never claim a skill routine you did not load. Then run it for the task with workflow_run, workflow_status, workflow_step_start and workflow_step_done, unless the user only asked you to build a workflow. Any required confirmation to enable a schedule comes after the canvas exists.
3. A workflow you auto-create under this policy is scratch under "From threads" until the user keeps it: on workflow_save, pass origin {"kind":"workflow-first","threadId":"<id>"} using the thread id below. Do not mark a workflow the user explicitly asked you to create.

Answer simple questions, jokes and tiny edits directly. Continue an active workflow without repeating this check. The main agent only; delegated child work is exempt. Keep is optional: the user can keep a workflow for reuse, and you need not prompt a save after every task.`;

const contextTag = (threadId: string) =>
  `<t3_code_workflow_first_context>{"threadId":${JSON.stringify(threadId)}}</t3_code_workflow_first_context>`;

/**
 * Every block T3 prepends starts with this provenance line. It is what makes an
 * app-generated block identifiable: a user may quote or discuss the policy tags
 * in their own message, and those words are theirs, so the echo strip and the
 * retry check only recognise the exact marked envelope.
 */
const appProvenance = `<t3_code_workflow_first_provenance source="app-setting" />`;

const envelope = (block: string) => `${appProvenance}\n${block}`;

export const workflowFirstPolicy = (threadId: string) =>
  envelope(`<t3_code_workflow_first>
Workflow-first is ON for this thread.
${workflowFirstRules}
${contextTag(threadId)}
</t3_code_workflow_first>`);

export const workflowFirstTransition = (enabled: boolean, threadId: string) =>
  envelope(
    enabled
      ? `<t3_code_workflow_first_transition enabled="true">
Workflow-first is now ON for this thread.
${workflowFirstRules}
${contextTag(threadId)}
</t3_code_workflow_first_transition>`
      : `<t3_code_workflow_first_transition enabled="false">
Workflow-first is now OFF for this thread. Disregard the earlier <t3_code_workflow_first> guidance and do not apply it to later requests. Continue any workflow that is already running.
</t3_code_workflow_first_transition>`,
  );

/**
 * One app block, then the blank line T3 adds before the prompt. Anchored at the
 * start and requiring the provenance line, so a quoted block in the middle of a
 * message never matches and never loses its surrounding whitespace.
 */
const appContextEnvelope = new RegExp(
  '^<t3_code_workflow_first_provenance source="app-setting" />\\n' +
    "(?:<t3_code_workflow_first>[\\s\\S]*?</t3_code_workflow_first>" +
    '|<t3_code_workflow_first_transition enabled="(?:true|false)">[\\s\\S]*?</t3_code_workflow_first_transition>)' +
    "\\n\\n",
);

/**
 * Splits off the app context T3 itself prepended, leaving the user's text
 * byte-for-byte, including any leading newlines of their own. `null` means the
 * text carries no app block, so callers leave it alone.
 */
export const takeLeadingWorkflowFirstContext = (text: string): { readonly rest: string } | null => {
  let rest = text;
  let taken = false;
  while (true) {
    const match = appContextEnvelope.exec(rest);
    if (match === null) break;
    rest = rest.slice(match[0].length);
    taken = true;
  }
  return taken ? { rest } : null;
};

/** Strip our marked block from the native prompt wrappers used by ACP and Cursor. */
const nativeUserRequestWrappers = [
  {
    open: "<t3_code_instructions>\n",
    boundary: "\n</t3_code_instructions>\n\n<user_request>\n",
  },
  {
    open: "<t3_code_orchestration_instructions>",
    boundary: "</t3_code_orchestration_instructions>\n\n<user_request>\n",
  },
] as const;

const stripNativeUserRequestContext = (text: string): string => {
  for (const wrapper of nativeUserRequestWrappers) {
    if (!text.startsWith(wrapper.open)) continue;
    const boundaryIndex = text.indexOf(wrapper.boundary, wrapper.open.length);
    if (boundaryIndex === -1) continue;
    const bodyStart = boundaryIndex + wrapper.boundary.length;
    const body = text.slice(bodyStart);
    const stripped = takeLeadingWorkflowFirstContext(body)?.rest ?? body;
    if (stripped === body) continue;
    return text.slice(0, bodyStart) + stripped;
  }
  return text;
};

/** Prepends exactly one app block, separated by the blank line the strip expects. */
export const withWorkflowFirstContext = (block: string, text: string): string =>
  `${block}\n\n${text}`;

/** Remove only app-generated context when providers echo a prompt into history. */
export const stripWorkflowFirstContext = (text: string): string =>
  stripNativeUserRequestContext(takeLeadingWorkflowFirstContext(text)?.rest ?? text);
