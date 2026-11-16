import type { ReactElement } from "react";
import { EnvironmentId, type WorkflowListing } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { PlusIcon } from "lucide-react";
import "~/index.css";

import { render } from "../../test/render";
import { WorkflowPanelHeader } from "./WorkflowPanelHeader";
import { Button } from "../components/ui/button";
import { consumeWorkflowCreateRequest } from "./workflowUiStore";
import { workflowRunFixture } from "./workflowTestFixture";

const credentials = vi.hoisted(() => ({
  allowed: true,
  queriedEnvironments: [] as string[],
}));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => credentials.allowed) as never,
}));
vi.mock("../state/entities", () => ({ useProjects: () => [], useThreadShell: () => null }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: { environmentId: string; kind: string } | null) => {
    if (query) credentials.queriedEnvironments.push(query.environmentId);
    return {
      data:
        query === null
          ? null
          : query.kind === "live"
            ? { historyRevision: 0, pending: [], active: [] }
            : query.kind === "history"
              ? { events: [] }
              : query.kind === "grants"
                ? []
                : query.kind === "list"
                  ? { credentials: [] }
                  : { pinSet: true, keyStorage: "os-keychain" },
      isPending: false,
      error: null,
      refresh: vi.fn(),
    };
  },
}));
vi.mock("../credentials/credentialState", () => ({
  createCredential: { permissionAtom: () => null },
  credentialLive: { liveStateAtom: (environmentId: string) => ({ environmentId, kind: "live" }) },
  credentialHistoryWindowQuery: (input: object) => ({ ...input, kind: "history" }),
  credentialHistoryQuery: (input: object) => ({ ...input, kind: "history" }),
  credentialGrantsQuery: (input: object) => ({ ...input, kind: "grants" }),
  revokeCredentialGrant: {},
  credentialListQuery: (input: object) => ({ ...input, kind: "list" }),
  credentialsStatusQuery: (input: object) => ({ ...input, kind: "status" }),
  deleteCredential: {},
  lockCredentials: {},
  readCredentialHistory: {},
  removeCredentialSecret: {},
  setCredentialPin: {},
  setCredentialSecret: {},
  unlockCredentials: {},
  updateCredential: {},
}));

const listing = {
  projectId: workflowRunFixture.projectId,
  workflow: workflowRunFixture.workflow,
  definition: workflowRunFixture.definition,
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: workflowRunFixture.startedAt,
  scratch: false,
  editedByThreadId: null,
} satisfies WorkflowListing;

const onSelectWorkflow = vi.fn();
const onSaveAsWorkflow = vi.fn();
const onNew = vi.fn();
const onEditWorkflow = vi.fn();
const onStop = vi.fn();
const onRun = vi.fn();

function setup() {
  onSelectWorkflow.mockReset();
  onSaveAsWorkflow.mockReset();
  onNew.mockReset();
  onEditWorkflow.mockReset();
  onStop.mockReset();
  onRun.mockReset();
  consumeWorkflowCreateRequest();
  credentials.allowed = true;
  credentials.queriedEnvironments = [];
}

function renderHeader(element: ReactElement, width = "450px") {
  setup();
  const container = document.createElement("div");
  container.style.width = width;
  return render(element, { container });
}

function header(
  options: {
    longName?: boolean;
    running?: boolean;
    editMode?: boolean;
    environmentId?: EnvironmentId;
  } = {},
) {
  const workflow = options.longName
    ? {
        ...listing,
        definition: {
          ...listing.definition!,
          name: "A very long workflow name that should truncate",
        },
      }
    : listing;
  return (
    <WorkflowPanelHeader
      {...(options.environmentId ? { environmentId: options.environmentId } : {})}
      workflows={[workflow]}
      selected={workflow}
      runs={options.running ? [workflowRunFixture] : []}
      run={options.running ? workflowRunFixture : null}
      editMode={options.editMode ?? Boolean(options.running)}
      showSubagents={false}
      canEdit
      hasProject
      busy={false}
      onSelectWorkflow={onSelectWorkflow}
      onSelectRun={vi.fn()}
      stepAction={
        <Button variant="outline" size="icon-xs" aria-label="Add a step">
          <PlusIcon />
        </Button>
      }
      onNew={onNew}
      onToggleSubagents={vi.fn()}
      onSaveAsWorkflow={onSaveAsWorkflow}
      onStop={onStop}
      canStop
      onRun={onRun}
      onEditWorkflow={onEditWorkflow}
      onOpenBlocker={vi.fn()}
      latestRun={null}
      changedSinceRun={false}
      onOpenLastRun={vi.fn()}
      rerunOf={null}
    />
  );
}

