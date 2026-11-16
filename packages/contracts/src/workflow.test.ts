import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  ScheduledTaskId,
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  MAX_WORKFLOW_NOTES,
  MAX_WORKFLOW_STEP_ATTACHMENTS,
  WorkflowAttachment,
  WorkflowDefinition,
  WorkflowTags,
  WorkflowEdit,
  WorkflowEditResult,
  WorkflowInput,
  WorkflowInputId,
  WorkflowListing,
  WorkflowLayout,
  WorkflowNote,
  type WorkflowNestedStep,
  WorkflowPreferences,
  WorkflowRead,
  WorkflowReadinessEntry,
  WorkflowReadinessSnapshot,
  WorkflowReadResult,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowSkillInfo,
  WorkflowSkillStep,
  WorkflowStep,
  WorkflowStepRun,
  WorkflowUpdate,
  upgradeWorkflowDefinition,
  workflowChecksCardKey,
  workflowCredentialCardKey,
  workflowGateCardKey,
  workflowResourceCardKey,
  workflowSemanticDefinition,
  workflowReadinessSpecification,
} from "./index.ts";

const isWorkflowStepRun = Schema.is(WorkflowStepRun);
const isWorkflowInput = Schema.is(WorkflowInput);
const isWorkflowStep = Schema.is(WorkflowStep);
const isWorkflowDefinition = Schema.is(WorkflowDefinition);
const isWorkflowNote = Schema.is(WorkflowNote);
const isWorkflowAttachment = Schema.is(WorkflowAttachment);
const isWorkflowRun = Schema.is(WorkflowRun);
const isWorkflowPreferences = Schema.is(WorkflowPreferences);
const isWorkflowRunContext = Schema.is(WorkflowRunContext);
const isWorkflowInputId = Schema.is(WorkflowInputId);
const isWorkflowLayout = Schema.is(WorkflowLayout);
const isWorkflowReadinessEntry = Schema.is(WorkflowReadinessEntry);
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];
const decodeOption = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownOption(Schema.toCodecJson(schema) as never);
const decodeOk =
  <S extends Schema.Top>(schema: S) =>
  (value: unknown) => {
    const option = decodeOption(schema)(value);
    if (option._tag === "None") throw new Error("expected decode to succeed");
    return option.value as S["Type"];
  };
const v1 = {
  version: 1 as const,
  name: "Launch site",
  brief: "A site for Kimchi Red.",
  delegation: "prefer-subagents" as const,
  steps: [{ id: "build", skill: "frontend-design" }],
};
const v2 = {
  version: 2 as const,
  name: "ASO refresh",
  inputs: [{ id: "appName", label: "App name", kind: "text", required: true }],
  trigger: "schedule",
  execution: "always-subagents",
  steps: [{ id: "keywords", skill: "aso-research" }],
};
const v3 = {
  version: 3 as const,
  name: "Launch site",
  brief: "A site for Kimchi Red.",
  notes: [{ id: "remember", text: "Keep the copy short.", x: 12, y: 8 }],
  steps: [
    {
      id: "build",
      skill: "frontend-design",
      checks: [{ kind: "file" as const, path: "out/index.html" }],
      attachments: [
        { id: "node", kind: "requirement" as const, requirement: "node", minVersion: "22" },
      ],
    },
    {
      id: "deploy",
      kind: "workflow" as const,
      workflow: "deploy-site",
      gate: true,
      attachments: [
        {
          id: "vercel",
          kind: "service-login" as const,
          service: "vercel",
          command: "vercel whoami",
        },
      ],
    },
  ],
};

describe("WorkflowInput", () => {
  it("keeps bounded defaults in existing definition versions", () => {
    const input = {
      id: "site",
      label: "Site",
      kind: "url",
      required: true,
      defaultValue: "https://example.test",
    };
    expect(decode(WorkflowInput)(input)).toEqual(input);
    for (const version of [1, 2, 3]) {
      expect(decode(WorkflowDefinition)({ ...v3, version, inputs: [input] }).inputs).toEqual([
        input,
      ]);
    }
    expect(isWorkflowInput({ ...input, kind: "multiline", defaultValue: "x".repeat(4_000) })).toBe(
      true,
    );
    expect(isWorkflowInput({ ...input, kind: "text", defaultValue: "x".repeat(4_001) })).toBe(
      false,
    );
  });

  it("rejects invalid URL defaults while preserving optional defaults", () => {
    const input = { id: "site", label: "Site", kind: "url" };
    expect(isWorkflowInput(input)).toBe(true);
    for (const defaultValue of ["", "example.test", "ftp://example.test", "file:///tmp/site"]) {
      expect(() => decode(WorkflowInput)({ ...input, defaultValue })).toThrow("defaultValue");
    }
    expect(isWorkflowInput({ ...input, defaultValue: "http://localhost:3000" })).toBe(true);
    expect(decode(WorkflowInput)({ ...input, kind: "text", defaultValue: "" }).defaultValue).toBe(
      "",
    );
  });

  it("stays additive: definitions saved without defaults decode unchanged", () => {
    expect(decode(WorkflowDefinition)(v2)).toEqual(v2);
    expect(decode(WorkflowDefinition)(v3)).toEqual(v3);
  });
});

describe("WorkflowStep", () => {
  it("decodes saved skill steps without a kind and explicit skill kinds", () => {
    expect(decode(WorkflowStep)({ id: "build", skill: "frontend-design" })).toEqual({
      id: "build",
      skill: "frontend-design",
    });
    expect(decode(WorkflowSkillStep)({ id: "build", kind: "skill", skill: "s" })).toEqual({
      id: "build",
      kind: "skill",
      skill: "s",
    });
  });

  it("decodes nested workflow steps with their input mapping", () => {
    const step = decodeOk(WorkflowStep)({
      id: "screenshots",
      kind: "workflow",
      workflow: "screenshots",
      inputs: { appName: "{{input.appName}}" },
      readsFrom: [],
      gate: true,
    }) as WorkflowNestedStep;
    expect(step.workflow).toBe("screenshots");
    expect(step.inputs).toEqual({ appName: "{{input.appName}}" });
    expect(step.gate).toBe(true);
  });

  it("rejects a step that is neither a skill nor a workflow", () => {
    expect(isWorkflowStep({ id: "nothing" })).toBe(false);
    expect(isWorkflowStep({ id: "w", kind: "workflow" })).toBe(false);
    // A kind: "workflow" step wins; a stray skill field is stripped.
    expect(isWorkflowStep({ id: "s", skill: "x", kind: "workflow", workflow: "w" })).toBe(true);
  });
});

