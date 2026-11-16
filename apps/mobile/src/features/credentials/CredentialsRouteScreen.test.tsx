import type {
  Credential,
  CredentialId,
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
    permitted: new Set<string>(),
    targets: [] as Array<{ environmentId: string; label: string }>,
    list: { data: null as CredentialListResult | null, error: null as string | null },
  },
}));

vi.mock("react-native", () => ({ View: Children }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock("../../components/ui/AppText", () => ({ AppText: Children }));
vi.mock("../../components/ui/AppActivityIndicator", () => ({
  AppActivityIndicator: () => <span>loading</span>,
}));
vi.mock("../../components/ui/ErrorBanner", () => ({
  ErrorBanner: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
vi.mock("../../components/ui/RowPressable", () => ({
  RowPressable: ({ children, onPress }: { children?: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: Children,
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: mocks.list.data,
    error: mocks.list.error,
    isPending: false,
    isSuccess: mocks.list.data !== null,
    refresh: () => {},
  }),
}));
vi.mock("../../state/session", () => ({
  useEnvironmentsWithScope: () => mocks.permitted,
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
vi.mock("../settings/components/SettingsEnvironmentFilterHeader", () => ({
  SettingsEnvironmentFilterHeader: () => null,
  useSettingsEnvironmentMenu: () => ({ title: "", icon: "", items: [] }),
}));
vi.mock("../settings/settings-environment-filter", () => ({
  useSettingsEnvironmentFilter: () => ({ selectedTargets: mocks.targets }),
}));
vi.mock("./credentialState", () => ({
  credentialListQuery: () => "list",
  credentialHistoryQuery: () => "history",
}));

import { CredentialsRouteScreen } from "./CredentialsRouteScreen";

const environmentId = "env-1" as EnvironmentId;

const credential = (
  id: string,
  name: string,
  templateId: string,
  status: Credential["status"] = "ready",
): Credential => ({
  id: id as CredentialId,
  name,
  templateId,
  fields: [
    {
      id: "token",
      label: "Token",
      kind: "secret",
      envVar: "TOKEN",
      required: true,
      highRisk: false,
    },
  ],
  policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  useCount: 0,
  status,
});

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => root.render(<CredentialsRouteScreen />));
}

function text(): string {
  return container.textContent ?? "";
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.permitted = new Set<string>([environmentId]);
  mocks.targets = [{ environmentId, label: "MacBook" }];
  mocks.list = { data: null, error: null };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CredentialsRouteScreen", () => {
  it("asks for an environment when the filter selects none", () => {
    mocks.targets = [];
    render();

    expect(text()).toContain("Select a connected environment.");
  });

  it("refuses to show a connection without the credentials grant", () => {
    mocks.permitted = new Set<string>();
    mocks.list = {
      data: { credentials: [credential("gh", "GitHub actions", "github")] },
      error: null,
    };
    render();

    expect(text()).toContain("No access");
    expect(text()).not.toContain("GitHub actions");
  });

  it("points at web and desktop when an environment has no credentials", () => {
    mocks.list = { data: { credentials: [] }, error: null };
    render();

    expect(text()).toContain("No credentials yet");
    expect(text()).toContain("Credentials are added from the desktop app or web.");
  });

  it("groups credentials by type and shows each status", () => {
    mocks.list = {
      data: {
        credentials: [
          credential("gh", "GitHub actions", "github", "missing-field"),
          credential("vercel", "Vercel prod", "vercel"),
          credential("gh2", "GitHub release", "github", "expiring"),
        ],
      },
      error: null,
    };
    render();

    expect(text()).toContain("MacBook");
    expect(text()).toContain("GitHub token");
    expect(text()).toContain("Vercel");
    expect(text()).toContain("GitHub actions");
    expect(text()).toContain("Missing field");
    expect(text()).toContain("Expires soon");
    expect(text()).toContain("Ready");
  });

  it("shows the read error instead of an empty list", () => {
    mocks.list = { data: null, error: "This connection requires credentials:manage." };
    render();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This connection requires credentials:manage.",
    );
    expect(text()).not.toContain("No credentials yet");
  });
});
