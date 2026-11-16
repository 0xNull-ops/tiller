import type {
  Credential,
  CredentialId,
  ProjectId,
  WorkflowCredentialAttachment,
  WorkflowCredentialCandidate,
  WorkflowCredentialReadiness,
  WorkflowCredentialState,
  WorkflowDefinition,
  WorkflowReadinessEntry,
  WorkflowReadinessSnapshot,
  WorkflowReadinessStatus,
  WorkflowStep,
} from "@t3tools/contracts";
import {
  CREDENTIAL_APPROVALS_WARNING,
  CREDENTIAL_REAPPROVAL_WARNING,
  credentialEnvVarProblem,
} from "@t3tools/contracts";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One credential attachment resolved against the vault. `matched` means the id came from the
 * template, not from the file, so the UI can say so and let the user change it.
 */
export type CredentialResolution =
  | {
      readonly state: "ready" | "expiring" | "incomplete" | "expired" | "not-allowed";
      readonly credential: Credential;
    }
  | { readonly state: "matched"; readonly credential: Credential }
  | { readonly state: "choose"; readonly candidates: ReadonlyArray<Credential> }
  | { readonly state: "missing" };

/** The states a scheduled run cannot start with; a manual run is advisory and still starts. */
const BLOCKING_STATES: ReadonlySet<WorkflowCredentialState> = new Set([
  "missing",
  "choose",
  "incomplete",
  "expired",
  "not-allowed",
  "no-access",
]);

/** Portable credentials are global unless the user narrowed them to projects. */
const credentialAllowedInProject = (credential: Credential, projectId: ProjectId) =>
  credential.policy.projects === "all" || credential.policy.projects.includes(projectId);

/** Ready or expiring, and offered to this project. Nothing here inspects a value. */
const credentialUsable = (credential: Credential, projectId: ProjectId) =>
  credentialAllowedInProject(credential, projectId) &&
  (credential.status === "ready" || credential.status === "expiring");

const boundResolution = (credential: Credential, projectId: ProjectId): CredentialResolution => {
  // A bound credential that cannot be used reports its own problem. Never substitute a
  // different credential for one the user chose explicitly.
  if (!credentialAllowedInProject(credential, projectId))
    return { state: "not-allowed", credential };
  if (credential.status === "expired") return { state: "expired", credential };
  if (credential.status === "missing-field") return { state: "incomplete", credential };
  return credential.status === "expiring"
    ? { state: "expiring", credential }
    : { state: "ready", credential };
};

/** Share one binding rule between readiness, prompts, and pre-approved policy. */
export function resolveCredentialAttachment(input: {
  readonly attachment: WorkflowCredentialAttachment;
  readonly projectId: ProjectId;
  readonly credentials: ReadonlyArray<Credential>;
}): CredentialResolution {
  const bound =
    input.attachment.credentialId === undefined
      ? undefined
      : input.credentials.find(
          (credential) =>
            credential.id === input.attachment.credentialId &&
            // The template is the portable requirement; a re-pointed file must not inject
            // another type's fields into this step.
            credential.templateId === input.attachment.templateId,
        );
  if (bound !== undefined) return boundResolution(bound, input.projectId);

  const candidates = input.credentials.filter(
    (credential) =>
      credential.templateId === input.attachment.templateId &&
      credentialAllowedInProject(credential, input.projectId),
  );
  const usable = candidates.filter((credential) => credentialUsable(credential, input.projectId));
  if (usable.length === 1) return { state: "matched", credential: usable[0]! };
  if (usable.length > 1) return { state: "choose", candidates };
  if (candidates.length === 1) return boundResolution(candidates[0]!, input.projectId);
  if (candidates.length > 1) return { state: "choose", candidates };
  return { state: "missing" };
}

export const credentialTemplateName = (templateId: string): string =>
  credentialTemplate(templateId)?.name ?? templateId;

const expiringLabel = (expiresAt: string | undefined, nowMs: number): string | undefined => {
  if (expiresAt === undefined) return undefined;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return undefined;
  const days = Math.ceil((at - nowMs) / DAY_MS);
  if (days <= 0) return "Expires today";
  return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
};

