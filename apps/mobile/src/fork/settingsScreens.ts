import { WorkflowsSettingsScreen } from "./builtins/WorkflowsSettingsScreen";
import { CommonActions } from "@react-navigation/native";
import { rootNavigationRef } from "../lib/rootNavigation";
import { SkillsScreen } from "./skillsSh/SkillsScreen";
import {
  createNativeStackScreen,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import type { ComponentProps } from "react";

import { CredentialsRouteScreen } from "../features/credentials/CredentialsRouteScreen";
import { CredentialDetailRouteScreen } from "../features/credentials/CredentialDetailRouteScreen";
import { SettingsRow } from "../features/settings/components/SettingsRow";
import { tourIntroStore } from "./tour/tourIntro";
import type { ForkSettingsPageTarget } from "./settings";

type MobileSettingsRow = ComponentProps<typeof SettingsRow> & { readonly id: string };
type MobileSettingsSection = {
  readonly title?: string;
  readonly rows: readonly MobileSettingsRow[];
};

export function forkMobileSettingsSections(serverAvailable: boolean): MobileSettingsSection[] {
  const serverPage = (
    target: ForkSettingsPageTarget,
    icon: ComponentProps<typeof SettingsRow>["icon"],
    label: string,
  ): MobileSettingsRow => ({
    id: target,
    icon,
    label,
    target,
    disabled: !serverAvailable,
  });
  return [
    {
      title: "Tiller",
      rows: [
        {
          id: "SettingsSkills",
          icon: { ios: "book.fill", android: "folder" },
          label: "Skills",
          disabled: !serverAvailable,
          onPress: () => {
            rootNavigationRef.dispatch(CommonActions.navigate({ name: "SettingsSkills" }));
          },
        },
        serverPage(
          "SettingsEnvironmentCredentials",
          { ios: "lock.fill", android: "lock" },
          "Credentials",
        ),
        serverPage(
          "SettingsWorkflows",
          { ios: "arrow.triangle.branch", android: "build" },
          "Workflows",
        ),
        {
          id: "TourIntro",
          icon: { ios: "arrow.counterclockwise", android: "bolt" },
          label: "Replay intro",
          onPress: tourIntroStore.replay,
        },
      ],
    },
  ];
}

export function createForkSettingsScreens(settingsPageOptions: NativeStackNavigationOptions) {
  return {
    SettingsWorkflows: createNativeStackScreen({
      screen: WorkflowsSettingsScreen,
      linking: "settings/workflows",
      options: { ...settingsPageOptions, title: "Workflows" },
    }),
    SettingsSkills: createNativeStackScreen({
      screen: SkillsScreen,
      linking: "settings/skills",
      options: { ...settingsPageOptions, title: "Skills" },
    }),
    SettingsEnvironmentCredentials: createNativeStackScreen({
      screen: CredentialsRouteScreen,
      linking: "settings/credentials",
      options: { ...settingsPageOptions, title: "Credentials" },
    }),
    SettingsCredentialDetail: createNativeStackScreen({
      screen: CredentialDetailRouteScreen,
      linking: "settings/credentials/:environmentId/:credentialId",
      options: { ...settingsPageOptions, title: "Credential" },
    }),
  };
}
