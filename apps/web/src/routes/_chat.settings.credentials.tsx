import { createFileRoute } from "@tanstack/react-router";

import { CredentialsSettings } from "../credentials/CredentialsSettings";

function SettingsCredentialsRoute() {
  return <CredentialsSettings />;
}

export const Route = createFileRoute("/_chat/settings/credentials")({
  component: SettingsCredentialsRoute,
});
