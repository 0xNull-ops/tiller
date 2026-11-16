import type { CSSProperties } from "react";
import { SettingsRow, SettingResetButton } from "../../../components/settings/settingsLayout";
import { Switch } from "../../../components/ui/switch";
import {
  AMBIENT_CONTROL_LIMITS,
  DEFAULT_AMBIENT_CONTROLS,
  type AmbientControlKey,
  type AmbientControls as Controls,
} from "./controls";

export function AmbientControls({
  controls,
  onChange,
  particles = true,
}: {
  controls: Controls;
  onChange: (value: Controls) => void;
  particles?: boolean;
}) {
  return (
    <>
      {(Object.keys(AMBIENT_CONTROL_LIMITS) as AmbientControlKey[])
        .filter((key) => particles || key === "speed" || key === "opacity")
        .map((key) => {
          const limit = AMBIENT_CONTROL_LIMITS[key];
          const id = `ambient-${key}`;
          return (
            <SettingsRow
              key={key}
              title={limit.label}
              description={limit.description}
              resetAction={
                controls[key] !== DEFAULT_AMBIENT_CONTROLS[key] ? (
                  <SettingResetButton
                    label={limit.label.toLowerCase()}
                    onClick={() => onChange({ ...controls, [key]: DEFAULT_AMBIENT_CONTROLS[key] })}
                  />
                ) : undefined
              }
              control={
                <div className="flex w-full items-center gap-3 sm:w-60">
                  <output
                    htmlFor={id}
                    className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                  >
                    {key === "wind"
                      ? controls[key].toFixed(1)
                      : `${Math.round(controls[key] * 100)}%`}
                  </output>
                  <input
                    id={id}
                    aria-label={limit.label}
                    type="range"
                    className="settings-slider min-w-0 flex-1"
                    min={limit.min}
                    max={limit.max}
                    step={limit.step}
                    value={controls[key]}
                    style={
                      {
                        "--settings-slider-fill-offset": `${0.5 - (controls[key] - limit.min) / (limit.max - limit.min)}rem`,
                        "--settings-slider-progress": `${((controls[key] - limit.min) / (limit.max - limit.min)) * 100}%`,
                      } as CSSProperties
                    }
                    onChange={(event) =>
                      onChange({ ...controls, [key]: Number(event.currentTarget.value) })
                    }
                  />
                </div>
              }
            />
          );
        })}
      {particles ? (
        <SettingsRow
          title="React to activity"
          description="Slightly speed up ambient effects while the agent works."
          control={
            <Switch
              aria-label="React to activity"
              checked={controls.activityBoost}
              onCheckedChange={(activityBoost) => onChange({ ...controls, activityBoost })}
            />
          }
        />
      ) : null}
    </>
  );
}
