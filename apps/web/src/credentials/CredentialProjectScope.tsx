import type { ProjectId } from "@t3tools/contracts";
import { useId } from "react";

import { Checkbox } from "../components/ui/checkbox";
import { Radio, RadioGroup } from "../components/ui/radio-group";

export interface CredentialProjectOption {
  readonly id: ProjectId;
  readonly title: string;
}

export function CredentialProjectScope({
  projects,
  scope,
  projectIds,
  disabled = false,
  onChange,
}: {
  readonly projects: ReadonlyArray<CredentialProjectOption>;
  readonly scope: "all" | "selected";
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly disabled?: boolean | undefined;
  readonly onChange: (scope: "all" | "selected", projectIds: ReadonlyArray<ProjectId>) => void;
}) {
  const labelId = useId();
  const toggle = (projectId: ProjectId, checked: boolean) => {
    onChange(
      "selected",
      checked
        ? [...projectIds.filter((id) => id !== projectId), projectId]
        : projectIds.filter((id) => id !== projectId),
    );
  };

  return (
    <div className="space-y-2">
      <span id={labelId} className="text-sm font-medium">
        Projects
      </span>
      <RadioGroup
        aria-labelledby={labelId}
        value={scope}
        disabled={disabled}
        onValueChange={(value) => {
          if (value === "all" || value === "selected") {
            onChange(value, value === "all" ? [] : projectIds);
          }
        }}
      >
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Radio value="all" />
          <span>All projects</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Radio value="selected" />
          <span>Only these projects</span>
        </label>
      </RadioGroup>
      {scope === "selected" ? (
        <div className="space-y-1 rounded-lg border border-border p-2">
          {projects.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              No projects are open in this environment yet.
            </p>
          ) : (
            projects.map((project) => (
              <label
                key={project.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={projectIds.includes(project.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) => toggle(project.id, checked === true)}
                />
                <span className="min-w-0 flex-1 truncate">{project.title}</span>
              </label>
            ))
          )}
          {projectIds.length === 0 ? (
            <p className="px-1 py-1 text-xs text-warning-foreground">
              With none selected, no project can use this credential.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
