import { useAtomValue } from "@effect/atom-react";
import { createWorkflowTemplateCommands } from "@t3tools/client-runtime/state/workflowTemplates";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { workflowTemplates } from "@t3tools/shared/workflowTemplates";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { startScheduledTaskEditor } from "../../features/settings/scheduled-task-editor-state";
import {
  createDraft,
  scheduleDraftForTask,
  scheduledTaskDefaultModel,
} from "../../features/settings/scheduledTaskDraft";
import { useEnvironmentQuery } from "../../state/query";
import { workflowFirstRead, editWorkflow } from "../../workflows/workflowState";
const commands = createWorkflowTemplateCommands(connectionAtomRuntime);
export function TemplatesSection(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const command = useAtomCommand(commands.use, {
    label: "Use workflow template",
    reportFailure: false,
  });
  const preferencesCommand = useAtomCommand(editWorkflow, { label: "Template visibility" });
  const canUse = useAtomValue(commands.use.permissionAtom(props.environmentId));
  const canEdit = useAtomValue(editWorkflow.permissionAtom(props.environmentId));
  const query = useEnvironmentQuery(
    workflowFirstRead({ environmentId: props.environmentId, input: { _tag: "preferences" } }),
  );
  const prefs = query.data?._tag === "preferences" ? query.data.preferences : null;
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = useEnvironmentServerConfig(props.environmentId);
  const project = useProjects().find(
    (p) => p.environmentId === props.environmentId && p.id === props.projectId,
  );
  const navigation = useNavigation();
  const use = async (template: (typeof workflowTemplates)[number]) => {
    if (busy || !canUse) return;
    setBusy(true);
    setError(null);
    const result = await command({
      environmentId: props.environmentId,
      input: { templateId: template.id, projectId: props.projectId },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      setError(String(squashAtomCommandFailure(result)));
      return;
    }
    setMessage(`Added ${template.definition.name} to this project.`);
    const suggested = result.value.suggestedSchedule;
    if (suggested && suggested.schedule.type !== "webhook") {
      startScheduledTaskEditor({
        environmentId: props.environmentId,
        environmentLabel: props.environmentId,
        draft: {
          ...createDraft(props.projectId, scheduledTaskDefaultModel(config, project ?? null)),
          title: `Workflow schedule: ${template.definition.name}`,
          prompt: "Schedule copied workflow",
          workspace: "root",
          schedule: scheduleDraftForTask({ schedule: suggested.schedule }),
          workflowTemplate: {
            projectId: props.projectId,
            workflow: result.value.slug,
            fields: template.definition.inputs ?? [],
            inputs: {},
            driverThreadId: null,
            knobs: suggested.knobs,
          },
        },
      });
      navigation.dispatch(StackActions.push("SettingsScheduledTaskNew"));
    }
  };
  const hide = async (id: string) => {
    const hidden = prefs?.hiddenBuiltins ?? [];
    const result = await preferencesCommand({
      environmentId: props.environmentId,
      input: {
        _tag: "preferencesSet",
        hiddenBuiltins: hidden.includes(id)
          ? hidden.filter((value) => value !== id)
          : [...hidden, id],
      },
    });
    if (result._tag === "Success") query.refresh();
  };
  if (prefs?.showBuiltinWorkflows === false) return null;
  return (
    <View className="gap-3">
      <Text textRole="headline" className="font-t3-bold text-foreground">
        Templates
      </Text>
      {prefs?.hiddenBuiltins.length ? (
        <Button
          label={showHidden ? "Hide hidden" : "Show hidden"}
          tone="text"
          onPress={() => setShowHidden(!showHidden)}
        />
      ) : null}
      {message ? <Notice message={message} /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {workflowTemplates
        .filter((template) => showHidden || !prefs?.hiddenBuiltins.includes(template.id))
        .map((template) => (
          <View key={template.id} className="gap-2 rounded-2xl border border-border bg-card p-4">
            <Text className="font-t3-semibold text-foreground">{template.definition.name}</Text>
            <Text className="text-xs text-foreground-muted">
              Built-in · {template.definition.steps.length} steps
            </Text>
            <Text className="text-sm text-foreground-muted">{template.definition.brief}</Text>
            <View className="flex-row gap-2">
              <Button
                label="Use template"
                disabled={!canUse || busy}
                onPress={() => void use(template)}
              />
              <Button
                label={prefs?.hiddenBuiltins.includes(template.id) ? "Unhide" : "Hide"}
                tone="text"
                disabled={!canEdit || prefs === null}
                onPress={() => void hide(template.id)}
              />
            </View>
          </View>
        ))}
    </View>
  );
}