/** Short words for one credential on a card, derived so an old credential reports today's state. */
const credentialStatusLabel = (credential: Credential, nowMs: number): string => {
  switch (credential.status) {
    case "ready":
      return "Ready";
    case "expiring":
      return expiringLabel(credential.expiresAt, nowMs) ?? "Expiring soon";
    case "expired":
      return "Expired";
    case "missing-field":
      return "Missing a required field";
  }
};

const STATE_LABELS: Record<Exclude<WorkflowCredentialState, "expiring">, string> = {
  ready: "Ready",
  matched: "Matched automatically",
  choose: "Choose a credential",
  missing: "Missing",
  incomplete: "Missing a required field",
  expired: "Expired",
  "not-allowed": "Not allowed in this project",
  "no-access": "Credential vault unavailable",
};

/**
 * The names the step prompt and the Needs block promise. A vault saved before the reserved-name
 * check may hold `PATH` or `LD_PRELOAD`; injection skips those names, so readiness must not list
 * them either — the same function decides in both places.
 */
const envVarsOf = (credential: Credential) =>
  credential.fields
    .filter((field) => credentialEnvVarProblem(field.envVar) === null)
    .map((field) => ({ name: field.envVar, file: field.kind === "secretFile" }));

const candidateOf = (credential: Credential, nowMs: number): WorkflowCredentialCandidate => ({
  id: credential.id,
  name: credential.name,
  status: credential.status,
  ...(credential.icon === undefined ? {} : { icon: credential.icon }),
  statusLabel: credentialStatusLabel(credential, nowMs),
});

/**
 * The display half of a resolution. Ready, matched and expiring mean "the step will use this
 * credential"; the rest mean it cannot, and the message says what to do.
 */
export function credentialReadiness(input: {
  readonly attachment: WorkflowCredentialAttachment;
  /** Absent means the vault could not be read. */
  readonly resolution: CredentialResolution | undefined;
  readonly nowMs: number;
}): WorkflowCredentialReadiness {
  const optional = input.attachment.optional === true;
  const resolution = input.resolution;
  if (resolution === undefined)
    return {
      state: "no-access",
      templateId: input.attachment.templateId,
      statusLabel: STATE_LABELS["no-access"],
      envVars: [],
      candidates: [],
      optional,
    };
  if (resolution.state === "choose")
    return {
      state: "choose",
      templateId: input.attachment.templateId,
      statusLabel: STATE_LABELS.choose,
      envVars: [],
      candidates: resolution.candidates.map((credential) => candidateOf(credential, input.nowMs)),
      optional,
    };
  if (resolution.state === "missing")
    return {
      state: "missing",
      templateId: input.attachment.templateId,
      statusLabel: STATE_LABELS.missing,
      envVars: [],
      candidates: [],
      optional,
    };
  const credential = resolution.credential;
  return {
    state: resolution.state,
    templateId: input.attachment.templateId,
    statusLabel:
      resolution.state === "expiring"
        ? (expiringLabel(credential.expiresAt, input.nowMs) ?? "Expiring soon")
        : STATE_LABELS[resolution.state],
    credentialId: credential.id,
    name: credential.name,
    ...(credential.icon === undefined ? {} : { icon: credential.icon }),
    ...(credential.expiresAt === undefined ? {} : { expiresAt: credential.expiresAt }),
    envVars: envVarsOf(credential),
    candidates: [],
    optional,
  };
}