describe("WorkflowDefinition", () => {
  it("decodes version 1, 2 and 3 files", () => {
    expect(decode(WorkflowDefinition)(v1)).toEqual(v1);
    expect(decode(WorkflowDefinition)(v2)).toEqual(v2);
    expect(decode(WorkflowDefinition)(v3)).toEqual(v3);
    expect(isWorkflowDefinition({ ...v2, version: 4 })).toBe(false);
  });

  it("decodes notes, attachments and a budget for each", () => {
    const note = decode(WorkflowNote)({
      id: "remember",
      text: "Use the brand font.",
      anchorStepId: "build",
      x: 10,
      y: -4,
    });
    expect(note).toEqual({
      id: "remember",
      text: "Use the brand font.",
      anchorStepId: "build",
      x: 10,
      y: -4,
    });
    expect(isWorkflowNote({ id: "n", text: "x", x: Number.POSITIVE_INFINITY })).toBe(false);
    expect(
      isWorkflowAttachment({
        id: "vercel",
        kind: "service-login",
        service: "vercel",
        signInCommand: "vercel login",
      }),
    ).toBe(true);
    expect(isWorkflowAttachment({ id: "server", kind: "mcp-connection", server: "linear" })).toBe(
      true,
    );
    expect(isWorkflowAttachment({ id: "node", kind: "requirement", requirement: "node" })).toBe(
      true,
    );
    expect(isWorkflowAttachment({ id: "bad", kind: "unknown" })).toBe(false);

    const tooManyNotes = Array.from({ length: MAX_WORKFLOW_NOTES + 1 }, (_, index) => ({
      id: `note-${index}`,
      text: "x",
    }));
    expect(isWorkflowDefinition({ ...v3, notes: tooManyNotes })).toBe(false);
    const tooManyAttachments = Array.from(
      { length: MAX_WORKFLOW_STEP_ATTACHMENTS + 1 },
      (_, index) => ({ id: `item-${index}`, kind: "requirement", requirement: "node" }),
    );
    expect(
      isWorkflowDefinition({
        ...v3,
        steps: [{ id: "build", skill: "frontend-design", attachments: tooManyAttachments }],
      }),
    ).toBe(false);
  });

  it("keeps a note out of the step graph", () => {
    const definition = decodeOk(WorkflowDefinition)(v3);
    expect(definition.notes).toHaveLength(1);
    expect(definition.steps.map((step) => step.id)).toEqual(["build", "deploy"]);
    expect(definition.steps[0]?.attachments?.[0]?.kind).toBe("requirement");
  });

  it("decodes loops, loop edits, and step round history within bounds", () => {
    const loop = {
      id: "review-to-draft",
      from: "deploy",
      to: "build",
      maxRounds: 3,
      until: { kind: "condition" as const, text: "score >= 8" },
      feedback: false,
    };
    const withLoops = decodeOk(WorkflowDefinition)({ ...v3, loops: [loop] });
    expect(withLoops.loops).toEqual([loop]);
    expect(workflowSemanticDefinition(withLoops).loops).toEqual([loop]);
    expect(
      isWorkflowDefinition({
        ...v3,
        loops: [{ ...loop, maxRounds: 21 }],
      }),
    ).toBe(false);
    expect(
      decodeOk(WorkflowEdit)({
        _tag: "loopPut",
        projectId: "proj-1",
        workflow: "launch-site",
        loop,
      })._tag,
    ).toBe("loopPut");
    expect(
      decodeOk(WorkflowEdit)({
        _tag: "loopRemove",
        projectId: "proj-1",
        workflow: "launch-site",
        loopId: loop.id,
      })._tag,
    ).toBe("loopRemove");
    expect(
      isWorkflowStepRun({
        stepId: "build",
        status: "running",
        threadId: null,
        attempts: 1,
        round: 2,
        loopExhausted: true,
        previousRounds: [
          {
            round: 1,
            status: "done",
            attempts: 1,
            summary: "VERDICT: revise — tighten spacing",
            verdict: "revise",
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("upgradeWorkflowDefinition", () => {
  it("upgrades version 1, turning delegation into execution", () => {
    expect(upgradeWorkflowDefinition(decode(WorkflowDefinition)(v1))).toEqual({
      version: 3,
      name: "Launch site",
      brief: "A site for Kimchi Red.",
      execution: "prefer-subagents",
      steps: [{ id: "build", skill: "frontend-design" }],
    });
  });

  it("upgrades version 2 and keeps its legacy fields", () => {
    const upgraded = upgradeWorkflowDefinition(decode(WorkflowDefinition)(v2));
    expect(upgraded).toEqual({ ...v2, version: 3 });
    expect(upgraded.inputs).toEqual(v2.inputs);
    expect(upgraded.trigger).toBe("schedule");
  });

  it("leaves a normal version 3 definition untouched", () => {
    const definition = decode(WorkflowDefinition)(v3);
    expect(upgradeWorkflowDefinition(definition)).toBe(definition);
  });

  it("drops a stray delegation and lets execution win when both are set", () => {
    const upgraded = upgradeWorkflowDefinition(
      decode(WorkflowDefinition)({ ...v1, version: 3, execution: "auto" }),
    );
    expect(upgraded.version).toBe(3);
    expect(upgraded.execution).toBe("auto");
    expect("delegation" in upgraded).toBe(false);
  });

  it("folds a legacy model into one subagent model", () => {
    const upgraded = upgradeWorkflowDefinition(
      decode(WorkflowDefinition)({ ...v2, model: { instanceId: "codex", model: "gpt-6-luna" } }),
    );
    expect(upgraded.subagentModels).toEqual([{ instanceId: "codex", model: "gpt-6-luna" }]);
    expect("model" in upgraded).toBe(false);
  });

  it("keeps a saved subagent list and still drops the legacy model", () => {
    const subagentModels = [{ instanceId: "codex-work", model: "gpt-6-luna" }];
    const upgraded = upgradeWorkflowDefinition(
      decode(WorkflowDefinition)({
        ...v3,
        model: { instanceId: "codex", model: "gpt-6-mini" },
        subagentModels,
      }),
    );
    expect(upgraded.subagentModels).toEqual(subagentModels);
    expect("model" in upgraded).toBe(false);
  });

  it("upgrades a version 3 file that still carries the legacy model", () => {
    const definition = decode(WorkflowDefinition)({
      ...v3,
      model: { instanceId: "codex", model: "gpt-6-luna" },
    });
    const upgraded = upgradeWorkflowDefinition(definition);
    expect(upgraded).not.toBe(definition);
    expect(upgraded.subagentModels).toEqual([{ instanceId: "codex", model: "gpt-6-luna" }]);
    expect("model" in upgraded).toBe(false);
  });

  it("adds nothing when neither a subagent list nor a model is saved", () => {
    const upgraded = upgradeWorkflowDefinition(decode(WorkflowDefinition)(v2));
    expect("subagentModels" in upgraded).toBe(false);
    expect("model" in upgraded).toBe(false);
  });

  it("stays upgradeable in any order and idempotent", () => {
    const once = upgradeWorkflowDefinition(
      decode(WorkflowDefinition)({
        ...v1,
        model: { instanceId: "codex", model: "gpt-6-luna" },
      }),
    );
    expect(once.execution).toBe("prefer-subagents");
    expect(once.subagentModels).toEqual([{ instanceId: "codex", model: "gpt-6-luna" }]);
    const twice = upgradeWorkflowDefinition(once);
    expect(twice).toBe(once);
    expect(upgradeWorkflowDefinition(upgradeWorkflowDefinition(twice))).toBe(twice);
  });
});

describe("workflow subagent models", () => {
  const subagent = (index: number) => ({
    instanceId: `codex-${index}`,
    model: "gpt-6-luna",
  });

  it("bounds a saved list at the schema ceiling", () => {
    const ceiling = Array.from({ length: 16 }, (_, index) => subagent(index));
    expect(decode(WorkflowDefinition)({ ...v3, subagentModels: ceiling }).subagentModels).toEqual(
      ceiling,
    );
    expect(() =>
      decode(WorkflowDefinition)({ ...v3, subagentModels: [...ceiling, subagent(16)] }),
    ).toThrow();
    expect(() =>
      decode(WorkflowEdit)({
        _tag: "meta",
        projectId: ProjectId.make("project-1"),
        workflow: "launch-site",
        subagentModels: [...ceiling, subagent(16)],
      }),
    ).toThrow();
  });

  it("accepts a meta list and its legacy one-item model field", () => {
    const target = { projectId: ProjectId.make("project-1"), workflow: "launch-site" };
    expect(
      decode(WorkflowEdit)({
        _tag: "meta",
        ...target,
        subagentModels: [{ driver: "codex", instanceId: "codex", model: "gpt-6-luna" }],
      }),
    ).toMatchObject({
      subagentModels: [{ driver: "codex", instanceId: "codex", model: "gpt-6-luna" }],
    });
    expect(decode(WorkflowEdit)({ _tag: "meta", ...target, subagentModels: null })).toMatchObject({
      subagentModels: null,
    });
    expect(decode(WorkflowEdit)({ _tag: "meta", ...target, model: null })).toMatchObject({
      model: null,
    });
  });

  it("pins a resolved snapshot on a run and carries it to the driver's context", () => {
    const subagents = {
      usable: [
        {
          driver: "codex",
          instanceId: "codex",
          model: "gpt-6-luna",
          label: "GPT-6 Luna",
        },
      ],
      missing: [
        {
          hint: { instanceId: "claude", model: "claude-haiku-5-5" },
          reason: "signed-out",
        },
      ],
      fallback: false,
    };
    const decoded = decode(WorkflowRun)({
      id: "wf-1",
      projectId: ProjectId.make("project-1"),
      workflow: "launch-site",
      driverThreadId: ThreadId.make("driver"),
      status: "running",
      startedAt: "2026-10-23T00:00:00.000Z",
      definition: v3,
      skills: [],
      subagents,
      steps: [{ stepId: "build", status: "ready", threadId: null, attempts: 0 }],
    });
    expect(decoded.subagents).toEqual(subagents);
    expect(
      decode(WorkflowRunContext)({
        definitionVersion: 3,
        definitionRevision: "sha256:definition",
        driverThreadId: ThreadId.make("driver"),
        status: "running",
        ready: [],
        needsUser: [],
        actions: [],
        next: [],
        notes: [],
        subagents,
        steps: [],
      }).subagents,
    ).toEqual(subagents);
    expect(
      isWorkflowRun({
        id: "wf-1",
        projectId: "project-1",
        workflow: "launch-site",
        driverThreadId: "driver",
        status: "running",
        startedAt: "2026-10-23T00:00:00.000Z",
        definition: v3,
        skills: [],
        subagents: { ...subagents, missing: [{ ...subagents.missing[0], reason: "broken" }] },
        steps: [],
      }),
    ).toBe(false);
  });
});

describe("workflow preferences", () => {
  it("bounds the subagent cap and keeps pins as names", () => {
    expect(
      decode(WorkflowPreferences)({ pinnedSkills: ["frontend-design"], maxSubagentModels: 4 }),
    ).toEqual({
      pinnedSkills: ["frontend-design"],
      maxSubagentModels: 4,
      pinnedWorkflows: [],
      showBuiltinWorkflows: true,
      hiddenBuiltins: [],
      workflowFirstForNewThreads: false,
    });
    expect(
      isWorkflowPreferences({
        pinnedSkills: [],
        maxSubagentModels: 16,
        pinnedWorkflows: [],
        showBuiltinWorkflows: true,
        hiddenBuiltins: [],
        workflowFirstForNewThreads: false,
      }),
    ).toBe(true);
    for (const maxSubagentModels of [0, 17, 2.5]) {
      expect(
        isWorkflowPreferences({
          pinnedSkills: [],
          maxSubagentModels,
          pinnedWorkflows: [],
          showBuiltinWorkflows: true,
          hiddenBuiltins: [],
          workflowFirstForNewThreads: false,
        }),
      ).toBe(false);
    }
    expect(isWorkflowPreferences({ pinnedSkills: [] })).toBe(false);
  });

  it("reads preferences and sets pins through the existing edit and read tags", () => {
    expect(decode(WorkflowRead)({ _tag: "preferences" })).toEqual({ _tag: "preferences" });
    expect(
      decode(WorkflowReadResult)({
        _tag: "preferences",
        preferences: {
          pinnedSkills: ["frontend-design"],
          maxSubagentModels: 4,
          pinnedWorkflows: [],
          showBuiltinWorkflows: true,
          hiddenBuiltins: [],
          workflowFirstForNewThreads: false,
        },
      }),
    ).toEqual({
      _tag: "preferences",
      preferences: {
        pinnedSkills: ["frontend-design"],
        maxSubagentModels: 4,
        pinnedWorkflows: [],
        showBuiltinWorkflows: true,
        hiddenBuiltins: [],
        workflowFirstForNewThreads: false,
      },
    });
    expect(
      decode(WorkflowEdit)({ _tag: "skillPinSet", name: "frontend-design", pinned: true }),
    ).toEqual({ _tag: "skillPinSet", name: "frontend-design", pinned: true });
    expect(decode(WorkflowEdit)({ _tag: "preferencesSet", maxSubagentModels: 8 })).toEqual({
      _tag: "preferencesSet",
      maxSubagentModels: 8,
    });
    expect(() => decode(WorkflowEdit)({ _tag: "preferencesSet", maxSubagentModels: 0 })).toThrow();
    expect(
      decode(WorkflowSkillInfo)({
        name: "frontend-design",
        description: null,
        path: "/repo/.agents/skills/frontend-design/SKILL.md",
        scope: "project",
        requires: [],
        pinned: true,
      }).pinned,
    ).toBe(true);
  });
});

describe("WorkflowRun", () => {
  const run = (definition: WorkflowDefinition, extra: Record<string, unknown> = {}) => ({
    id: "wf-1",
    projectId: ProjectId.make("project-1"),
    workflow: "launch-site",
    driverThreadId: ThreadId.make("driver"),
    status: "running",
    startedAt: "2026-10-20T00:00:00.000Z",
    definition,
    skills: [],
    steps: [{ stepId: "build", status: "ready", threadId: null, attempts: 0 }],
    ...extra,
  });

  it("decodes runs saved before inputs and nesting, upgrading their definition", () => {
    const decoded = decode(WorkflowRun)(run(v1));
    expect(upgradeWorkflowDefinition(decoded.definition).execution).toBe("prefer-subagents");
    expect(decoded.inputs).toBeUndefined();
    expect(decoded.parent).toBeUndefined();
    expect(decoded.steps[0]?.childRunId).toBeUndefined();
    expect(decoded.steps[0]?.outputPreviews).toBeUndefined();
  });

  it("round-trips URL preview metadata without storing image bytes in runs", () => {
    const outputPreviews = {
      site: { status: "ready", attachmentId: "driver-123-jpg" },
      second: { status: "pending" },
      third: { status: "unavailable" },
    };
    const value = {
      stepId: "build",
      status: "done",
      threadId: null,
      attempts: 1,
      outputs: { site: "https://example.com" },
      outputPreviews,
    };
    expect(decode(WorkflowStepRun)(value)).toEqual(value);
    expect(isWorkflowStepRun({ ...value, outputPreviews: { site: { status: "ready" } } })).toBe(
      false,
    );
  });

  it("decodes run inputs, a parent link and a step's child run", () => {
    const decoded = decode(WorkflowRun)(
      run(decode(WorkflowDefinition)(v2), {
        inputs: { appName: "Kimchi" },
        parent: { runId: "wf-0", stepId: "screenshots" },
        steps: [
          {
            stepId: "screenshots",
            status: "running",
            threadId: null,
            attempts: 1,
            childRunId: "wf-2",
          },
        ],
      }),
    );
    expect(decoded.inputs).toEqual({ appName: "Kimchi" });
    expect(decoded.parent).toEqual({ runId: "wf-0", stepId: "screenshots" });
    expect(decoded.steps[0]?.childRunId).toBe("wf-2");
    expect(isWorkflowStepRun(decoded.steps[0])).toBe(true);
  });

  it("decodes old runs with their original pinned definition", () => {
    const decoded = decode(WorkflowRun)(run(v1));
    expect(decoded.definition).toEqual(v1);
    expect(decoded.preflight).toBeUndefined();
    expect(decoded.steps[0]?.checking).toBeUndefined();
  });

  it("decodes durable wakeups and a definition revision, leaving old runs without them", () => {
    const saved = decode(WorkflowRun)(run(v1));
    expect(saved.definitionRevision).toBeUndefined();
    expect(saved.driverWakeup).toBeUndefined();
    const wakeup = {
      revision: 3,
      acknowledgedRevision: 1,
      key: "sha256:state",
      message: 'Workflow wf-1: step "build" is ready.',
      queuedAt: "2026-10-21T00:00:00.000Z",
      attempts: 1,
      lastAttemptAt: "2026-10-21T00:00:01.000Z",
      lastError: "thread_offline",
    };
    const decoded = decode(WorkflowRun)(
      run(v1, { definitionRevision: "sha256:definition", driverWakeup: wakeup }),
    );
    expect(decoded.definitionRevision).toBe("sha256:definition");
    expect(decoded.driverWakeup).toEqual(wakeup);
    expect(
      isWorkflowRun(
        run(v1, {
          driverWakeup: { ...wakeup, revision: -1 },
        }),
      ),
    ).toBe(false);
  });

  it("decodes the driver's compact run context without letting cards become ready work", () => {
    const context = decode(WorkflowRunContext)({
      definitionVersion: 3,
      definitionRevision: "sha256:definition",
      driverThreadId: ThreadId.make("driver"),
      status: "waiting",
      ready: [],
      needsUser: [{ kind: "approval", audience: "user", stepId: "deploy", message: "Approve it." }],
      actions: [
        { kind: "approval", audience: "user", stepId: "deploy", message: "Approve it." },
        { kind: "repair", audience: "driver", stepId: "build", message: "Repair it." },
      ],
      next: ['Ask the user to approve "deploy".'],
      notes: [{ id: "remember", text: "Ship Friday.", anchorStepId: "deploy" }],
      steps: [
        {
          stepId: "deploy",
          title: "Deploy",
          kind: "skill",
          status: "waiting",
          attempts: 0,
          gate: true,
          checks: ["`pnpm build`"],
          resources: [
            {
              stepId: "deploy",
              attachmentId: "vercel",
              kind: "service-login",
              status: "unknown",
              message: "Not checked yet.",
            },
          ],
          waitingFor: "approval",
        },
      ],
    });
    expect(context.ready).toEqual([]);
    expect(context.needsUser[0]?.kind).toBe("approval");
    expect(context.steps[0]?.resources[0]?.status).toBe("unknown");
    expect(isWorkflowRunContext({ ...context, status: "unknown" })).toBe(false);
  });

  it("decodes a validation token and run preflight observations", () => {
    const checking = {
      stepId: "build",
      status: "running",
      threadId: null,
      attempts: 1,
      checking: { token: "attempt-2", startedAt: "2026-10-21T00:00:00.000Z" },
    };
    expect(decode(WorkflowStepRun)(checking)).toEqual(checking);
    const preflight = {
      entries: [
        {
          stepId: "build",
          attachmentId: "node",
          kind: "requirement",
          status: "available",
          message: "Node 22.1.0 is installed.",
          checkedAt: "2026-10-21T00:00:00.000Z",
          expiresAt: "2026-10-21T00:05:00.000Z",
          providerInstanceId: "codex",
          workspaceRoot: "/work/project",
          stale: false,
        },
      ],
      blocksRun: false,
      evaluatedAt: "2026-10-21T00:00:00.000Z",
    };
    const decoded = decode(WorkflowRun)(
      run(decode(WorkflowDefinition)(v3), {
        preflight,
        steps: [{ stepId: "build", status: "running", threadId: null, attempts: 1 }],
      }),
    );
    expect(decoded.preflight).toEqual(preflight);
    expect(decoded.definition.notes?.[0]?.id).toBe("remember");
  });

  it("decodes a listing with cached readiness", () => {
    const readiness = decode(WorkflowReadinessSnapshot)({
      entries: [
        {
          stepId: "build",
          attachmentId: "node",
          kind: "requirement",
          status: "unknown",
          message: "Not checked yet.",
        },
      ],
      blocksRun: false,
    });
    const listing = decode(WorkflowListing)({
      projectId: ProjectId.make("project-1"),
      workflow: "launch-site",
      definition: v3,
      scratch: false,
      problem: null,
      missingSkills: [],
      skills: [],
      blockers: [],
      readiness,
      updatedAt: "2026-10-21T00:00:00.000Z",
      editedByThreadId: null,
    });
    expect(listing.readiness?.entries[0]?.status).toBe("unknown");
    expect(listing.scratch).toBe(false);
  });

  it("flags a listing as scratch from its origin", () => {
    const listing = decode(WorkflowListing)({
      projectId: ProjectId.make("project-1"),
      workflow: "launch-site",
      definition: {
        ...v3,
        origin: { kind: "workflow-first", threadId: ThreadId.make("thread-1") },
      },
      scratch: true,
      problem: null,
      missingSkills: [],
      skills: [],
      blockers: [],
      updatedAt: "2026-10-21T00:00:00.000Z",
      editedByThreadId: null,
    });
    expect(listing.scratch).toBe(true);
    expect(listing.definition?.origin).toEqual({
      kind: "workflow-first",
      threadId: ThreadId.make("thread-1"),
    });
  });

  it("keeps readiness context optional for older snapshots", () => {
    const legacy = decode(WorkflowReadinessSnapshot)({ entries: [], blocksRun: false });
    expect(legacy.context).toBeUndefined();
    expect(
      decode(WorkflowReadinessSnapshot)({
        entries: [],
        blocksRun: false,
        context: {
          threadId: ThreadId.make("thread-1"),
          workspaceRoot: "/repo",
          model: { instanceId: "codex", model: "gpt-6-luna" },
          specification: "{}",
        },
      }).context,
    ).toEqual({
      threadId: ThreadId.make("thread-1"),
      workspaceRoot: "/repo",
      model: { instanceId: "codex", model: "gpt-6-luna" },
      specification: "{}",
    });
  });
});

describe("WorkflowEdit", () => {
  const target = { projectId: ProjectId.make("project-1"), workflow: "launch-site" };

  it("decodes inputsSet, runStart with inputs and meta execution", () => {
    const inputsSet = decode(WorkflowEdit)({
      _tag: "inputsSet",
      ...target,
      inputs: [{ id: "appName", label: "App name", kind: "text", required: true }],
    });
    if (inputsSet._tag !== "inputsSet") throw new Error("expected inputsSet");
    expect(inputsSet.inputs).toEqual([
      { id: "appName", label: "App name", kind: "text", required: true },
    ]);
    expect(isWorkflowInput(inputsSet.inputs[0])).toBe(true);
    const runStart = decode(WorkflowEdit)({
      _tag: "runStart",
      ...target,
      driverThreadId: ThreadId.make("driver"),
      inputs: { appName: "Kimchi" },
    });
    if (runStart._tag !== "runStart") throw new Error("expected runStart");
    expect(runStart.inputs).toEqual({ appName: "Kimchi" });
    const execution = decode(WorkflowEdit)({
      _tag: "meta",
      ...target,
      execution: "always-subagents",
    });
    if (execution._tag !== "meta") throw new Error("expected meta");
    expect(execution.execution).toBe("always-subagents");
    const legacy = decode(WorkflowEdit)({ _tag: "meta", ...target, delegation: null });
    if (legacy._tag !== "meta") throw new Error("expected meta");
    expect(legacy.delegation).toBe(null);
  });

  it("decodes the keep promotion as a plain workflow target", () => {
    expect(decode(WorkflowEdit)({ _tag: "keep", ...target })).toEqual({
      _tag: "keep",
      ...target,
    });
  });

  it("decodes note edits, a probe request and a readiness result", () => {
    const notePut = decode(WorkflowEdit)({
      _tag: "notePut",
      ...target,
      note: { id: "remember", text: "Keep it short.", anchorStepId: "build", x: 4, y: 9 },
    });
    if (notePut._tag !== "notePut") throw new Error("expected notePut");
    expect(notePut.note).toEqual({
      id: "remember",
      text: "Keep it short.",
      anchorStepId: "build",
      x: 4,
      y: 9,
    });
    const noteRemove = decode(WorkflowEdit)({
      _tag: "noteRemove",
      ...target,
      noteId: "remember",
    });
    expect(noteRemove).toMatchObject({ _tag: "noteRemove", noteId: "remember" });
    const probe = decode(WorkflowEdit)({
      _tag: "probe",
      ...target,
      stepIds: ["build", "deploy"],
    });
    if (probe._tag !== "probe") throw new Error("expected probe");
    expect(probe.stepIds).toEqual(["build", "deploy"]);
    const result = decode(WorkflowEditResult)({
      readiness: {
        entries: [
          {
            stepId: "build",
            attachmentId: "node",
            kind: "requirement",
            status: "missing",
            message: "Node isn't installed.",
          },
        ],
        blocksRun: true,
        evaluatedAt: "2026-10-21T00:00:00.000Z",
      },
    });
    expect(result.readiness?.blocksRun).toBe(true);
  });

  it("decodes workflow_update as one tagged draft mutation", () => {
    const update = decode(WorkflowUpdate)({
      _tag: "notePut",
      workflow: "launch-site",
      note: { id: "remember", text: "Keep it short." },
    });
    expect(update).toMatchObject({ _tag: "notePut", workflow: "launch-site" });
    const meta = decode(WorkflowUpdate)({
      _tag: "meta",
      workflow: "launch-site",
      brief: null,
      execution: "auto",
    });
    expect(meta).toMatchObject({ _tag: "meta", brief: null, execution: "auto" });
    const inputs = decode(WorkflowUpdate)({
      _tag: "inputsSet",
      workflow: "launch-site",
      inputs: [{ id: "appName", label: "App name", kind: "text" }],
    });
    expect(inputs).toMatchObject({ _tag: "inputsSet" });
    expect(
      decode(WorkflowUpdate)({
        _tag: "noteRemove",
        workflow: "launch-site",
        noteId: "remember",
      }),
    ).toMatchObject({ _tag: "noteRemove" });
  });

  it("decodes schedule edits and reads", () => {
    const scheduleAdd = decode(WorkflowEdit)({
      _tag: "scheduleAdd",
      ...target,
      driverThreadId: ThreadId.make("driver"),
      inputs: { appName: "Kimchi" },
      schedule: { type: "interval", everyMs: 60_000 },
    });
    if (scheduleAdd._tag !== "scheduleAdd") throw new Error("expected scheduleAdd");
    expect(scheduleAdd.schedule).toMatchObject({ type: "interval", everyMs: 60_000 });
    expect(scheduleAdd.inputs).toEqual({ appName: "Kimchi" });
    const scheduleRemove = decode(WorkflowEdit)({
      _tag: "scheduleRemove",
      ...target,
      id: ScheduledTaskId.make("t1"),
    });
    expect(scheduleRemove).toMatchObject({ _tag: "scheduleRemove" });
    const scheduleSetEnabled = decode(WorkflowEdit)({
      _tag: "scheduleSetEnabled",
      ...target,
      id: ScheduledTaskId.make("t1"),
      enabled: false,
    });
    expect(scheduleSetEnabled).toMatchObject({ _tag: "scheduleSetEnabled", enabled: false });
    expect(decode(WorkflowRead)({ _tag: "scheduleList", ...target })).toMatchObject({
      _tag: "scheduleList",
    });
  });
});

describe("WorkflowInputId", () => {
  it("accepts identifiers and rejects everything else", () => {
    for (const id of ["appName", "AppName3", "my_key", "a-b_c"])
      expect(isWorkflowInputId(id)).toBe(true);
    for (const id of ["1abc", "app name", "", "-x"]) expect(isWorkflowInputId(id)).toBe(false);
  });
});

describe("workflow MCP inventory contracts", () => {
  const target = { projectId: ProjectId.make("p1"), workflow: "launch" };

  it("reads an old MCP attachment without provider identity and a new one with it", () => {
    const legacy = decode(WorkflowDefinition)({
      version: 3,
      name: "Launch",
      steps: [
        {
          id: "deploy",
          skill: "deploy",
          attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }],
        },
      ],
    });
    expect(legacy.steps[0]?.attachments?.[0]).toEqual({
      id: "linear",
      kind: "mcp-connection",
      server: "linear",
    });
    const bound = decode(WorkflowDefinition)({
      version: 3,
      name: "Launch",
      steps: [
        {
          id: "deploy",
          skill: "deploy",
          attachments: [
            {
              id: "linear",
              kind: "mcp-connection",
              server: "linear",
              providerInstanceId: "codex-work",
            },
          ],
        },
      ],
    });
    expect(bound.steps[0]?.attachments?.[0]).toMatchObject({
      providerInstanceId: "codex-work",
    });
  });

  it("decodes the cached read and explicit refresh tags", () => {
    expect(decode(WorkflowRead)({ _tag: "mcpInventory", ...target })).toMatchObject({
      _tag: "mcpInventory",
    });
    expect(
      decode(WorkflowEdit)({
        _tag: "mcpInventoryRefresh",
        ...target,
        stepId: "deploy",
        contextThreadId: ThreadId.make("driver"),
      }),
    ).toMatchObject({ _tag: "mcpInventoryRefresh", stepId: "deploy" });
  });

  it("decodes an inventory snapshot with honest unknown and unavailable states", () => {
    const snapshot = decode(WorkflowEditResult)({
      mcpInventory: {
        status: "available",
        message: "Codex reported 1 MCP connection.",
        scope: {
          providerInstanceId: "codex-work",
          driverKind: "codex",
          providerLabel: "Work Codex",
          model: { instanceId: "codex-work", model: "gpt-5-codex" },
          modelScoped: false,
          workspaceRoot: "/repo",
          threadId: ThreadId.make("driver"),
          providerSessionId: "session-1",
        },
        servers: [
          {
            name: "linear",
            status: "connected",
            auth: "signed-in",
            toolsStatus: "available",
            tools: [{ name: "create_issue", title: "Create issue", readOnly: false }],
          },
          {
            name: "notebook",
            status: "unknown",
            toolsStatus: "unavailable",
            tools: [],
          },
        ],
        checkedAt: "2026-10-21T00:00:00.000Z",
        cached: false,
        stale: false,
        excludedInternal: 1,
        limitations: ["Provider configuration changes are only visible after Refresh."],
      },
    });
    expect(snapshot.mcpInventory).toMatchObject({
      status: "available",
      servers: [
        { name: "linear", status: "connected", toolsStatus: "available" },
        { name: "notebook", status: "unknown", toolsStatus: "unavailable" },
      ],
      excludedInternal: 1,
    });
  });

  it("rejects an unsupported inventory status instead of guessing", () => {
    expect(
      decodeOption(WorkflowEditResult)({
        mcpInventory: {
          status: "configured",
          message: "Configured is not proof.",
          scope: { modelScoped: false, workspaceRoot: "/repo" },
          servers: [],
          cached: false,
          stale: false,
          excludedInternal: 0,
          limitations: [],
        },
      })._tag,
    ).toBe("None");
  });
});

describe("WorkflowLayout", () => {
  it("round trips optional v3 layout metadata without moving notes or changing older files", () => {
    const layout = {
      build: { x: -12.5, y: 8 },
      [workflowChecksCardKey("build")]: { x: 40, y: 90 },
      [workflowGateCardKey("deploy")]: { x: 100, y: 200 },
      [workflowResourceCardKey("build", "node")]: { x: 300, y: -40 },
      [workflowCredentialCardKey("build", "resource-1f0f")]: { x: 500, y: 60 },
    };
    expect(decode(WorkflowLayout)(layout)).toEqual(layout);
    expect(decode(WorkflowDefinition)({ ...v3, layout })).toEqual({ ...v3, layout });
    expect(decode(WorkflowDefinition)(v1)).not.toHaveProperty("layout");
    expect(decode(WorkflowDefinition)(v2)).not.toHaveProperty("layout");
    expect(
      decode(WorkflowEdit)({
        _tag: "layoutSet",
        projectId: "p",
        workflow: "launch",
        positions: layout,
        reset: true,
      }),
    ).toEqual({
      _tag: "layoutSet",
      projectId: "p",
      workflow: "launch",
      positions: layout,
      reset: true,
    });
  });

  it("drops malformed keys from a definition instead of failing the file", () => {
    expect(
      decode(WorkflowDefinition)({
        ...v3,
        layout: {
          build: { x: 1, y: 2 },
          "gate:absent": { x: 1, y: 2 },
          "future:build": { x: 1, y: 2 },
        },
      }),
    ).toEqual({ ...v3, layout: { build: { x: 1, y: 2 }, "gate:absent": { x: 1, y: 2 } } });
  });

  it("keeps presentation-only layout out of the semantic definition", () => {
    const moved = { ...v3, layout: { build: { x: 1, y: 2 } } };
    expect(workflowSemanticDefinition(moved)).toEqual(v3);
    expect(workflowSemanticDefinition(v3)).toBe(v3);
  });

  it("bounds layout records to 600 finite coordinate pairs", () => {
    const positions = Object.fromEntries(
      Array.from({ length: 600 }, (_, i) => [`step-${i}`, { x: i, y: -i }]),
    );
    expect(decode(WorkflowLayout)(positions)).toEqual(positions);
    expect(() => decode(WorkflowLayout)({ ...positions, extra: { x: 0, y: 0 } })).toThrow();
    for (const point of [{ x: Infinity, y: 0 }, { x: 0, y: NaN }, { x: 0 }, { x: "1", y: 2 }])
      expect(isWorkflowLayout({ build: point })).toBe(false);
  });

  it("ignores unknown key formats and overlong slug segments on decode", () => {
    for (const key of [
      "Build",
      "note:build",
      "resource:build",
      "gate:build:extra",
      "credential:build",
      "a".repeat(65),
      `resource:build:${"a".repeat(65)}`,
    ])
      expect(decode(WorkflowLayout)({ [key]: { x: 0, y: 0 } })).toEqual({});
  });
});

describe("WorkflowOrigin", () => {
  const origin = { kind: "workflow-first" as const, threadId: ThreadId.make("thread-1") };

  it("round trips an additive version 3 origin and leaves old files untouched", () => {
    expect(decode(WorkflowDefinition)({ ...v3, origin })).toEqual({ ...v3, origin });
    expect(decode(WorkflowDefinition)(v3)).toEqual(v3);
    expect(decode(WorkflowDefinition)(v3)).not.toHaveProperty("origin");
    expect(decode(WorkflowDefinition)({ ...v1, origin })).toEqual({ ...v1, origin });
  });

  it("survives the version 2 upgrade where other fields are folded", () => {
    const upgraded = upgradeWorkflowDefinition(
      decode(WorkflowDefinition)({
        ...v2,
        origin,
        model: { instanceId: "codex", model: "gpt-6-luna" },
      }),
    );
    expect(upgraded.version).toBe(3);
    expect(upgraded.origin).toEqual(origin);
    expect(upgraded).not.toHaveProperty("model");
  });

  it("keeps provenance out of the semantic definition so a keep never reads as an edit", () => {
    const scratch = { ...v3, origin };
    expect(workflowSemanticDefinition(scratch)).toEqual(v3);
    expect(workflowSemanticDefinition(scratch)).not.toHaveProperty("origin");
    expect(workflowSemanticDefinition(v3)).toBe(v3);
  });

  it("accepts only workflow-first origins with a thread", () => {
    expect(() =>
      decode(WorkflowDefinition)({ ...v3, origin: { kind: "manual", threadId: "thread-1" } }),
    ).toThrow();
    expect(() =>
      decode(WorkflowDefinition)({ ...v3, origin: { kind: "workflow-first" } }),
    ).toThrow();
    expect(() =>
      decode(WorkflowDefinition)({ ...v3, origin: { kind: "workflow-first", threadId: "" } }),
    ).toThrow();
  });
});

it("preserves workflow credential approval policies and rejects unknown policies", () => {
  for (const credentialApprovals of ["ask", "once-per-run", "pre-approved"] as const) {
    expect(decode(WorkflowDefinition)({ ...v3, credentialApprovals }).credentialApprovals).toBe(
      credentialApprovals,
    );
  }
  expect(() => decode(WorkflowDefinition)({ ...v3, credentialApprovals: "always" })).toThrow();
});

describe("credential attachments", () => {
  const attachment = {
    id: "asc",
    kind: "credential" as const,
    templateId: "app-store-connect",
  };

  it("decodes a portable requirement and a local binding", () => {
    expect(decode(WorkflowAttachment)(attachment)).toEqual(attachment);
    const bound = { ...attachment, credentialId: "cred-1", optional: true };
    expect(decode(WorkflowAttachment)(bound)).toEqual(bound);
    expect(
      decode(WorkflowDefinition)({
        version: 3,
        name: "Release",
        steps: [{ id: "upload", skill: "ship", attachments: [bound] }],
      }).steps[0]?.attachments?.[0],
    ).toEqual(bound);
  });

  it("rejects an unknown template shape and never keeps a value-shaped field", () => {
    expect(isWorkflowAttachment({ ...attachment, kind: "credential-value" })).toBe(false);
    expect(isWorkflowAttachment({ id: "asc", kind: "credential" })).toBe(false);
    for (const extra of [
      { value: "super-secret" },
      { secret: "super-secret" },
      { fields: [{ id: "token", envVar: "TOKEN" }] },
    ]) {
      expect(decode(WorkflowAttachment)({ ...attachment, ...extra })).toEqual(attachment);
    }
  });

  it("carries bounded readiness detail without values or field contents", () => {
    const credential = {
      state: "choose",
      templateId: "app-store-connect",
      statusLabel: "Choose a credential",
      envVars: [
        { name: "ASC_KEY_ID", file: false },
        { name: "ASC_PRIVATE_KEY_PATH", file: true },
      ],
      candidates: [
        { id: "cred-1", name: "App Store — Acme", status: "ready", statusLabel: "Ready" },
        { id: "cred-2", name: "App Store — Old", status: "expired", statusLabel: "Expired" },
      ],
      optional: false,
    };
    const entry = decode(WorkflowReadinessEntry)({
      stepId: "upload",
      attachmentId: "asc",
      kind: "credential",
      status: "missing",
      message: "Choose which App Store Connect API key to use.",
      credential,
    });
    expect(entry.credential).toEqual(credential);
    expect(
      decode(WorkflowReadinessSnapshot)({
        entries: [entry],
        blocksRun: false,
        warnings: ["Scheduled runs need Pre-approved credentials."],
      }).warnings,
    ).toEqual(["Scheduled runs need Pre-approved credentials."]);
    expect(
      isWorkflowReadinessEntry({
        stepId: "upload",
        attachmentId: "asc",
        kind: "credential",
        status: "missing",
        message: "x",
        credential: { ...credential, state: "bound" },
      }),
    ).toBe(false);
    // A readiness payload can never carry a value, even if one is put there by mistake.
    expect(
      decode(WorkflowReadinessEntry)({
        ...entry,
        credential: { ...credential, envVars: [{ name: "ASC_KEY_ID", file: false, value: "x" }] },
      }).credential?.envVars,
    ).toEqual([{ name: "ASC_KEY_ID", file: false }]);
  });
});

it("invalidates readiness when workflow subagent providers or step models change", () => {
  const definition: WorkflowDefinition = {
    ...v3,
    subagentModels: [
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        model: "gpt-6-luna",
      },
    ],
  };
  const specification = workflowReadinessSpecification(definition);
  expect(
    workflowReadinessSpecification({
      ...definition,
      subagentModels: [
        {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          model: "claude-haiku-5-5",
        },
      ],
    }),
  ).not.toBe(specification);
  expect(
    workflowReadinessSpecification({
      ...definition,
      steps: definition.steps.map((step) =>
        step.id === "build"
          ? {
              ...step,
              model: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
            }
          : step,
      ),
    }),
  ).not.toBe(specification);
});

it("normalizes tags and rejects invalid or oversized tag sets", () => {
  expect(decode(WorkflowTags)([" WEB ", "web", "Design"])).toEqual(["web", "design"]);
  for (const tags of [
    [""],
    ["two words"],
    ["a_b"],
    ["x".repeat(25)],
    ["a", "b", "c", "d", "e", "f", "g"],
  ]) {
    expect(decodeOption(WorkflowTags)(tags)._tag).toBe("None");
  }
  expect(decode(WorkflowTags)(["a", "b", "c", "d", "e", "x".repeat(24)])).toHaveLength(6);
  expect(decode(WorkflowTags)([])).toEqual([]);
  expect(
    decode(WorkflowEdit)({ _tag: "tagsSet", projectId: "p", workflow: "w", tags: [" WEB "] }),
  ).toMatchObject({ tags: ["web"] });
});
