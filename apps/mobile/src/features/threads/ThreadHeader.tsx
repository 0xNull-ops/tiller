import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";
// fork(workflow-first)
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useWorkflowFirstStatus } from "../../workflows/useWorkflowFirstStatus";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
  // fork(workflows)
  readonly onOpenWorkflowRuns?: () => void;
}) {
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const { environmentId, threadId } = props.gitControls;
  // fork(workflow-first): native stack options override the subtitle passed to AppBar.
  const workflowFirstEnabled = useWorkflowFirstStatus(
    typeof environmentId === "string" ? EnvironmentId.make(environmentId) : environmentId,
    typeof threadId === "string" ? ThreadId.make(threadId) : threadId,
  );
  const subtitle = workflowFirstEnabled
    ? props.subtitle
      ? `${props.subtitle} · Workflow-first`
      : "Workflow-first"
    : props.subtitle;
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? "Close files" : "Open files",
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  // fork(workflows)
  if (props.onOpenWorkflowRuns) {
    actions.push({
      accessibilityLabel: "Workflow runs",
      icon: { ios: "list.bullet.rectangle", android: "build" },
      onPress: props.onOpenWorkflowRuns,
    });
  }
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  return (
    <AppBar
      title={props.title}
      subtitle={subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
