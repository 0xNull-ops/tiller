import {
  CredentialId,
  type ProjectId,
  type WorkflowDefinition,
  type WorkflowReadinessSnapshot,
} from "@t3tools/contracts";

export const SAMPLE_WORKFLOW_SLUG = "launch-a-landing-page";

/** Bundled fixture: shown read-only and written to a project only through Save a copy. */
export const SAMPLE_WORKFLOW: WorkflowDefinition = {
  version: 3,
  name: "Launch a landing page",
  brief: "A one-page site for a new app: researched, designed, built and reviewed.",
  steps: [
    { id: "brief", skill: "brief", title: "Brief" },
    {
      id: "research",
      skill: "research",
      title: "Research",
      attachments: [{ id: "github", kind: "credential", templateId: "github", optional: true }],
    },
    { id: "design", skill: "design", title: "Design" },
    { id: "build", skill: "build", title: "Build", readsFrom: ["design", "research"] },
    { id: "review", skill: "review", title: "Review" },
  ],
  loops: [
    {
      id: "polish",
      from: "review",
      to: "build",
      maxRounds: 2,
      until: { kind: "step-says-pass" },
    },
  ],
};

export const SAMPLE_SCHEDULE_LABEL = "09:00 weekdays";

/** The next weekday 09:00 after `now`, in local time. */
export function nextWeekdayNine(now: Date): Date {
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

const SKILL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  brief: "Turn the request into a short, checkable brief.",
  research: "Find what similar launch pages say and what visitors need.",
  design: "Choose a layout, type and colours for the page.",
  build: "Build the page from the design.",
  review: "Check the page against the brief and say pass or revise.",
};

/** Skills written with a copy, so it runs. A skill the project already has is left as it is. */
function sampleSkillFiles(): ReadonlyArray<{ name: string; content: string }> {
  return Object.entries(SKILL_DESCRIPTIONS).map(([name, description]) => ({
    name,
    content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`,
  }));
}

/** The edit that saves a copy. It is the only path from the sample to disk. */
export function saveCopyEdit(input: {
  readonly projectId: ProjectId;
  readonly workflow: string;
  readonly name: string;
}) {
  return {
    _tag: "import" as const,
    projectId: input.projectId,
    workflow: input.workflow,
    definition: { ...SAMPLE_WORKFLOW, name: input.name },
    skills: sampleSkillFiles(),
  };
}

/** What the credential card shows: a connected vault entry, so the sample reads as set up. */
export const SAMPLE_READINESS: WorkflowReadinessSnapshot = {
  entries: [
    {
      stepId: "research",
      attachmentId: "github",
      kind: "credential",
      status: "available",
      message: "Ready",
      credential: {
        state: "ready",
        templateId: "github",
        statusLabel: "Ready",
        credentialId: CredentialId.make("tour-sample-github"),
        name: "GitHub (sample)",
        envVars: [{ name: "GITHUB_TOKEN", file: false }],
        candidates: [],
        optional: true,
      },
    },
  ],
  blocksRun: false,
};
