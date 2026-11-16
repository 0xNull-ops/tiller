import { EnvironmentId, ProjectId, type WorkflowListing } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../test/render";
const state = vi.hoisted(() => ({
  search: vi.fn(),
  preview: vi.fn(),
  install: vi.fn(),
  edit: vi.fn(),
  skills: [] as Record<string, unknown>[],
}));
vi.mock("@t3tools/client-runtime/state/skillsSh", () => ({
  createSkillsShCommands: () =>
    Object.fromEntries(
      [
        "search",
        "preview",
        "install",
        "audit",
        "dismiss",
        "list",
        "uninstall",
        "updates",
        "pending",
      ].map((kind) => [kind, { kind, permissionAtom: () => Atom.make(true) }]),
    ),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { kind: string }) =>
    state[command.kind as "search" | "preview" | "install"] ??
    vi.fn().mockResolvedValue({ _tag: "Success", value: [] }),
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { _tag: "skills", skills: state.skills },
    isPending: false,
    refresh: () => {},
  }),
}));
vi.mock("./workflowState", () => ({
  useWorkflowEdit: () => ({ canEdit: true, busy: false, run: state.edit }),
  workflowRead: ({ input }: { input: unknown }) => input,
  workflowRunsLive: () => ({}),
}));
import { MissingSkillActions } from "./MissingSkillActions";
import { WorkflowSkillPickerContents } from "./WorkflowSkillPicker";
const environmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
function setup() {
  state.skills = [];
  state.search.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      skills: [
        {
          name: "copy-writing",
          id: "owner/repo/copy-writing",
          source: "owner/repo",
          installs: 42,
        },
      ],
    },
  });
  state.preview.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      id: "owner/repo/copy-writing",
      name: "copy-writing",
      sha: "abc",
      audit: null,
      files: [],
      markdown: "Skill",
      sourceUrl: "https://example.com",
    },
  });
  state.install.mockReset().mockResolvedValue({ _tag: "Success", value: { name: "copy-writing" } });
  state.edit.mockReset().mockResolvedValue({});
}
const listing: WorkflowListing = {
  projectId,
  workflow: "video",
  missingSkills: ["copywriting"],
  skills: [],
  blockers: [],
  scratch: false,
  problem: null,
  updatedAt: "2026-10-29T00:00:00Z",
  editedByThreadId: null,
  definition: { version: 3, name: "Video", steps: [{ id: "script", skill: "copywriting" }] },
};
it("proposes a catalogue match and installs and relinks only after confirmation", async () => {
  setup();
  await using screen = await render(
    <MissingSkillActions environmentId={environmentId} listing={listing} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Find skills", exact: true }));
  const apply = screen.getByRole("button", { name: "Install & link 1" });
  await expect.element(apply).toBeEnabled();
  expect(state.install).not.toHaveBeenCalled();
  await userEvent.click(apply);
  await expect.element(screen.getByText("Installed & linked", { exact: true })).toBeVisible();
  expect(state.install).toHaveBeenCalledWith({
    environmentId,
    input: { scope: "global", id: "owner/repo/copy-writing", sha: "abc", name: "copy-writing" },
  });
  expect(state.edit).toHaveBeenCalledWith(
    expect.objectContaining({ _tag: "stepPut", step: { id: "script", skill: "copy-writing" } }),
  );
});
it("shows skills.sh below local skills and links the installed skill", async () => {
  setup();
  const onPick = vi.fn();
  await using screen = await render(
    <WorkflowSkillPickerContents
      environmentId={environmentId}
      projectId={projectId}
      missingSkill="copywriting"
      onPick={onPick}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Install & link", exact: true }));
  await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("copy-writing"));
});
it("links a normalized local match without installing third-party code", async () => {
  setup();
  state.skills = [
    {
      name: "copy-writing",
      path: "/home/me/.claude/skills/copy-writing/SKILL.md",
      scope: "global",
      description: "Copywriting",
      requires: [],
    },
  ];
  await using screen = await render(
    <MissingSkillActions environmentId={environmentId} listing={listing} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Find skills", exact: true }));
  await expect
    .element(
      screen.getByText("Found copy-writing in /home/me/.claude/skills/copy-writing", {
        exact: true,
      }),
    )
    .toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Install & link 1" }));
  await expect.element(screen.getByText("Linked", { exact: true })).toBeVisible();
  expect(state.search).not.toHaveBeenCalled();
  expect(state.install).not.toHaveBeenCalled();
  expect(state.edit).toHaveBeenCalledWith(
    expect.objectContaining({ _tag: "stepPut", step: { id: "script", skill: "copy-writing" } }),
  );
});
