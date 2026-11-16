import {
  buildFeedbackIssueUrl,
  type FeedbackFacts,
  type FeedbackKind,
} from "@t3tools/shared/fork/feedback";

import * as Electron from "electron";

/** Opens the prefilled issue in the user's browser and reports whether it opened. */
export async function openFeedbackIssue(input: {
  readonly kind: FeedbackKind;
  readonly facts: FeedbackFacts;
}): Promise<boolean> {
  // Only the three environment facts are prefilled: no logs, prompts, paths or project names.
  const url = buildFeedbackIssueUrl(input);
  try {
    await Electron.shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}
