import { workflowScheduleNextRuns } from "@t3tools/contracts";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { WORKFLOW_SCHEDULE_WEEKDAYS } from "../../workflows/WorkflowSchedulePanel";
import { WORKFLOW_SCHEDULE_SHEET_CLASS } from "../../workflows/WorkflowScheduleSheet";
import { SAMPLE_WORKFLOW } from "./sampleWorkflow";

const WEEKDAY_RUNS = [1, 2, 3, 4, 5];
const PREVIEW_SCHEDULE = {
  type: "fixed_time",
  timeOfDay: "09:00",
  weekdays: WEEKDAY_RUNS,
} as const;
const PRESETS = [
  "Every hour",
  "Every day 09:00",
  "Weekdays 09:00",
  "Every Monday",
  "Every 15 minutes",
  "Custom",
];

/**
 * The scheduler sheet at the sample's weekday 09:00 trigger, read-only: every control is
 * disabled and no hook here reaches a store, an RPC or a provider.
 */
export function SchedulerPreview() {
  const [now] = useState(() => new Date().toISOString());
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nextRuns = workflowScheduleNextRuns(PREVIEW_SCHEDULE, now, timeZone, 3);
  return (
    <section
      aria-label="Schedule preview"
      className={cn(
        WORKFLOW_SCHEDULE_SHEET_CLASS,
        "fixed bottom-0 left-1/2 max-h-(--tour-preview-height) -translate-x-1/2 overflow-auto p-6",
      )}
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">Workflow schedules</h2>
        <p className="text-xs text-muted-foreground">{SAMPLE_WORKFLOW.name}</p>
        <Badge variant="outline">Sample · read-only</Badge>
      </header>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Add schedule</h3>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="xs"
                variant={preset === "Weekdays 09:00" ? "default" : "outline"}
                aria-pressed={preset === "Weekdays 09:00"}
                disabled
              >
                {preset}
              </Button>
            ))}
          </div>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-xs">Days</legend>
            {WORKFLOW_SCHEDULE_WEEKDAYS.map((label, day) => (
              <label key={label} className="flex items-center gap-1 text-xs">
                <Checkbox checked={WEEKDAY_RUNS.includes(day)} disabled />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1 text-xs">
            Time
            <Input aria-label="Schedule time" type="time" value="09:00" readOnly disabled />
          </label>
          <p className="text-xs text-muted-foreground">
            Runs at 09:00 on Mon, Tue, Wed, Thu and Fri. This chat’s agent drives each run.
          </p>
        </div>
        <aside className="space-y-2">
          <h3 className="text-sm font-medium">Next 3 runs · {timeZone}</h3>
          <ol className="space-y-1 text-xs text-muted-foreground">
            {nextRuns.map((at) => (
              <li key={at}>{new Date(at).toLocaleString()}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Nothing here is saved and no run starts. Back, Next or Skip closes this preview.
          </p>
          <Button type="button" size="xs" disabled>
            Add schedule
          </Button>
        </aside>
      </div>
    </section>
  );
}
