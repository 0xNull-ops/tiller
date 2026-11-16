import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  CredentialIconSlug,
  CredentialId,
  CredentialStatus,
  CredentialTemplateId,
} from "./credential.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { WorkflowScheduleKnobs } from "./workflowScheduleKnobs.ts";
import { ScheduledTask, ScheduledTaskUpsertSchedule } from "./scheduledTask.ts";

/** Lowercase letters, digits and dashes: a workflow's file name and a step's id. */
export const WorkflowSlug = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(64),
).annotate({ description: "Lowercase letters, digits and dashes, such as launch-site." });
export type WorkflowSlug = typeof WorkflowSlug.Type;

export const MAX_WORKFLOW_STEPS = 40;
export const MAX_WORKFLOW_STEP_CHECKS = 8;
export const MAX_WORKFLOW_STEP_ATTEMPTS = 3;
export const MAX_WORKFLOW_INPUTS = 12;
export const MAX_WORKFLOW_NOTES = 40;
export const MAX_WORKFLOW_NOTE_LENGTH = 4_000;
export const MAX_WORKFLOW_STEP_ATTACHMENTS = 12;
/** root -> child -> grandchild: the most workflow references one chain may cross. */
export const MAX_WORKFLOW_NESTING_EDGES = 2;

/**
 * A deterministic test of a step's result. File paths may be project-relative, absolute or home-relative (`~/`). A failed check sends the
 * step back to ready so the driving agent can fix it, up to MAX_WORKFLOW_STEP_ATTEMPTS.
 */
export const WorkflowStepCheck = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: TrimmedNonEmptyString.annotate({
      description: "File path: relative to the project, absolute or home-relative (~/).",
    }),
    minBytes: Schema.optional(NonNegativeInt),
  }),
  Schema.Struct({
    kind: Schema.Literal("command"),
    command: TrimmedNonEmptyString,
    timeoutSec: Schema.optional(NonNegativeInt),
  }),
]);
export type WorkflowStepCheck = typeof WorkflowStepCheck.Type;

/**
 * How the driving agent carries out steps. auto: its call, small steps itself and heavy or
 * parallel ones through subagents. The agent always drives; this only says how.
 */
export const WorkflowDelegation = Schema.Literals(["auto", "prefer-subagents", "always-subagents"]);
export type WorkflowDelegation = typeof WorkflowDelegation.Type;

/** A step's own override: always hand it to a subagent, or always do it in the driving thread. */
export const WorkflowStepDelegation = Schema.Literals(["subagent", "self"]);
export type WorkflowStepDelegation = typeof WorkflowStepDelegation.Type;

/**
 * The schema ceiling. A server's own cap is a preference, never a reason to fail a read.
 *
 * @public Contract constants: the preferences store and the pickers import them from here.
 */
export const MAX_WORKFLOW_SUBAGENT_MODELS_CEILING = 16;
/** @public The cap a server uses until the user changes it. */
export const DEFAULT_MAX_SUBAGENT_MODELS = 4;

/**
 * One model the workflow asks subagents to use. It is a hint, not a requirement: the run resolves
 * it against the environment's providers. `instanceId` records where it was picked, and `driver`
 * is the portable part. `driver` is optional only so entries folded from the legacy `model` field
 * decode; the UI always writes it.
 */
export const WorkflowSubagentModel = Schema.Struct({
  driver: Schema.optional(ProviderDriverKind),
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
});
export type WorkflowSubagentModel = typeof WorkflowSubagentModel.Type;

/** A bounded list of hints; both the definition and the meta edit carry one. */
const WorkflowSubagentModels = Schema.Array(WorkflowSubagentModel).check(
  Schema.isMaxLength(MAX_WORKFLOW_SUBAGENT_MODELS_CEILING),
);

/** How many subagent models a workflow may name. The schema ceiling; a server's cap is lower. */
export const WorkflowSubagentModelCap = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_WORKFLOW_SUBAGENT_MODELS_CEILING }),
);
export type WorkflowSubagentModelCap = typeof WorkflowSubagentModelCap.Type;

/** Why a hinted subagent model was not usable on the environment a run resolved against. */
export const WorkflowSubagentMissingReason = Schema.Literals([
  "no-instance",
  "disabled",
  "not-installed",
  "unavailable",
  "signed-out",
  "model-not-offered",
]);
export type WorkflowSubagentMissingReason = typeof WorkflowSubagentMissingReason.Type;

export const WorkflowUsableSubagentModel = Schema.Struct({
  driver: ProviderDriverKind,
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  /** What to call the model in the canvas and in the driver's prompt. */
  label: TrimmedNonEmptyString,
});
export type WorkflowUsableSubagentModel = typeof WorkflowUsableSubagentModel.Type;

/**
 * A workflow's subagent models resolved against one environment's providers. `usable` is what the
 * driver may pass to `delegate_task`; `missing` names each hint that did not resolve and why.
 * `fallback` means hints were given and none is usable, so the agent picks a model itself.
 */
export const WorkflowSubagentsSnapshot = Schema.Struct({
  usable: Schema.Array(WorkflowUsableSubagentModel),
  missing: Schema.Array(
    Schema.Struct({ hint: WorkflowSubagentModel, reason: WorkflowSubagentMissingReason }),
  ),
  fallback: Schema.Boolean,
});
export type WorkflowSubagentsSnapshot = typeof WorkflowSubagentsSnapshot.Type;

export const WorkflowPin = Schema.Struct({ projectId: ProjectId, workflow: WorkflowSlug });
const NormalizedWorkflowTags = Schema.Array(
  Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/), Schema.isMaxLength(24)),
).check(Schema.isMaxLength(6));
export const WorkflowTags = Schema.Array(Schema.String).pipe(
  Schema.decodeTo(
    NormalizedWorkflowTags,
    SchemaTransformation.transform<ReadonlyArray<string>, ReadonlyArray<string>>({
      decode: (tags) => [...new Set(tags.map((tag) => tag.trim().toLowerCase()))],
      encode: (tags) => tags,
    }),
  ),
);

/** Server preferences stay outside portable workflow files; workflow pins are project-scoped. */
export const WorkflowPreferences = Schema.Struct({
  pinnedSkills: Schema.Array(TrimmedNonEmptyString),
  pinnedWorkflows: Schema.Array(WorkflowPin).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  showBuiltinWorkflows: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  hiddenBuiltins: Schema.Array(WorkflowSlug).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  maxSubagentModels: WorkflowSubagentModelCap,
  workflowFirstForNewThreads: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
});
export type WorkflowPreferences = typeof WorkflowPreferences.Type;

/** An input's key in {{input.<id>}} templates and in a run's inputs, such as appName. */
export const WorkflowInputId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]*$/),
  Schema.isMaxLength(64),
).annotate({ description: "Letter first, then letters, digits, underscores or dashes." });
export type WorkflowInputId = typeof WorkflowInputId.Type;

/** What a workflow asks for when it runs. Required inputs must be filled before a run starts. */
export const WorkflowInput = Schema.Struct({
  id: WorkflowInputId,
  label: TrimmedNonEmptyString,
  kind: Schema.Literals(["text", "url", "multiline"]).annotate({
    description:
      "text: one line. url: an http(s) address, checked when the run starts. multiline: paragraphs.",
  }),
  required: Schema.optional(Schema.Boolean),
  /**
   * A run that omits this input uses this value; required inputs still fail without one. It is
   * additive, so definitions saved before it existed (every version) decode unchanged and simply
   * have no default.
   */
  defaultValue: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))).annotate({
    description: "Used when a run omits this input. URL inputs require an http(s) address.",
  }),
}).check(
  Schema.makeFilter((input) => {
    if (input.kind !== "url" || input.defaultValue === undefined) return true;
    try {
      const url = new URL(input.defaultValue);
      if (url.protocol === "http:" || url.protocol === "https:") return true;
    } catch {
      // Invalid URL defaults fail when saving, before a run can inherit them.
    }
    return "defaultValue for a url input must be a valid http(s) URL.";
  }),
);
export type WorkflowInput = typeof WorkflowInput.Type;

