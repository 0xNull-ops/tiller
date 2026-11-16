import {
  CredentialId,
  EnvironmentId,
  ProjectId,
  type WorkflowCredentialReadiness,
  type WorkflowReadinessEntry,
  type WorkflowReadinessSnapshot,
} from "@t3tools/contracts";
import { EMPTY_CREDENTIAL_LIVE_STATE } from "@t3tools/client-runtime/state/runtime";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { WorkflowCanvasCard } from "./WorkflowCanvasCard";
import { attachmentChipCounts } from "./WorkflowAttachmentCard";
import {
  WorkflowCredentialNeeds,
  WorkflowCredentialSatelliteCard,
} from "./WorkflowCredentialSatellite";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import { workflowRunFixture } from "./workflowTestFixture";
import {
  credentialActivityFixture,
  credentialHistoryFixture,
  credentialRequestFixture,
} from "../credentials/credentialActivityFixture";
import "~/index.css";

vi.mock("../credentials/CredentialRequest", () => ({
  CredentialRequest: () => <div>Allow for this run · Deny</div>,
}));

const environmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const credentialId = CredentialId.make("cred-appstore");
const credentialName = "App Store Connect — Acme";
const templateId = "app-store-connect";
const templateName = "App Store Connect API key";

const appStore = {
  credentialId,
  credentialName,
  templateId,
};

const definition = {
  ...workflowRunFixture.definition,
  credentialApprovals: "once-per-run" as const,
  steps: workflowRunFixture.definition.steps.map((step) =>
    step.id === "build"
      ? {
          ...step,
          attachments: [
            {
              id: "resource-1",
              kind: "credential" as const,
              templateId,
              credentialId,
            },
          ],
        }
      : step,
  ),
};

const credentialReadiness = (
  overrides: Partial<WorkflowCredentialReadiness> = {},
): WorkflowCredentialReadiness => ({
  state: "ready",
  templateId,
  statusLabel: "Ready",
  credentialId,
  name: credentialName,
  envVars: [{ name: "ASC_KEY_ID", file: false }],
  candidates: [],
  optional: false,
  ...overrides,
});

const snapshot = (credential: WorkflowCredentialReadiness): WorkflowReadinessSnapshot => ({
  entries: [
    {
      stepId: "build",
      attachmentId: "resource-1",
      kind: "credential",
      status:
        credential.state === "missing" || credential.state === "choose" ? "missing" : "available",
      message: credential.statusLabel,
      credential,
    } satisfies WorkflowReadinessEntry,
  ],
  blocksRun: false,
});

const readySnapshot = snapshot(credentialReadiness());

type GraphCredentials = Parameters<typeof buildWorkflowRunGraph>[4];

const noop = () => undefined;

const noChips: ReturnType<typeof attachmentChipCounts> = [];

function Harness({
  credentials,
  chips = noChips,
  onChoose = noop,
  onAdd = noop,
  onFix = noop,
  onRemove = noop,
  subagentModelLabel,
  editMode = false,
  delegation,
}: {
  credentials: GraphCredentials;
  chips?: ReturnType<typeof attachmentChipCounts>;
  onChoose?: (credentialId: string) => void;
  onAdd?: () => void;
  onFix?: () => void;
  onRemove?: () => void;
  subagentModelLabel?: string;
  editMode?: boolean;
  delegation?: "subagent" | "self";
}) {
  const node = buildWorkflowRunGraph(
    workflowRunFixture,
    definition,
    [],
    new Map(),
    credentials,
  ).nodes.find((entry) => entry.workflowStepId === "build")!;
  return (
    <div>
      <WorkflowCanvasCard
        node={node}
        style={{ position: "relative" }}
        onOpen={null}
        actions={null}
        error=""
        worker={node.worker ?? null}
        appearing={false}
        onAppearanceEnd={() => undefined}
        onSelectDetail={null}
        chips={chips}
        editMode={editMode}
        {...(delegation ? { delegation } : {})}
        {...(subagentModelLabel ? { subagentModelLabel } : {})}
      />
      {node.credentials!.map((satellite) => (
        <WorkflowCredentialSatelliteCard
          key={satellite.key}
          satellite={satellite}
          environmentId={environmentId}
          projectId={projectId}
          canEdit
          onChoose={onChoose}
          onAdd={onAdd}
          onFix={onFix}
          onManage={() => undefined}
          onRemove={onRemove}
        />
      ))}
      <WorkflowCredentialNeeds satellites={node.credentials!} />
    </div>
  );
}

it("shows the draft delegation indicator instead of the last run model while editing", async () => {
  await using screen = await render(
    <Harness
      credentials={{ live: EMPTY_CREDENTIAL_LIVE_STATE, history: [], readiness: readySnapshot }}
      editMode
      delegation="subagent"
      subagentModelLabel="Haiku 5.5"
    />,
  );

  expect(screen.getByRole("img", { name: "Runs as a subagent" })).toBeDefined();
  expect(screen.container.textContent).not.toContain("Subagent · Haiku 5.5");
});

