import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Input } from "../components/ui/input";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { useEnvironmentQuery } from "../state/query";
import { useWorkflowEdit, workflowRead } from "./workflowState";
import { useWorkflowLiveRefresh } from "./useWorkflowLiveRefresh";
import { Switch } from "../components/ui/switch"; // fork(workflow-first)

export function WorkflowGeneralSettings(props: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(
    workflowRead({ environmentId: props.environmentId, input: { _tag: "preferences" } }),
  );
  const edit = useWorkflowEdit(props.environmentId);
  const preferences = query.data?._tag === "preferences" ? query.data.preferences : null;
  const [draft, setDraft] = useState<{ readonly value: number; readonly revision: number } | null>(
    null,
  );
  const value =
    draft?.revision === query.dataUpdatedAt ? draft.value : (preferences?.maxSubagentModels ?? 4);
  useWorkflowLiveRefresh(props.environmentId, query.refresh);

  const save = async () => {
    if (
      !edit.canEdit ||
      edit.busy ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 16 ||
      value === preferences?.maxSubagentModels
    )
      return;
    await edit.run({ _tag: "preferencesSet", maxSubagentModels: value });
  };

  return (
    <SettingsSection id="workflow-general-settings" title="Workflows">
      <SettingsRow
        title="Show built-in workflows"
        description="Include starter templates in the workflow gallery."
        control={
          <Switch
            aria-label="Show built-in workflows"
            checked={preferences?.showBuiltinWorkflows ?? true}
            disabled={!edit.canEdit || edit.busy || preferences === null}
            onCheckedChange={(enabled) =>
              void edit
                .run({ _tag: "preferencesSet", showBuiltinWorkflows: enabled })
                .then(() => query.refresh())
            }
          />
        }
      />
      <SettingsRow
        title="Workflow-first for new threads"
        description="Check saved workflows before multi-step work in newly created threads."
        control={
          <Switch
            checked={preferences?.workflowFirstForNewThreads ?? false}
            disabled={!edit.canEdit || edit.busy || preferences === null}
            onCheckedChange={(enabled) =>
              void edit
                .run({ _tag: "preferencesSet", workflowFirstForNewThreads: enabled })
                .then(() => query.refresh())
            }
            aria-label="Workflow-first for new threads"
          />
        }
      />
      <SettingsRow
        title="Max subagent models per workflow"
        description="Limit how many subagent model choices a workflow can store."
        control={
          <div className="w-24">
            <Input
              aria-label="Max subagent models per workflow"
              type="number"
              min={1}
              max={16}
              step={1}
              value={value}
              disabled={!edit.canEdit || edit.busy}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (Number.isInteger(next) && next >= 1 && next <= 16)
                  setDraft({ value: next, revision: query.dataUpdatedAt });
              }}
              onBlur={() => void save()}
            />
          </div>
        }
      />
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
    </SettingsSection>
  );
}
