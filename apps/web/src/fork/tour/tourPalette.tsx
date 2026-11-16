import { WorkflowIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "../../components/CommandPalette.logic";
import { useStartTour } from "./useStartTour";

/** The palette's "Replay Tiller tour" entry. */
export function useTourPaletteItem(): CommandPaletteActionItem {
  const startTour = useStartTour();
  return {
    kind: "action",
    value: "action:replay-tour",
    searchTerms: ["Replay Tiller tour", "tour", "intro", "onboarding", "sample workflow"],
    title: "Replay Tiller tour",
    icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      startTour();
    },
  };
}
