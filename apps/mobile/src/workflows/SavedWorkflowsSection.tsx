import { TemplatesSection } from "../fork/builtins/TemplatesSection";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { useAtomCommand } from "../state/use-atom-command";
import { editWorkflow } from "./workflowState";
import { WorkflowTriggers } from "./WorkflowTriggers";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ProjectId, WorkflowListing } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import { savedWorkflowRows, type SavedWorkflowRow } from "./savedWorkflows";

/**
 * The project's saved workflows. Scratch workflows stay folded under "From
 * threads" until expanded. Mobile has no canvas, so a tap opens the chat the workflow came
 * from; the web and desktop canvas remains the place to edit one.
 */
export function SavedWorkflowsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflows: ReadonlyArray<WorkflowListing>;
}) {
  const [tag, setTag] = useState<string | null>(null);
  const allRows = savedWorkflowRows(props);
  const { regular, scratch } = savedWorkflowRows({ ...props, tag });
  const tags = [
    ...new Set([...allRows.regular, ...allRows.scratch].flatMap((row) => row.tags)),
  ].sort();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinCommand = useAtomCommand(editWorkflow, { label: "Pin workflow", reportFailure: false });
  const canPin = useAtomValue(editWorkflow.permissionAtom(props.environmentId));
  const pin = async (row: SavedWorkflowRow) => {
    if (busy || !canPin) return;
    setBusy(true);
    setError(null);
    const result = await pinCommand({
      environmentId: row.environmentId,
      input: {
        _tag: "workflowPinSet",
        projectId: row.projectId,
        workflow: row.workflow,
        pinned: !row.pinned,
      },
    });
    setBusy(false);
    if (result._tag !== "Success" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const [fromThreadsExpanded, setFromThreadsExpanded] = useState(false);
  const navigation = useNavigation();

  const openThread = (row: SavedWorkflowRow) => {
    if (row.threadId === null) return;
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: row.environmentId,
        threadId: row.threadId,
      }),
    );
  };

  return (
    <View className="gap-2">
      <TemplatesSection environmentId={props.environmentId} projectId={props.projectId} />
      <Text textRole="headline" className="font-t3-bold text-foreground">
        Saved workflows
      </Text>
      <WorkflowTriggers {...props} />
      {tags.length > 0 || tag ? (
        <View className="flex-row flex-wrap gap-2" accessibilityLabel="Workflow tag filters">
          {[null, ...tags].map((value) => (
            <Pressable
              key={value ?? "all"}
              accessibilityRole="button"
              accessibilityLabel={value ? `Tag filter: ${value}` : "All tags"}
              accessibilityState={{ selected: tag === value }}
              onPress={() => setTag(value)}
              className={
                tag === value
                  ? "min-h-11 justify-center rounded-full bg-primary px-3"
                  : "min-h-11 justify-center rounded-full bg-subtle px-3"
              }
            >
              <Text
                className={
                  tag === value
                    ? "text-xs text-primary-foreground"
                    : "text-xs text-foreground-muted"
                }
              >
                {value ? `#${value}` : "All tags"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {!regular.length && !scratch.length ? (
        <Text className="text-sm text-foreground-muted">No workflows with this tag.</Text>
      ) : null}
      {regular.map((row) => (
        <SavedWorkflowListItem
          key={row.workflow}
          row={row}
          onPress={() => openThread(row)}
          onTag={setTag}
          canPin={canPin && !busy}
          onPin={() => void pin(row)}
        />
      ))}
      {scratch.length > 0 ? (
        <View className="gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: fromThreadsExpanded }}
            onPress={() => setFromThreadsExpanded((current) => !current)}
            className="flex-row items-center gap-2 rounded-xl px-1 py-2 active:opacity-70"
          >
            <SymbolView
              name={fromThreadsExpanded ? "chevron.down" : "chevron.right"}
              size={12}
              tintColorClassName="accent-chevron"
              type="monochrome"
            />
            <Text className="flex-1 text-xs font-t3-semibold uppercase tracking-wide text-foreground-muted">
              From threads
            </Text>
            <Text className="text-xs text-foreground-muted">{scratch.length}</Text>
          </Pressable>
          {fromThreadsExpanded
            ? scratch.map((row) => (
                <SavedWorkflowListItem
                  key={row.workflow}
                  row={row}
                  onPress={() => openThread(row)}
                  onTag={setTag}
                  canPin={canPin && !busy}
                  onPin={() => void pin(row)}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

function SavedWorkflowListItem(props: {
  readonly row: SavedWorkflowRow;
  readonly onPress: () => void;
  readonly onTag: (tag: string) => void;
  readonly canPin: boolean;
  readonly onPin: () => void;
}) {
  const { row } = props;
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            row.scratch ? `${row.title}, created in a chat` : `${row.title}, saved workflow`
          }
          disabled={row.threadId === null}
          onPress={props.onPress}
          className="min-h-12 flex-1 justify-center active:opacity-70"
        >
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-t3-semibold text-foreground">{row.title}</Text>
              <Text className="text-xs text-foreground-muted">
                {row.stepCount} work steps
                {row.loopCount > 0
                  ? ` · ${row.loopCount} loop${row.loopCount === 1 ? "" : "s"}`
                  : ""}
                {row.threadId === null ? "" : " · Tap to open its chat"}
              </Text>
            </View>
            {row.scratch ? (
              <Text className="rounded-full bg-subtle px-2.5 py-1 text-xs font-t3-medium text-foreground-muted">
                From thread
              </Text>
            ) : row.invalid ? (
              <Text className="rounded-full bg-subtle px-2.5 py-1 text-xs font-t3-medium text-danger-foreground">
                Invalid
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Button
          label={row.pinned ? "Unpin" : "Pin"}
          accessibilityLabel={`${row.pinned ? "Unpin" : "Pin"} ${row.title}`}
          tone="text"
          disabled={!props.canPin}
          onPress={props.onPin}
        />
      </View>
      {row.tags.length ? (
        <View className="flex-row flex-wrap gap-2">
          {row.tags.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={`Filter by tag ${tag}`}
              onPress={() => props.onTag(tag)}
              className="min-h-11 justify-center rounded-full bg-subtle px-3"
            >
              <Text className="text-xs text-foreground-muted">#{tag}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
