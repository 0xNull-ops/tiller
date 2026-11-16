import { describe, expect, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  CredentialId,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@t3tools/contracts";
import { buildStepPrompt, buildWorkflowStepPrompt } from "./stepPrompt.ts";

const workflow: WorkflowDefinition = {
  version: 1,
  name: "Release",
  brief: "Ship it",
  spec: "SPEC.md",
  steps: [],
};
const step: WorkflowStep = {
  id: "build",
  skill: "frontend-design",
  title: "Build UI",
  note: "Keep it simple",
};
const build = (overrides: Partial<Parameters<typeof buildStepPrompt>[0]> = {}) =>
  buildStepPrompt({
    runId: "run-42",
    definition: workflow,
    step,
    skill: { name: "frontend-design", path: "/skill", text: "Design carefully" },
    upstream: [],
    ...overrides,
  });

describe("buildStepPrompt", () => {
  it("includes configured sections and omits empty upstream results", () => {
    const prompt = build();
    expect(prompt).toContain('Workflow "Release", step "Build UI" (run run-42).');
    expect(prompt).toContain("## Brief\nShip it");
    expect(prompt).toContain(
      "Read `SPEC.md` in the project first; it is the shared spec every step follows.",
    );
    expect(prompt).toContain("Skill: frontend-design");
    expect(prompt).toContain("## Your instruction for this step\nKeep it simple");
    expect(prompt).not.toContain("Results from earlier steps");
    expect(prompt).toContain("Then stop; the driving agent continues the run.");
    expect(prompt).not.toContain("turn ending without");
  });

  it("omits optional brief, spec and note, and includes upstream results", () => {
    const prompt = build({
      definition: { version: 1, name: "Release", steps: [] },
      step: { id: "build", skill: "frontend-design" },
      upstream: [
        { stepId: "plan", title: "Plan", summary: "Ready", outputs: { report: "out.md" } },
      ],
    });
    expect(prompt).not.toContain("## Brief");
    expect(prompt).not.toContain("shared spec");
    expect(prompt).not.toContain("Your instruction for this step");
    expect(prompt).toContain("## Results from earlier steps\n### Plan\nReady\nreport: out.md");
  });

  it("uses explicit skill, note and check output paths before the default folder", () => {
    const prompt = build({
      skill: { name: "snapshot", path: "/skill", text: "Write out/snapshot.html" },
      step: {
        ...step,
        note: "Save the summary at out/summary.md",
        checks: [
          { kind: "file", path: "out/snapshot.html" },
          { kind: "command", command: "test -s out/summary.md" },
        ],
      },
    });
    expect(prompt).toContain("Write out/snapshot.html");
    expect(prompt).toContain("Save the summary at out/summary.md");
    expect(prompt).toContain(
      "Use the output paths this step's skill, note or checks name. Only when none of them names a path, put files you produce that aren't part of the codebase under `.t3/workflows/out/run-42/build/`.",
    );
    expect(prompt).toContain(
      "Project-relative paths resolve inside the current project working directory (do not walk up to a parent repository root).",
    );
    expect(prompt).toContain(
      "Relative file paths and commands use the project working directory. File paths also accept absolute paths and ~/.",
    );
  });

  it("grows the skill fence past backticks in the skill text", () => {
    const prompt = build({ skill: { name: "x", path: "x", text: "Use ``` here" } });
    expect(prompt).toContain("````\nUse ``` here\n````");
  });

  it("includes retry details and exact workflow_step_done identifiers", () => {
    const prompt = build({ retry: { attempt: 2, problems: ["Missing output", "Check failed"] } });
    expect(prompt).toContain(
      "This is attempt 2. The last attempt failed:\n- Missing output\n- Check failed\n\nFix these first.",
    );
    expect(prompt).toContain('workflow_step_done` tool with `runId: "run-42"`, `stepId: "build"`');
  });

  it("includes the owner's checks, resources and relevant notes", () => {
    const prompt = build({
      definition: {
        version: 3,
        name: "Release",
        notes: [
          { id: "mine", text: "Keep it short.", anchorStepId: "build" },
          { id: "general", text: "Ship Friday." },
          { id: "other", text: "Deploy carefully.", anchorStepId: "deploy" },
        ],
        steps: [],
      },
      step: {
        id: "build",
        skill: "frontend-design",
        checks: [{ kind: "command", command: "pnpm build" }],
        attachments: [
          { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
          { id: "linear", kind: "mcp-connection", server: "linear" },
        ],
      },
      preflight: {
        blocksRun: false,
        entries: [
          {
            stepId: "build",
            attachmentId: "node",
            kind: "requirement",
            status: "available",
            message: "Node 22.1.0 is installed.",
          },
        ],
      },
    });
    expect(prompt).toContain("## Workflow context notes");
    expect(prompt).toContain("Keep it short.");
    expect(prompt).toContain("Ship Friday.");
    expect(prompt).not.toContain("Deploy carefully.");
    expect(prompt).toContain("## Checks the server runs after you report done");
    expect(prompt).toContain("`pnpm build`");
    expect(prompt).toContain("## Resources this step expects");
    expect(prompt).toContain("node 22+ (requirement): available: Node 22.1.0 is installed.");
    expect(prompt).toContain("MCP linear (mcp-connection): unknown");
    expect(prompt).toContain("The chat thread's main agent owns the workflow");
  });

  it("reports live MCP evidence and marks a stale observation without claiming current access", () => {
    const prompt = build({
      step: { ...step, attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }] },
      preflight: {
        blocksRun: false,
        entries: [
          {
            stepId: step.id,
            attachmentId: "linear",
            kind: "mcp-connection",
            status: "available",
            message:
              "Connected per live Work Codex session at 2026-10-22T12:00:00.000Z; T3 doesn't verify what the server can access (files, sign-ins).",
            stale: true,
          },
        ],
      },
    });
    expect(prompt).toContain(
      "available (stale): Connected per live Work Codex session at 2026-10-22T12:00:00.000Z; T3 doesn't verify what the server can access (files, sign-ins).",
    );
    expect(prompt).toContain("not guaranteed access now");
  });

  it("reports configured MCP evidence as unverified", () => {
    const prompt = build({
      step: { ...step, attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }] },
      preflight: {
        blocksRun: false,
        entries: [
          {
            stepId: step.id,
            attachmentId: "linear",
            kind: "mcp-connection",
            status: "unknown",
            message: "Configured in Work Codex, not verified (no live session).",
          },
        ],
      },
    });
    expect(prompt).toContain("unknown: Configured in Work Codex, not verified (no live session).");
  });

  it("lists attached credentials by name and env var, and never a value", () => {
    const prompt = build({
      step: {
        ...step,
        attachments: [
          {
            id: "asc",
            kind: "credential",
            templateId: "app-store-connect",
            credentialId: CredentialId.make("cred-1"),
          },
          { id: "gh", kind: "credential", templateId: "github", optional: true },
        ],
      },
      preflight: {
        blocksRun: false,
        entries: [
          {
            stepId: step.id,
            attachmentId: "asc",
            kind: "credential",
            status: "available",
            message: "App Store Connect is ready.",
            credential: {
              state: "ready",
              templateId: "app-store-connect",
              statusLabel: "Ready",
              credentialId: CredentialId.make("cred-1"),
              name: "App Store — Acme",
              envVars: [
                { name: "ASC_KEY_ID", file: false },
                { name: "ASC_PRIVATE_KEY_PATH", file: true },
              ],
              candidates: [],
              optional: false,
            },
          },
          {
            stepId: step.id,
            attachmentId: "gh",
            kind: "credential",
            status: "missing",
            message: "No GitHub token credential exists.",
            credential: {
              state: "missing",
              templateId: "github",
              statusLabel: "Missing",
              envVars: [],
              candidates: [],
              optional: true,
            },
          },
        ],
      },
    });
    expect(prompt).toContain("## Credentials for this step");
    expect(prompt).toContain('Call `credential_exec` with `credential: "cred-1"`');
    expect(prompt).toContain("env vars ASC_KEY_ID, ASC_PRIVATE_KEY_PATH");
    expect(prompt).toContain("ASC_PRIVATE_KEY_PATH is a file path");
    expect(prompt).toContain("credential_file");
    expect(prompt).toContain("GitHub token (github, missing) (optional)");
    expect(prompt).toContain("Settings → Credentials");
    // Credential cards are not repeated in the resource section.
    expect(prompt).not.toContain("(credential):");
    expect(prompt).not.toContain("super-secret");
  });

  it("asks the user to choose instead of naming an ambiguous credential", () => {
    const prompt = build({
      step: {
        ...step,
        attachments: [{ id: "asc", kind: "credential", templateId: "app-store-connect" }],
      },
      preflight: {
        blocksRun: false,
        entries: [
          {
            stepId: step.id,
            attachmentId: "asc",
            kind: "credential",
            status: "missing",
            message: "2 match; choose one.",
            credential: {
              state: "choose",
              templateId: "app-store-connect",
              statusLabel: "Choose a credential",
              envVars: [],
              candidates: [
                {
                  id: CredentialId.make("cred-1"),
                  name: "Acme",
                  status: "ready",
                  statusLabel: "Ready",
                },
                {
                  id: CredentialId.make("cred-2"),
                  name: "Old",
                  status: "ready",
                  statusLabel: "Ready",
                },
              ],
              optional: false,
            },
          },
        ],
      },
    });
    expect(prompt).toContain("(app-store-connect, choose)");
    expect(prompt).toContain("Ask the user to fix it in Settings → Credentials");
    expect(prompt).not.toContain('credential: "cred-1"');
  });

  it("never assumes credentials on a run whose preflight has none", () => {
    const prompt = build({
      step: { ...step, attachments: [{ id: "gh", kind: "credential", templateId: "github" }] },
      preflight: { blocksRun: false, entries: [] },
    });
    expect(prompt).toContain("GitHub token (github, unknown)");
    expect(prompt).not.toContain("credential_exec` with");
  });

  it("omits checks from a nested workflow prompt but keeps notes and resources", () => {
    const prompt = buildWorkflowStepPrompt({
      runId: "run-42",
      definition: {
        version: 3,
        name: "Release",
        notes: [{ id: "note", text: "Nested context.", anchorStepId: "deploy" }],
        steps: [],
      },
      step: {
        id: "deploy",
        kind: "workflow",
        workflow: "deploy-site",
        gate: true,
        attachments: [{ id: "vercel", kind: "service-login", service: "vercel" }],
      },
      inputs: {},
      childInputs: {},
    });
    expect(prompt).toContain("Nested context.");
    expect(prompt).toContain("vercel login (service-login): unknown");
    expect(prompt).not.toContain("Checks the server runs");
    expect(prompt).toContain("workflow_step_start");
  });

  it("includes loop feedback on target steps, verdict instructions on closing steps, and carry-over results", () => {
    const loopDef: WorkflowDefinition = {
      version: 3,
      name: "Polish",
      brief: "Improve area",
      loops: [
        {
          id: "review-to-draft",
          from: "review",
          to: "draft",
          maxRounds: 3,
          until: { kind: "condition", text: "all acceptance criteria pass" },
        },
      ],
      steps: [
        { id: "draft", skill: "writer", title: "Draft", note: "Prior run: {{last.result}}" },
        { id: "review", skill: "critic", title: "Review" },
      ],
    };
    const draftPrompt = build({
      definition: loopDef,
      step: loopDef.steps[0]!,
      lastRunResult: {
        runId: "run-41",
        endedAt: "2026-10-27T10:00:00.000Z",
        summary: "Shipped v1",
        outputs: { url: "https://example.test" },
      },
      loopFeedback: {
        from: "review",
        round: 1,
        summary: "VERDICT: revise — Hero headline is too long",
        outputs: { diff: "hero.patch" },
        checks: [{ ok: false, message: "Headline exceeds 60 chars" }],
      },
    });
    expect(draftPrompt).toContain(
      "Last run (2026-10-27T10:00:00.000Z) result: Shipped v1\nOutputs:\n- url: https://example.test",
    );
    expect(draftPrompt).toContain("Prior run: Shipped v1");
    expect(draftPrompt).toContain("## Feedback from review, round 1");
    expect(draftPrompt).toContain("VERDICT: revise — Hero headline is too long");
    expect(draftPrompt).toContain("- Check failed: Headline exceeds 60 chars");
    expect(draftPrompt).toContain("diff: hero.patch");

    const reviewPrompt = build({
      definition: loopDef,
      step: loopDef.steps[1]!,
    });
    expect(reviewPrompt).toContain("Condition: all acceptance criteria pass");
    expect(reviewPrompt).toContain("`VERDICT: pass`");
    expect(reviewPrompt).toContain("`VERDICT: revise: <why>`");
  });
});

