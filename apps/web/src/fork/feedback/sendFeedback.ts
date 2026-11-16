import {
  buildFeedbackIssueUrl,
  type FeedbackKind,
  FEEDBACK_NEW_ISSUE_URL,
} from "@t3tools/shared/fork/feedback";

import { toastManager } from "~/components/ui/toast";
import { ensureLocalApi } from "~/localApi";

import { readFeedbackFacts } from "./facts";

/** Opens the prefilled public issue for this kind of feedback in the user's browser. */
export async function sendFeedback(kind: FeedbackKind) {
  const facts = await readFeedbackFacts();
  try {
    await ensureLocalApi().shell.openExternal(buildFeedbackIssueUrl({ kind, facts }));
  } catch {
    toastManager.add({
      type: "error",
      title: "Could not open the feedback form",
      description: `Open ${FEEDBACK_NEW_ISSUE_URL} in a browser instead.`,
    });
  }
}
