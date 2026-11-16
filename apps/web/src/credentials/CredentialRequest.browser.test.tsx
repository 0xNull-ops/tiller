import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { CredentialAccessError, EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { CredentialRequest } from "./CredentialRequest";
import { credentialRequestFixture } from "./credentialActivityFixture";
import "~/index.css";

const state = vi.hoisted(() => ({
  approve: vi.fn(),
  deny: vi.fn(),
  unlock: vi.fn(),
  osEnabled: false,
  osPin: vi.fn(),
}));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => true) as never,
}));
vi.mock("./credentialState", () => ({
  approveCredential: { label: "approve", permissionAtom: () => null },
  denyCredential: { label: "deny" },
  unlockCredentials: { label: "unlock" },
  credentialListQuery: () => null,
}));
vi.mock("./CredentialsEnvironmentPanel", () => ({ CredentialsEnvironmentPanel: () => null }));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      credentials: [
        {
          id: "github",
          fields: [{ kind: "secret", secret: { set: true }, envVar: "GITHUB_TOKEN" }],
        },
      ],
    },
  }),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { label: keyof typeof state }) => state[command.label],
}));
vi.mock(import("./credentialOsUnlock"), async (original) => ({
  ...(await original()),
  useCredentialOsUnlockStatus: () => ({
    supported: true,
    status: state.osEnabled
      ? { available: true, enabled: true, method: "touch-id" as const }
      : null,
    setStatus: vi.fn(),
  }),
  bindCredentialOsUnlock: () => ({ requestPin: state.osPin, disable: vi.fn() }) as never,
}));

function setup() {
  state.osEnabled = false;
  state.osPin.mockReset().mockResolvedValue("1234");
  state.approve.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.deny.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.unlock
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ pinSet: true, keyStorage: "os-keychain" }));
}
const environmentId = EnvironmentId.make("remote");

it("offers only allowed scopes and denies through the destination environment", async () => {
  setup();
  await using screen = await render(
    <CredentialRequest environmentId={environmentId} request={credentialRequestFixture} />,
  );
  await expect.element(screen.getByRole("button", { name: "Allow for this run" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Allow once" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Allow for this workflow" }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Allow for this thread" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText("Gets: GITHUB_TOKEN")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Deny", exact: true }));
  expect(state.deny).toHaveBeenCalledWith({ environmentId, input: { requestId: "request-1" } });
});

it("unlocks and retries the original scope once, including when the retry is refused", async () => {
  setup();
  state.approve.mockResolvedValue(
    AsyncResult.failure(Cause.fail(new CredentialAccessError({ reason: "unlock-required" }))),
  );
  await using screen = await render(
    <CredentialRequest environmentId={environmentId} request={credentialRequestFixture} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Allow for this run" }));
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "1234");
  await userEvent.click(page.getByRole("button", { name: "Unlock", exact: true }));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(state.unlock).toHaveBeenCalledWith({ environmentId, input: { pin: "1234" } });
  expect(state.approve).toHaveBeenCalledTimes(2);
  expect(state.approve).toHaveBeenLastCalledWith({
    environmentId,
    input: { requestId: "request-1", scope: "run" },
  });
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Unlock the credential vault first.");
});

it("uses Touch ID to unlock before retrying approval", async () => {
  setup();
  state.osEnabled = true;
  state.approve
    .mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new CredentialAccessError({ reason: "unlock-required" }))),
    )
    .mockResolvedValue(AsyncResult.success(undefined));
  await using screen = await render(
    <CredentialRequest environmentId={environmentId} request={credentialRequestFixture} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Allow once", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Unlock with Touch ID", exact: true }));
  expect(state.osPin).toHaveBeenCalledTimes(1);
  expect(state.unlock).toHaveBeenCalledWith({ environmentId, input: { pin: "1234" } });
  expect(state.approve).toHaveBeenCalledTimes(2);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
