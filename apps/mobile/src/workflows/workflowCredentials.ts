import type {
  WorkflowCredentialAttachment,
  WorkflowCredentialReadiness,
  WorkflowCredentialState,
} from "@t3tools/contracts";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";

/** `neutral` is for an attachment no preflight has checked yet, so it is not a problem. */
export type WorkflowCredentialTone = "ready" | "expiring" | "attention" | "neutral";

export interface WorkflowCredentialRow {
  readonly name: string;
  readonly templateIcon: string | null;
  readonly iconOverride: string | undefined;
  readonly envVars: readonly string[];
  readonly statusLabel: string;
  readonly tone: WorkflowCredentialTone;
}

const TONE_BY_STATE: Readonly<Record<WorkflowCredentialState, WorkflowCredentialTone>> = {
  ready: "ready",
  matched: "ready",
  expiring: "expiring",
  choose: "attention",
  missing: "attention",
  incomplete: "attention",
  expired: "attention",
  "not-allowed": "attention",
  "no-access": "attention",
};

/**
 * One credential attachment as a read-only row. Names and env-var names only: the readiness
 * never carries a value, so nothing here can show one.
 */
export function workflowCredentialRow(
  attachment: WorkflowCredentialAttachment,
  readiness: WorkflowCredentialReadiness | undefined,
): WorkflowCredentialRow {
  const template = credentialTemplate(attachment.templateId);
  return {
    name: readiness?.name ?? template?.name ?? attachment.templateId,
    templateIcon: template?.icon ?? null,
    iconOverride: readiness?.icon,
    envVars: readiness?.envVars.map((envVar) => envVar.name) ?? [],
    statusLabel: readiness?.statusLabel ?? "Not checked",
    tone: readiness === undefined ? "neutral" : TONE_BY_STATE[readiness.state],
  };
}
