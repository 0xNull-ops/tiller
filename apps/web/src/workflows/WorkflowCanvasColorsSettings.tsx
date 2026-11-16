import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import {
  useScopedSettings,
  useUpdateScopedSettings,
} from "../components/settings/useScopedSettings";
import { cn } from "~/lib/utils";
import { WORKFLOW_CANVAS_COLOR_PRESETS, WORKFLOW_CANVAS_KINDS } from "./workflowCanvasColors";

/** One row per attachment kind, each with the preset swatches. Stored per device, like appearance. */
export function WorkflowCanvasColorsSettings() {
  const colors = useScopedSettings((settings) => settings.workflowCanvasColors);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection id="workflow-canvas-colors" title="Workflow canvas colours">
      {WORKFLOW_CANVAS_KINDS.map(({ kind, label, defaultColor }) => {
        const current = colors[kind] ?? defaultColor;
        const pick = (color: string) =>
          updateSettings({ workflowCanvasColors: { ...colors, [kind]: color } });
        // Resetting drops the pick instead of storing today's default, so a later default reaches
        // this user too.
        const reset = () => {
          const rest = { ...colors };
          delete rest[kind];
          updateSettings({ workflowCanvasColors: rest });
        };
        return (
          <SettingsRow
            key={kind}
            title={label}
            resetAction={
              current === defaultColor ? null : (
                <SettingResetButton label={`${label} colour`} onClick={reset} />
              )
            }
            control={
              <div className="flex items-center gap-1.5">
                {WORKFLOW_CANVAS_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.color}
                    type="button"
                    aria-label={`${label}: ${preset.name}`}
                    aria-pressed={preset.color === current}
                    onClick={() => pick(preset.color)}
                    style={{ backgroundColor: preset.color }}
                    className={cn(
                      "size-5 rounded-full border border-border/60 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      preset.color === current && "ring-2 ring-inset ring-primary",
                    )}
                  />
                ))}
              </div>
            }
          />
        );
      })}
    </SettingsSection>
  );
}