/** How a workflow starts. Schedules run through upstream scheduled tasks that name this workflow. */
export const WorkflowTrigger = Schema.Literals(["manual", "schedule", "webhook"]);
export type WorkflowTrigger = typeof WorkflowTrigger.Type;

/**
 * A sticky note on the canvas. Notes are context only: they never execute, never become ready
 * and never block a step.
 */
export const WorkflowNote = Schema.Struct({
  id: WorkflowSlug,
  text: Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_NOTE_LENGTH)),
  /** The step a note is drawn beside. It is not a dependency. */
  anchorStepId: Schema.optional(WorkflowSlug),
  /** Canvas position in canvas units; finite so a corrupt file can't break layout maths. */
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
});
export type WorkflowNote = typeof WorkflowNote.Type;

/** One slug piece: dash-separated segments, at most 64 characters, then `:` or the end. */
const LayoutSlug = "(?=[a-z0-9-]{1,64}(?::|$))[a-z0-9]+(?:-[a-z0-9]+)*";
const WorkflowLayoutKey = Schema.String.check(
  Schema.isPattern(
    new RegExp(
      `^(?:(?:gate|checks):${LayoutSlug}|resource:${LayoutSlug}:${LayoutSlug}|credential:${LayoutSlug}:${LayoutSlug}|${LayoutSlug})$`,
    ),
  ),
);

/**
 * Keys name a work step or one of its non-executable cards: the step id itself, `gate:<step>`,
 * `checks:<step>`, `resource:<step>:<attachment>`, or `credential:<step>:<credential>`. Notes keep
 * their own x/y.
 */
export const workflowGateCardKey = (stepId: WorkflowSlug) => `gate:${stepId}`;
export const workflowChecksCardKey = (stepId: WorkflowSlug) => `checks:${stepId}`;
export const workflowResourceCardKey = (stepId: WorkflowSlug, attachmentId: WorkflowSlug) =>
  `resource:${stepId}:${attachmentId}`;

/**
 * A credential satellite is drawn once per credential a step uses: keyed by the attachment when
 * the credential is attached to the step, so binding one never moves the card, and by the vault id
 * when an agent used it ad hoc without an attachment.
 */
export const workflowCredentialCardKey = (stepId: WorkflowSlug, id: string) =>
  `credential:${stepId}:${id}`;

/** Step ids and vault or attachment ids are slugs already; anything else is made one. */
export const workflowLayoutSlug = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return slug === "" ? "card" : slug;
};

/** Saved canvas positions in canvas units. 600 is every card a full workflow can hold. */
export const WorkflowLayout = Schema.Record(
  WorkflowLayoutKey,
  Schema.Struct({ x: Schema.Finite, y: Schema.Finite }),
).check(Schema.isMaxProperties(600));
export type WorkflowLayout = typeof WorkflowLayout.Type;

export const WorkflowAttachmentKind = Schema.Literals([
  "requirement",
  "service-login",
  "mcp-connection",
  "credential",
]);
export type WorkflowAttachmentKind = typeof WorkflowAttachmentKind.Type;

const AttachmentShared = {
  id: WorkflowSlug,
  label: Schema.optional(TrimmedNonEmptyString),
};

/** An OS or tool prerequisite, such as Node 22. Status has to come from a real probe. */
export const WorkflowRequirementAttachment = Schema.Struct({
  ...AttachmentShared,
  kind: Schema.Literal("requirement"),
  requirement: TrimmedNonEmptyString,
  /** A version the requirement must meet, such as 22 for Node. */
  minVersion: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowRequirementAttachment = typeof WorkflowRequirementAttachment.Type;

/**
 * An existing CLI login, such as a Vercel session. `command` is an optional bounded,
 * non-interactive status command; sign-in instructions are for the user, and no credentials are
 * stored on the card.
 */
export const WorkflowServiceLoginAttachment = Schema.Struct({
  ...AttachmentShared,
  kind: Schema.Literal("service-login"),
  service: TrimmedNonEmptyString,
  command: Schema.optional(TrimmedNonEmptyString),
  signInCommand: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowServiceLoginAttachment = typeof WorkflowServiceLoginAttachment.Type;

/** An MCP server the step expects. Configured never proves available; unknown is honest. */
export const WorkflowMcpConnectionAttachment = Schema.Struct({
  ...AttachmentShared,
  kind: Schema.Literal("mcp-connection"),
  server: TrimmedNonEmptyString,
  /**
   * The provider instance this connection was chosen for. Absent keeps the step's effective
   * provider, and keeps files saved before provider identity was recorded working.
   */
  providerInstanceId: Schema.optional(ProviderInstanceId),
});
export type WorkflowMcpConnectionAttachment = typeof WorkflowMcpConnectionAttachment.Type;

/**
 * A credential a step needs, stored in the workflow file for the marketplace: `templateId` is the
 * portable requirement, such as app-store-connect, and `credentialId` is this machine's binding.
 * Nothing value-shaped is part of an attachment: field contents live in the vault, so a stray
 * `value` or `fields` key is dropped on read, and the MCP schema rejects it outright.
 */
export const WorkflowCredentialAttachment = Schema.Struct({
  ...AttachmentShared,
  kind: Schema.Literal("credential"),
  templateId: CredentialTemplateId,
  /** Absent when the workflow was imported or shared: readiness then matches by templateId. */
  credentialId: Schema.optional(CredentialId),
  /** The step can run without it; absent means required. */
  optional: Schema.optional(Schema.Boolean),
});
export type WorkflowCredentialAttachment = typeof WorkflowCredentialAttachment.Type;

export const WorkflowAttachment = Schema.Union([
  WorkflowRequirementAttachment,
  WorkflowServiceLoginAttachment,
  WorkflowMcpConnectionAttachment,
  WorkflowCredentialAttachment,
]);
export type WorkflowAttachment = typeof WorkflowAttachment.Type;

export const WorkflowWaitBefore = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("delay"),
    minutes: Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(525600)),
  }),
  Schema.Struct({
    kind: Schema.Literal("until"),
    timeOfDay: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    weekdays: Schema.optional(
      Schema.Array(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
      ).check(Schema.isMinLength(1)),
    ),
  }),
]);
export type WorkflowWaitBefore = typeof WorkflowWaitBefore.Type;

const WorkflowStepShared = {
  id: WorkflowSlug,
  title: Schema.optional(TrimmedNonEmptyString),
  /** The user's instruction for this step, on top of the skill or child workflow. */
  note: Schema.optional(TrimmedNonEmptyString),
  /** Steps whose results this step reads. Absent means the step before it; empty means none. */
  readsFrom: Schema.optional(Schema.Array(WorkflowSlug)),
  /** Waits for the user after the step finishes. */
  pauseAfter: Schema.optional(Schema.Boolean),
  waitBefore: Schema.optional(WorkflowWaitBefore),
  /** Waits for the user's approval before the step starts: deploys, store submissions, pricing. */
  gate: Schema.optional(Schema.Boolean),
  /** Non-executable resources drawn beside this step. IDs are unique within the step. */
  attachments: Schema.optional(
    Schema.Array(WorkflowAttachment).check(Schema.isMaxLength(MAX_WORKFLOW_STEP_ATTACHMENTS)),
  ),
};

/** Carries out a named skill. kind is absent in files saved before nested workflows. */
export const WorkflowSkillStep = Schema.Struct({
  ...WorkflowStepShared,
  kind: Schema.optional(Schema.Literal("skill")),
  /** The skill this step carries out, by name, such as "frontend-design". */
  skill: TrimmedNonEmptyString,
  /** Overrides the workflow's model for this step only. */
  model: Schema.optional(ModelSelection),
  checks: Schema.optional(Schema.Array(WorkflowStepCheck)),
  /** Overrides the workflow's delegation for this step only. */
  delegation: Schema.optional(WorkflowStepDelegation),
});
export type WorkflowSkillStep = typeof WorkflowSkillStep.Type;

/**
 * Runs another saved workflow from the same project as a child run of this one. The parent run's
 * driver thread drives the child run too; no new thread is created.
 */