it("keeps the primary controls on one row at 450px and puts secondary actions in menus", async () => {
  await using screen = await renderHeader(header({ longName: true, running: true }), "450px");
  const { container } = screen;
  const row = container.firstElementChild as HTMLElement;
  const rects = [...row.querySelectorAll("button")].map((child) => child.getBoundingClientRect());
  expect(
    rects.every(
      (rect) => Math.abs(rect.top + rect.height / 2 - (rects[0]!.top + rects[0]!.height / 2)) < 1,
    ),
  ).toBe(true);
  expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(45);
  expect(rects.every((rect) => rect.right <= container.getBoundingClientRect().right)).toBe(true);
  expect(
    container.querySelector('[aria-label="Workflow"]')?.getBoundingClientRect().width,
  ).toBeGreaterThan(0);
  expect(container.querySelector('[aria-label="Remote runs"]')?.hasAttribute("disabled")).toBe(
    true,
  );
  expect(container.querySelector('[aria-label="More workflow actions"]')).not.toBeNull();
  expect(
    [...row.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Stop"),
  ).toBe(true);
  expect(container.textContent).not.toContain("Save as workflow…");

  await userEvent.click(container.querySelector('[aria-label="More workflow actions"]')!);
  await userEvent.click(
    [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Save as workflow"),
    )!,
  );
  expect(onSaveAsWorkflow).toHaveBeenCalledOnce();
  await screen.rerender(header({ longName: true, running: true, editMode: false }));
  await userEvent.click(container.querySelector('[aria-label="More workflow actions"]')!);
  await userEvent.click(
    [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Edit workflow"),
    )!,
  );
  expect(onEditWorkflow).toHaveBeenCalledOnce();
});

it.each([320, 450])(
  "offers New workflow as a non-selecting final workflow action at %spx",
  async (width) => {
    await using screen = await renderHeader(header(), `${width}px`);
    await userEvent.click(screen.container.querySelector('[aria-label="Workflow"]')!);
    await expect
      .poll(() =>
        document.querySelector('[data-slot="select-positioner"]')?.getAttribute("data-side"),
      )
      .toBe("bottom");
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual([listing.definition!.name, "New workflow…"]);
    await userEvent.click(options[1]!);
    expect(onNew).toHaveBeenCalledOnce();
    expect(onSelectWorkflow).not.toHaveBeenCalled();
    expect(screen.container.querySelector('[aria-label="Workflow"]')?.textContent).toContain(
      listing.definition!.name,
    );
    expect(consumeWorkflowCreateRequest()).toBe(false);
  },
);

it.each(["Escape", "Close"])(
  "opens the environment's credential manager and returns to the canvas with %s",
  async (close) => {
    const environmentId = EnvironmentId.make("workflow-environment");
    await using screen = await renderHeader(
      <>
        {header({ environmentId })}
        <input aria-label="Canvas note" defaultValue="Keep this canvas" />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "More workflow actions" });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Credentials…" }).click();
    await expect.element(page.getByRole("dialog", { name: "Workflow credentials" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Add credential", exact: true }).first())
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Open in Settings" }))
      .toHaveAttribute("href", "/settings/credentials");
    expect(new Set(credentials.queriedEnvironments)).toEqual(new Set([environmentId]));
    if (close === "Escape") await userEvent.keyboard("{Escape}");
    else await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Workflow credentials" }))
      .not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
    await expect
      .element(screen.getByRole("textbox", { name: "Canvas note" }))
      .toHaveValue("Keep this canvas");
    expect(screen.router?.state.location.pathname).toBe("/");
  },
);

it("keeps Credentials available to a connection without access and shows the shared no-access state", async () => {
  await using screen = await renderHeader(
    header({ environmentId: EnvironmentId.make("narrowed") }),
  );
  credentials.allowed = false;
  await screen.getByRole("button", { name: "More workflow actions" }).click();
  await page.getByRole("menuitem", { name: "Credentials…" }).click();
  await expect.element(page.getByRole("dialog", { name: "Workflow credentials" })).toBeVisible();
  await expect.element(page.getByText("Credentials are not available here")).toBeVisible();
  await expect
    .element(page.getByText("This connection wasn't granted credential access.", { exact: false }))
    .toBeVisible();
  expect(credentials.queriedEnvironments).toEqual([]);
});
