import { KeyRoundIcon, WorkflowIcon } from "lucide-react";

export type ForkSettingsPath = "/settings/skills" | "/settings/workflows" | "/settings/credentials";

const FORK_SETTINGS_PATHS = [
  "/settings/skills",
  "/settings/workflows",
  "/settings/credentials",
] as const satisfies readonly ForkSettingsPath[];

export const FORK_SETTINGS_LABELS: Readonly<Record<ForkSettingsPath, string>> = {
  "/settings/skills": "Skills",
  "/settings/workflows": "Workflows",
  "/settings/credentials": "Credentials",
};

export const FORK_SETTINGS_ICONS = {
  "/settings/skills": WorkflowIcon,
  "/settings/workflows": WorkflowIcon,
  "/settings/credentials": KeyRoundIcon,
} as const;

export const FORK_SETTINGS_NAV_GROUPS = [
  { heading: "Tiller", paths: FORK_SETTINGS_PATHS },
] as const;

export const FORK_SETTINGS_SEARCH_ITEMS = [
  {
    id: "skills-sh",
    title: "Find a skill…",
    to: "/settings/skills",
    searchTerms: ["skills.sh browse install skills"],
  },
  {
    id: "workflow-settings",
    title: "Workflows",
    to: "/settings/workflows",
    searchTerms: ["workflow canvas defaults skill steps"],
  },
  {
    id: "workflow-first-default",
    title: "Workflow-first for new threads",
    to: "/settings/workflows",
    searchTerms: ["workflow saved plan workflow-first new thread default"],
  },
  {
    id: "workflow-canvas-colors",
    title: "Workflow canvas colours",
    to: "/settings/workflows",
    searchTerms: ["credential mcp check login attachment satellite card colour color accent"],
    targetId: "workflow-canvas-colors",
  },
  {
    id: "replay-tour",
    title: "Replay tour",
    to: "/settings/workflows",
    searchTerms: ["tiller tour intro onboarding sample workflow show on new devices"],
    targetId: "tour",
  },
  {
    id: "credentials",
    title: "Credentials",
    to: "/settings/credentials",
    searchTerms: ["credential vault secrets tokens api keys pin unlock env bundle rotation"],
  },
  {
    id: "send-feedback",
    title: "Send feedback",
    to: "/settings/about",
    searchTerms: ["feedback bug report feature request idea github issue support contact"],
  },
] as const;

export const FORK_SETTINGS_CATEGORY_SCOPES: Readonly<Record<ForkSettingsPath, null>> = {
  "/settings/skills": null,
  "/settings/workflows": null,
  "/settings/credentials": null,
};

export function shouldShowTillerEnvironmentIdentification() {
  return true;
}
