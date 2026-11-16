import type {
  Credential,
  CredentialId,
  CredentialHistoryPage,
  CredentialListResult,
  EnvironmentId,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { Children, mocks } = vi.hoisted(() => ({
  Children: ({ children }: { children?: ReactNode }) => children,
  mocks: {
    canRead: true,
    list: { data: null as CredentialListResult | null, error: null as string | null },
    history: {
      data: null as CredentialHistoryPage | null,
      error: null as string | null,
    },
  },
}));

vi.mock("react-native", () => ({ View: Children }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../../components/ui/AppText", () => ({ AppText: Children }));
vi.mock("../../components/ui/AppActivityIndicator", () => ({
  AppActivityIndicator: () => <span>loading</span>,
}));
vi.mock("../../components/ui/ErrorBanner", () => ({
  ErrorBanner: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: Children }));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => mocks.canRead }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => {
    const target = atom === "history" ? mocks.history : mocks.list;
    return {
      data: target.data,
      error: target.error,
      isPending: false,
      isSuccess: target.data !== null,
      refresh: () => {},
    };
  },
}));
vi.mock("../settings/components/SettingsScreen", () => ({ SettingsScreen: Children }));
vi.mock("../settings/components/SettingsSection", () => ({
  SettingsSection: ({ title, children }: { title?: string; children?: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));
vi.mock("./credentialState", () => ({
  credentialListQuery: () => "list",
  credentialHistoryQuery: () => "history",
}));

import { CredentialDetailRouteScreen } from "./CredentialDetailRouteScreen";

const environmentId = "env-1" as EnvironmentId;
const credentialId = "cred-1" as CredentialId;

const credential: Credential = {
  id: credentialId,
  name: "GitHub deploy",
  templateId: "github",
  fields: [
    {
      id: "owner",
      label: "Owner",
      kind: "text",
      envVar: "GH_OWNER",
      required: true,
      highRisk: false,
      value: "acme",
    },
    {
      id: "token",
      label: "Token",
      kind: "secret",
      envVar: "GH_TOKEN",
      required: true,
      highRisk: true,
      secret: { set: true },
    },
  ],
  policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  useCount: 0,
  status: "ready",
};

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() =>
    root.render(
      <CredentialDetailRouteScreen route={{ params: { environmentId, credentialId } }} />,
    ),
  );
}

function text(): string {
  return container.textContent ?? "";
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.canRead = true;
  mocks.list = { data: { credentials: [credential] }, error: null };
  mocks.history = {
    data: {
      events: [
        { id: "e1", at: "2026-10-03T00:00:00.000Z", type: "secret-replaced", fieldIds: ["token"] },
      ],
    },
    error: null,
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CredentialDetailRouteScreen", () => {
  it("refuses to read without the credentials grant", () => {
    mocks.canRead = false;
    render();

    expect(text()).toContain("This connection cannot read credentials.");
    expect(text()).not.toContain("GitHub deploy");
  });

  it("shows plain fields, whether a secret is set, and the policy", () => {
    render();

    expect(text()).toContain("GitHub deploy");
    expect(text()).toContain("GitHub token");
    expect(text()).toContain("Ready");
    expect(text()).toContain("GH_OWNER");
    expect(text()).toContain("acme");
    // Both names are overrides of the GitHub template's defaults, so the detail reads the stored
    // metadata rather than the template.
    expect(text()).toContain("GH_TOKEN");
    expect(text()).not.toContain("GITHUB_TOKEN");
    expect(text()).toContain("Set");
    expect(text()).toContain("required · high risk");
    expect(text()).toContain("All projects");
    expect(text()).toContain("Always ask before agents use this");
  });

  it("shows history entries by name and the field that changed", () => {
    render();

    expect(text()).toContain("Recent history");
    expect(text()).toContain("Secret replaced");
    expect(text()).toContain("Token");
  });

  it("says so when the credential was deleted elsewhere", () => {
    mocks.list = { data: { credentials: [] }, error: null };
    render();

    expect(text()).toContain("This credential no longer exists.");
  });
});

it("shows use and approval history with actor, scope, unlock and command metadata", () => {
  mocks.history = {
    error: null,
    data: {
      events: [
        {
          id: "use",
          at: "2026-10-03T00:00:00Z",
          type: "used",
          use: {
            provider: "codex",
            model: "gpt-6.1-sol",
            agentRole: "subagent",
            mode: "exec",
            commandPreview: "gh release list",
            decision: "allowed",
            approvalScope: "run",
            result: "ok",
            exitCode: 0,
          },
        },
        {
          id: "approval",
          at: "2026-10-03T00:00:00Z",
          type: "approved",
          use: {
            provider: "Claude",
            agentRole: "main",
            mode: "exec",
            decision: "allowed",
            approvalScope: "run",
            approvalMethod: "unlock",
            approverSessionId: "session" as import("@t3tools/contracts").AuthSessionId,
            result: "ok",
          },
        },
      ],
    },
  };
  render();
  expect(text()).toContain("Used by Codex · gpt-6.1-sol · subagent");
  expect(text()).toContain("gh release list");
  expect(text()).toContain("exit 0");
  expect(text()).toContain("Allowed for this run");
  expect(text()).toContain("Claude · main agent");
  expect(text()).toContain("by you (unlocked session)");
});
