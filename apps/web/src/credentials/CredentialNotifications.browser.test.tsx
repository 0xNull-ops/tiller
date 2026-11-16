import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { CredentialNotifications } from "./CredentialNotifications";
import { credentialActivityFixture, credentialRequestFixture } from "./credentialActivityFixture";

const state = vi.hoisted(() => ({
  pending: [] as unknown[],
  add: vi.fn(),
  close: vi.fn(),
  navigate: vi.fn(),
  threadId: "other",
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [{ environmentId: "remote", connection: { phase: "connected" } }],
  }),
}));
vi.mock("./credentialState", () => ({ credentialLive: { liveStateAtom: () => "credentials" } }));
vi.mock("../workflows/workflowState", () => ({ workflowRunsLive: () => "workflows" }));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (atom: string) => ({
    data:
      atom === "credentials"
        ? { pending: state.pending }
        : { runs: [{ id: "run-one", driverThreadId: "driver" }] },
  }),
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: state.add, close: state.close } }));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
  useParams: (() => ({ environmentId: "remote", threadId: state.threadId })) as never,
}));

it("toasts once per off-screen request, reviews its thread, and closes when answered", async () => {
  state.pending = [credentialRequestFixture];
  state.threadId = "other";
  state.add.mockReset().mockReturnValue("toast-1");
  state.close.mockReset();
  state.navigate.mockReset();
  await using screen = await render(<CredentialNotifications />);
  expect(state.add).toHaveBeenCalledTimes(1);
  const options = state.add.mock.calls[0]![0] as {
    actionProps: { children: string; onClick: () => void };
  };
  expect(options.actionProps.children).toBe("Review");
  options.actionProps.onClick();
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: {
      environmentId: EnvironmentId.make("remote"),
      threadId: credentialRequestFixture.caller.threadId,
    },
  });
  state.pending = [{ ...credentialRequestFixture }];
  await screen.rerender(<CredentialNotifications />);
  expect(state.add).toHaveBeenCalledTimes(1);
  state.pending = [];
  await screen.rerender(<CredentialNotifications />);
  expect(state.close).toHaveBeenCalledWith("toast-1");
});

it("names the caller's driver, not its raw id, in an add request's toast", async () => {
  state.pending = [
    {
      id: "add-request",
      kind: "add",
      caller: credentialActivityFixture.caller,
      templateId: "github",
      name: "Release GitHub",
      reason: "Upload a release",
      startedAt: "2026-10-22T14:00:00Z",
    },
  ];
  state.threadId = "other";
  state.add.mockReset().mockReturnValue("toast-add");
  state.close.mockReset();
  await using screen = await render(<CredentialNotifications />);
  const options = state.add.mock.calls[0]![0] as { title: string };
  expect(options.title).toBe("Codex subagent asks for credentials");
  await screen.unmount();
});

it("keeps requests quiet while their workflow driver thread is on screen", async () => {
  state.pending = [credentialRequestFixture];
  state.threadId = "driver";
  state.add.mockReset();
  state.close.mockReset();
  state.navigate.mockReset();
  await using screen = await render(<CredentialNotifications />);
  expect(state.add).not.toHaveBeenCalled();
  await screen.unmount();
});
