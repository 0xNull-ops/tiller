import {
  CredentialId,
  ProjectId,
  ThreadId,
  AuthSessionId,
  type Credential,
  type CredentialCreateInput,
  type CredentialHistoryPage,
  type CredentialId as CredentialIdType,
  type CredentialRemoveSecretInput,
  type CredentialSetSecretInput,
  type CredentialUpdateInput,
  type CredentialsStatus,
  type DesktopCredentialOsUnlockStatus,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { CredentialsManager, type CredentialsManagerActions } from "./CredentialsManager";
import type { CredentialOsUnlockClient } from "./credentialOsUnlock";
import type { CredentialActionResult } from "./credentialWriteGate";
import "~/index.css";

const STATUS: CredentialsStatus = { pinSet: true, keyStorage: "os-keychain" };
const TOUCH_ID: DesktopCredentialOsUnlockStatus = {
  available: true,
  enabled: false,
  method: "touch-id",
};

const credential = (overrides: Partial<Credential> = {}): Credential => ({
  id: CredentialId.make("cred-github"),
  name: "GitHub",
  templateId: "github",
  fields: [
    {
      id: "token",
      label: "Token",
      kind: "secret",
      envVar: "GITHUB_TOKEN",
      required: true,
      highRisk: false,
      secret: { set: true, updatedAt: "2026-10-02T10:00:00.000Z" },
    },
  ],
  policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  useCount: 0,
  status: "ready",
  ...overrides,
});

const emptyHistory: CredentialHistoryPage = { events: [] };

const ok = <A,>(value: A): CredentialActionResult<A> => ({ ok: true, value });

const actions = (
  overrides: Partial<CredentialsManagerActions> = {},
): CredentialsManagerActions => ({
  create: async (_input: CredentialCreateInput) => ok(credential()),
  update: async (_input: CredentialUpdateInput) => ok(credential()),
  setSecret: async (_input: CredentialSetSecretInput) => ok(credential()),
  removeSecret: async (_input: CredentialRemoveSecretInput) => ok(credential()),
  deleteCredential: async (_id: CredentialIdType) => ok(undefined),
  setPin: async () => ok(STATUS),
  unlock: async () => ok(STATUS),
  lock: async () => ok(STATUS),
  loadHistory: async () => ok(emptyHistory),
  ...overrides,
});

const manager = (props: {
  readonly credentials?: ReadonlyArray<Credential>;
  readonly status?: CredentialsStatus;
  readonly readOnly?: boolean;
  readonly osUnlock?: CredentialOsUnlockClient | null;
  readonly osUnlockStatus?: DesktopCredentialOsUnlockStatus | null;
  readonly onOsUnlockStatus?: (status: DesktopCredentialOsUnlockStatus | null) => void;
  readonly actions: CredentialsManagerActions;
}) => (
  <CredentialsManager
    credentials={props.credentials ?? []}
    status={props.status ?? STATUS}
    projects={[]}
    loading={false}
    error={null}
    readOnly={props.readOnly ?? false}
    osUnlock={props.osUnlock ?? null}
    osUnlockStatus={props.osUnlockStatus ?? null}
    onOsUnlockStatus={props.onOsUnlockStatus ?? (() => undefined)}
    onRetry={() => undefined}
    actions={props.actions}
  />
);

const osClient = (overrides: Partial<CredentialOsUnlockClient> = {}): CredentialOsUnlockClient => ({
  status: async () => TOUCH_ID,
  enable: async () => ({ ...TOUCH_ID, enabled: true }),
  disable: async () => TOUCH_ID,
  requestPin: async () => "1234",
  ...overrides,
});

const clickAddCredential = async (screen: Awaited<ReturnType<typeof render>>) => {
  const button = [...screen.container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Add credential",
  );
  await userEvent.click(button!);
};

const clickFirstSwitch = async (screen: Awaited<ReturnType<typeof render>>) => {
  const toggle = screen.container.querySelector<HTMLElement>('[role="switch"]');
  await userEvent.click(toggle!);
};

it("sets a PIN, then retries the write that needed one", async () => {
  let created = 0;
  const create = vi.fn(async (_input: CredentialCreateInput) => {
    created += 1;
    return created === 1
      ? ({ ok: false, failure: { kind: "pin-required" } } as const)
      : ok(credential());
  });
  const setPin = vi.fn(async () => ok({ ...STATUS, pinSet: true }));

  await using screen = await render(
    manager({
      status: { pinSet: false, keyStorage: "os-keychain" },
      actions: actions({ create, setPin }),
    }),
  );

  await clickAddCredential(screen);
  await userEvent.click(screen.getByRole("button", { name: /GitHub token/ }));
  await userEvent.fill(screen.getByLabelText("Name"), "GitHub");
  await userEvent.fill(screen.getByLabelText(/^Token/), "ghp_secret");
  await userEvent.click(screen.getByRole("button", { name: "Add credential" }));

  await expect.element(page.getByText("Set a credential PIN")).toBeVisible();
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "1234");
  await userEvent.fill(page.getByLabelText("Confirm PIN"), "1234");
  await userEvent.click(page.getByRole("button", { name: "Set PIN" }));

  await expect.element(screen.getByRole("heading", { name: "GitHub" })).toBeVisible();
  expect(setPin).toHaveBeenCalledWith({ newPin: "1234" });
  expect(create).toHaveBeenCalledTimes(2);
  expect(created).toBe(2);
});

