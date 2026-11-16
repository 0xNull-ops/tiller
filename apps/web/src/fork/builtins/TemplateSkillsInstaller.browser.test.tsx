import { EnvironmentId } from "@t3tools/contracts";
import { workflowTemplates } from "@t3tools/shared/workflowTemplates";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { TemplateSkillsInstaller } from "./TemplateSkillsInstaller";
const state = vi.hoisted(() => ({ preview: vi.fn(), install: vi.fn() }));
vi.mock(import("@t3tools/client-runtime/state/skillsSh"), () => ({
  createSkillsShCommands: (() => ({
    search: { kind: "search" },
    preview: { kind: "preview" },
    install: { kind: "install", permissionAtom: () => Atom.make(true) },
  })) as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: ((command: { kind: "preview" | "install" }) => state[command.kind]) as never,
}));
it("reviews missing skills, pins their preview revisions, and installs only to All projects", async () => {
  state.preview.mockReset().mockImplementation(({ input }: { input: { id: string } }) =>
    Promise.resolve({
      _tag: "Success",
      value: { id: input.id, name: input.id.split("/").at(-1), sha: "a".repeat(40), audit: null },
    }),
  );
  state.install.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  const template = workflowTemplates[0]!;
  await using screen = await render(
    <TemplateSkillsInstaller
      environmentId={EnvironmentId.make("remote")}
      template={template}
      installed={new Set(["research", "copywriting"])}
      onInstalled={() => {}}
    />,
  );
  const install = screen.getByRole("button", {
    name: "Install all to All projects (3)",
    exact: true,
  });
  await expect.element(install).toBeEnabled();
  expect(state.install).not.toHaveBeenCalled();
  expect(state.preview.mock.calls.map(([request]) => request.input.id)).not.toContain(
    template.skills.research,
  );
  await userEvent.click(install);
  await expect.element(screen.getByRole("button", { name: "All skills installed" })).toBeDisabled();
  expect(state.install.mock.calls.map(([request]) => request.input)).toEqual(
    ["frontend-design", "impeccable", "deploy-to-vercel"].map((name) => ({
      scope: "global",
      id: template.skills[name],
      sha: "a".repeat(40),
      name,
    })),
  );
});
