import {
  ProjectId,
  ThreadId,
  type WorkflowRun,
  type WorkflowStepRun,
  type WorkflowStepStatus,
} from "@t3tools/contracts";

import { SAMPLE_WORKFLOW, SAMPLE_WORKFLOW_SLUG } from "./sampleWorkflow";

const STEP_IDS = SAMPLE_WORKFLOW.steps.map((step) => step.id);
const STARTED_AT = "2026-10-29T09:00:00.000Z";

type StepSpec = readonly [status: WorkflowStepStatus, extra?: Partial<WorkflowStepRun>];

const OUTPUTS: Readonly<Record<string, string>> = {
  brief: "One page, three sections, one call to action.",
  research: "Five similar pages compared.",
  design: "Layout, type and colours chosen.",
  build: "A page with hero, features and sign-up.",
  review: "Passes the brief.",
};

function step(stepId: string, [status, extra]: StepSpec): WorkflowStepRun {
  return {
    stepId,
    status,
    threadId: null,
    attempts: status === "queued" ? 0 : 1,
    ...(status === "done" && OUTPUTS[stepId] ? { summary: OUTPUTS[stepId] } : {}),
    ...extra,
  };
}

function frame(
  status: WorkflowRun["status"],
  specs: ReadonlyArray<StepSpec>,
  loopRound: number,
): WorkflowRun {
  return {
    id: "tour-demo-run",
    projectId: ProjectId.make("tour-demo"),
    workflow: SAMPLE_WORKFLOW_SLUG,
    driverThreadId: ThreadId.make("tour-demo-thread"),
    status,
    startedAt: STARTED_AT,
    ...(status === "done" ? { endedAt: "2026-10-29T09:04:00.000Z" } : {}),
    definition: SAMPLE_WORKFLOW,
    loopRounds: { polish: loopRound },
    skills: [],
    steps: STEP_IDS.map((id, index) => step(id, specs[index] ?? ["queued"])),
  };
}

const Q: StepSpec = ["queued"];
const D: StepSpec = ["done"];
const R: StepSpec = ["running"];
const roundTwo = { round: 2 } as const;

/** A recorded run of the sample: pending, running, done, one loop back to Build, then pass. */
export const DEMO_RUN_FRAMES: ReadonlyArray<WorkflowRun> = [
  frame("running", [R, Q, Q, Q, Q], 1),
  frame("running", [D, R, Q, Q, Q], 1),
  frame("running", [D, D, R, Q, Q], 1),
  frame("running", [D, D, D, R, Q], 1),
  frame("running", [D, D, D, D, R], 1),
  frame("running", [D, D, D, ["running", roundTwo], ["queued", roundTwo]], 2),
  frame("running", [D, D, D, ["done", roundTwo], ["running", roundTwo]], 2),
  frame("done", [D, D, D, ["done", roundTwo], ["done", roundTwo]], 2),
];

const DEMO_FRAME_INTERVAL_MS = 1200;

export interface DemoScheduler {
  readonly schedule: (run: () => void, delayMs: number) => () => void;
}

const timerScheduler: DemoScheduler = {
  schedule: (run, delayMs) => {
    const id = setTimeout(run, delayMs);
    return () => clearTimeout(id);
  },
};

/**
 * Replays the recorded frames through `onFrame`, then calls `onEnd`. It only reads the fixture:
 * nothing starts a provider, a thread or an RPC. Returns a function that stops the replay.
 */
export function playDemoRun(
  onFrame: (run: WorkflowRun) => void,
  onEnd: () => void,
  scheduler: DemoScheduler = timerScheduler,
): () => void {
  let cancel = () => {};
  // The fixture's clock is fixed; replaying it from now keeps the run timer honest.
  const startedAt = new Date();
  const endedAt = new Date(startedAt.getTime() + 4 * 60_000).toISOString();
  const emit = (index: number) => {
    const run = DEMO_RUN_FRAMES[index];
    if (run === undefined) {
      onEnd();
      return;
    }
    onFrame({
      ...run,
      startedAt: startedAt.toISOString(),
      ...(run.endedAt === undefined ? {} : { endedAt }),
    });
    if (index + 1 >= DEMO_RUN_FRAMES.length) onEnd();
    else cancel = scheduler.schedule(() => emit(index + 1), DEMO_FRAME_INTERVAL_MS);
  };
  emit(0);
  return () => cancel();
}
