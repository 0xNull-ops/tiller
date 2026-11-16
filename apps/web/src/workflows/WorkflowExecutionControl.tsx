import { UsersIcon } from "lucide-react";
import { useState } from "react";
import type {
  EnvironmentId,
  ServerProvider,
  WorkflowListing,
  WorkflowRun,
} from "@t3tools/contracts";
import { useEnvironmentProviders } from "../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../state/server";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { resolveSubagentModels } from "@t3tools/shared/workflowSubagents";
import { WorkflowExecutionSelect } from "./WorkflowExecutionSelect";
import { WorkflowSubagentModelsField } from "./WorkflowSubagentModelsField";

export function workflowExecutionChipLabel(
  mode: string,
  models: ReadonlyArray<string>,
  missing: number,
) {
  const modeLabel =
    mode === "prefer-subagents"
      ? "Prefer subagents"
      : mode === "always-subagents"
        ? "Always subagents"
        : "Agent decides";
  const named =
    models.length > 0
      ? ` · ${models.slice(0, 2).join(", ")}${models.length > 2 ? ` +${models.length - 2}` : ""}`
      : "";
  return `${modeLabel}${missing ? ` · ⚠ ${missing} missing` : named}`;
}

export function WorkflowExecutionControl(props: {
  readonly environmentId: EnvironmentId;
  readonly listing: WorkflowListing;
  readonly run?: WorkflowRun | null;
}) {
  const [open, setOpen] = useState(false);
  const providersByEnvironment = useEnvironmentProviders();
  const providers: ReadonlyArray<ServerProvider> =
    providersByEnvironment instanceof Map
      ? (providersByEnvironment.get(props.environmentId) ?? EMPTY_SERVER_PROVIDERS)
      : EMPTY_SERVER_PROVIDERS;
  const definition = props.run?.definition ?? props.listing.definition;
  if (!definition) return null;
  const listing = props.run ? { ...props.listing, definition } : props.listing;
  const snapshot = props.run
    ? (props.run.subagents ?? { usable: [], missing: [], fallback: false })
    : resolveSubagentModels(definition.subagentModels ?? [], providers);
  const labels = snapshot.usable.map((model) => model.label);
  const mode = definition.execution ?? "auto";
  const warning = snapshot.missing.length > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={warning ? "warning-outline" : "ghost"}
            size="xs"
            aria-label="Workflow subagent settings"
          />
        }
      >
        <UsersIcon />
        {workflowExecutionChipLabel(mode, labels, snapshot.missing.length)}
      </PopoverTrigger>
      {open ? (
        <PopoverPopup
          align="end"
          width="auto"
          className="w-80"
          padding="none"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="space-y-3 p-3">
            <WorkflowExecutionSelect
              environmentId={props.environmentId}
              listing={listing}
              disabled={props.run != null}
            />
            <div className="space-y-1">
              <p className="text-2xs font-medium text-muted-foreground">Subagent models</p>
              <WorkflowSubagentModelsField
                environmentId={props.environmentId}
                projectId={props.listing.projectId}
                listing={listing}
                disabled={props.run != null}
                {...(props.run !== undefined ? { run: props.run } : {})}
              />
            </div>
          </div>
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}
