import { RegistryContext } from "@effect/atom-react";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { type ComponentProps, useContext, useRef, useState } from "react";
import { View, TextInput, Switch } from "react-native";
import type {
  EnvironmentId,
  ProjectId,
  ScheduledTaskUpsertSchedule,
  ThreadId,
} from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useThreadShells } from "../../state/entities";
import type { ScheduledTaskDraft } from "../../features/settings/scheduledTaskDraft";
export function useWorkflowTemplateSchedule(props: {
  readonly environmentId: EnvironmentId;
  readonly draft: ScheduledTaskDraft;
  readonly setDraft: (update: (current: ScheduledTaskDraft) => ScheduledTaskDraft) => void;
  readonly setSaving: (value: boolean) => void;
  readonly onSaved: () => void;
}) {
  const registry = useContext(RegistryContext);
  const pending = useRef(false);
  const [rotationValues, setRotationValues] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const template = props.draft.workflowTemplate;
  if (!template) return null;
  const change = (patch: Partial<typeof template>) =>
    props.setDraft((current) => ({ ...current, workflowTemplate: { ...template, ...patch } }));
  const save = async (schedule: ScheduledTaskUpsertSchedule | null) => {
    if (!schedule || !template.driverThreadId) {
      setError("Choose a driver chat and valid schedule.");
      return;
    }
    if (pending.current) return;
    pending.current = true;
    props.setSaving(true);
    setError(null);
    try {
      // Loaded here so the schedule form does not pull the connection runtime into clients that never use it.
      const { editWorkflow } = await import("../../workflows/workflowState");
      if (!registry.get(editWorkflow.permissionAtom(props.environmentId))) {
        setError("Choose a driver chat and valid schedule.");
        return;
      }
      const result = await runAtomCommand(
        registry,
        editWorkflow,
        {
          environmentId: props.environmentId,
          input: {
            _tag: "scheduleAdd",
            projectId: template.projectId,
            workflow: template.workflow,
            driverThreadId: template.driverThreadId,
            inputs: template.inputs,
            schedule,
            knobs: template.knobs,
          },
        },
        { label: "Schedule copied workflow", reportFailure: false },
      );
      if (result._tag === "Success") props.onSaved();
      else setError(String(squashAtomCommandFailure(result)));
    } catch (cause) {
      setError(String(cause));
    } finally {
      pending.current = false;
      props.setSaving(false);
    }
  };
  return {
    save,
    fields: (
      <View className="gap-3 p-4">
        <Text className="font-t3-semibold text-foreground">Driver chat</Text>
        <WorkflowDriverChatPicker
          environmentId={props.environmentId}
          projectId={template.projectId}
          selectedThreadId={template.driverThreadId}
          onSelect={(driverThreadId) => change({ driverThreadId })}
        />
        {template.fields.map((field) => (
          <View key={field.id} className="gap-1">
            <Text className="text-foreground">{field.label}</Text>
            <TextInput
              accessibilityLabel={field.label}
              placeholder={field.defaultValue ?? field.label}
              value={template.inputs[field.id] ?? ""}
              onChangeText={(value) =>
                change({ inputs: { ...template.inputs, [field.id]: value } })
              }
              className="rounded-lg border border-border p-3 text-foreground"
            />
          </View>
        ))}
        <View className="flex-row items-center justify-between">
          <Text className="text-foreground">Carry over the last result</Text>
          <Switch
            accessibilityLabel="Carry over the last result"
            value={template.knobs.carryOver ?? false}
            onValueChange={(carryOver) => change({ knobs: { ...template.knobs, carryOver } })}
          />
        </View>
        {template.knobs.rotate ? (
          <View className="gap-1">
            <Text className="text-foreground">Rotate {template.knobs.rotate.inputId}</Text>
            <TextInput
              accessibilityLabel="Rotation values"
              value={rotationValues ?? template.knobs.rotate.values.join(", ")}
              onChangeText={(values) => {
                setRotationValues(values);
                change({
                  knobs: {
                    ...template.knobs,
                    rotate: {
                      ...template.knobs.rotate!,
                      values: values
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    },
                  },
                });
              }}
              className="rounded-lg border border-border p-3 text-foreground"
            />
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
    ),
  };
}

function WorkflowDriverChatPicker({
  environmentId,
  projectId,
  selectedThreadId,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly selectedThreadId: ThreadId | null;
  readonly onSelect: (threadId: ThreadId) => void;
}) {
  const threads = useThreadShells().filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.projectId === projectId &&
      !thread.archivedAt &&
      !thread.deletedAt,
  );
  if (!threads.length) {
    return (
      <Text className="text-foreground-muted">
        Create a chat in this project before scheduling.
      </Text>
    );
  }
  return threads.map((thread) => (
    <Button
      key={thread.id}
      label={`${selectedThreadId === thread.id ? "✓ " : ""}${thread.title}`}
      tone="text"
      onPress={() => onSelect(thread.id)}
    />
  ));
}

export function WorkflowTaskSection({
  hidden,
  ...props
}: ComponentProps<typeof SettingsSection> & { readonly hidden: boolean }) {
  return hidden ? null : <SettingsSection {...props} />;
}
