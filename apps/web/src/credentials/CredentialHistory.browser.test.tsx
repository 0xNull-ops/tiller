import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { CredentialHistory } from "./CredentialHistory";
import { credentialHistoryFixture } from "./credentialActivityFixture";
import "~/index.css";

it("filters uses, approvals, and changes without losing actor or exit information", async () => {
  const denied = {
    ...credentialHistoryFixture,
    id: "denied",
    type: "denied" as const,
    use: {
      ...credentialHistoryFixture.use!,
      decision: "denied" as const,
      result: "denied" as const,
      exitCode: null,
    },
  };
  const changed = { id: "changed", type: "secret-replaced" as const, at: "2026-10-22T13:00:00Z" };
  await using screen = await render(
    <CredentialHistory
      events={[
        credentialHistoryFixture,
        denied,
        { ...credentialHistoryFixture, id: "approved", type: "approved" },
        changed,
      ]}
    />,
  );
  await expect.element(screen.getByText("Codex · gpt-6.1-sol · subagent").first()).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Uses", exact: true }));
  await expect.element(screen.getByText(/^Requested by/)).not.toBeInTheDocument();
  await expect.element(screen.getByText(/exit 0/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Approvals", exact: true }));
  await expect.element(screen.getByText("Denied", { exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Changes", exact: true }));
  await expect.element(screen.getByText(/^Used by/)).not.toBeInTheDocument();
  await expect.element(screen.getByText("Secret replaced")).toBeVisible();
});