it("unlocks the vault and retries the refused write once", async () => {
  const update = vi
    .fn<(input: CredentialUpdateInput) => Promise<CredentialActionResult<Credential>>>()
    .mockResolvedValueOnce({ ok: false, failure: { kind: "unlock-required" } })
    .mockResolvedValueOnce(ok(credential()));
  const unlock = vi.fn(async () => ok(STATUS));
  const loadHistory = vi.fn(async () => ok(emptyHistory));
  const current = credential();

  await using screen = await render(
    manager({
      credentials: [current],
      actions: actions({ update, unlock, loadHistory }),
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await clickFirstSwitch(screen);

  await expect.element(page.getByText("Unlock credentials")).toBeVisible();
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "1234");
  await userEvent.click(page.getByRole("button", { name: "Unlock" }));

  expect(unlock).toHaveBeenCalledWith("1234");
  expect(update).toHaveBeenCalledTimes(2);
  await expect.element(page.getByText("Unlock credentials")).not.toBeInTheDocument();
});

it("shows a lockout with its retry time", async () => {
  const update = vi.fn(async (): Promise<CredentialActionResult<Credential>> => ({
    ok: false,
    failure: { kind: "unlock-required" },
  }));
  const unlock = vi.fn(async (): Promise<CredentialActionResult<CredentialsStatus>> => ({
    ok: false,
    failure: { kind: "locked-out", retryAfterSeconds: 30 },
  }));

  await using screen = await render(
    manager({
      credentials: [credential()],
      actions: actions({ update, unlock }),
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await clickFirstSwitch(screen);
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "0000");
  await userEvent.click(page.getByRole("button", { name: "Unlock" }));

  await expect
    .element(page.getByText("Too many incorrect PINs. Try again in 30 seconds."))
    .toBeVisible();
  expect(update).toHaveBeenCalledTimes(1);
});

it("asks before deleting and returns to the list", async () => {
  const deleteCredential = vi.fn(async (_id: CredentialIdType) => ok(undefined));
  const current = credential();

  await using screen = await render(
    manager({ credentials: [current], actions: actions({ deleteCredential }) }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await userEvent.click(screen.getByRole("button", { name: "Delete credential" }));
  await expect.element(page.getByText("Delete GitHub?")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Delete" }));

  expect(deleteCredential).toHaveBeenCalledWith(current.id);
  await expect.element(screen.getByRole("heading", { name: "Credentials" })).toBeVisible();
});

it("never renders a replaced secret back into the page", async () => {
  const setSecret = vi.fn(async (_input: CredentialSetSecretInput) => ok(credential()));
  const current = credential();

  await using screen = await render(
    manager({ credentials: [current], actions: actions({ setSecret }) }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await userEvent.click(screen.getByRole("button", { name: "Replace" }));
  await userEvent.fill(screen.getByLabelText("Replace Token"), "super-secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(setSecret).toHaveBeenCalledWith({
    id: current.id,
    fieldId: "token",
    value: "super-secret-value",
  });
  await expect.element(screen.getByText(/Set ✓ · updated/)).toBeVisible();
  expect(screen.container.textContent).not.toContain("super-secret-value");
  expect(
    [...screen.container.querySelectorAll("input")].some(
      (input) => input.value === "super-secret-value",
    ),
  ).toBe(false);
});

it("explains a connection without the manage scope instead of erroring", async () => {
  await using screen = await render(manager({ readOnly: true, actions: actions() }));

  await expect.element(screen.getByText("Credentials are not available here")).toBeVisible();
  expect(screen.getByText(/credentials:manage/)).toBeTruthy();
});

it("does not offer system unlock in a browser", async () => {
  await using screen = await render(manager({ actions: actions() }));

  expect(screen.container.querySelector('[role="switch"]')).toBeNull();
  expect(screen.container.textContent).not.toContain("Touch ID");
});

it("unlocks with the stored PIN after the OS prompt", async () => {
  const update = vi
    .fn<(input: CredentialUpdateInput) => Promise<CredentialActionResult<Credential>>>()
    .mockResolvedValueOnce({ ok: false, failure: { kind: "unlock-required" } })
    .mockResolvedValueOnce(ok(credential()));
  const unlock = vi.fn(async () => ok(STATUS));
  const requestPin = vi.fn(async () => "2468");

  await using screen = await render(
    manager({
      credentials: [credential()],
      osUnlock: osClient({ requestPin }),
      osUnlockStatus: { ...TOUCH_ID, enabled: true },
      actions: actions({ update, unlock }),
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await clickFirstSwitch(screen);
  await expect.element(page.getByText("Unlock credentials")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Unlock with Touch ID" }));

  expect(requestPin).toHaveBeenCalledTimes(1);
  expect(unlock).toHaveBeenCalledWith("2468");
  expect(update).toHaveBeenCalledTimes(2);
  await expect.element(page.getByText("Unlock credentials")).not.toBeInTheDocument();
});

it("deletes a stored PIN the server rejects and falls back to the PIN field", async () => {
  const update = vi.fn(async (): Promise<CredentialActionResult<Credential>> => ({
    ok: false,
    failure: { kind: "unlock-required" },
  }));
  const unlock = vi.fn(async (): Promise<CredentialActionResult<CredentialsStatus>> => ({
    ok: false,
    failure: { kind: "pin-incorrect", attemptsRemaining: 4 },
  }));
  const disable = vi.fn(async () => TOUCH_ID);
  const onOsUnlockStatus = vi.fn();

  await using screen = await render(
    manager({
      credentials: [credential()],
      osUnlock: osClient({ disable }),
      osUnlockStatus: { ...TOUCH_ID, enabled: true },
      onOsUnlockStatus,
      actions: actions({ update, unlock }),
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await clickFirstSwitch(screen);
  await userEvent.click(page.getByRole("button", { name: "Unlock with Touch ID" }));

  expect(disable).toHaveBeenCalledTimes(1);
  expect(onOsUnlockStatus).toHaveBeenCalledWith(TOUCH_ID);
  await expect.element(page.getByText(/The PIN saved for Touch ID no longer works/)).toBeVisible();
  await expect.element(page.getByLabelText("PIN", { exact: true })).toBeVisible();
});

it("stops trying after a lockout instead of retrying the stored PIN", async () => {
  const update = vi.fn(async (): Promise<CredentialActionResult<Credential>> => ({
    ok: false,
    failure: { kind: "unlock-required" },
  }));
  const unlock = vi.fn(async (): Promise<CredentialActionResult<CredentialsStatus>> => ({
    ok: false,
    failure: { kind: "locked-out", retryAfterSeconds: 30 },
  }));
  const requestPin = vi.fn(async () => "2468");

  await using screen = await render(
    manager({
      credentials: [credential()],
      osUnlock: osClient({ requestPin }),
      osUnlockStatus: { ...TOUCH_ID, enabled: true },
      actions: actions({ update, unlock }),
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await clickFirstSwitch(screen);
  await userEvent.click(page.getByRole("button", { name: "Unlock with Touch ID" }));

  await expect
    .element(page.getByText("Too many incorrect PINs. Try again in 30 seconds."))
    .toBeVisible();
  expect(requestPin).toHaveBeenCalledTimes(1);
  expect(unlock).toHaveBeenCalledTimes(1);
  await expect.element(page.getByRole("button", { name: "Unlock with Touch ID" })).toBeDisabled();
});

it("verifies the PIN with the server before the shell keeps it", async () => {
  const unlock = vi.fn(async () => ok(STATUS));
  const enable = vi.fn(async () => ({ ...TOUCH_ID, enabled: true }));
  const onOsUnlockStatus = vi.fn();

  await using screen = await render(
    manager({
      osUnlock: osClient({ enable }),
      osUnlockStatus: TOUCH_ID,
      onOsUnlockStatus,
      actions: actions({ unlock }),
    }),
  );

  await clickFirstSwitch(screen);
  await expect.element(page.getByText("Turn on Touch ID unlock")).toBeVisible();
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "1234");
  await userEvent.click(page.getByRole("button", { name: "Turn on Touch ID" }));

  expect(unlock).toHaveBeenCalledWith("1234");
  expect(enable).toHaveBeenCalledWith("1234");
  expect(unlock.mock.invocationCallOrder[0]!).toBeLessThan(enable.mock.invocationCallOrder[0]!);
  expect(onOsUnlockStatus).toHaveBeenCalledWith({ ...TOUCH_ID, enabled: true });
});

it("changes the PIN and updates the PIN the shell holds", async () => {
  const setPin = vi.fn(async () => ok(STATUS));
  const enable = vi.fn(async () => ({ ...TOUCH_ID, enabled: true }));

  await using screen = await render(
    manager({
      osUnlock: osClient({ enable }),
      osUnlockStatus: { ...TOUCH_ID, enabled: true },
      actions: actions({ setPin }),
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: "Change PIN" }));
  await userEvent.fill(page.getByLabelText("Current PIN"), "1234");
  await userEvent.fill(page.getByLabelText("New PIN"), "5678");
  await userEvent.fill(page.getByLabelText("Confirm new PIN"), "5678");
  await userEvent.click(page.getByRole("button", { name: "Save new PIN" }));

  expect(setPin).toHaveBeenCalledWith({ currentPin: "1234", newPin: "5678" });
  expect(enable).toHaveBeenCalledWith("5678");
  await expect.element(page.getByText("Change credential PIN")).not.toBeInTheDocument();
});

it("prefills an agent add request and includes requestId when saving", async () => {
  const create = vi.fn(async (_input: CredentialCreateInput) => ok(credential()));
  const request = {
    id: "add-request",
    kind: "add" as const,
    caller: {
      threadId: "thread",
      threadTitle: "Release",
      projectId: "project",
      provider: "Codex",
      model: "gpt-6.1-sol",
      agentRole: "main" as const,
    },
    templateId: "github",
    name: "Release GitHub",
    reason: "Upload a release",
    startedAt: "2026-10-22T14:00:00Z",
  };
  await using screen = await render(
    <CredentialsManager
      credentials={[]}
      status={STATUS}
      projects={[]}
      loading={false}
      error={null}
      readOnly={false}
      osUnlock={null}
      osUnlockStatus={null}
      onOsUnlockStatus={() => undefined}
      onRetry={() => undefined}
      actions={actions({ create })}
      addRequest={{
        ...request,
        caller: {
          ...request.caller,
          threadId: ThreadId.make("thread"),
          projectId: ProjectId.make("project"),
        },
      }}
    />,
  );
  await expect.element(screen.getByLabelText("Name")).toHaveValue("Release GitHub");
  await userEvent.fill(screen.getByLabelText(/^Token/), "ghp_secret");
  await userEvent.click(screen.getByRole("button", { name: "Add credential", exact: true }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: "add-request",
      templateId: "github",
      name: "Release GitHub",
    }),
  );
});

it("unlocks before revoking a credential grant and retries once", async () => {
  const revoke = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, failure: { kind: "unlock-required" } })
    .mockResolvedValueOnce(ok(undefined));
  const unlock = vi.fn(async () => ok(STATUS));
  await using screen = await render(
    <CredentialsManager
      credentials={[credential()]}
      status={STATUS}
      projects={[]}
      loading={false}
      error={null}
      readOnly={false}
      osUnlock={null}
      osUnlockStatus={null}
      onOsUnlockStatus={() => undefined}
      onRetry={() => undefined}
      actions={actions({ unlock })}
      grants={[
        {
          kind: "approval",
          id: "grant",
          credentialId: credential().id,
          scope: "workflow",
          projectId: ProjectId.make("project"),
          threadId: ThreadId.make("thread"),
          workflow: "release",
          approverSessionId: AuthSessionId.make("session"),
          approvalMethod: "pin",
          createdAt: "2026-10-22T14:00:00Z",
        },
      ]}
      onRevokeGrant={revoke}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await userEvent.click(screen.getByRole("button", { name: "Revoke", exact: true }));
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "1234");
  await userEvent.click(page.getByRole("button", { name: "Unlock", exact: true }));
  expect(unlock).toHaveBeenCalledWith("1234");
  expect(revoke).toHaveBeenCalledTimes(2);
  expect(revoke).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "approval", id: "grant" }),
  );
});

it("shows a workflow pre-approval in the grants list and revokes just that credential", async () => {
  const revoke = vi.fn(async () => ok(undefined));
  const projectId = ProjectId.make("project");
  const preapproval = {
    kind: "workflow-preapproval",
    id: "workflow-preapproval:project:release:cred-github",
    credentialId: credential().id,
    projectId,
    workflow: "release",
    approverSessionId: AuthSessionId.make("session"),
    createdAt: "2026-10-22T14:00:00Z",
  } as const;
  await using screen = await render(
    <CredentialsManager
      credentials={[credential()]}
      status={STATUS}
      projects={[{ id: projectId, title: "Acme" }]}
      loading={false}
      error={null}
      readOnly={false}
      osUnlock={null}
      osUnlockStatus={null}
      onOsUnlockStatus={() => undefined}
      onRetry={() => undefined}
      actions={actions()}
      grants={[preapproval]}
      onRevokeGrant={revoke}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await expect.element(screen.getByText("Pre-approved for workflow release · Acme")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Revoke", exact: true }));
  expect(revoke).toHaveBeenCalledWith(preapproval);
});

const customCredential = (): Credential =>
  credential({
    id: CredentialId.make("cred-custom"),
    name: "Deploy",
    templateId: "custom",
    fields: [
      {
        id: "token",
        label: "Token",
        kind: "secret",
        envVar: "DEPLOY_TOKEN",
        required: true,
        highRisk: false,
        secret: { set: true, updatedAt: "2026-10-02T10:00:00.000Z" },
      },
      {
        id: "url",
        label: "URL",
        kind: "text",
        envVar: "DEPLOY_URL",
        required: false,
        highRisk: false,
        value: "https://example.test",
      },
    ],
  });

it("edits a built-in field's environment variable and resets it to the template default", async () => {
  const update = vi.fn(async (_input: CredentialUpdateInput) => ok(credential()));
  const current = credential();

  await using screen = await render(
    manager({ credentials: [current], actions: actions({ update }) }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const envVar = screen.getByLabelText("Environment variable for Token");
  const envVarInput = () =>
    screen.container.querySelector<HTMLInputElement>(
      'input[aria-label="Environment variable for Token"]',
    )?.value;
  await userEvent.clear(envVar);
  await userEvent.fill(envVar, "GH_TOKEN");
  await userEvent.click(
    screen.getByRole("button", { name: "Reset environment variable for Token" }),
  );
  expect(envVarInput()).toBe("GITHUB_TOKEN");

  await userEvent.clear(envVar);
  await userEvent.fill(envVar, "GH_TOKEN");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

  expect(update).toHaveBeenCalledWith({
    id: current.id,
    fields: [{ id: "token", label: "Token", kind: "secret", envVar: "GH_TOKEN", required: true }],
  });
});

it("adds a custom field and confirms before removing one that holds a value", async () => {
  const update = vi.fn(async (_input: CredentialUpdateInput) => ok(customCredential()));
  const current = customCredential();

  await using screen = await render(
    manager({ credentials: [current], actions: actions({ update }) }),
  );

  await userEvent.click(screen.getByRole("button", { name: /Deploy/ }));
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));

  // A field that already holds a secret cannot have its kind changed.
  await expect.element(page.getByLabelText("Kind of Token")).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Remove field Token" }));
  await expect.element(page.getByText("Remove Token?")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Remove field" }));

  await userEvent.click(screen.getByRole("button", { name: "Add field" }));
  await expect.element(page.getByLabelText("Kind of new field")).not.toBeDisabled();
  await userEvent.fill(screen.getByLabelText("Label for new field"), "Region");

  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

  expect(update).toHaveBeenCalledWith({
    id: current.id,
    fields: [
      { id: "url", label: "URL", kind: "text", envVar: "DEPLOY_URL", required: false },
      { id: "field-2", label: "Region", kind: "secret", envVar: "REGION", required: true },
    ],
  });
});

it("unlocks the vault and retries a field edit once", async () => {
  const update = vi
    .fn<(input: CredentialUpdateInput) => Promise<CredentialActionResult<Credential>>>()
    .mockResolvedValueOnce({ ok: false, failure: { kind: "unlock-required" } })
    .mockResolvedValueOnce(ok(credential()));
  const unlock = vi.fn(async () => ok(STATUS));
  const current = credential();

  await using screen = await render(
    manager({ credentials: [current], actions: actions({ update, unlock }) }),
  );

  await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const envVar = screen.getByLabelText("Environment variable for Token");
  await userEvent.clear(envVar);
  await userEvent.fill(envVar, "GH_TOKEN");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await expect.element(page.getByText("Unlock credentials")).toBeVisible();
  await userEvent.fill(page.getByLabelText("PIN", { exact: true }), "1234");
  await userEvent.click(page.getByRole("button", { name: "Unlock" }));

  expect(update).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenLastCalledWith({
    id: current.id,
    fields: [{ id: "token", label: "Token", kind: "secret", envVar: "GH_TOKEN", required: true }],
  });
  await expect.element(page.getByText("Unlock credentials")).not.toBeInTheDocument();
});

it("sets the environment variable a built-in field is injected as, and refuses a reserved name", async () => {
  const create = vi.fn(async (_input: CredentialCreateInput) => ok(credential()));

  await using screen = await render(manager({ actions: actions({ create }) }));

  await clickAddCredential(screen);
  await userEvent.click(screen.getByRole("button", { name: /GitHub token/ }));
  await userEvent.fill(screen.getByLabelText("Name"), "GitHub deploy");
  await userEvent.fill(screen.getByLabelText(/^Token/), "ghp_secret");
  const envVar = screen.getByLabelText("Environment variable for Token");
  await userEvent.fill(envVar, "PATH");
  await userEvent.click(screen.getByRole("button", { name: "Add credential" }));

  await expect.element(screen.getByText(/PATH is reserved by the system/)).toBeVisible();
  expect(create).not.toHaveBeenCalled();

  await userEvent.fill(envVar, "GH_TOKEN");
  await userEvent.click(screen.getByRole("button", { name: "Add credential" }));

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      templateId: "github",
      fields: [{ id: "token", label: "Token", kind: "secret", envVar: "GH_TOKEN" }],
    }),
  );
});
