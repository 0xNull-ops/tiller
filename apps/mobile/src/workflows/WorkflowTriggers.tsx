import { editWorkflow } from "./workflowState";
import { useAtomValue } from "@effect/atom-react";
import {
  workflowScheduleBinding,
  type EnvironmentId,
  type ProjectId,
  type WorkflowListing,
} from "@t3tools/contracts";
import { View } from "react-native";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";

export function WorkflowTriggers(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workflows: ReadonlyArray<WorkflowListing>;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "Workflow trigger enabled",
  });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "Run workflow trigger",
  });
  const canToggle = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(props.environmentId),
  );
  const editTrigger = useAtomCommand(editWorkflow, { label: "Workflow trigger enabled" });
  const canEditTrigger = useAtomValue(editWorkflow.permissionAtom(props.environmentId));
  const canRun = useAtomValue(
    serverEnvironment.runScheduledTaskNow.permissionAtom(props.environmentId),
  );
  const tasks = (query.data?.tasks ?? []).filter(
    (task) => workflowScheduleBinding(task)?.projectId === props.projectId,
  );
  return (
    <View className="gap-2">
      <Text className="font-t3-semibold text-foreground">Triggers · Manual always available</Text>
      {query.error ? <Text className="text-foreground-muted">Couldn’t load triggers.</Text> : null}
      {props.workflows.flatMap((workflow) =>
        (workflow.definition?.startAfter ?? []).map((trigger) => (
          <View key={`${workflow.workflow}:${trigger.workflow}`} className="gap-2">
            <Text className="text-xs text-foreground-muted">
              {workflow.definition?.name}: after {trigger.workflow} ({trigger.when})
              {trigger.enabled === false ? " · Disabled" : ""}
            </Text>
            <Button
              label={trigger.enabled === false ? "Enable" : "Disable"}
              disabled={!canEditTrigger}
              onPress={() =>
                void editTrigger({
                  environmentId: props.environmentId,
                  input: {
                    _tag: "triggerSet",
                    projectId: props.projectId,
                    workflow: workflow.workflow,
                    afterWorkflow: trigger.workflow,
                    when: trigger.when,
                    enabled: trigger.enabled === false,
                  },
                })
              }
            />
          </View>
        )),
      )}
      {tasks.map((task) => (
        <View key={task.id} className="gap-2 rounded-xl border border-border p-3">
          <Text className="text-xs text-foreground">
            {workflowScheduleBinding(task)?.workflow} ·{" "}
            {task.schedule.type === "webhook"
              ? "Webhook"
              : task.schedule.type === "interval"
                ? `Every ${task.schedule.everyMs / 60000} minutes`
                : task.schedule.type === "once"
                  ? new Date(task.schedule.runAt).toLocaleString()
                  : task.schedule.timeOfDay}
            {task.enabled ? "" : " · Disabled"}
          </Text>
          <View className="flex-row gap-2">
            <Button
              label={task.enabled ? "Disable" : "Enable"}
              disabled={!canToggle}
              onPress={() =>
                void toggle({
                  environmentId: props.environmentId,
                  input: { id: task.id, enabled: !task.enabled },
                })
              }
            />
            <Button
              label="Run now"
              disabled={!canRun}
              onPress={() =>
                void run({ environmentId: props.environmentId, input: { id: task.id } })
              }
            />
          </View>
        </View>
      ))}
    </View>
  );
}
