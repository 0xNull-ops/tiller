import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  permissions: { operate: true },
  projects: [] as ReadonlyArray<unknown>,
  threads: [] as ReadonlyArray<unknown>,
  confirmDelete: vi.fn(),
  updateMetadata: vi.fn(),
}));

vi.mock(import("../../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: (() => state.projects) as never,
  useThreadShells: (() => state.threads) as never,
}));
vi.mock(import("../../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: (() => state.permissions.operate) as never,
}));
vi.mock(import("../../../state/threads"), async (importOriginal) => ({
  ...(await importOriginal()),
  threadEnvironment: { updateMetadata: {} } as never,
}));
vi.mock(import("../../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => state.updateMetadata) as never,
}));
vi.mock(import("../../../hooks/useThreadActions"), async (importOriginal) => ({
  ...(await importOriginal()),
  useThreadActions: (() => ({ confirmAndDeleteThread: state.confirmDelete })) as never,
}));

import { render } from "../../../../test/render";
import { StudioSessionList } from "./StudioSessions";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
const title = "Unclear Snow Theme Request";

function setup() {
  state.permissions.operate = true;
  state.confirmDelete.mockReset().mockResolvedValue({ _tag: "Success" });
  state.updateMetadata.mockReset().mockResolvedValue({ _tag: "Success" });
  state.projects = [{ environmentId, id: projectId, title: "Tiller Theme Studio" }];
  state.threads = [
    {
      environmentId,
      id: threadId,
      projectId,
      title,
      updatedAt: "2026-11-07T00:00:00.000Z",
      runtime: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    },
  ];
}

it("hides chat actions when the connection cannot change threads", async () => {
  setup();
  state.permissions.operate = false;
  await using screen = await render(<StudioSessionList />);
  await expect
    .element(screen.getByRole("button", { name: `Delete chat ${title}` }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: `Rename chat ${title}` }))
    .not.toBeInTheDocument();
});

it("deletes a chat through the guarded thread action", async () => {
  setup();
  await using screen = await render(<StudioSessionList />);
  await screen.getByRole("button", { name: `Delete chat ${title}` }).click();
  await vi.waitFor(() =>
    expect(state.confirmDelete).toHaveBeenCalledWith({ environmentId, threadId }, title),
  );
});

it("renames a chat through the thread metadata command", async () => {
  setup();
  await using screen = await render(<StudioSessionList />);
  await screen.getByRole("button", { name: `Rename chat ${title}` }).click();
  const input = screen.getByRole("textbox", { name: "Chat title" });
  await input.fill("Clear Snow Theme Request");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(state.updateMetadata).toHaveBeenCalledWith({
      environmentId,
      input: { threadId, title: "Clear Snow Theme Request" },
    }),
  );
});
