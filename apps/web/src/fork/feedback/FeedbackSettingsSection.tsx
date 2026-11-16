import { FEEDBACK_KIND_LABELS } from "@t3tools/shared/fork/feedback";
import { BugIcon, LightbulbIcon } from "lucide-react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { searchableSetting } from "~/components/settings/settingsSearch";
import { Button } from "~/components/ui/button";

import { sendFeedback } from "./sendFeedback";

export function FeedbackSettingsSection() {
  return (
    <SettingsSection id="feedback" title="Feedback">
      <SettingsRow
        {...searchableSetting("send-feedback")}
        description="Opens a new issue on the public Tiller repository. It fills in your app version, macOS version and architecture, and never includes logs, prompts, file paths or project names."
        control={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void sendFeedback("bug")}>
              <BugIcon className="size-3.5" aria-hidden="true" />
              {FEEDBACK_KIND_LABELS.bug}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void sendFeedback("feature")}>
              <LightbulbIcon className="size-3.5" aria-hidden="true" />
              {FEEDBACK_KIND_LABELS.feature}
            </Button>
          </div>
        }
      />
    </SettingsSection>
  );
}
