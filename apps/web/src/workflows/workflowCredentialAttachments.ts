import {
  CredentialId,
  TrimmedNonEmptyString,
  workflowCredentialCardKey,
  workflowLayoutSlug,
  type CredentialPendingRequest,
  type WorkflowAttachment,
  type WorkflowCredentialAttachment,
  type WorkflowCredentialCandidate,
  type WorkflowCredentialEnvVar,
  type WorkflowCredentialReadiness,
  type WorkflowCredentialState,
  type WorkflowDefinition,
  type WorkflowReadinessEntry,
  type WorkflowStep,
} from "@t3tools/contracts";
import {
  credentialActivityLabel,
  type StepCredentialActivity,
} from "@t3tools/client-runtime/state/runtime";
import { matchCredentialBrand } from "@t3tools/shared/credentialBrand";
import { CREDENTIAL_TEMPLATES, credentialTemplate } from "@t3tools/shared/credentialTemplates";

/**
 * A credential card's state: what the vault and the binding say before a run, or what the agent is
 * doing with it during and after one. Live activity always wins, so a ready card turns into
 * "Needs approval" instead of drawing a second card for the same credential.
 */
export type WorkflowCredentialApprovalMode = NonNullable<WorkflowDefinition["credentialApprovals"]>;

export type WorkflowCredentialCardState = WorkflowCredentialState | "asking" | "in-use" | "used";

export interface WorkflowCredentialSatellite {
  /** The canvas and layout key. An attached credential keeps its attachment id after binding. */
  readonly key: string;
  readonly stepId: string;
  readonly attachmentId?: string;
  readonly credentialId?: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly name: string;
  readonly icon?: string;
  readonly state: WorkflowCredentialCardState;
  readonly statusLabel: string;
  readonly readiness?: WorkflowCredentialReadiness;
  readonly activity?: StepCredentialActivity;
  readonly requests: ReadonlyArray<CredentialPendingRequest>;
  readonly count: number;
  readonly envVars: ReadonlyArray<WorkflowCredentialEnvVar>;
  readonly candidates: ReadonlyArray<WorkflowCredentialCandidate>;
  readonly optional: boolean;
  readonly expiresAt?: string;
  readonly approval: WorkflowCredentialApprovalMode;
}

const DEFAULT_APPROVAL: WorkflowCredentialApprovalMode = "once-per-run";

const credentialAttachmentOf = (attachment: WorkflowAttachment) =>
  attachment.kind === "credential" ? attachment : null;

type StepAttachments = {
  readonly attachments?: ReadonlyArray<WorkflowAttachment> | undefined;
};

export const credentialAttachmentsOf = (step: StepAttachments) =>
  (step.attachments ?? []).flatMap((attachment) => {
    const credential = credentialAttachmentOf(attachment);
    return credential === null ? [] : [credential];
  });

export const resourceAttachmentsOf = (step: StepAttachments) =>
  (step.attachments ?? []).filter((attachment) => attachment.kind !== "credential");

export const credentialTemplateLabel = (templateId: string): string =>
  credentialTemplate(templateId)?.name ?? templateId;

/**
 * One card per credential a step uses. Attachments come first, in the order the user attached
 * them, so the canvas never shows two cards for the same credential: a live use is folded into the
 * attachment that resolves to it, and only a use with no attachment gets a card of its own.
 */
