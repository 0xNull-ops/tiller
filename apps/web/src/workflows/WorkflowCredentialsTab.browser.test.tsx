import { CredentialId, ProjectId, type Credential, type WorkflowStep } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { WorkflowCredentialsTab } from "./WorkflowCredentialsTab";
import "~/index.css";

const projectId = ProjectId.make("project");
const otherProjectId = ProjectId.make("other-project");

const credential = (input: {
  readonly id: string;
  readonly name: string;
  readonly templateId: string;
  readonly status: Credential["status"];
  readonly envVar?: string;
  readonly projects?: Credential["policy"]["projects"];
}): Credential => ({
  id: CredentialId.make(input.id),
  name: input.name,
  templateId: input.templateId,
  fields: [
    {
      id: "key",
      label: "Key",
      kind: "secret",
      envVar: input.envVar ?? "KEY",
      required: true,
      highRisk: false,
      secret: { set: true },
    },
  ],
  policy: {
    projects: input.projects ?? "all",
    alwaysAsk: true,
    revealAllowed: false,
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  useCount: 0,
  status: input.status,
});

const appStore = credential({
  id: "cred-appstore",
  name: "App Store Connect — Acme",
  templateId: "app-store-connect",
  status: "ready",
  envVar: "ASC_KEY_ID",
});
const vercel = credential({
  id: "cred-vercel",
  name: "Vercel — site",
  templateId: "vercel",
  status: "expiring",
  envVar: "VERCEL_TOKEN",
});
const broken = credential({
  id: "cred-broken",
  name: "GitHub — old",
  templateId: "github",
  status: "missing-field",
});
const scoped = credential({
  id: "cred-scoped",
  name: "RevenueCat — other app",
  templateId: "revenuecat",
  status: "ready",
  projects: [otherProjectId],
});

const plainStep: WorkflowStep = { id: "build", skill: "build" };
const iosStep: WorkflowStep = {
  id: "upload",
  skill: "ios-upload",
  note: "Upload the build with asc and wait for TestFlight processing.",
};

const projects = [
  { id: projectId, title: "Storefront" },
  { id: otherProjectId, title: "Other app" },
];

const vault = [appStore, vercel, broken, scoped];
const noop = () => undefined;

function Tab({
  step = plainStep,
  credentials = vault,
  onAttach = noop,
  onNewCredential = noop,
  onManage = noop,
  onOpenCredential = noop,
}: {
  step?: WorkflowStep;
  credentials?: ReadonlyArray<Credential>;
  onAttach?: (credentials: ReadonlyArray<Credential>) => void;
  onNewCredential?: (templateId: string | null) => void;
  onManage?: () => void;
  onOpenCredential?: (credentialId: string) => void;
}) {
  return (
    <WorkflowCredentialsTab
      projectId={projectId}
      projects={projects}
      step={step}
      credentials={credentials}
      loading={false}
      error={null}
      disabled={false}
      approvals={<span>Approvals: once per run</span>}
      onAttach={onAttach}
      onNewCredential={onNewCredential}
      onManage={onManage}
      onOpenCredential={onOpenCredential}
    />
  );
}

it("lists the vault with statuses and disables a credential limited to another project", async () => {
  await using screen = await render(<Tab />);
  await expect.element(screen.getByText("App Store Connect — Acme")).toBeVisible();
  await expect.element(screen.getByText("Ready").first()).toBeVisible();
  await expect.element(screen.getByText("Expires soon").first()).toBeVisible();
  await expect.element(screen.getByText("Missing field").first()).toBeVisible();
  await expect.element(screen.getByText("Only for Other app")).toBeVisible();
  await expect
    .element(screen.getByRole("checkbox", { name: "Attach RevenueCat — other app" }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("checkbox", { name: "Attach App Store Connect — Acme" }))
    .toBeEnabled();
});

it("suggests the credentials a step's own words name", async () => {
  const onNewCredential = vi.fn();
  await using screen = await render(
    <Tab step={iosStep} credentials={[vercel]} onNewCredential={onNewCredential} />,
  );
  const suggested = screen.getByRole("region", { name: "Suggested for this step" });
  await expect.element(suggested.getByText("App Store Connect API key")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Add App Store Connect API key" }));
  expect(onNewCredential).toHaveBeenCalledExactlyOnceWith("app-store-connect");
});

it("attaches a multi-selection in one write", async () => {
  const onAttach = vi.fn();
  await using screen = await render(<Tab onAttach={onAttach} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Attach App Store Connect — Acme" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Attach GitHub — old" }));
  await userEvent.click(screen.getByRole("button", { name: "Attach 2" }));
  expect(onAttach).toHaveBeenCalledOnce();
  const attached = onAttach.mock.calls[0]![0] as ReadonlyArray<Credential>;
  expect(attached.map((entry) => [entry.templateId, entry.id])).toEqual([
    ["app-store-connect", CredentialId.make("cred-appstore")],
    ["github", CredentialId.make("cred-broken")],
  ]);
});

it("shows a credential already on the step as attached and unselectable", async () => {
  const attachedStep: WorkflowStep = {
    ...plainStep,
    attachments: [
      {
        id: "resource-1",
        kind: "credential",
        templateId: "app-store-connect",
        credentialId: CredentialId.make("cred-appstore"),
      },
    ],
  };
  await using screen = await render(<Tab step={attachedStep} />);
  await expect.element(screen.getByText("Attached").first()).toBeVisible();
  await expect
    .element(screen.getByRole("checkbox", { name: "Attach App Store Connect — Acme" }))
    .toBeDisabled();
});

it("opens the add form from a template chip when the vault is empty", async () => {
  const onNewCredential = vi.fn();
  await using screen = await render(<Tab credentials={[]} onNewCredential={onNewCredential} />);
  await expect.element(screen.getByText("No credentials yet")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "GitHub token" }));
  expect(onNewCredential).toHaveBeenCalledExactlyOnceWith("github");
  await userEvent.click(screen.getByRole("button", { name: "Custom" }));
  expect(onNewCredential).toHaveBeenCalledTimes(2);
});

it("searches names, templates and env-var names", async () => {
  await using screen = await render(<Tab />);
  await userEvent.fill(
    screen.getByRole("searchbox", { name: "Search credentials" }),
    "VERCEL_TOKEN",
  );
  await expect.element(screen.getByText("Vercel — site")).toBeVisible();
  await expect.element(screen.getByText("App Store Connect — Acme")).not.toBeInTheDocument();
});

it("opens the manager for a row, for manage, and for a new credential", async () => {
  const onOpenCredential = vi.fn();
  const onManage = vi.fn();
  const onNewCredential = vi.fn();
  await using screen = await render(
    <Tab
      onOpenCredential={onOpenCredential}
      onManage={onManage}
      onNewCredential={onNewCredential}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Open Vercel — site" }));
  expect(onOpenCredential).toHaveBeenCalledExactlyOnceWith("cred-vercel");
  await userEvent.click(screen.getByRole("button", { name: "Manage credentials…" }));
  expect(onManage).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "New credential…" }));
  expect(onNewCredential).toHaveBeenCalledExactlyOnceWith(null);
});