export const WorkflowNestedStep = Schema.Struct({
  ...WorkflowStepShared,
  kind: Schema.Literal("workflow"),
  workflow: WorkflowSlug,
  /** Maps this workflow's inputs into the child's; values may use {{input.<id>}}. */
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type WorkflowNestedStep = typeof WorkflowNestedStep.Type;

export const WorkflowStep = Schema.Union([WorkflowSkillStep, WorkflowNestedStep]);
export type WorkflowStep = typeof WorkflowStep.Type;

/**
 * A workflow, stored as `.t3/workflows/<slug>.json` in its project. Version 1 and 2 files are
 * still accepted everywhere; the store upgrades them with {@link upgradeWorkflowDefinition} and
 * persists version 3, which adds notes, attachments and optional layout without changing older
 * fields. Layout is presentation only, so version 3 needs no further bump for it.
 */
export const WorkflowCredentialApprovals = Schema.Literals(["ask", "once-per-run", "pre-approved"]);

/**
 * Why a workflow exists, when T3 made it rather than the user. Only `workflow-first` exists: an
 * agent saved it automatically while Workflow-first was on, so it stays scratch ("From threads")
 * until the user keeps it. Provenance, never permission: it grants nothing and a keep only
 * forgets it.
 */
export const WorkflowOrigin = Schema.Struct({
  kind: Schema.Literal("workflow-first"),
  /** The thread whose agent saved it. */
  threadId: ThreadId,
});
export type WorkflowOrigin = typeof WorkflowOrigin.Type;

export const MAX_WORKFLOW_LOOPS = 5;
export const MAX_WORKFLOW_LOOP_ROUNDS = 20;

export const WorkflowLoopUntil = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("step-says-pass") }),
  Schema.Struct({ kind: Schema.Literal("checks-pass") }),
  Schema.Struct({
    kind: Schema.Literal("condition"),
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  }),
]);
export type WorkflowLoopUntil = typeof WorkflowLoopUntil.Type;

export const WorkflowLoop = Schema.Struct({
  id: WorkflowSlug,
  from: WorkflowSlug,
  to: WorkflowSlug,
  maxRounds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_WORKFLOW_LOOP_ROUNDS })),
  until: WorkflowLoopUntil,
  feedback: Schema.optional(Schema.Boolean),
});
export type WorkflowLoop = typeof WorkflowLoop.Type;

export const WorkflowDefinition = Schema.Struct({
  builtinTemplate: Schema.optional(Schema.String),
  tags: Schema.optional(WorkflowTags),
  credentialApprovals: Schema.optional(WorkflowCredentialApprovals),
  version: Schema.Literals([1, 2, 3]),
  name: TrimmedNonEmptyString,
  /** What the user wants, in their words. Every step reads it. */
  brief: Schema.optional(Schema.String),
  /** A project-relative spec file every step reads, such as SPEC.md. */
  spec: Schema.optional(TrimmedNonEmptyString),
  /** The default model for steps that don't set one. Legacy: the upgrade below folds it in. */
  model: Schema.optional(ModelSelection),
  /**
   * Models subagents should use. A hint: a run resolves each one against its environment's
   * providers, and a machine that has none of them lets the agent decide. Additive to version 3.
   */
  subagentModels: Schema.optional(WorkflowSubagentModels),
  /** What the workflow asks for when it runs; {{input.<id>}} templates resolve against these. */
  inputs: Schema.optional(
    Schema.Array(WorkflowInput).check(Schema.isMaxLength(MAX_WORKFLOW_INPUTS)),
  ),
  /** How the workflow starts; absent means manual. */
  trigger: Schema.optional(WorkflowTrigger),
  startAfter: Schema.optional(
    Schema.Array(
      Schema.Struct({
        workflow: WorkflowSlug,
        when: Schema.Literals(["succeeded", "finished"]),
        enabled: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  /** Loop-back connections from a later step back to an earlier step. */
  loops: Schema.optional(Schema.Array(WorkflowLoop).check(Schema.isMaxLength(MAX_WORKFLOW_LOOPS))),
  /** How the driving agent carries out steps. Version 1 called this `delegation`. */
  execution: Schema.optional(WorkflowDelegation),
  /** Version 1's name for execution, still accepted so old files and clients keep working. */
  delegation: Schema.optional(WorkflowDelegation),
  /** Non-running canvas notes. They never enter the execution graph. */
  notes: Schema.optional(Schema.Array(WorkflowNote).check(Schema.isMaxLength(MAX_WORKFLOW_NOTES))),
  /**
   * Where the canvas draws cards. Presentation only: it never changes steps, dependencies or run
   * history. Additive to version 3, so older builds ignore it and fall back to automatic layout.
   */
  layout: Schema.optional(WorkflowLayout),
  /**
   * Why this workflow exists, when T3 saved it automatically under Workflow-first. The canvas shows
   * it collapsed under "From threads" until {@link WorkflowEdit}'s `keep` clears it. Additive to
   * version 3; it never changes steps, dependencies or run history.
   */
  origin: Schema.optional(WorkflowOrigin),
  steps: Schema.Array(WorkflowStep),
});
export type WorkflowDefinition = typeof WorkflowDefinition.Type;

/**
 * Normalizes a definition to version 3: `delegation` becomes `execution` and the legacy `model`
 * becomes a one-item `subagentModels`, and both are dropped. The store runs this on every read, so
 * saved version 1 and 2 files keep working, and on every write, so nothing is persisted below
 * version 3. Running an already-normalized definition returns it unchanged.
 */
export function upgradeWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  const { delegation, model, ...rest } = definition;
  if (rest.version === 3 && delegation === undefined && model === undefined) return definition;
  const execution = rest.execution ?? delegation;
  // The folded entry has no driver: default instance ids equal their driver kind, and the resolver
  // treats an instance id it can't find as the driver kind.
  const subagentModels =
    rest.subagentModels ??
    (model === undefined ? undefined : [{ instanceId: model.instanceId, model: model.model }]);
  return {
    ...rest,
    version: 3,
    ...(execution === undefined ? {} : { execution }),
    ...(subagentModels === undefined ? {} : { subagentModels }),
  };
}

/**
 * The definition without presentation-only layout or provenance, for digests and change checks.
 * Moving a card or keeping a workflow must never read as a changed workflow.
 */
export function workflowSemanticDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  if (definition.layout === undefined && definition.origin === undefined) return definition;
  const { layout: _layout, origin: _origin, ...semantic } = definition;
  return semantic;
}

/** queued: earlier steps unfinished. ready: the driving agent may start it. */
export const WorkflowStepStatus = Schema.Literals([
  "queued",
  "ready",
  "waiting",
  "running",
  "done",
  "failed",
  "skipped",
]);
export type WorkflowStepStatus = typeof WorkflowStepStatus.Type;

export const WorkflowRunStatus = Schema.Literals([
  "running",
  "waiting",
  "done",
  "failed",
  "stopped",
]);
export type WorkflowRunStatus = typeof WorkflowRunStatus.Type;

export const WorkflowCheckResult = Schema.Struct({
  check: WorkflowStepCheck,
  ok: Schema.Boolean,
  /** Plain words, such as "out/site/index.html is missing". */
  message: Schema.String,
});
export type WorkflowCheckResult = typeof WorkflowCheckResult.Type;

/**
 * What is known about a step resource. Unknown is honest: it means nothing has been checked, and
 * configured means only that configuration exists, not that it works.
 */
export const WorkflowReadinessStatus = Schema.Literals([
  "unknown",
  "checking",
  "available",
  "missing",
  "error",
  "configured",
]);
export type WorkflowReadinessStatus = typeof WorkflowReadinessStatus.Type;

/** How an attached credential resolved for a step. Never silently picks between several. */
export const WorkflowCredentialState = Schema.Literals([
  "ready",
  "matched",
  "choose",
  "missing",
  "incomplete",
  "expired",
  "expiring",
  "not-allowed",
  "no-access",
]);
export type WorkflowCredentialState = typeof WorkflowCredentialState.Type;

/** One environment variable the step's agent gets. Names only; there is no value here. */
export const WorkflowCredentialEnvVar = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** A secretFile field: the agent gets a path, so `credential_file` applies. */
  file: Schema.Boolean,
});
export type WorkflowCredentialEnvVar = typeof WorkflowCredentialEnvVar.Type;