export function workflowCredentialSatellites(input: {
  readonly step: {
    readonly id: string;
    readonly attachments?: ReadonlyArray<WorkflowAttachment> | undefined;
  };
  readonly entries: ReadonlyArray<WorkflowReadinessEntry>;
  readonly activity: ReadonlyArray<StepCredentialActivity>;
  readonly approval?: WorkflowCredentialApprovalMode | undefined;
}): ReadonlyArray<WorkflowCredentialSatellite> {
  const approval = input.approval ?? DEFAULT_APPROVAL;
  const activityByCredential = new Map(
    input.activity.map((entry) => [entry.credentialId, entry] as const),
  );
  const seen = new Set<string>();
  const satellites: WorkflowCredentialSatellite[] = [];

  for (const attachment of credentialAttachmentsOf(input.step)) {
    const entry = input.entries.find(
      (candidate) => candidate.stepId === input.step.id && candidate.attachmentId === attachment.id,
    );
    const readiness = entry?.credential;
    const credentialId = readiness?.credentialId ?? attachment.credentialId;
    const live = credentialId === undefined ? undefined : activityByCredential.get(credentialId);
    if (live && credentialId !== undefined) activityByCredential.delete(credentialId);
    const templateName = credentialTemplateLabel(attachment.templateId);
    const key = workflowCredentialCardKey(
      workflowLayoutSlug(input.step.id),
      workflowLayoutSlug(attachment.id),
    );
    if (seen.has(key)) continue;
    seen.add(key);
    satellites.push({
      key,
      stepId: input.step.id,
      attachmentId: attachment.id,
      ...(credentialId === undefined ? {} : { credentialId }),
      templateId: attachment.templateId,
      templateName,
      name: live?.name ?? readiness?.name ?? attachment.label ?? templateName,
      ...((live?.icon ?? readiness?.icon)
        ? { icon: (live?.icon ?? readiness?.icon) as string }
        : {}),
      state: live?.state ?? readiness?.state ?? "no-access",
      statusLabel:
        live !== undefined
          ? credentialActivityLabel(live)
          : (readiness?.statusLabel ?? "Not checked"),
      ...(readiness === undefined ? {} : { readiness }),
      ...(live === undefined ? {} : { activity: live }),
      requests: live?.requests ?? [],
      count: live?.count ?? 0,
      envVars: readiness?.envVars ?? [],
      candidates: readiness?.candidates ?? [],
      optional: attachment.optional === true || readiness?.optional === true,
      ...(readiness?.expiresAt === undefined ? {} : { expiresAt: readiness.expiresAt }),
      approval,
    });
  }

  for (const live of activityByCredential.values()) {
    const key = workflowCredentialCardKey(
      workflowLayoutSlug(input.step.id),
      workflowLayoutSlug(live.credentialId),
    );
    if (seen.has(key)) continue;
    seen.add(key);
    satellites.push({
      key,
      stepId: input.step.id,
      credentialId: live.credentialId,
      templateId: live.templateId ?? "",
      templateName: live.templateId ? credentialTemplateLabel(live.templateId) : "Credential",
      name: live.name,
      ...(live.icon ? { icon: live.icon } : {}),
      state: live.state,
      statusLabel: credentialActivityLabel(live),
      activity: live,
      requests: live.requests,
      count: live.count,
      envVars: [],
      candidates: [],
      optional: false,
      approval,
    });
  }

  return satellites;
}

/** The step's satellites from a listing or run preflight, for cards and the Needs block. */
export function stepCredentialSatellites(input: {
  readonly step: WorkflowStep;
  readonly entries: ReadonlyArray<WorkflowReadinessEntry> | undefined;
  readonly activity: ReadonlyArray<StepCredentialActivity>;
  readonly approval?: WorkflowCredentialApprovalMode | undefined;
}): ReadonlyArray<WorkflowCredentialSatellite> {
  if ((input.step.attachments ?? []).every((attachment) => attachment.kind !== "credential"))
    return [];
  return workflowCredentialSatellites({
    step: input.step,
    entries: input.entries ?? [],
    activity: input.activity,
    approval: input.approval,
  });
}

/** Chips are neutral until something is wrong or happening: the card stays the loud one. */
export function credentialCardTone(
  state: WorkflowCredentialCardState,
): "secondary" | "warning" | "info" | "error" {
  switch (state) {
    case "asking":
      return "warning";
    case "in-use":
      return "info";
    case "missing":
    case "choose":
    case "expiring":
      return "warning";
    case "incomplete":
    case "expired":
    case "not-allowed":
    case "no-access":
      return "error";
    default:
      return "secondary";
  }
}

