import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { PenLineIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProjects, useThreadShells } from "../../../state/entities";
import { useThreadRouteTarget } from "../../../hooks/useThreadRouteTarget";
import { useThreadActions } from "../../../hooks/useThreadActions";
import { useEnvironmentScope } from "../../../state/session";
import { buildThreadRouteParams } from "../../../threadRoutes";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { stackedThreadToast, toastManager } from "../../../components/ui/toast";
import { threadEnvironment } from "../../../state/threads";
import { useOrchestrationCommand } from "../../../state/use-orchestration-command";
import { isStudioProject } from "./studioProject";
import "./studio.css";

function useStudioSessions() {
  const projects = useProjects();
  return useThreadShells()
    .filter((thread) =>
      projects.some(
        (project) =>
          isStudioProject(project) &&
          project.id === thread.projectId &&
          project.environmentId === thread.environmentId,
      ),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sessionStatus(thread: EnvironmentThreadShell) {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "Needs you";
  return threadRuntimeIsActive(thread.runtime) ? "Generating…" : "Done";
}

function StudioSessionRow({
  thread,
  onOpen,
  onDeleted,
  onRename,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly onOpen: () => void;
  readonly onDeleted: () => Promise<unknown>;
  readonly onRename: (title: string) => Promise<unknown>;
}) {
  // Thread commands are orchestration commands, so the session scope, not a command permission atom, gates them.
  const canManage = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [deleting, setDeleting] = useState(false);

  const startRenaming = () => {
    setDraft(thread.title);
    setRenaming(true);
  };
  const commitRename = async () => {
    const title = draft.trim();
    setRenaming(false);
    if (title.length === 0) {
      toastManager.add({ type: "warning", title: "Chat title cannot be empty" });
      return;
    }
    if (title !== thread.title) await onRename(title);
  };
  const remove = async () => {
    setDeleting(true);
    await onDeleted();
    setDeleting(false);
  };

  return (
    <li className="flex items-center gap-1" data-studio-session="">
      {renaming ? (
        <Input
          aria-label="Chat title"
          autoFocus
          className="min-w-0 flex-1"
          size="sm"
          value={draft}
          onBlur={() => void commitRename()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button
          className="flex min-w-0 flex-1 items-baseline justify-between gap-3 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          data-studio-session-open=""
          type="button"
          onClick={onOpen}
        >
          <span className="truncate text-sm font-medium text-foreground">{thread.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeTimeLabel(thread.updatedAt)} · {sessionStatus(thread)}
          </span>
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {canManage && !renaming ? (
          <Button
            aria-label={`Rename chat ${thread.title}`}
            size="icon-xs"
            variant="ghost"
            onClick={startRenaming}
          >
            <PenLineIcon />
          </Button>
        ) : null}
        {canManage ? (
          <Button
            aria-label={`Delete chat ${thread.title}`}
            disabled={deleting}
            size="icon-xs"
            variant="ghost-destructive"
            onClick={() => void remove()}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function StudioSessionList() {
  const sessions = useStudioSessions();
  const navigate = useNavigate();
  const { confirmAndDeleteThread } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const open = (thread: EnvironmentThreadShell) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };
  const deleteSession = async (thread: EnvironmentThreadShell) => {
    const result = await confirmAndDeleteThread(
      scopeThreadRef(thread.environmentId, thread.id),
      thread.title,
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Failed to delete chat", squashAtomCommandFailure(result));
    }
  };
  const renameSession = async (thread: EnvironmentThreadShell, title: string) => {
    const result = await updateThreadMetadata({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, title },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Failed to rename chat", squashAtomCommandFailure(result));
    }
  };
  if (sessions.length === 0) {
    return <p className="text-xs text-muted-foreground">No Theme Studio chats yet.</p>;
  }
  return (
    <ul className="grid gap-1" data-studio-sessions="">
      {sessions.slice(0, 5).map((thread) => (
        <StudioSessionRow
          key={`${thread.environmentId}:${thread.id}`}
          thread={thread}
          onDeleted={() => deleteSession(thread)}
          onOpen={() => open(thread)}
          onRename={(title) => renameSession(thread, title)}
        />
      ))}
    </ul>
  );
}

export function StudioActivity() {
  const sessions = useStudioSessions();
  const target = useThreadRouteTarget();
  const navigate = useNavigate();
  const previous = useRef(new Set<string>());
  const isElsewhere = (thread: (typeof sessions)[number]) =>
    target?.kind !== "server" ||
    target.threadRef.threadId !== thread.id ||
    target.threadRef.environmentId !== thread.environmentId;
  const open = (thread: (typeof sessions)[number]) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- delivers completion notifications for server runtime transitions.
  useEffect(() => {
    const active = new Set<string>();
    for (const thread of sessions) {
      const key = `${thread.environmentId}:${thread.id}`;
      if (threadRuntimeIsActive(thread.runtime)) active.add(key);
      else if (
        previous.current.has(key) &&
        !thread.hasPendingApprovals &&
        !thread.hasPendingUserInput &&
        isElsewhere(thread)
      )
        toastManager.add({
          title: "Theme ready in Theme Studio",
          actionProps: { children: "Open", onClick: () => open(thread) },
        });
    }
    previous.current = active;
  });
  const active = sessions.find(
    (thread) => threadRuntimeIsActive(thread.runtime) && isElsewhere(thread),
  );
  return active ? (
    <button type="button" data-studio-activity="" onClick={() => open(active)}>
      Theme Studio · generating in background…
    </button>
  ) : null;
}