/** A credential of the attachment's template that the project may use. */
export const WorkflowCredentialCandidate = Schema.Struct({
  id: CredentialId,
  name: TrimmedNonEmptyString,
  status: CredentialStatus,
  icon: Schema.optional(CredentialIconSlug),
  /** Plain words for the card, such as "Expires in 12 days". */
  statusLabel: TrimmedNonEmptyString,
});
export type WorkflowCredentialCandidate = typeof WorkflowCredentialCandidate.Type;

/**
 * Everything a client needs to draw one credential satellite without another round trip. It
 * carries names, env-var names and status labels; never a value or a field's content.
 */
export const WorkflowCredentialReadiness = Schema.Struct({
  state: WorkflowCredentialState,
  templateId: CredentialTemplateId,
  /** Short plain label for the card, such as "Ready" or "Choose a credential". */
  statusLabel: TrimmedNonEmptyString,
  /** The credential this step will use, when one resolved. */
  credentialId: Schema.optional(CredentialId),
  name: Schema.optional(TrimmedNonEmptyString),
  icon: Schema.optional(CredentialIconSlug),
  expiresAt: Schema.optional(IsoDateTime),
  /** Environment variable names the agent will see. */
  envVars: Schema.Array(WorkflowCredentialEnvVar),
  /** Only when `state` is choose: every candidate, so the user can pick one. */
  candidates: Schema.Array(WorkflowCredentialCandidate),
  /** The step can run without it. */
  optional: Schema.Boolean,
});
export type WorkflowCredentialReadiness = typeof WorkflowCredentialReadiness.Type;

/** One resource observation. `stale` marks a cached result whose freshness window has passed. */
export const WorkflowReadinessEntry = Schema.Struct({
  stepId: WorkflowSlug,
  attachmentId: WorkflowSlug,
  kind: WorkflowAttachmentKind,
  status: WorkflowReadinessStatus,
  /** Short, sanitized status or remediation; never raw process output or credentials. */
  message: Schema.String,
  checkedAt: Schema.optional(IsoDateTime),
  expiresAt: Schema.optional(IsoDateTime),
  providerInstanceId: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  stale: Schema.optional(Schema.Boolean),
  /** Present for a credential attachment: what the vault and the binding say, for the card. */
  credential: Schema.optional(WorkflowCredentialReadiness),
});
export type WorkflowReadinessEntry = typeof WorkflowReadinessEntry.Type;

/** Server-validated context that gives a readiness snapshot meaning to a particular viewer. */
export const WorkflowReadinessContext = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  workspaceRoot: TrimmedNonEmptyString,
  model: Schema.optional(ModelSelection),
  specification: TrimmedNonEmptyString,
});
export type WorkflowReadinessContext = typeof WorkflowReadinessContext.Type;

/** A compact stable key keeps the full attachment configuration off the workflows stream. */
export const workflowReadinessSpecification = (definition: WorkflowDefinition): string => {
  const serialized = JSON.stringify({
    subagentModels: upgradeWorkflowDefinition(definition).subagentModels,
    steps: definition.steps.map((step) => ({
      id: step.id,
      model: "model" in step ? step.model : undefined,
      attachments: step.attachments ?? [],
    })),
  });
  let forward = 0x811c9dc5;
  let reverse = 0x9dc5811c;
  for (let index = 0; index < serialized.length; index += 1) {
    forward ^= serialized.charCodeAt(index);
    forward = Math.imul(forward, 0x01000193) >>> 0;
    reverse ^= serialized.charCodeAt(serialized.length - 1 - index);
    reverse = Math.imul(reverse, 0x01000193) >>> 0;
  }
  return `${forward.toString(16).padStart(8, "0")}${reverse.toString(16).padStart(8, "0")}`;
};

/** Everything known about a definition's resources, from startup checks and cached probes. */
export const WorkflowReadinessSnapshot = Schema.Struct({
  entries: Schema.Array(WorkflowReadinessEntry),
  /** True when a required resource is missing or errored, so Run must stop with a reason. */
  blocksRun: Schema.Boolean,
  /**
   * Advisory sentences for the canvas, such as "Scheduled runs need Pre-approved credentials".
   * A warning never stops a manual run; it names a setup problem the user should fix.
   */
  warnings: Schema.optional(Schema.Array(Schema.String)),
  evaluatedAt: Schema.optional(IsoDateTime),
  /** Missing on older servers, whose observations cannot be scoped safely by clients. */
  context: Schema.optional(WorkflowReadinessContext),
});
export type WorkflowReadinessSnapshot = typeof WorkflowReadinessSnapshot.Type;

/** A scheduled run needs pre-approval to use the attached credentials unattended. */
export const CREDENTIAL_APPROVALS_WARNING = "Scheduled runs need Pre-approved credentials.";
export const CREDENTIAL_REAPPROVAL_WARNING =
  "Some attached credentials aren't covered by this workflow's pre-approval. Switch to Pre-approved again to cover them.";
/** The server's credential advisories; clients replace these with the listing's own copy. */
export const WORKFLOW_CREDENTIAL_WARNINGS: ReadonlyArray<string> = [
  CREDENTIAL_APPROVALS_WARNING,
  CREDENTIAL_REAPPROVAL_WARNING,
];

export const MAX_WORKFLOW_MCP_SERVERS = 100;
export const MAX_WORKFLOW_MCP_TOOLS_PER_SERVER = 100;
export const MAX_WORKFLOW_MCP_TOOLS = 500;
export const MAX_WORKFLOW_MCP_NAME_LENGTH = 200;
export const MAX_WORKFLOW_MCP_DESCRIPTION_LENGTH = 300;
export const MAX_WORKFLOW_MCP_DETAIL_LENGTH = 240;
export const MAX_WORKFLOW_MCP_LIMITATIONS = 8;
export const MAX_WORKFLOW_MCP_VERSION_LENGTH = 120;
export const MAX_WORKFLOW_MCP_ORIGIN_LENGTH = 300;
export const MAX_WORKFLOW_MCP_MESSAGE_LENGTH = 400;

/** Whether a provider connection is authoritatively ready, failed, or still unknown. */
export const WorkflowMcpConnectionState = Schema.Literals([
  "connected",
  "connecting",
  "needs-auth",
  "failed",
  "disabled",
  "not-started",
  "unknown",
]);
export type WorkflowMcpConnectionState = typeof WorkflowMcpConnectionState.Type;

/**
 * Whether this server's tools were actually reported. A disconnected or unsupported server is
 * `unavailable`, never `empty`: an unverified zero must not read as "no tools".
 */
export const WorkflowMcpToolsState = Schema.Literals([
  "available",
  "empty",
  "unavailable",
  "error",
]);
export type WorkflowMcpToolsState = typeof WorkflowMcpToolsState.Type;

export const WorkflowMcpTool = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_NAME_LENGTH)).annotate({
    description: "The tool name the provider exposes, such as create_issue.",
  }),
  title: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_NAME_LENGTH)),
  ),
  description: Schema.optional(
    Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_DESCRIPTION_LENGTH)),
  ),
  /** Hints the server advertises; absence is unknown, not permission. */
  readOnly: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
  openWorld: Schema.optional(Schema.Boolean),
});
export type WorkflowMcpTool = typeof WorkflowMcpTool.Type;