/** "once per run" | "ask every time" | "pre-approved", from the workflow's knob. */
export function credentialApprovalLabel(approval: WorkflowCredentialApprovalMode): string {
  return approval === "ask"
    ? "ask every time"
    : approval === "pre-approved"
      ? "pre-approved"
      : "once per run";
}

/**
 * The drawn height of one satellite, so layout can reserve its lane before it renders. The
 * approval request is the only tall state: its who-line, command and buttons. The masked env rows
 * are what make a card taller than its neighbour.
 */
export function workflowCredentialCardHeight(satellite: WorkflowCredentialSatellite): number {
  // The card masks two env names and folds the rest into one "+N" row.
  const envRows = Math.min(satellite.envVars.length, 2) + (satellite.envVars.length > 2 ? 1 : 0);
  const height = envRows * 14;
  if (satellite.state === "asking") return 160 * Math.max(1, satellite.requests.length) + height;
  if (satellite.state === "in-use") return 116 + height;
  if (satellite.state === "used") return 84 + height;
  return 96 + height;
}

/** The action a card offers, if any, before and after a run. */
export type WorkflowCredentialCardAction = "add" | "choose" | "fix" | "none";

export function credentialCardAction(
  satellite: WorkflowCredentialSatellite,
): WorkflowCredentialCardAction {
  if (satellite.activity !== undefined) return "none";
  switch (satellite.state) {
    case "missing":
      return "add";
    case "choose":
    case "matched":
      return "choose";
    case "incomplete":
    case "expired":
      return "fix";
    default:
      return "none";
  }
}

/** Why a card cannot run, in one plain sentence, when the user cannot fix it inline. */
export function credentialCardExplanation(satellite: WorkflowCredentialSatellite): string | null {
  switch (satellite.state) {
    case "not-allowed":
      return "Limited to other projects. Open it in the credential manager to change its projects.";
    case "no-access":
      return "This connection cannot read the credential vault.";
    case "choose":
      return "Several credentials match this step. Choose the one it should use.";
    default:
      return null;
  }
}

/** "ASC_KEY_ID · ASC_ISSUER_ID", with a file field shown the way the agent sees it. */
export function credentialEnvVarSummary(envVars: ReadonlyArray<WorkflowCredentialEnvVar>): string {
  return envVars
    .map((envVar) => (envVar.file ? `${envVar.name} (file path)` : envVar.name))
    .join(" · ");
}

/**
 * The brand slugs a template stands for. Cached because the templates are static and brand
 * detection walks the generated index.
 */
let templateBrandCache: ReadonlyMap<string, ReadonlySet<string>> | null = null;

function templateBrandSlugs(): ReadonlyMap<string, ReadonlySet<string>> {
  if (templateBrandCache !== null) return templateBrandCache;
  const map = new Map<string, ReadonlySet<string>>();
  for (const template of CREDENTIAL_TEMPLATES) {
    const slugs = new Set<string>();
    const icon = template.icon?.trim().toLowerCase();
    if (icon) slugs.add(icon);
    const byName = matchCredentialBrand({ name: template.name, templateIcon: template.icon });
    if (byName) slugs.add(byName.slug);
    for (const field of template.fields) {
      const byField = matchCredentialBrand({ name: "", envVars: [field.envVar] });
      if (byField) slugs.add(byField.slug);
    }
    map.set(template.id, slugs);
  }
  templateBrandCache = map;
  return map;
}