it("shows one credential card that turns from readiness into approval, use and history", async () => {
  await using screen = await render(
    <Harness
      credentials={{ live: EMPTY_CREDENTIAL_LIVE_STATE, history: [], readiness: readySnapshot }}
    />,
  );
  await expect.element(screen.getByText("Ready", { exact: true }).first()).toBeVisible();
  await expect.element(screen.getByText("once per run", { exact: true })).toBeVisible();
  expect(document.querySelectorAll("[data-workflow-credential-card]")).toHaveLength(1);

  await screen.rerender(
    <Harness
      credentials={{
        live: {
          ...EMPTY_CREDENTIAL_LIVE_STATE,
          pending: [{ ...credentialRequestFixture, ...appStore }],
        },
        history: [],
        readiness: readySnapshot,
      }}
    />,
  );
  await expect.element(screen.getByText("Needs approval", { exact: true }).first()).toBeVisible();
  await expect.element(screen.getByText("Allow for this run · Deny")).toBeVisible();
  expect(document.querySelectorAll("[data-workflow-credential-card]")).toHaveLength(1);

  await screen.rerender(
    <Harness
      credentials={{
        live: {
          ...EMPTY_CREDENTIAL_LIVE_STATE,
          active: [{ ...credentialActivityFixture, ...appStore }],
        },
        history: [],
        readiness: readySnapshot,
      }}
    />,
  );
  await expect.element(screen.getByText("In use", { exact: true }).first()).toBeVisible();
  expect(document.querySelectorAll("[data-workflow-credential-card]")).toHaveLength(1);

  await screen.rerender(
    <Harness
      credentials={{
        live: { ...EMPTY_CREDENTIAL_LIVE_STATE, historyRevision: 1 },
        history: [{ ...credentialHistoryFixture, ...appStore }],
        readiness: readySnapshot,
      }}
    />,
  );
  await expect.element(screen.getByText("Used 1×", { exact: true }).first()).toBeVisible();
  expect(document.querySelectorAll("[data-workflow-credential-card]")).toHaveLength(1);
});

it("names the caller and the command on the satellite while a use is asking or running", async () => {
  await using screen = await render(
    <Harness
      credentials={{
        live: {
          ...EMPTY_CREDENTIAL_LIVE_STATE,
          pending: [{ ...credentialRequestFixture, ...appStore }],
        },
        history: [],
        readiness: readySnapshot,
      }}
    />,
  );
  await expect.element(screen.getByText(/Asked by Codex subagent/).first()).toBeVisible();
  await expect.element(screen.getByText("gh release list", { exact: true }).first()).toBeVisible();

  await screen.rerender(
    <Harness
      credentials={{
        live: {
          ...EMPTY_CREDENTIAL_LIVE_STATE,
          active: [{ ...credentialActivityFixture, ...appStore }],
        },
        history: [],
        readiness: readySnapshot,
      }}
    />,
  );
  await expect.element(screen.getByText(/In use by Codex subagent/).first()).toBeVisible();
  await expect.element(screen.getByText("gh release list", { exact: true }).first()).toBeVisible();
});

it("reads as an attachment: kind label, masked env rows and one status line", async () => {
  const threeVars = credentialReadiness({
    envVars: [
      { name: "ASC_KEY_ID", file: false },
      { name: "ASC_ISSUER_ID", file: false },
      { name: "ASC_KEY_PATH", file: true },
    ],
  });
  await using screen = await render(
    <Harness
      credentials={{
        live: { ...EMPTY_CREDENTIAL_LIVE_STATE, historyRevision: 1 },
        history: [{ ...credentialHistoryFixture, ...appStore }],
        readiness: snapshot(threeVars),
      }}
    />,
  );
  const card = document.querySelector<HTMLElement>("[data-workflow-credential-card]")!;
  expect(card.dataset.attachmentKind).toBe("credential");
  expect(card.dataset.attachmentTone).toBe("idle");
  expect(card.textContent).toContain("Credential");
  await expect.element(screen.getByText("ASC_KEY_ID ••••••••")).toBeVisible();
  await expect.element(screen.getByText("ASC_ISSUER_ID ••••••••")).toBeVisible();
  await expect.element(screen.getByText("+1", { exact: true })).toBeVisible();
  expect(card.textContent).not.toContain("ASC_KEY_PATH");
  // The header no longer repeats the count; the status line is the one place it is said.
  const usedLines = Array.from(card.querySelectorAll("p")).filter(
    (line) => line.textContent === "Used 1×",
  );
  expect(usedLines).toHaveLength(1);
});