/** One MCP connection as the provider's live runtime or its own configuration reports it. */
export const WorkflowMcpServerInventory = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_NAME_LENGTH)),
  title: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_NAME_LENGTH)),
  ),
  description: Schema.optional(
    Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_DESCRIPTION_LENGTH)),
  ),
  version: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_VERSION_LENGTH)),
  ),
  /** HTTP origin only. T3 never returns credentials, paths, queries or fragments. */
  origin: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_ORIGIN_LENGTH)),
  ),
  transport: Schema.optional(Schema.Literals(["http", "stdio", "unknown"])),
  status: WorkflowMcpConnectionState,
  auth: Schema.optional(
    Schema.Literals(["signed-in", "needs-auth", "not-required", "unsupported", "unknown"]),
  ),
  statusDetail: Schema.optional(
    Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_DETAIL_LENGTH)),
  ),
  toolsStatus: WorkflowMcpToolsState,
  toolsDetail: Schema.optional(
    Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_DETAIL_LENGTH)),
  ),
  tools: Schema.Array(WorkflowMcpTool).check(Schema.isMaxLength(MAX_WORKFLOW_MCP_TOOLS_PER_SERVER)),
  toolsTruncated: Schema.optional(Schema.Boolean),
  resources: Schema.optional(NonNegativeInt),
  resourceTemplates: Schema.optional(NonNegativeInt),
});
export type WorkflowMcpServerInventory = typeof WorkflowMcpServerInventory.Type;

/**
 * Where the snapshot's servers came from. `live` is a running provider session; `configured` is
 * only the selected instance's own read-only configuration, whose status and tools are unknown.
 * Absent on snapshots that answered no server list, and on older servers.
 */
export const WorkflowMcpInventorySource = Schema.Literals(["live", "configured"]);
export type WorkflowMcpInventorySource = typeof WorkflowMcpInventorySource.Type;

/**
 * What an inventory snapshot describes. MCP connections belong to a live provider session (or
 * its directory), not to the model, so `modelScoped` is false unless a provider says otherwise.
 */
export const WorkflowMcpInventoryScope = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  driverKind: Schema.optional(ProviderDriverKind),
  providerLabel: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(ModelSelection),
  modelScoped: Schema.Boolean,
  workspaceRoot: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
  providerSessionId: Schema.optional(TrimmedNonEmptyString),
  source: Schema.optional(WorkflowMcpInventorySource),
});
export type WorkflowMcpInventoryScope = typeof WorkflowMcpInventoryScope.Type;

/**
 * `available` means the provider answered an inventory query. That answer can be a live runtime
 * session, or — when no session runs — the selected instance's own read-only configuration, whose
 * servers carry `unknown` status and unavailable tools. `unsupported` means no supported source
 * exists, `unavailable` means one exists but couldn't be read, and `not-checked` means only a
 */
export const WorkflowMcpInventoryStatus = Schema.Literals([
  "available",
  "unsupported",
  "unavailable",
  "error",
  "not-checked",
]);
export type WorkflowMcpInventoryStatus = typeof WorkflowMcpInventoryStatus.Type;

/** A bounded, read-only inventory for one effective provider instance. Never tool invocation. */
export const WorkflowMcpInventorySnapshot = Schema.Struct({
  status: WorkflowMcpInventoryStatus,
  /** One plain sentence: what was read, or why it couldn't be. */
  message: Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_MESSAGE_LENGTH)),
  scope: WorkflowMcpInventoryScope,
  servers: Schema.Array(WorkflowMcpServerInventory).check(
    Schema.isMaxLength(MAX_WORKFLOW_MCP_SERVERS),
  ),
  checkedAt: Schema.optional(IsoDateTime),
  /** True when served from cache rather than a query in this request. */
  cached: Schema.Boolean,
  /** A cached snapshot past its freshness window. Refresh asks the provider again. */
  stale: Schema.Boolean,
  /** T3's own injected MCP server is identified and excluded from third-party inventory. */
  excludedInternal: NonNegativeInt,
  limitations: Schema.Array(
    Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_MCP_DETAIL_LENGTH)),
  ).check(Schema.isMaxLength(MAX_WORKFLOW_MCP_LIMITATIONS)),
});
export type WorkflowMcpInventorySnapshot = typeof WorkflowMcpInventorySnapshot.Type;

export const WorkflowOutputPreview = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("ready"), attachmentId: TrimmedNonEmptyString }),
  Schema.Struct({ status: Schema.Literal("unavailable") }),
]);
export type WorkflowOutputPreview = typeof WorkflowOutputPreview.Type;

export const WorkflowStepRoundSummary = Schema.Struct({
  round: NonNegativeInt,
  executionToken: Schema.optional(TrimmedNonEmptyString),
  status: WorkflowStepStatus,
  attempts: NonNegativeInt,
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  summary: Schema.optional(Schema.String),
  outputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  checks: Schema.optional(Schema.Array(WorkflowCheckResult)),
  error: Schema.optional(Schema.String),
  endedAt: Schema.optional(IsoDateTime),
  verdict: Schema.optional(Schema.Literals(["pass", "revise"])),
});
export type WorkflowStepRoundSummary = typeof WorkflowStepRoundSummary.Type;

export const WorkflowCarryOverResult = Schema.Struct({
  runId: TrimmedNonEmptyString,
  endedAt: IsoDateTime,
  summary: Schema.String,
  outputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type WorkflowCarryOverResult = typeof WorkflowCarryOverResult.Type;

export const WorkflowStepRun = Schema.Struct({
  stepId: WorkflowSlug,
  status: WorkflowStepStatus,
  /** Why a waiting step waits. */
  resumeAt: Schema.optional(IsoDateTime),
  waitingFor: Schema.optional(Schema.Literals(["approval", "resume", "timer"])),
  /** Who is doing the step: the driving thread itself, or a subagent's thread. */
  threadId: Schema.NullOr(ThreadId),
  attempts: NonNegativeInt,
  /** 1-based loop round for steps inside a loop. */
  round: Schema.optional(NonNegativeInt),
  /** Per-round execution token so delayed completions from an earlier round cannot cross into a new one. */
  executionToken: Schema.optional(TrimmedNonEmptyString),
  /** Summary of earlier rounds when a loop reset this step. */
  previousRounds: Schema.optional(Schema.Array(WorkflowStepRoundSummary)),
  /** Set on a loop's deciding step when rounds ran out without satisfying `until`. */
  loopExhausted: Schema.optional(Schema.Boolean),
  startedAt: Schema.optional(IsoDateTime),
  endedAt: Schema.optional(IsoDateTime),
  /** What was reported through workflow_step_done. */
  summary: Schema.optional(Schema.String),
  /** Named results the step reported: project-relative, absolute or home-relative paths, URLs or short text. */
  outputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** URL thumbnails are attachments in this run's environment, fetched only when displayed. */
  outputPreviews: Schema.optional(Schema.Record(Schema.String, WorkflowOutputPreview)),
  checks: Schema.optional(Schema.Array(WorkflowCheckResult)),
  /** Set while validation runs; a later validation clears it or records the result. */
  checking: Schema.optional(
    Schema.Struct({
      token: TrimmedNonEmptyString,
      startedAt: IsoDateTime,
    }),
  ),
  error: Schema.optional(Schema.String),
  /** A workflow step's child run; set once the child run starts. */
  childRunId: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowStepRun = typeof WorkflowStepRun.Type;

/**
 * A queued wakeup for a run's driving thread. Delivery is retried with the same revision, so a
 * retry cannot post a second copy; acknowledgedRevision catches up once the thread has it.
 * Absent on runs saved before durable wakeups.
 */
export const WorkflowDriverWakeup = Schema.Struct({
  revision: NonNegativeInt,
  acknowledgedRevision: NonNegativeInt,
  /** A digest of the state this wakeup reports. The same state reuses its revision. */
  key: TrimmedNonEmptyString,
  /** Digest of the latest run state known to have a durable notification record. */
  stateKey: Schema.optional(TrimmedNonEmptyString),
  /** Bounded words for the driving thread; workflow_status carries the detail. */
  message: Schema.String,
  queuedAt: IsoDateTime,
  attempts: NonNegativeInt,
  lastAttemptAt: Schema.optional(IsoDateTime),
  lastError: Schema.optional(Schema.String),
});
export type WorkflowDriverWakeup = typeof WorkflowDriverWakeup.Type;

export const WorkflowPinnedSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  sha256: TrimmedNonEmptyString,
});
export type WorkflowPinnedSkill = typeof WorkflowPinnedSkill.Type;

export const WorkflowRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  workflow: WorkflowSlug,
  /** The thread whose agent drives the run: it starts each step, itself or through a subagent. */
  driverThreadId: ThreadId,
  /** Set when this run reruns another from one step; earlier results were copied from it. */
  rerunOf: Schema.optional(Schema.Struct({ runId: TrimmedNonEmptyString, stepId: WorkflowSlug })),
  status: WorkflowRunStatus,
  startedAt: IsoDateTime,
  endedAt: Schema.optional(IsoDateTime),
  /** The workflow as it was when the run started; later edits don't change a running run. */
  triggerDispatchPending: Schema.optional(Schema.Boolean),
  scheduleTaskId: Schema.optional(ScheduledTaskId),
  queuedScheduleTaskIds: Schema.optional(Schema.Array(ScheduledTaskId)),
  triggerSourceRunId: Schema.optional(Schema.String),
  definition: WorkflowDefinition,
  /** What the run was started with; {{input.<id>}} templates resolve against these. */
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Previous finished run's result carried over by a schedule with `carryOver: true`. */
  lastRunResult: Schema.optional(WorkflowCarryOverResult),
  /** Per-loop 1-based round counters so nested loops reset independently of outer loops. */
  loopRounds: Schema.optional(Schema.Record(Schema.String, NonNegativeInt)),
  /** Loop ids that exhausted their `maxRounds` without meeting `until`. */
  exhaustedLoops: Schema.optional(Schema.Array(WorkflowSlug)),
  /** Set when this run is the child of a workflow step in another run. */
  parent: Schema.optional(
    Schema.Struct({ runId: TrimmedNonEmptyString, stepId: WorkflowSlug }).annotate({
      description: "The parent run and the workflow step that started this child run.",
    }),
  ),
  /** Skill text is pinned by hash when the run starts. */
  skills: Schema.Array(WorkflowPinnedSkill),
  /** What pre-flight knew about resources when the run started; historical, not live. */
  preflight: Schema.optional(WorkflowReadinessSnapshot),
  /**
   * The workflow's subagent models resolved when the run started. Historical, like preflight: a
   * later sign-in or uninstall does not rewrite what this run used.
   */
  subagents: Schema.optional(WorkflowSubagentsSnapshot),
  /** A digest of the pinned definition, so a changed draft is recognizably different. */
  definitionRevision: Schema.optional(TrimmedNonEmptyString),
  /** The last wakeup queued for the driving thread, and how far it got. */
  driverWakeup: Schema.optional(WorkflowDriverWakeup),
  steps: Schema.Array(WorkflowStepRun),
  error: Schema.optional(Schema.String),
});
export type WorkflowRun = typeof WorkflowRun.Type;

