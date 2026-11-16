import {
  CREDENTIAL_REAPPROVAL_WARNING,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import { WorkflowSchedulePanel } from "./WorkflowSchedulePanel";
import { workflowAttachmentRevision, workflowReadinessForListing } from "./workflowState";
import { workflowRunFixture } from "./workflowTestFixture";

const state = vi.hoisted(() => ({ edit: vi.fn(), gate: vi.fn(), allowed: true }));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => state.allowed) as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.edit) as never,
}));
vi.mock(import("../credentials/useCredentialGate"), async (original) => ({
  ...(await original()),
  useCredentialGate: (() => ({
    run: state.gate,
    busy: false,
    error: null,
    dialog: null,
  })) as never,
}));
vi.mock(import("./workflowState"), async (original) => ({
  ...(await original()),
  useWorkflowEdit: (() => ({
    canEdit: state.allowed,
    busy: false,
    error: null,
    clearError: () => {},
    run: vi.fn(),
  })) as never,
}));
vi.mock(import("./useWorkflowSchedules"), () => ({
  useWorkflowSchedules: () => ({ tasks: [], nextRunAt: null, isPending: false, error: null }),
}));
vi.mock(import("../state/environments"), () => ({
  useEnvironmentHttpBaseUrl: () => "https://server.example",
}));

const projectId = ProjectId.make("project");
const listing = {
  projectId,
  workflow: "monthly-aso",
  definition: {
    ...workflowRunFixture.definition,
    name: "Monthly ASO",
    credentialApprovals: "once-per-run" as const,
    steps: [
      {
        id: "upload",
        skill: "ios-upload",
        attachments: [
          {
            id: "resource-1",
            kind: "credential" as const,
            templateId: "app-store-connect",
            credentialId: "cred-appstore" as never,
          },
        ],
      },
    ],
  },
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  readiness: {
    entries: [],
    blocksRun: false,
    warnings: ["Scheduled runs need Pre-approved credentials."],
  },
  updatedAt: workflowRunFixture.startedAt,
  scratch: false,
  editedByThreadId: null,
};

function setup() {
  state.allowed = true;
  state.edit.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  state.gate.mockReset().mockImplementation(async (action: () => Promise<unknown>) => action());
}

it("shows the schedule readiness warning and switches the knob through the unlock gate", async () => {
  setup();
  await using _screen = await render(
    <WorkflowSchedulePanel
      environmentId={EnvironmentId.make("remote")}
      projectId={projectId}
      workflow={listing}
      driverThreadId={ThreadId.make("driver")}
      onClose={() => {}}
    />,
  );
  await expect
    .poll(() => document.body.textContent ?? "")
    .toContain("Scheduled runs need Pre-approved credentials.");
  const preApprove = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Switch to Pre-approved"),
  );
  if (!preApprove) throw new Error(`No pre-approve button in: ${document.body.textContent}`);
  await userEvent.click(preApprove);
  expect(state.gate).toHaveBeenCalledOnce();
  expect(state.edit).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("remote"),
    input: {
      _tag: "meta",
      projectId,
      workflow: "monthly-aso",
      credentialApprovals: "pre-approved",
    },
  });
});

it("hides the pre-approve action once the workflow is already pre-approved", async () => {
  setup();
  await using _screen = await render(
    <WorkflowSchedulePanel
      environmentId={EnvironmentId.make("remote")}
      projectId={projectId}
      workflow={{
        ...listing,
        definition: { ...listing.definition, credentialApprovals: "pre-approved" },
        readiness: { ...listing.readiness, warnings: [] },
      }}
      driverThreadId={ThreadId.make("driver")}
      onClose={() => {}}
    />,
  );
  expect(
    [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Switch to Pre-approved",
    ),
  ).toBeUndefined();
});

it("re-offers the approval when a pre-approved workflow has an uncovered credential", async () => {
  setup();
  await using _screen = await render(
    <WorkflowSchedulePanel
      environmentId={EnvironmentId.make("remote")}
      projectId={projectId}
      workflow={{
        ...listing,
        definition: { ...listing.definition, credentialApprovals: "pre-approved" },
        readiness: {
          ...listing.readiness,
          warnings: [
            "Some attached credentials aren't covered by this workflow's pre-approval. Switch to Pre-approved again to cover them.",
          ],
        },
      }}
      driverThreadId={ThreadId.make("driver")}
      onClose={() => {}}
    />,
  );
  await expect
    .poll(() => document.body.textContent ?? "")
    .toContain("aren't covered by this workflow's pre-approval");
  const reapprove = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Re-approve credentials"),
  );
  if (!reapprove) throw new Error(`No re-approve button in: ${document.body.textContent}`);
  await userEvent.click(reapprove);
  expect(state.gate).toHaveBeenCalledOnce();
  expect(state.edit).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("remote"),
    input: {
      _tag: "meta",
      projectId,
      workflow: "monthly-aso",
      credentialApprovals: "pre-approved",
    },
  });
});

it("keeps the server's credential warning when a newer probe result sets the readiness", async () => {
  setup();
  const preApproved = {
    ...listing,
    definition: { ...listing.definition, credentialApprovals: "pre-approved" as const },
  };
  const context = {
    threadId: ThreadId.make("driver"),
    workspaceRoot: "/repo",
    specification: workflowAttachmentRevision(preApproved),
  };
  const readiness = workflowReadinessForListing(
    {
      ...preApproved,
      readiness: {
        entries: [],
        blocksRun: false,
        warnings: [CREDENTIAL_REAPPROVAL_WARNING],
        evaluatedAt: "2026-10-21T10:00:00.000Z",
        context,
      },
    },
    {
      readiness: {
        entries: [],
        blocksRun: false,
        evaluatedAt: "2026-10-21T12:00:00.000Z",
        context,
      },
      attachmentRevision: workflowAttachmentRevision(preApproved),
    },
    context,
  );
  if (!readiness) throw new Error("No readiness merged from the listing and the probe");
  await using _screen = await render(
    <WorkflowSchedulePanel
      environmentId={EnvironmentId.make("remote")}
      projectId={projectId}
      workflow={{ ...preApproved, readiness }}
      driverThreadId={ThreadId.make("driver")}
      onClose={() => {}}
    />,
  );
  await expect
    .poll(() => document.body.textContent ?? "")
    .toContain("aren't covered by this workflow's pre-approval");
});
