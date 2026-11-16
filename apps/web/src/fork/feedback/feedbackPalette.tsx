import { FEEDBACK_KIND_LABELS, type FeedbackKind } from "@t3tools/shared/fork/feedback";
import { BugIcon, LightbulbIcon, MessageSquareIcon } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteSubmenuItem } from "~/components/CommandPalette.logic";

import { sendFeedback } from "./sendFeedback";

const ITEM_ICONS = { bug: BugIcon, feature: LightbulbIcon } as const;

const ITEM_SEARCH_TERMS: Readonly<Record<FeedbackKind, ReadonlyArray<string>>> = {
  bug: ["bug", "issue", "report", "broken", "crash"],
  feature: ["feature", "request", "idea", "suggest"],
};

const FEEDBACK_GROUP_ITEMS = (["bug", "feature"] as const).map((kind: FeedbackKind) => {
  const Icon = ITEM_ICONS[kind];
  return {
    kind: "action" as const,
    value: `action:feedback-${kind}`,
    title: FEEDBACK_KIND_LABELS[kind],
    searchTerms: ITEM_SEARCH_TERMS[kind],
    description: "Opens a new issue on the public Tiller repository",
    icon: <Icon className={ITEM_ICON_CLASS} />,
    run: () => sendFeedback(kind),
  };
});

export function buildFeedbackPaletteItem(): CommandPaletteSubmenuItem {
  return {
    kind: "submenu",
    value: "action:send-feedback",
    searchTerms: ["feedback", "bug", "issue", "feature", "request", "github", "support", "help"],
    title: "Send feedback",
    icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
    groups: [{ value: "feedback", label: "Send feedback", items: FEEDBACK_GROUP_ITEMS }],
  };
}
