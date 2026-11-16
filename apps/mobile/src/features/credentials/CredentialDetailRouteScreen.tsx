import {
  AuthCredentialsManageScope,
  type Credential,
  type CredentialField,
  type CredentialId,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import type { StaticScreenProps } from "@react-navigation/native";
import {
  credentialStatusPresentation,
  historyEventLabel,
  credentialActorLabel,
  credentialDecisionLabel,
  credentialApproverLabel,
  type CredentialStatusVariant,
} from "@t3tools/shared/credentialPresentation";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { CredentialBrandMark } from "./CredentialBrandMark";
import { credentialTypeName } from "./credentialGrouping";
import { credentialListQuery, credentialHistoryQuery } from "./credentialState";
import { credentialFileSize, credentialProjectScopeLabel } from "./credentialSummary";

/** One page of history is enough to answer "what changed recently" on a phone. */
const HISTORY_LIMIT = 20;

const STATUS_CLASS: Readonly<Record<CredentialStatusVariant, string>> = {
  success: "text-foreground-muted",
  warning: "text-warning-foreground",
  error: "text-danger-foreground",
};

export function CredentialDetailRouteScreen({
  route,
}: StaticScreenProps<{
  readonly environmentId: EnvironmentId;
  readonly credentialId: CredentialId;
}>) {
  return (
    <CredentialDetail
      key={`${route.params.environmentId}:${route.params.credentialId}`}
      environmentId={route.params.environmentId}
      credentialId={route.params.credentialId}
    />
  );
}

function CredentialDetail({
  environmentId,
  credentialId,
}: {
  readonly environmentId: EnvironmentId;
  readonly credentialId: CredentialId;
}) {
  const insets = useSafeAreaInsets();
  const canRead = useEnvironmentScope(environmentId, AuthCredentialsManageScope);
  const list = useEnvironmentQuery(
    canRead ? credentialListQuery({ environmentId, input: {} }) : null,
  );

  return (
    <SettingsScreen title="Credential">
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {!canRead ? (
          <Text className="px-2 text-sm text-foreground-muted">
            This connection cannot read credentials. Use the desktop app or web.
          </Text>
        ) : list.error !== null ? (
          <ErrorBanner message={list.error} />
        ) : list.data === null ? (
          <View className="flex-row items-center gap-3 px-2">
            <AppActivityIndicator />
            <Text className="text-sm text-foreground-muted">Loading credential…</Text>
          </View>
        ) : (
          <CredentialBody
            environmentId={environmentId}
            credential={list.data.credentials.find((entry) => entry.id === credentialId) ?? null}
          />
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function CredentialBody({
  environmentId,
  credential,
}: {
  readonly environmentId: EnvironmentId;
  readonly credential: Credential | null;
}) {
  if (credential === null) {
    return (
      <View className="gap-1 px-2">
        <Text className="text-base text-foreground">This credential no longer exists.</Text>
        <Text className="text-sm text-foreground-muted">It was deleted from another client.</Text>
      </View>
    );
  }
  return (
    <>
      <CredentialHeader credential={credential} />
      <FieldsSection credential={credential} />
      <DetailsSection credential={credential} />
      <PolicySection environmentId={environmentId} credential={credential} />
      <HistorySection environmentId={environmentId} credential={credential} />
      <Text className="px-2 text-sm text-foreground-muted">
        Credentials are added and changed from the desktop app or web.
      </Text>
    </>
  );
}

function CredentialHeader({ credential }: { readonly credential: Credential }) {
  const template = credentialTemplate(credential.templateId);
  const status = credentialStatusPresentation(credential.status);
  return (
    <View className="flex-row items-start gap-3 px-2">
      <CredentialBrandMark
        name={credential.name}
        templateIcon={template?.icon ?? null}
        iconOverride={credential.icon ?? null}
        envVars={credential.fields.map((field) => field.envVar)}
        size="lg"
      />
      <View className="min-w-0 flex-1 gap-1">
        <Text textRole="headline" className="font-t3-bold text-foreground">
          {credential.name}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {`${credentialTypeName(credential)} · added ${relativeTime(credential.createdAt)}`}
        </Text>
        <Text textRole="footnote" className={STATUS_CLASS[status.variant]}>
          {status.label}
        </Text>
      </View>
    </View>
  );
}

function DetailRow(props: {
  readonly label: string;
  readonly value: ReactNode;
  readonly mono?: boolean;
  readonly tone?: "default" | "warning";
}) {
  return (
    <View className="flex-row items-start justify-between gap-3 px-4 py-2.5">
      <Text textRole="footnote" className="shrink text-foreground">
        {props.label}
      </Text>
      <Text
        textRole="footnote"
        selectable
        className={cn(
          "min-w-0 flex-1 text-right",
          props.mono && "font-mono",
          props.tone === "warning" ? "text-warning-foreground" : "text-foreground-muted",
        )}
      >
        {props.value}
      </Text>
    </View>
  );
}

function secretLabel(field: CredentialField): string {
  if (field.secret?.set !== true) return "Not set";
  return field.secret.updatedAt === undefined
    ? "Set"
    : `Set · updated ${relativeTime(field.secret.updatedAt)}`;
}

function FieldsSection({ credential }: { readonly credential: Credential }) {
  return (
    <SettingsSection title="Fields">
      {credential.fields.map((field) => (
        <View key={field.id} className="gap-0.5 py-2.5">
          <DetailRow
            label={field.label}
            value={
              field.kind === "text"
                ? field.value === undefined || field.value === ""
                  ? "—"
                  : field.value
                : secretLabel(field)
            }
            mono={field.kind === "text"}
            tone={
              field.kind !== "text" && field.secret?.set !== true && field.required
                ? "warning"
                : "default"
            }
          />
          <Text textRole="caption" className="px-4 text-foreground-muted">
            {field.envVar}
            {field.required ? " · required" : ""}
            {field.highRisk ? " · high risk" : ""}
            {field.kind === "secretFile" && field.secret?.fileName !== undefined
              ? ` · ${field.secret.fileName}${
                  field.secret.size === undefined
                    ? ""
                    : ` (${credentialFileSize(field.secret.size)})`
                }`
              : ""}
          </Text>
        </View>
      ))}
    </SettingsSection>
  );
}

function DetailsSection({ credential }: { readonly credential: Credential }) {
  const notes = credential.notes?.trim();
  return (
    <SettingsSection title="Details">
      <DetailRow label="Notes" value={notes === undefined || notes === "" ? "No notes" : notes} />
      <DetailRow
        label="Expires"
        value={
          credential.expiresAt === undefined ? "No expiry date" : credential.expiresAt.slice(0, 10)
        }
      />
      {credential.tags === undefined || credential.tags.length === 0 ? null : (
        <DetailRow label="Tags" value={credential.tags.join(", ")} />
      )}
      <DetailRow label="Updated" value={relativeTime(credential.updatedAt)} />
      <DetailRow
        label="Last used"
        value={credential.lastUsedAt === undefined ? "Never" : relativeTime(credential.lastUsedAt)}
      />
      <DetailRow
        label="Uses"
        value={credential.useCount === 0 ? "None" : `${credential.useCount}`}
      />
    </SettingsSection>
  );
}

function PolicySection({
  environmentId,
  credential,
}: {
  readonly environmentId: EnvironmentId;
  readonly credential: Credential;
}) {
  const projects = useProjects();
  const titles = new Map<ProjectId, string>(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id, project.title]),
  );
  return (
    <SettingsSection title="Policy">
      <DetailRow
        label="Always ask before agents use this"
        value={credential.policy.alwaysAsk ? "Yes" : "No"}
      />
      <DetailRow
        label="Allow the provider to see this value"
        value={credential.policy.revealAllowed ? "Yes" : "No"}
        tone={credential.policy.revealAllowed ? "warning" : "default"}
      />
      <DetailRow label="Projects" value={credentialProjectScopeLabel(credential.policy, titles)} />
    </SettingsSection>
  );
}

function HistorySection({
  environmentId,
  credential,
}: {
  readonly environmentId: EnvironmentId;
  readonly credential: Credential;
}) {
  const history = useEnvironmentQuery(
    credentialHistoryQuery({
      environmentId,
      input: { credentialId: credential.id, limit: HISTORY_LIMIT },
    }),
  );
  if (history.error !== null) return <ErrorBanner message={history.error} />;
  const events = history.data?.events ?? null;
  return (
    <SettingsSection title="Recent history">
      {events === null ? (
        <View className="flex-row items-center gap-3 p-4">
          <AppActivityIndicator />
          <Text className="text-sm text-foreground-muted">Loading history…</Text>
        </View>
      ) : events.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">No history yet.</Text>
      ) : (
        events.map((event) => {
          const changed = (event.fieldIds ?? []).flatMap((fieldId) => {
            const field = credential.fields.find((candidate) => candidate.id === fieldId);
            return field === undefined ? [] : [field.label];
          });
          return (
            <View key={event.id} className="flex-row items-start justify-between gap-3 px-4 py-2.5">
              <View className="min-w-0 flex-1 gap-0.5">
                <Text textRole="footnote" className="text-foreground">
                  {event.type === "used" && event.use
                    ? `${event.use.result === "denied" ? "Requested" : "Used"} by ${credentialActorLabel(event.use)}`
                    : event.use && (event.type === "approved" || event.type === "denied")
                      ? credentialDecisionLabel(event.use)
                      : historyEventLabel(event.type)}
                </Text>
                {event.use ? (
                  <>
                    {event.type !== "used" ? (
                      <Text textRole="caption">{credentialActorLabel(event.use)}</Text>
                    ) : null}
                    <Text textRole="caption" className="text-foreground-muted">
                      {[event.use.workflow, event.use.stepTitle ?? event.use.stepId]
                        .filter(Boolean)
                        .join(" › ")}
                      {event.use.workflow ? " · " : ""}
                      {event.use.threadTitle}
                    </Text>
                    {event.use.commandPreview ? (
                      <Text selectable textRole="caption" className="font-mono">
                        {event.use.commandPreview}
                      </Text>
                    ) : null}
                    <Text textRole="caption" className="text-foreground-muted">
                      {credentialDecisionLabel(event.use)} · {credentialApproverLabel(event.use)}
                      {event.type === "used"
                        ? ` · ${event.use.exitCode != null ? `exit ${event.use.exitCode}` : event.use.result}`
                        : ""}
                    </Text>
                  </>
                ) : null}
                {changed.length === 0 ? null : (
                  <Text textRole="caption" className="text-foreground-muted">
                    {changed.join(", ")}
                  </Text>
                )}
              </View>
              <Text textRole="caption" className="shrink text-foreground-muted">
                {relativeTime(event.at)}
              </Text>
            </View>
          );
        })
      )}
    </SettingsSection>
  );
}