/** The card's status and one sentence, kept in step with `credentialReadiness`. */
export function describeCredentialState(input: {
  readonly attachment: WorkflowCredentialAttachment;
  readonly resolution: CredentialResolution | undefined;
  readonly readiness: WorkflowCredentialReadiness;
  readonly stepLabel: string;
  readonly nowMs: number;
}): { readonly status: Exclude<WorkflowReadinessStatus, "checking">; readonly message: string } {
  const template = credentialTemplateName(input.attachment.templateId);
  const resolution = input.resolution;
  if (resolution === undefined)
    return {
      status: "unknown",
      message: `The credential vault is unavailable, so "${input.stepLabel}" can't check its ${template}.`,
    };
  switch (resolution.state) {
    case "ready":
      return {
        status: "available",
        message: `"${input.stepLabel}" uses "${resolution.credential.name}" (${template}).`,
      };
    case "expiring":
      return {
        status: "available",
        message: `"${input.stepLabel}" uses "${resolution.credential.name}" (${template}); ${input.readiness.statusLabel.toLowerCase()}.`,
      };
    case "matched":
      return {
        status: "available",
        message: `"${input.stepLabel}" uses "${resolution.credential.name}" (${template}), matched automatically by type.`,
      };
    case "choose":
      return {
        status: "missing",
        message: `${resolution.candidates.length} ${template} credentials match "${input.stepLabel}"; choose one.`,
      };
    case "missing":
      return {
        status: "missing",
        message: `No ${template} credential exists on this server; add one in Settings → Credentials.`,
      };
    case "incomplete":
      return {
        status: "missing",
        message: `"${resolution.credential.name}" (${template}) is missing a required field.`,
      };
    case "expired":
      return {
        status: "error",
        message: `"${resolution.credential.name}" (${template}) expired.`,
      };
    case "not-allowed":
      return {
        status: "missing",
        message: `"${resolution.credential.name}" (${template}) is limited to other projects.`,
      };
  }
}

/** The credential ids a step resolved to, for the pre-approved policy. Never a candidate list. */
export function attachedCredentialIds(input: {
  readonly step: WorkflowStep;
  readonly projectId: ProjectId;
  readonly credentials: ReadonlyArray<Credential>;
}): ReadonlyArray<CredentialId> {
  const ids: CredentialId[] = [];
  for (const attachment of input.step.attachments ?? []) {
    if (attachment.kind !== "credential") continue;
    const resolution = resolveCredentialAttachment({
      attachment,
      projectId: input.projectId,
      credentials: input.credentials,
    });
    if (resolution.state === "choose" || resolution.state === "missing") continue;
    // An unusable binding is not a pre-approval: the vault's own check still has to refuse it.
    if (
      resolution.state !== "ready" &&
      resolution.state !== "matched" &&
      resolution.state !== "expiring"
    )
      continue;
    ids.push(resolution.credential.id);
  }
  return ids;
}

const hasCredentialAttachments = (definition: WorkflowDefinition): boolean =>
  definition.steps.some((step) =>
    (step.attachments ?? []).some((attachment) => attachment.kind === "credential"),
  );

/** A schedule runs unattended, so attached credentials need the pre-approved knob to work. */
export const credentialApprovalWarnings = (
  definition: WorkflowDefinition,
): ReadonlyArray<string> =>
  hasCredentialAttachments(definition) &&
  (definition.credentialApprovals ?? "once-per-run") !== "pre-approved"
    ? [CREDENTIAL_APPROVALS_WARNING]
    : [];

/**
 * Pre-approval covers the ids the user approved on this machine, never the file's knob. An
 * attachment added afterwards, or a file that arrived saying "pre-approved", has no grant, so it
 * asks at run time and the canvas offers to approve it again. Ids come from the resolved
 * snapshot, so a template-matched credential is judged by the credential it really uses.
 */
export const credentialPreapprovalWarnings = (input: {
  readonly definition: WorkflowDefinition;
  readonly snapshot: WorkflowReadinessSnapshot | undefined;
  readonly approvedIds: ReadonlyArray<CredentialId>;
}): ReadonlyArray<string> => {
  if ((input.definition.credentialApprovals ?? "once-per-run") !== "pre-approved") return [];
  const approved = new Set(input.approvedIds);
  const uncovered = (input.snapshot?.entries ?? []).some(
    (entry) =>
      entry.kind === "credential" &&
      entry.credential?.credentialId !== undefined &&
      !approved.has(entry.credential.credentialId),
  );
  return uncovered ? [CREDENTIAL_REAPPROVAL_WARNING] : [];
};

/** Required attachments an unattended start must not run without. */
export const blockingCredentialEntries = (
  snapshot: WorkflowReadinessSnapshot | undefined,
): ReadonlyArray<WorkflowReadinessEntry> =>
  (snapshot?.entries ?? []).filter(
    (entry) =>
      entry.kind === "credential" &&
      entry.credential !== undefined &&
      entry.credential.optional !== true &&
      BLOCKING_STATES.has(entry.credential.state),
  );
