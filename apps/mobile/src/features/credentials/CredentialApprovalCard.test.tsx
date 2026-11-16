import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import {
  CredentialAccessError,
  CredentialPinRequiredError,
  CredentialId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type CredentialPendingRequest,
} from "@t3tools/contracts";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), deny: vi.fn(), unlock: vi.fn() }));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TextInput: ({
    value,
    onChangeText,
    secureTextEntry,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    secureTextEntry: boolean;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      type={secureTextEntry ? "password" : "text"}
      disabled={!editable}
      value={value}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/ErrorBanner", () => ({
  ErrorBanner: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
vi.mock("../../components/ui/Sheet", () => ({
  Sheet: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./CredentialBrandMark", () => ({ CredentialBrandMark: () => null }));
vi.mock("./credentialState", () => ({
  approveCredential: "approve",
  denyCredential: "deny",
  unlockCredentials: "unlock",
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: keyof typeof mocks) => mocks[command],
}));

import { CredentialApprovalCard } from "./CredentialApprovalCard";

const environmentId = EnvironmentId.make("env");
const request: CredentialPendingRequest = {
  id: "request",
  kind: "use",
  credentialId: CredentialId.make("github"),
  credentialName: "GitHub deploy",
  templateId: "github",
  mode: "exec",
  commandPreview: "gh release list",
  startedAt: "2026-10-22T12:00:00Z",
  allowedScopes: ["once", "run"],
  caller: {
    threadId: ThreadId.make("worker"),
    projectId: ProjectId.make("project"),
    threadTitle: "Release",
    provider: "codex",
    model: "gpt-6.1-sol",
    agentRole: "subagent",
    workflow: "release",
    stepTitle: "Upload",
  },
};
const success = () => AsyncResult.success({});
const locked = () => AsyncResult.fail(new CredentialAccessError({ reason: "unlock-required" }));

async function setup(pending: CredentialPendingRequest = request) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue(success());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <CredentialApprovalCard
          environmentId={environmentId}
          request={pending}
          envVars={["GH_TOKEN"]}
        />,
      ),
    );
  } catch (error) {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    throw error;
  }
  return {
    container,
    async click(label: string) {
      const button = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      );
      if (!button) throw new Error(`Missing button: ${label}`);
      await act(async () => button.click());
    },
    async pin(value: string) {
      const input = container.querySelector("input");
      if (!input) throw new Error("Missing PIN field");
      await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    async [Symbol.asyncDispose]() {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("approves, unlocks with transient PIN entry, then retries the same scope once", async () => {
  await using screen = await setup();
  mocks.approve.mockResolvedValueOnce(locked()).mockResolvedValueOnce(success());
  expect(screen.container.textContent).toContain("Codex · gpt-6.1-sol · subagent");
  expect(screen.container.textContent).toContain("release › Upload · Release");
  expect(screen.container.textContent).toContain("GH_TOKEN");
  await screen.click("Allow for this run");
  expect(mocks.unlock).not.toHaveBeenCalled();
  expect(screen.container.querySelector("input")?.type).toBe("password");
  await screen.pin("7294");
  await screen.click("Unlock");
  expect(mocks.unlock).toHaveBeenCalledExactlyOnceWith({ environmentId, input: { pin: "7294" } });
  expect(mocks.approve).toHaveBeenCalledTimes(2);
  expect(mocks.approve).toHaveBeenLastCalledWith({
    environmentId,
    input: { requestId: "request", scope: "run" },
  });
  expect(screen.container.querySelector("input")).toBeNull();
  expect(screen.container.textContent).not.toContain("7294");
});

it("never loops approval retries when the retried action requires unlock again", async () => {
  await using screen = await setup();
  mocks.approve.mockResolvedValue(locked());
  await screen.click("Allow once");
  await screen.pin("7294");
  await screen.click("Unlock");
  expect(mocks.approve).toHaveBeenCalledTimes(2);
  expect(mocks.unlock).toHaveBeenCalledTimes(1);
  expect(screen.container.textContent).toContain("The session locked again.");
  expect(screen.container.querySelector("input")).toBeNull();
});

it("denies a request without approving it", async () => {
  await using screen = await setup();
  await screen.click("Deny");
  expect(mocks.deny).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { requestId: "request" },
  });
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.unlock).not.toHaveBeenCalled();
});

it("shows server lockout retry time, clears the PIN, and does not retry approval", async () => {
  await using screen = await setup();
  mocks.approve.mockResolvedValue(locked());
  mocks.unlock.mockResolvedValue(
    AsyncResult.fail(new CredentialAccessError({ reason: "locked-out", retryAfterSeconds: 47 })),
  );
  await screen.click("Allow once");
  await screen.pin("0000");
  await screen.click("Unlock");
  expect(screen.container.textContent).toContain("Try again in 47 seconds.");
  expect(screen.container.querySelector("input")?.value).toBe("");
  expect(mocks.approve).toHaveBeenCalledTimes(1);
});

it("directs vault PIN setup to desktop or web", async () => {
  await using screen = await setup();
  mocks.approve.mockResolvedValue(AsyncResult.fail(new CredentialPinRequiredError({})));
  await screen.click("Allow once");
  expect(screen.container.textContent).toContain("Set a credential PIN on desktop or web first.");
  expect(screen.container.querySelector("input")).toBeNull();
});

it("shows add guidance and lets the user decline credential_request", async () => {
  await using screen = await setup({
    id: "add",
    kind: "add",
    caller: request.caller,
    templateId: "github",
    reason: "Need deploy access",
    startedAt: request.startedAt,
  });
  expect(screen.container.textContent).toContain("Add on desktop or web.");
  expect(screen.container.textContent).toContain("Need deploy access");
  expect(screen.container.textContent).not.toContain("Allow once");
  await screen.click("Decline");
  expect(mocks.deny).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { requestId: "add" },
  });
});