it("draws a satellite that is asking for approval as a solid, amber card", async () => {
  await using _screen = await render(
    <Harness
      credentials={{
        live: {
          ...EMPTY_CREDENTIAL_LIVE_STATE,
          pending: [{ ...credentialRequestFixture, ...appStore }],
        },
        history: [],
        readiness: readySnapshot,
      }}
    />,
  );
  const card = document.querySelector<HTMLElement>("[data-workflow-credential-card]")!;
  expect(card.dataset.credentialState).toBe("asking");
  expect(card.dataset.attachmentTone).toBe("needs-you");
});

it("counts what a step uses on its card, not the credential's status", async () => {
  await using screen = await render(
    <Harness
      credentials={{ live: EMPTY_CREDENTIAL_LIVE_STATE, history: [], readiness: readySnapshot }}
      chips={attachmentChipCounts({ credentials: 1, checks: 1, attachments: [] })}
    />,
  );
  await expect.element(screen.getByRole("img", { name: "1 credential" })).toBeVisible();
  await expect.element(screen.getByRole("img", { name: "1 check" })).toBeVisible();
  expect(screen.getByRole("img", { name: "1 credential" }).element().textContent).not.toContain(
    credentialName,
  );
});

it("keeps the who-line alone when the live use has no command", async () => {
  const withoutCommand = { ...credentialActivityFixture, ...appStore };
  delete withoutCommand.commandPreview;
  await using screen = await render(
    <Harness
      credentials={{
        live: { ...EMPTY_CREDENTIAL_LIVE_STATE, active: [withoutCommand] },
        history: [],
        readiness: readySnapshot,
      }}
    />,
  );
  await expect.element(screen.getByText(/In use by Codex subagent/).first()).toBeVisible();
  expect(screen.getByText("gh release list", { exact: true }).elements()).toHaveLength(0);
});

it("offers Add for a missing credential and binds it through the panel", async () => {
  const onAdd = vi.fn();
  await using screen = await render(
    <Harness
      credentials={{
        live: EMPTY_CREDENTIAL_LIVE_STATE,
        history: [],
        readiness: snapshot(
          credentialReadiness({ state: "missing", statusLabel: "Missing", envVars: [] }),
        ),
      }}
      onAdd={onAdd}
    />,
  );
  await expect.element(screen.getByText("Missing", { exact: true }).first()).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: `Add ${templateName}` }));
  expect(onAdd).toHaveBeenCalledOnce();
});

it("chooses among candidates for an imported, unbound step", async () => {
  const onChoose = vi.fn();
  await using screen = await render(
    <Harness
      credentials={{
        live: EMPTY_CREDENTIAL_LIVE_STATE,
        history: [],
        readiness: snapshot(
          credentialReadiness({
            state: "choose",
            statusLabel: "Choose a credential",
            envVars: [],
            candidates: [
              { id: credentialId, name: credentialName, status: "ready", statusLabel: "Ready" },
            ],
          }),
        ),
      }}
      onChoose={onChoose}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: `Choose ${templateName}` }));
  await userEvent.click(screen.getByRole("button", { name: `Choose ${credentialName}` }));
  expect(onChoose).toHaveBeenCalledExactlyOnceWith(credentialId);
});

it("removes the attachment from the step's card menu", async () => {
  const onRemove = vi.fn();
  await using screen = await render(
    <Harness
      credentials={{ live: EMPTY_CREDENTIAL_LIVE_STATE, history: [], readiness: readySnapshot }}
      onRemove={onRemove}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: `${credentialName} credential actions` }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Remove from step" }));
  expect(onRemove).toHaveBeenCalledOnce();
});

it("names the env vars the agent gets and the approval mode", async () => {
  await using screen = await render(
    <Harness
      credentials={{
        live: EMPTY_CREDENTIAL_LIVE_STATE,
        history: [],
        readiness: snapshot(
          credentialReadiness({
            envVars: [
              { name: "ASC_KEY_ID", file: false },
              { name: "ASC_PRIVATE_KEY", file: true },
            ],
          }),
        ),
      }}
    />,
  );
  await expect
    .element(screen.getByText(/ASC_KEY_ID · ASC_PRIVATE_KEY \(file path\)/).first())
    .toBeVisible();
  await expect.element(screen.getByText(/Agent gets/)).toBeVisible();
  await expect.element(screen.getByText(/once per run/).first()).toBeVisible();
});

it("shows the model used by a subagent on the step card", async () => {
  await using screen = await render(
    <Harness
      credentials={{ live: EMPTY_CREDENTIAL_LIVE_STATE, history: [], readiness: readySnapshot }}
      subagentModelLabel="Haiku 5.5"
    />,
  );
  await expect.element(screen.getByText("Subagent · Haiku 5.5")).toBeVisible();
});
