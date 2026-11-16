import { EnvironmentId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";

import { render } from "../../test/render";

const state = vi.hoisted(() => ({
  edit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: { _tag?: string }) =>
    query?._tag === "live"
      ? { data: null, dataUpdatedAt: 0, error: null, isPending: false, refresh: state.refresh }
      : {
          data: { _tag: "preferences", preferences: { pinnedSkills: [], maxSubagentModels: 4 } },
          dataUpdatedAt: 1,
          error: null,
          isPending: false,
          refresh: state.refresh,
        },
}));
vi.mock("../components/settings/settingsLayout", () => ({
  SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SettingsRow: ({ title, control }: { title: string; control: ReactNode }) => (
    <div>
      <h3>{title}</h3>
      {control}
    </div>
  ),
}));
vi.mock("./workflowState", () => ({
  useWorkflowEdit: () => ({ canEdit: true, busy: false, error: null, run: state.edit }),
  workflowRead: ({ input }: { input: { _tag: string } }) => input,
  workflowRunsLive: () => ({ _tag: "live" }),
}));

import { WorkflowGeneralSettings } from "./WorkflowGeneralSettings";

it("saves the selected model cap through preferencesSet", async () => {
  state.edit.mockReset().mockResolvedValue({});
  await using screen = await render(
    <WorkflowGeneralSettings environmentId={EnvironmentId.make("local")} />,
  );
  const input = screen.getByRole("spinbutton", { name: "Max subagent models per workflow" });
  await userEvent.fill(input, "8");
  await userEvent.tab();

  await vi.waitFor(() =>
    expect(state.edit).toHaveBeenCalledWith({ _tag: "preferencesSet", maxSubagentModels: 8 }),
  );
  await userEvent.click(screen.getByRole("switch", { name: "Show built-in workflows" }));
  await vi.waitFor(() =>
    expect(state.edit).toHaveBeenCalledWith({
      _tag: "preferencesSet",
      showBuiltinWorkflows: false,
    }),
  );
});