const usableModel = {
  driver: ProviderDriverKind.make("codex"),
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6-luna",
  label: "Luna",
};
const missingModel = {
  hint: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "haiku" },
  reason: "signed-out" as const,
};

it.effect(
  "puts exactly one model instruction immediately after dispatch for every snapshot state",
  () =>
    Effect.sync(() => {
      const usable = { usable: [usableModel], missing: [], fallback: false };
      const expected =
        "Preferred subagent models (the user's choice): Luna (codex / gpt-6-luna). Prefer these when you delegate.";
      for (const [subagents, line] of [
        [undefined, undefined],
        [usable, expected],
        [{ ...usable, missing: [missingModel] }, expected],
        [{ usable: [], missing: [missingModel], fallback: true }, undefined],
        [{ usable: [], missing: [], fallback: false }, undefined],
      ] as const) {
        const prompt = build({ subagents });
        if (line === undefined) expect(prompt).not.toContain("Preferred subagent models:");
        else {
          expect(
            prompt
              .split("\n")
              .filter((line) => line.startsWith("Preferred subagent models (the user's choice):")),
          ).toEqual([line]);
          expect(prompt).toContain(`this step only.\n${line}`);
        }
      }
    }),
);

it.effect("gives a resolved step preference priority and omits unavailable overrides", () =>
  Effect.sync(() => {
    const subagents = { usable: [usableModel], missing: [], fallback: false };
    const own = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "haiku" };
    const resolved = { ...usableModel, ...own };
    const prompt = build({
      step: { ...step, model: own },
      subagents,
      stepSubagents: { usable: [resolved], missing: [], fallback: false },
    });
    expect(prompt).toContain("this step only.\nThis step prefers Luna (claudeAgent / haiku).");
    expect(prompt).not.toContain("Preferred subagent models:");
    const missing = { usable: [], missing: [missingModel], fallback: true };
    const fallback = build({ step: { ...step, model: own }, subagents, stepSubagents: missing });
    expect(fallback).toContain(
      "this step only.\nPreferred subagent models (the user's choice): Luna (codex / gpt-6-luna). Prefer these when you delegate.",
    );
    expect(fallback).not.toContain("This step prefers");
    expect(build({ step: { ...step, model: own }, stepSubagents: missing })).not.toContain(
      "This step prefers",
    );
    expect(build({ step: { ...step, model: own }, stepSubagents: missing })).not.toContain(
      "Preferred subagent models",
    );
  }),
);
