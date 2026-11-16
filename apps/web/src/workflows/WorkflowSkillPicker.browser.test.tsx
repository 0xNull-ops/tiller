import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";

const state = vi.hoisted(() => ({
  skills: [] as Array<Record<string, unknown>>,
  edit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: { _tag?: string }) =>
    query?._tag === "live"
      ? { data: null, dataUpdatedAt: 0, error: null, isPending: false, refresh: state.refresh }
      : {
          data: { _tag: "skills", skills: state.skills },
          dataUpdatedAt: 1,
          error: null,
          isPending: false,
          refresh: state.refresh,
        },
}));
vi.mock("./workflowState", () => ({
  useWorkflowEdit: () => ({ canEdit: true, busy: false, error: null, run: state.edit }),
  workflowRead: ({ input }: { input: { _tag: string } }) => input,
  workflowRunsLive: () => ({ _tag: "live" }),
}));

import { WorkflowSkillPickerContents } from "./WorkflowSkillPicker";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-1");
const onPick = vi.fn();
const skill = (name: string, scope: string, pinned = false) => ({
  name,
  description: `${name} description`,
  path: `/skills/${name}/SKILL.md`,
  scope,
  requires: [],
  ...(pinned ? { pinned: true } : {}),
});

function content() {
  return (
    <WorkflowSkillPickerContents
      environmentId={environmentId}
      projectId={projectId}
      onPick={onPick}
    />
  );
}

it("shows pinned skills first and filters pinned matches only in that group", async () => {
  state.skills = [
    skill("pinned-match", "project", true),
    skill("project-skill", "project"),
    skill("global-skill", "global"),
  ];
  await using screen = await render(content());

  await vi.waitFor(() =>
    expect(
      Array.from(screen.container.querySelectorAll("h3"), (heading) => heading.textContent),
    ).toEqual(["Pinned", "This project", "Global"]),
  );
  await userEvent.type(screen.getByRole("textbox", { name: "Search skills" }), "pinned-match");
  await expect.element(screen.getByRole("heading", { name: "Pinned" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "pinned-match pinned-match description" }))
    .toBeVisible();
  await vi.waitFor(() =>
    expect(
      Array.from(screen.container.querySelectorAll("h3"), (heading) => heading.textContent),
    ).toEqual(["Pinned"]),
  );
});

it("sends a pin edit without selecting the skill", async () => {
  state.skills = [skill("build-tools", "project")];
  state.edit.mockReset().mockResolvedValue({});
  onPick.mockReset();
  await using screen = await render(content());

  await userEvent.click(screen.getByRole("button", { name: "Pin build-tools" }));
  await vi.waitFor(() =>
    expect(state.edit).toHaveBeenCalledWith({
      _tag: "skillPinSet",
      name: "build-tools",
      pinned: true,
    }),
  );
  expect(onPick).not.toHaveBeenCalled();
});
