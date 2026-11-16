// fork(scenes): one collapsible Theme Studio section for scene themes, ambient settings and chats.
import { PaletteIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SettingsRow } from "../../../components/settings/settingsLayout";
import { FoldedSettingsSection } from "../../../components/settings/FoldedSettingsSection";
import { Button } from "../../../components/ui/button";
import { useActiveScene } from "../useActiveScene";
import { AmbientSettings } from "../ambient/preference";
import { StudioSessionList } from "./StudioSessions";
import { useOpenThemeStudio } from "./useOpenThemeStudio";

export function ThemeStudioSettingsSection({ children }: { readonly children: ReactNode }) {
  const scene = useActiveScene();
  const openThemeStudio = useOpenThemeStudio();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (openThemeStudio === null) return;
    setOpening(true);
    await openThemeStudio();
    setOpening(false);
  };

  return (
    <FoldedSettingsSection
      id="appearance-theme-studio"
      title="Theme Studio"
      summary="Scene themes, ambient effects and chats"
      control={
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={openThemeStudio === null || opening}
            onClick={() => void open()}
          >
            <PaletteIcon />
            New session
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-3 py-3 sm:px-4">
        <p className="max-w-2xl text-pretty text-xs leading-normal text-muted-foreground">
          Describe a scene theme in a chat and an agent designs it for you to preview and apply.
        </p>
        {children}
      </div>
      <AmbientSettings scene={scene} />
      <SettingsRow
        title="Recent chats"
        description="Agent-generated chat titles. Open a chat to keep designing, or rename or delete the chat without touching the themes it made."
      >
        <StudioSessionList />
      </SettingsRow>
    </FoldedSettingsSection>
  );
}
