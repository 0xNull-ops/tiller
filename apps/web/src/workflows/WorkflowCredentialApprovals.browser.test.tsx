import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { EnvironmentId, ProjectId, WorkflowRpcError } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { WorkflowCredentialApprovals } from "./WorkflowCredentialApprovals";
import "~/index.css";

const state = vi.hoisted(() => ({ edit: vi.fn(), unlock: vi.fn() }));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => true) as never,
}));
vi.mock("./workflowState", () => ({ editWorkflow: { label: "edit", permissionAtom: () => null } }));
vi.mock("../credentials/credentialState", () => ({ unlockCredentials: { label: "unlock" } }));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { label: keyof typeof state }) => state[command.label],
}));
vi.mock("../credentials/credentialOsUnlock", () => ({
  useCredentialOsUnlockStatus: () => ({ status: null }),
  bindCredentialOsUnlock: () => null,
  credentialOsUnlockMethodLabel: () => "Touch ID",
  unlockWithStoredPin: vi.fn(),
}));

it("saves the server's approval policy, unlocking only when the server requires it", async () => {
  state.edit
    .mockReset()
    .mockResolvedValueOnce(
      AsyncResult.failure(
        Cause.fail(
          new WorkflowRpcError({
            cause: null,
            reason: "Unlock the credential vault to pre-approve workflow credentials.",
          }),
        ),
      ),
    )
    .mockResolvedValue(AsyncResult.success({}));
  state.unlock
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ pinSet: true, keyStorage: "os-keychain" }));
  const environmentId = EnvironmentId.make("remote");
  const projectId = ProjectId.make("project");
  await using screen = await render(
    <WorkflowCredentialApprovals
      environmentId={environmentId}
      projectId={projectId}
      workflow="release"
      value={undefined}
      disabled={false}
    />,
  );
  await expect
    .element(screen.getByRole("combobox", { name: "Credential approvals" }))
    .toHaveTextContent("Once per run (default)");
  await userEvent.click(screen.getByRole("combobox", { name: "Credential approvals" }));
  await userEvent.click(page.getByRole("option", { name: "Pre-approved", exact: true }));
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "1234");
  await userEvent.click(page.getByRole("button", { name: "Unlock", exact: true }));
  expect(state.edit).toHaveBeenCalledTimes(2);
  expect(state.edit).toHaveBeenLastCalledWith({
    environmentId,
    input: { _tag: "meta", projectId, workflow: "release", credentialApprovals: "pre-approved" },
  });
});

it("re-offers the approval so credentials attached later are covered", async () => {
  state.edit.mockReset().mockResolvedValue(AsyncResult.success({}));
  const environmentId = EnvironmentId.make("remote");
  const projectId = ProjectId.make("project");
  await using screen = await render(
    <WorkflowCredentialApprovals
      environmentId={environmentId}
      projectId={projectId}
      workflow="release"
      value="pre-approved"
      disabled={false}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Re-approve attached credentials" }));
  expect(state.edit).toHaveBeenCalledWith({
    environmentId,
    input: { _tag: "meta", projectId, workflow: "release", credentialApprovals: "pre-approved" },
  });
});
