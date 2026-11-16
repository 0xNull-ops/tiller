import {
  AuthCredentialsManageScope,
  type Credential,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import {
  credentialStatusPresentation,
  type CredentialStatusVariant,
} from "@t3tools/shared/credentialPresentation";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { relativeTime } from "../../lib/time";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentsWithScope } from "../../state/session";
import { useSettingsEnvironmentMenu } from "../settings/components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useSettingsEnvironmentFilter } from "../settings/settings-environment-filter";
import { CredentialBrandMark } from "./CredentialBrandMark";
import { groupCredentialsByType } from "./credentialGrouping";
import { credentialListQuery } from "./credentialState";

const STATUS_CLASS: Readonly<Record<CredentialStatusVariant, string>> = {
  success: "text-foreground-muted",
  warning: "text-warning-foreground",
  error: "text-danger-foreground",
};

/** 6A is read-only: mobile lists and inspects, and every change happens on web or desktop. */
export function CredentialsRouteScreen() {
  const insets = useSafeAreaInsets();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const permittedEnvironments = useEnvironmentsWithScope(
    selectedTargets,
    AuthCredentialsManageScope,
  );

  return (
    <SettingsScreen title="Credentials" menus={[environmentMenu]}>
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {selectedTargets.length === 0 ? (
          <Text className="px-2 text-sm text-foreground-muted">
            Select a connected environment.
          </Text>
        ) : (
          selectedTargets.map((environment) => (
            <SettingsSection key={environment.environmentId} title={environment.label}>
              {permittedEnvironments.has(environment.environmentId) ? (
                <EnvironmentCredentials environmentId={environment.environmentId} />
              ) : (
                <View className="gap-1 p-4">
                  <Text className="text-base text-foreground">No access</Text>
                  <Text className="text-sm text-foreground-muted">
                    This connection wasn't granted credential access. Manage access in Settings →
                    Connections → Authorized clients on web or desktop.
                  </Text>
                </View>
              )}
            </SettingsSection>
          ))
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function EnvironmentCredentials({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigation = useNavigation();
  const list = useEnvironmentQuery(credentialListQuery({ environmentId, input: {} }));

  if (list.error !== null) return <ErrorBanner message={list.error} />;

  const credentials = list.data?.credentials ?? null;
  if (credentials === null) {
    return (
      <View className="flex-row items-center gap-3 p-4">
        <AppActivityIndicator />
        <Text className="text-sm text-foreground-muted">Loading credentials…</Text>
      </View>
    );
  }
  if (credentials.length === 0) {
    return (
      <View className="gap-1 p-4">
        <Text className="text-base text-foreground">No credentials yet</Text>
        <Text className="text-sm text-foreground-muted">
          Credentials are added from the desktop app or web.
        </Text>
      </View>
    );
  }

  return (
    <>
      {groupCredentialsByType(credentials).map((group) => (
        <View key={group.typeName}>
          <View className="bg-grouped-card px-4 pb-1 pt-3">
            <Text textRole="caption" className="font-t3-medium text-foreground-muted">
              {group.typeName}
            </Text>
          </View>
          {group.credentials.map((credential) => (
            <CredentialRow
              key={credential.id}
              credential={credential}
              onPress={() =>
                navigation.navigate("SettingsCredentialDetail", {
                  environmentId,
                  credentialId: credential.id,
                })
              }
            />
          ))}
        </View>
      ))}
    </>
  );
}

function usageLine(credential: Credential): string {
  const updated = `Updated ${relativeTime(credential.updatedAt)}`;
  if (credential.lastUsedAt === undefined) return `${updated} · Never used`;
  return `${updated} · Last used ${relativeTime(credential.lastUsedAt)}`;
}

function CredentialRow({
  credential,
  onPress,
}: {
  readonly credential: Credential;
  readonly onPress: () => void;
}) {
  const template = credentialTemplate(credential.templateId);
  const status = credentialStatusPresentation(credential.status);
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={`${credential.name}, ${status.label}`}
      onPress={onPress}
      className="bg-grouped-card"
    >
      <View className="min-h-14 flex-row items-center gap-3 px-4 py-2.5">
        <CredentialBrandMark
          name={credential.name}
          templateIcon={template?.icon ?? null}
          iconOverride={credential.icon ?? null}
          envVars={credential.fields.map((field) => field.envVar)}
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text textRole="body" numberOfLines={1} className="text-foreground">
            {credential.name}
          </Text>
          <Text textRole="caption" numberOfLines={1} className="text-foreground-muted">
            {usageLine(credential)}
          </Text>
        </View>
        <Text textRole="footnote" className={STATUS_CLASS[status.variant]}>
          {status.label}
        </Text>
      </View>
    </RowPressable>
  );
}