/** Who must act on a run: the user, or the driving agent. */
export const WorkflowRunAction = Schema.Struct({
  kind: Schema.Literals(["approval", "resume", "repair", "validation", "resource"]),
  audience: Schema.Literals(["user", "driver"]),
  stepId: Schema.optional(WorkflowSlug),
  /** One bounded sentence the driver can act on or relay. */
  message: Schema.String,
});
export type WorkflowRunAction = typeof WorkflowRunAction.Type;

/** One resource card's state as the run knew it. Absent evidence stays unknown, never green. */
export const WorkflowResourceObservation = Schema.Struct({
  stepId: WorkflowSlug,
  attachmentId: WorkflowSlug,
  kind: WorkflowAttachmentKind,
  label: Schema.optional(TrimmedNonEmptyString),
  status: WorkflowReadinessStatus,
  message: Schema.String,
  stale: Schema.optional(Schema.Boolean),
});
export type WorkflowResourceObservation = typeof WorkflowResourceObservation.Type;

/** A compact view of one definition card and its run state, for the driver's status context. */
export const WorkflowStepCardSummary = Schema.Struct({
  stepId: WorkflowSlug,
  title: TrimmedNonEmptyString,
  kind: Schema.Literals(["skill", "workflow"]),
  status: WorkflowStepStatus,
  attempts: NonNegativeInt,
  round: Schema.optional(NonNegativeInt),
  maxRounds: Schema.optional(NonNegativeInt),
  loopExhausted: Schema.optional(Schema.Boolean),
  gate: Schema.Boolean,
  /** Human-readable check tests; a nested workflow has none in this phase. */
  checks: Schema.Array(Schema.String),
  resources: Schema.Array(WorkflowResourceObservation),
  error: Schema.optional(Schema.String),
  resumeAt: Schema.optional(IsoDateTime),
  waitingFor: Schema.optional(Schema.Literals(["approval", "resume", "timer"])),
});
export type WorkflowStepCardSummary = typeof WorkflowStepCardSummary.Type;

/**
 * What the driving agent needs to know about a run: identity, executable ready work, typed
 * reasons, and every supported card type. Notes and resources are context; they never become
 * ready work, and a check or gate is never an agent task.
 */
export const WorkflowRunContext = Schema.Struct({
  definitionVersion: Schema.Literals([1, 2, 3]),
  definitionRevision: TrimmedNonEmptyString,
  driverThreadId: ThreadId,
  status: WorkflowRunStatus,
  /** Executable steps only: never notes, checks, gates or resource cards. */
  ready: Schema.Array(
    Schema.Struct({
      stepId: WorkflowSlug,
      title: TrimmedNonEmptyString,
      skill: TrimmedNonEmptyString,
      runAs: Schema.Literals(["subagent", "self", "prefer-subagent", "agent-decides"]),
    }),
  ),
  /** Decisions only the user can make: approvals and resumes. */
  needsUser: Schema.Array(WorkflowRunAction),
  /** Typed repairs, validation and resource problems, plus the user decisions above. */
  actions: Schema.Array(WorkflowRunAction),
  /** Everything the driver can do now, in short actionable sentences. */
  next: Schema.Array(Schema.String),
  /** The subagent models this run resolved at start; absent when the workflow named none. */
  subagents: Schema.optional(WorkflowSubagentsSnapshot),
  /** Workflow context, clipped; never executable instructions. */
  notes: Schema.Array(WorkflowNote),
  steps: Schema.Array(WorkflowStepCardSummary),
});
export type WorkflowRunContext = typeof WorkflowRunContext.Type;

/** Where a skill lives: in the project, or in the user's home and shared by every project. */
export const WorkflowSkillScope = Schema.Literals(["project", "global"]);
export type WorkflowSkillScope = typeof WorkflowSkillScope.Type;

export const WorkflowSkillInfo = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  /** Absolute path of the SKILL.md. */
  path: TrimmedNonEmptyString,
  scope: WorkflowSkillScope,
  /** From the `requires:` frontmatter: an OS (macos, linux, windows) or commands on PATH. */
  requires: Schema.Array(TrimmedNonEmptyString),
  /** Pinned on this server; pins are stored apart from workflow files. */
  pinned: Schema.optional(Schema.Boolean),
});
export type WorkflowSkillInfo = typeof WorkflowSkillInfo.Type;

/** Why a workflow can't run yet. A null stepId is about the whole workflow. */
export const WorkflowBlocker = Schema.Struct({
  stepId: Schema.NullOr(WorkflowSlug),
  kind: Schema.Literals(["invalid", "missing-skill", "missing-workflow", "requirement"]),
  message: Schema.String,
});
export type WorkflowBlocker = typeof WorkflowBlocker.Type;

/** A saved workflow as the canvas shows it, including ones that don't parse. */
export const WorkflowListing = Schema.Struct({
  pinned: Schema.optional(Schema.Boolean),
  projectId: ProjectId,
  workflow: WorkflowSlug,
  definition: Schema.NullOr(WorkflowDefinition),
  /**
   * True when `definition.origin` is set: T3 saved it automatically, so it is grouped under "From
   * threads" until the user keeps it. Derived from the definition, never stored beside it.
   */
  scratch: Schema.Boolean,
  /** Why the file doesn't parse or validate. */
  problem: Schema.NullOr(Schema.String),
  /** Skills the steps name that aren't installed. */
  missingSkills: Schema.Array(TrimmedNonEmptyString),
  /** The installed skills the steps name, as they resolve from the project root. */
  skills: Schema.Array(WorkflowSkillInfo),
  /** Pre-flight: everything that stops a run from starting on this server. Empty means ready. */
  blockers: Schema.Array(WorkflowBlocker),
  /** Cached resource observations; probes run only on explicit readiness or at Run. */
  readiness: Schema.optional(WorkflowReadinessSnapshot),
  updatedAt: IsoDateTime,
  /** The thread whose agent last changed it through the workflow tools; the canvas opens there. */
  editedByThreadId: Schema.NullOr(ThreadId),
});
export type WorkflowListing = typeof WorkflowListing.Type;