/** Every brand the step's words could name: the whole text, single words, and hosts. */
function brandSlugsInText(text: string): ReadonlySet<string> {
  const slugs = new Set<string>();
  const add = (slug: string | null | undefined) => {
    if (slug) slugs.add(slug);
  };
  add(matchCredentialBrand({ name: text })?.slug);
  const hosts = text.match(/(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/giu) ?? [];
  if (hosts.length > 0) add(matchCredentialBrand({ name: "", urls: hosts })?.slug);
  for (const word of text.split(/[^A-Za-z0-9_]+/u)) {
    if (word.length < 3) continue;
    add(matchCredentialBrand({ name: word })?.slug);
    // A skill's spelling often looks like an env prefix: `asc`, `gh`, `eas`.
    add(matchCredentialBrand({ name: "", envVars: [word] })?.slug);
  }
  return slugs;
}

const MAX_SUGGESTIONS = 5;

/**
 * Credential templates worth offering for a step, matched from what the step already says: its
 * skill, title, note and attached MCP server names. Every word and host goes through the shared
 * brand matcher, so this agrees with the icons the manager and mobile draw.
 */
export function suggestedCredentialTemplateIds(input: {
  readonly step: WorkflowStep;
  readonly attachedServers: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const text = [
    input.step.title ?? "",
    input.step.note ?? "",
    "skill" in input.step ? input.step.skill : input.step.workflow,
    ...input.attachedServers,
  ]
    .filter(Boolean)
    .join(" ");
  const normalized = text.trim();
  if (normalized === "") return [];
  const brands = brandSlugsInText(normalized);
  if (brands.size === 0) return [];
  const attachedTemplates = new Set(
    credentialAttachmentsOf(input.step).map((attachment) => attachment.templateId),
  );
  const templates = templateBrandSlugs();
  const suggestions: string[] = [];
  for (const [templateId, slugs] of templates) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    if (attachedTemplates.has(templateId)) continue;
    const template = credentialTemplate(templateId);
    // Custom and .env bundles are always offered by the gallery, never suggested by a word.
    if (template === undefined || template.dynamic === true) continue;
    if (![...slugs].some((slug) => brands.has(slug))) continue;
    suggestions.push(templateId);
  }
  return suggestions;
}

/** The attachment a multi-select attach writes: the portable template plus this machine's id. */
export function credentialAttachment(input: {
  readonly id: string;
  readonly templateId: string;
  readonly credentialId?: string | undefined;
  readonly name?: string | undefined;
}): WorkflowCredentialAttachment {
  return {
    id: input.id,
    kind: "credential",
    templateId: input.templateId,
    ...(input.credentialId ? { credentialId: CredentialId.make(input.credentialId) } : {}),
    ...(input.name ? { label: TrimmedNonEmptyString.make(input.name) } : {}),
  };
}

/**
 * What a multi-select attach writes: one attachment per credential, carrying the portable template
 * and this machine's id. Already-attached credentials and steps at the limit are left out.
 */
export function credentialAttachmentsFor(input: {
  readonly step: StepAttachments;
  readonly credentials: ReadonlyArray<{
    readonly id: string;
    readonly templateId: string;
    readonly name: string;
  }>;
  readonly limit: number;
  readonly newId: () => string;
}): ReadonlyArray<WorkflowCredentialAttachment> {
  const existing = input.step.attachments ?? [];
  const attached = new Set(
    credentialAttachmentsOf(input.step).map((attachment) => attachment.credentialId),
  );
  const room = Math.max(0, input.limit - existing.length);
  return input.credentials
    .filter((credential) => !attached.has(credential.id as never))
    .slice(0, room)
    .map((credential) =>
      credentialAttachment({
        id: input.newId(),
        templateId: credential.templateId,
        credentialId: credential.id,
        name: credential.name,
      }),
    );
}

/** The Choose… action's write: bind this machine's credential without touching the template. */
export function bindCredentialAttachment(
  attachment: WorkflowCredentialAttachment,
  credentialId: string,
): WorkflowCredentialAttachment {
  return { ...attachment, credentialId: CredentialId.make(credentialId) };
}

/** True when this step already uses that credential, so attaching it again is a no-op. */
export function stepUsesCredential(step: WorkflowStep, credentialId: string): boolean {
  return credentialAttachmentsOf(step).some(
    (attachment) => attachment.credentialId === credentialId,
  );
}
