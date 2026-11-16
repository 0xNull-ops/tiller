import type { WorkflowWaitBefore } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { stepDelay, waitForMode, waitMode, type WaitMode } from "./waitControlValue";

export function WaitControl({
  value,
  onChange,
  disabled,
  timeZone,
}: {
  value: WorkflowWaitBefore | undefined;
  onChange: (value: WorkflowWaitBefore | undefined) => void;
  disabled?: boolean | undefined;
  timeZone?: string | undefined;
}) {
  return (
    <div className="space-y-3">
      <ToggleGroup
        aria-label="Wait mode"
        value={[waitMode(value)]}
        disabled={disabled}
        onValueChange={(modes) => {
          const mode = modes[0] as WaitMode | undefined;
          if (mode) onChange(waitForMode(mode, value));
        }}
      >
        <Toggle value="none">None</Toggle>
        <Toggle value="delay">Delay</Toggle>
        <Toggle value="until">Until</Toggle>
      </ToggleGroup>
      {value?.kind === "delay" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon-xs"
              variant="outline"
              aria-label="Decrease wait"
              disabled={disabled || value.minutes <= 1}
              onClick={() => onChange({ ...value, minutes: stepDelay(value.minutes, -1) })}
            >
              −
            </Button>
            <div className="w-20">
              <Input
                size="sm"
                type="number"
                min={1}
                max={525600}
                aria-label="Wait minutes"
                value={value.minutes}
                disabled={disabled}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  if (Number.isFinite(minutes) && minutes > 0 && minutes <= 525600)
                    onChange({ ...value, minutes });
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground">min</span>
            <Button
              size="icon-xs"
              variant="outline"
              aria-label="Increase wait"
              disabled={disabled || value.minutes >= 1440}
              onClick={() => onChange({ ...value, minutes: stepDelay(value.minutes, 1) })}
            >
              +
            </Button>
          </div>
          <div className="flex gap-1">
            {([5, 15, 60, 120] as const).map((minutes) => (
              <Button
                key={minutes}
                size="xs"
                variant={value.minutes === minutes ? "secondary" : "ghost"}
                disabled={disabled}
                onClick={() => onChange({ ...value, minutes })}
              >
                {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {value?.kind === "until" ? (
        <div className="space-y-2">
          <div className="w-fit">
            <Input
              size="sm"
              type="time"
              aria-label="Wait until"
              value={value.timeOfDay}
              disabled={disabled}
              onChange={(event) => {
                if (event.target.value) onChange({ ...value, timeOfDay: event.target.value });
              }}
            />
          </div>
          <ToggleGroup
            multiple
            variant="outline"
            size="sm"
            aria-label="Wait weekdays"
            disabled={disabled}
            value={(value.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).map(String)}
            onValueChange={(days) => {
              if (days.length) onChange({ ...value, weekdays: days.map(Number) });
            }}
          >
            {([1, 2, 3, 4, 5, 6, 0] as const).map((day) => (
              <Toggle
                key={day}
                value={String(day)}
                aria-label={
                  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
                    day
                  ]
                }
              >
                {["S", "M", "T", "W", "T", "F", "S"][day]}
              </Toggle>
            ))}
          </ToggleGroup>
          <p className="text-2xs text-muted-foreground">
            server time · {timeZone ?? "server local timezone"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
