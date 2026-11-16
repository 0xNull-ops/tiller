import { CredentialId, EnvironmentId, type Credential } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import { WorkflowCredentialsSheet } from "./WorkflowCredentialsSheet";

const saved: Credential = {
  id: CredentialId.make("cred-vercel"),
  name: "Vercel — site",
  templateId: "vercel",
  fields: [
    {
      id: "token",
      label: "Token",
      kind: "secret",
      envVar: "VERCEL_TOKEN",
      required: true,
      highRisk: false,
      secret: { set: true },
    },
  ],
  policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  useCount: 0,
  status: "ready",
};

vi.mock("../credentials/CredentialsEnvironmentPanel", () => ({
  CredentialsEnvironmentPanel: (props: {
    presetTemplateId?: string | null;
    focusCredentialId?: string | null;
    onCredentialCreated?: (credential: Credential) => void;
  }) => (
    <div>
      <p>preset: {props.presetTemplateId ?? "none"}</p>
      <p>focus: {props.focusCredentialId ?? "none"}</p>
      <button type="button" onClick={() => props.onCredentialCreated?.(saved)}>
        Save credential
      </button>
    </div>
  ),
}));

it("opens the add form on the requested template and hands the saved credential back", async () => {
  const onCredentialCreated = vi.fn();
  await using screen = await render(
    <WorkflowCredentialsSheet
      environmentId={EnvironmentId.make("remote")}
      open
      onOpenChange={() => {}}
      presetTemplateId="vercel"
      focusCredentialId={null}
      onCredentialCreated={onCredentialCreated}
    />,
  );
  await expect.element(screen.getByText("preset: vercel")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Save credential" }));
  expect(onCredentialCreated).toHaveBeenCalledExactlyOnceWith(saved);
});

it("opens an existing credential for its Fix action", async () => {
  await using screen = await render(
    <WorkflowCredentialsSheet
      environmentId={EnvironmentId.make("remote")}
      open
      onOpenChange={() => {}}
      focusCredentialId={CredentialId.make("cred-broken")}
    />,
  );
  await expect.element(screen.getByText("focus: cred-broken")).toBeVisible();
});