export const WorkflowsSnapshot = Schema.Struct({
  workflows: Schema.Array(WorkflowListing),
  runs: Schema.Array(WorkflowRun),
});
export type WorkflowsSnapshot = typeof WorkflowsSnapshot.Type;

// fork(workflows): allow one subscription for the whole environment.
export const WorkflowListRunsInput = Schema.Struct({ projectId: Schema.optional(ProjectId) });
export const WorkflowStopInput = Schema.Struct({ runId: TrimmedNonEmptyString });
export const WorkflowStepActionInput = Schema.Struct({
  runId: TrimmedNonEmptyString,
  stepId: WorkflowSlug,
});
export class WorkflowRpcError extends Schema.TaggedError<WorkflowRpcError>()("WorkflowRpcError", {
  cause: Schema.Defect(),
  /** A plain-words reason the canvas can show, such as a pre-flight blocker. */
  reason: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return this.reason ?? "The workflow operation failed.";
  }
}

const EditTarget = { projectId: ProjectId, workflow: WorkflowSlug };
/** Where a step goes: after the named step, or first when null. */
const StepPosition = Schema.NullOr(WorkflowSlug);

/**
 * Every change the canvas can make. Edits are small on purpose, so the user and the thread's
 * agent can change the same workflow at once without overwriting each other.
 */
