/**
 * Credential copy shared by web and mobile so the two clients cannot drift on
 * what a status or a history line says. Each client maps `variant` to its own
 * badge or colour; nothing here touches a renderer.
 */
import {
  PROVIDER_DISPLAY_NAMES,
  type CredentialHistoryEventType,
  type CredentialStatus,
  type ProviderDriverKind,
} from "@t3tools/contracts";

export type CredentialStatusVariant = "success" | "warning" | "error";

export interface CredentialStatusPresentation {
  readonly label: string;
  readonly variant: CredentialStatusVariant;
}

export const credentialStatusPresentation = (
  status: CredentialStatus,
): CredentialStatusPresentation => {
  switch (status) {
    case "ready":
      return { label: "Ready", variant: "success" };
    case "missing-field":
      return { label: "Missing field", variant: "error" };
    case "expiring":
      return { label: "Expires soon", variant: "warning" };
    case "expired":
      return { label: "Expired", variant: "error" };
  }
};

export const historyEventLabel = (type: CredentialHistoryEventType): string => {
  switch (type) {
    case "created":
      return "Created";
    case "renamed":
      return "Renamed";
    case "updated":
      return "Details updated";
    case "secret-replaced":
      return "Secret replaced";
    case "secret-removed":
      return "Secret removed";
    case "policy-changed":
      return "Policy changed";
    case "deleted":
      return "Deleted";
    case "pin-set":
      return "PIN set";
    case "pin-changed":
      return "PIN changed";
    case "unlock-failed":
      return "Unlock failed";
    case "approved":
      return "Allowed";
    case "denied":
      return "Denied";
    case "used":
      return "Used";
  }
};

/** "Codex · gpt-6 · subagent". An unknown driver shows its raw id rather than a blank. */
export const credentialActorLabel = (actor: {
  readonly provider?: string;
  readonly model?: string;
  readonly agentRole?: string;
}) =>
  [
    actor.provider === undefined
      ? undefined
      : (PROVIDER_DISPLAY_NAMES[actor.provider as ProviderDriverKind] ?? actor.provider),
    actor.model,
    actor.agentRole === "subagent"
      ? "subagent"
      : actor.agentRole === "main"
        ? "main agent"
        : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

export const credentialDecisionLabel = (use: {
  readonly decision: string;
  readonly approvalScope?: string;
}) =>
  use.decision === "denied"
    ? "Denied"
    : use.decision === "policy"
      ? "Allowed by policy"
      : use.approvalScope === "once"
        ? "Allowed once"
        : `Allowed for this ${use.approvalScope ?? "use"}`;

export const credentialApproverLabel = (use: {
  readonly approverSessionId?: string;
  readonly approvalMethod?: string;
}) => (use.approverSessionId ? "by you (unlocked session)" : "");
