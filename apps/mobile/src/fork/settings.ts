import type { SettingsPageTarget } from "../features/settings/components/settings-page-targets";

export const FORK_SETTINGS_PAGE_TARGETS = [
  "SettingsEnvironmentCredentials",
  "SettingsWorkflows",
] as const;

export type ForkSettingsPageTarget = (typeof FORK_SETTINGS_PAGE_TARGETS)[number];

export const FORK_SETTINGS_SEARCH_TERMS = {
  SettingsWorkflows: ["built-in templates workflows show hide"],
} as const satisfies Partial<Record<SettingsPageTarget, readonly string[]>>;