export const WorkflowEdit = Schema.Union([
  Schema.TaggedStruct("create", {
    ...EditTarget,
    name: TrimmedNonEmptyString,
    brief: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("delete", EditTarget),
  Schema.TaggedStruct("meta", {
    credentialApprovals: Schema.optional(WorkflowCredentialApprovals),
    ...EditTarget,
    name: Schema.optional(TrimmedNonEmptyString),
    brief: Schema.optional(Schema.NullOr(Schema.String)),
    /**
     * Legacy: still accepted, and means a one-item `subagentModels`. `null` clears the list; the
     * server owns that mapping.
     */
    model: Schema.optional(Schema.NullOr(ModelSelection)),
    /** Replaces the whole subagent model list; `null` clears it, so the agent decides. */
    subagentModels: Schema.optional(Schema.NullOr(WorkflowSubagentModels)),
    /** How the driving agent carries out steps. Version 1 clients still send `delegation`. */
    execution: Schema.optional(Schema.NullOr(WorkflowDelegation)),
    /** Legacy name for execution; setting it is the same as setting execution. */
    delegation: Schema.optional(Schema.NullOr(WorkflowDelegation)),
  }),
  Schema.TaggedStruct("tagsSet", { ...EditTarget, tags: WorkflowTags }),
  Schema.TaggedStruct("workflowPinSet", { ...EditTarget, pinned: Schema.Boolean }),
  /** Replaces the workflow's whole input list; an empty list clears it. */
  Schema.TaggedStruct("inputsSet", {
    ...EditTarget,
    inputs: Schema.Array(WorkflowInput).check(Schema.isMaxLength(MAX_WORKFLOW_INPUTS)),
  }),
  /** Saved canvas positions. Positions merge by key unless `reset` clears the old set first. */
  Schema.TaggedStruct("layoutSet", {
    ...EditTarget,
    positions: WorkflowLayout,
    reset: Schema.optional(Schema.Boolean),
  }),
  /** Adds a note, or replaces the note with this id. Notes never execute. */
  Schema.TaggedStruct("notePut", {
    ...EditTarget,
    note: WorkflowNote,
  }),
  Schema.TaggedStruct("noteRemove", {
    ...EditTarget,
    noteId: WorkflowSlug,
  }),
  /**
   * Creates a workflow in one go, such as one saved from a thread's work. Listed skills are
   * written to the project first; one that already exists there is left as it is.
   */
  Schema.TaggedStruct("import", {
    ...EditTarget,
    definition: WorkflowDefinition,
    skills: Schema.Array(
      Schema.Struct({
        name: WorkflowSlug,
        content: Schema.String.check(Schema.isMaxLength(200_000)),
      }),
    ).check(Schema.isMaxLength(50)),
  }),
  Schema.TaggedStruct("stepPut", {
    ...EditTarget,
    step: WorkflowStep,
    after: Schema.optional(StepPosition),
  }),
  Schema.TaggedStruct("stepMove", { ...EditTarget, stepId: WorkflowSlug, after: StepPosition }),
  Schema.TaggedStruct("stepRemove", { ...EditTarget, stepId: WorkflowSlug }),
  /** project: .agents/skills/<name>/SKILL.md. installed: wherever the skill resolves now. */
  Schema.TaggedStruct("skillWrite", {
    projectId: ProjectId,
    name: WorkflowSlug,
    content: Schema.String.check(Schema.isMaxLength(200_000)),
    target: Schema.Literals(["project", "installed"]),
  }),
  /** Copies a global skill's whole folder into .agents/skills/<name>, which then wins. */
  Schema.TaggedStruct("skillCopyToProject", { projectId: ProjectId, name: WorkflowSlug }),
  /**
   * Pins or unpins a skill for this server, by name. Pins live beside the server's workflow
   * preferences, never in a workflow file, and match a skill of that name in any project.
   */
  Schema.TaggedStruct("skillPinSet", {
    name: TrimmedNonEmptyString,
    pinned: Schema.Boolean,
  }),
  /** This server's workflow preferences; a field replaces only what it names. */
  Schema.TaggedStruct("preferencesSet", {
    pinnedWorkflows: Schema.optional(Schema.Array(WorkflowPin)),
    showBuiltinWorkflows: Schema.optional(Schema.Boolean),
    hiddenBuiltins: Schema.optional(Schema.Array(WorkflowSlug)),
    maxSubagentModels: Schema.optional(WorkflowSubagentModelCap),
    workflowFirstForNewThreads: Schema.optional(Schema.Boolean),
  }),
  Schema.TaggedStruct("workflowFirstSet", { threadId: ThreadId, enabled: Schema.Boolean }), // fork(workflow-first)
  Schema.TaggedStruct("runStart", {
    ...EditTarget,
    driverThreadId: ThreadId,
    inputs: Schema.optional(
      Schema.Record(Schema.String, Schema.String).annotate({
        description: "Values for the workflow's inputs, keyed by input id.",
      }),
    ),
  }),
  /** Starts a new run from this step with fresh skills; earlier results are copied over. */
  Schema.TaggedStruct("stepRerun", {
    runId: TrimmedNonEmptyString,
    stepId: WorkflowSlug,
    driverThreadId: Schema.optional(ThreadId),
  }),
  Schema.TaggedStruct("stepChecksRun", { runId: TrimmedNonEmptyString, stepId: WorkflowSlug }),
  Schema.TaggedStruct("stepSkip", { runId: TrimmedNonEmptyString, stepId: WorkflowSlug }),
  /** Schedules run through upstream scheduled tasks whose prompt names this workflow. */
  Schema.TaggedStruct("scheduleAdd", {
    id: Schema.optional(ScheduledTaskId),
    knobs: Schema.optional(WorkflowScheduleKnobs),
    ...EditTarget,
    driverThreadId: ThreadId,
    inputs: Schema.optional(
      Schema.Record(Schema.String, Schema.String).annotate({
        description: "Values for the workflow's inputs, keyed by input id.",
      }),
    ),
    schedule: ScheduledTaskUpsertSchedule,
  }),
  Schema.TaggedStruct("scheduleRemove", { ...EditTarget, id: ScheduledTaskId }),
  Schema.TaggedStruct("scheduleSetEnabled", {
    ...EditTarget,
    id: ScheduledTaskId,
    enabled: Schema.Boolean,
  }),
  /** Reloads saved workflow definitions from disk and retries any missing or failed output previews. */
  Schema.TaggedStruct("refresh", {
    projectId: ProjectId,
    workflow: Schema.optional(WorkflowSlug),
    runId: Schema.optional(TrimmedNonEmptyString),
  }),
  /**
   * Explicitly refreshes readiness for some or all steps' resources. This contract only defines
   * the operation; the probe runner is wired in a later milestone, so nothing may treat this tag
   * as an availability claim.
   */
  Schema.TaggedStruct("probe", {
    projectId: ProjectId,
    workflow: WorkflowSlug,
    stepIds: Schema.optional(Schema.Array(WorkflowSlug)),
    /** Optional visible thread context for probing its server-side workspace and effective model. */
    contextThreadId: Schema.optional(ThreadId),
  }),
  /**
   * Explicitly asks the step's effective provider for its MCP connections. Uses the live session
   * when one exists; otherwise reads the selected instance's own configuration for server names
   * only. Not a write: it never invokes a tool, signs in or changes provider configuration.
   */
  Schema.TaggedStruct("mcpInventoryRefresh", {
    projectId: ProjectId,
    workflow: WorkflowSlug,
    /** Only this step's effective model. Absent uses the workflow's or the context thread's. */
    stepId: Schema.optional(WorkflowSlug),
    contextThreadId: Schema.optional(ThreadId),
  }),
  /**
   * Promotes a scratch workflow the user kept: clears `definition.origin` and nothing else, so it
   * stops being grouped under "From threads". Idempotent, and the only edit that clears an origin;
   * it reuses the workflowsEdit permission rather than adding one.
   */
  Schema.TaggedStruct("keep", EditTarget),
  Schema.TaggedStruct("triggerSet", {
    ...EditTarget,
    afterWorkflow: WorkflowSlug,
    when: Schema.NullOr(Schema.Literals(["succeeded", "finished"])),
    enabled: Schema.optional(Schema.Boolean),
  }),
  Schema.TaggedStruct("scheduleTest", {
    ...EditTarget,
    id: ScheduledTaskId,
    body: Schema.String.check(Schema.isMaxLength(65536)),
  }),
  Schema.TaggedStruct("loopPut", {
    ...EditTarget,
    loop: WorkflowLoop,
  }),
  Schema.TaggedStruct("loopRemove", {
    ...EditTarget,
    loopId: WorkflowSlug,
  }),
]);
export type WorkflowEdit = typeof WorkflowEdit.Type;

/** State reaches clients through the workflows stream, so an edit only says what it made. */
export const WorkflowEditResult = Schema.Struct({
  webhookOutcome: Schema.optional(Schema.String),
  runId: Schema.optional(TrimmedNonEmptyString),
  path: Schema.optional(Schema.String),
  /** The scheduled task a scheduleAdd made. */
  taskId: Schema.optional(ScheduledTaskId),
  /** Observations a probe produced; absent for other edits. */
  readiness: Schema.optional(WorkflowReadinessSnapshot),
  /** A refreshed MCP inventory; absent for other edits. */
  mcpInventory: Schema.optional(WorkflowMcpInventorySnapshot),
});
export type WorkflowEditResult = typeof WorkflowEditResult.Type;

const UpdateTarget = { workflow: WorkflowSlug };

/**
 * The draft mutations the agent's workflow_update tool accepts. It mirrors the canvas's edit
 * tags and calls the same service methods; steps, gates, checks and attachments stay on
 * workflow_step_put.
 */
export const WorkflowUpdate = Schema.Union([
  Schema.TaggedStruct("meta", {
    credentialApprovals: Schema.optional(WorkflowCredentialApprovals),
    ...UpdateTarget,
    name: Schema.optional(TrimmedNonEmptyString),
    brief: Schema.optional(Schema.NullOr(Schema.String)),
    model: Schema.optional(Schema.NullOr(ModelSelection)),
    execution: Schema.optional(Schema.NullOr(WorkflowDelegation)),
  }),
  Schema.TaggedStruct("inputsSet", {
    ...UpdateTarget,
    inputs: Schema.Array(WorkflowInput).check(Schema.isMaxLength(MAX_WORKFLOW_INPUTS)),
  }),
  Schema.TaggedStruct("notePut", {
    ...UpdateTarget,
    note: WorkflowNote,
  }),
  Schema.TaggedStruct("noteRemove", {
    ...UpdateTarget,
    noteId: WorkflowSlug,
  }),
]);
export type WorkflowUpdate = typeof WorkflowUpdate.Type;

export const WorkflowSkillDocument = Schema.Struct({
  ...WorkflowSkillInfo.fields,
  text: Schema.String,
});
export type WorkflowSkillDocument = typeof WorkflowSkillDocument.Type;

/** A skill a draft would create in the project; `exists` means one by that name is installed. */
export const WorkflowDraftSkill = Schema.Struct({
  name: WorkflowSlug,
  content: Schema.String,
  exists: Schema.Boolean,
});
export type WorkflowDraftSkill = typeof WorkflowDraftSkill.Type;

/**
 * A workflow proposed from what a thread already did: each delegated task becomes a step whose
 * skill is written from the task's prompt. Nothing is saved until it is imported.
 */
export const WorkflowDraft = Schema.Struct({
  slug: WorkflowSlug,
  definition: WorkflowDefinition,
  skills: Schema.Array(WorkflowDraftSkill),
});
export type WorkflowDraft = typeof WorkflowDraft.Type;

export const WorkflowRead = Schema.Union([
  Schema.TaggedStruct("skills", { projectId: ProjectId }),
  /** Pins and the subagent model cap, stored on the server rather than in a workflow file. */
  Schema.TaggedStruct("preferences", {}),
  Schema.TaggedStruct("workflowFirst", { threadId: ThreadId }), // fork(workflow-first)
  Schema.TaggedStruct("skill", { projectId: ProjectId, name: TrimmedNonEmptyString }),
  Schema.TaggedStruct("draftFromThread", { projectId: ProjectId, threadId: ThreadId }),
  /** This workflow's schedules, read through the upstream scheduler. */
  Schema.TaggedStruct("scheduleList", EditTarget),
  /**
   * Cheap cached MCP inventory for a step's effective provider. Never queries a provider: use
   * the `mcpInventoryRefresh` edit for live or configured discovery.
   */
  Schema.TaggedStruct("mcpInventory", {
    ...EditTarget,
    stepId: Schema.optional(WorkflowSlug),
    contextThreadId: Schema.optional(ThreadId),
  }),
]);
export type WorkflowRead = typeof WorkflowRead.Type;

export const WorkflowReadResult = Schema.Union([
  Schema.TaggedStruct("skills", { skills: Schema.Array(WorkflowSkillInfo) }),
  Schema.TaggedStruct("preferences", { preferences: WorkflowPreferences }),
  Schema.TaggedStruct("workflowFirst", { enabled: Schema.Boolean }), // fork(workflow-first)
  Schema.TaggedStruct("skill", { skill: WorkflowSkillDocument }),
  Schema.TaggedStruct("draftFromThread", { draft: WorkflowDraft }),
  Schema.TaggedStruct("scheduleList", { tasks: Schema.Array(ScheduledTask) }),
  Schema.TaggedStruct("mcpInventory", { inventory: WorkflowMcpInventorySnapshot }),
]);
export type WorkflowReadResult = typeof WorkflowReadResult.Type;

export function workflowResumeAt(wait: WorkflowWaitBefore, now: number): string {
  if (wait.kind === "delay")
    return DateTime.formatIso(DateTime.makeUnsafe(now + wait.minutes * 60_000));
  const [hour, minute] = wait.timeOfDay.split(":").map(Number);
  const next = DateTime.toDateUtc(DateTime.makeUnsafe(now));
  next.setHours(hour!, minute!, 0, 0);
  for (let day = 0; day < 8; day++) {
    if (next.getTime() > now && (!wait.weekdays || wait.weekdays.includes(next.getDay())))
      return next.toISOString();
    next.setDate(next.getDate() + 1);
  }
  throw new Error("No eligible weekday");
}
