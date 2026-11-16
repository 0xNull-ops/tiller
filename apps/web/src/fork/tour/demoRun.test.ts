import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { WorkflowRun } from "@t3tools/contracts";

import { DEMO_RUN_FRAMES, playDemoRun, type DemoScheduler } from "./demoRun";
import { SAMPLE_WORKFLOW, saveCopyEdit, SAMPLE_WORKFLOW_SLUG } from "./sampleWorkflow";
import { WorkflowDefinition, WorkflowEdit, ProjectId } from "@t3tools/contracts";

const decodeRun = Schema.decodeSync(WorkflowRun);
const decodeDefinition = Schema.decodeSync(WorkflowDefinition);
const decodeEdit = Schema.decodeSync(WorkflowEdit);

function manualScheduler() {
  const queue: Array<() => void> = [];
  const scheduler: DemoScheduler = {
    schedule: (run) => {
      queue.push(run);
      return () => {
        queue.length = 0;
      };
    },
  };
  return { scheduler, tick: () => queue.shift()?.() };
}

describe("demo run", () => {
  it("is a recorded run the contract accepts, with one loop back to Build", () => {
    for (const frame of DEMO_RUN_FRAMES) decodeRun(frame);
    const rounds = DEMO_RUN_FRAMES.map((frame) => frame.loopRounds?.polish);
    expect(rounds).toContain(1);
    expect(rounds.at(-1)).toBe(2);
    expect(DEMO_RUN_FRAMES.at(-1)?.status).toBe("done");
    const build = DEMO_RUN_FRAMES.flatMap((frame) =>
      frame.steps.filter((step) => step.stepId === "build"),
    );
    expect(build.some((step) => step.round === 2)).toBe(true);
  });

  it("replays frames in order from the fixture alone, then ends", () => {
    const { scheduler, tick } = manualScheduler();
    const seen: string[] = [];
    let ended = false;
    playDemoRun(
      (run) => seen.push(run.steps.map((step) => step.status[0]).join("")),
      () => (ended = true),
      scheduler,
    );
    expect(seen).toHaveLength(1);
    for (let i = 0; i < DEMO_RUN_FRAMES.length; i++) tick();
    expect(seen).toHaveLength(DEMO_RUN_FRAMES.length);
    expect(seen[0]).toBe("rqqqq");
    expect(ended).toBe(true);
  });

  it("stops when cancelled", () => {
    const { scheduler, tick } = manualScheduler();
    const seen: number[] = [];
    const stop = playDemoRun(
      (run) => seen.push(run.steps.length),
      () => {},
      scheduler,
    );
    stop();
    tick();
    expect(seen).toHaveLength(1);
  });
});

describe("sample workflow", () => {
  it("is a valid definition with a loop, a credential and a read-from arc", () => {
    const definition = decodeDefinition(SAMPLE_WORKFLOW);
    expect(definition.steps.map((step) => step.id)).toEqual([
      "brief",
      "research",
      "design",
      "build",
      "review",
    ]);
    expect(definition.loops).toEqual([
      expect.objectContaining({ from: "review", to: "build", maxRounds: 2 }),
    ]);
    expect(
      definition.steps.some((step) =>
        step.attachments?.some((entry) => entry.kind === "credential"),
      ),
    ).toBe(true);
  });

  it("reaches a project only as one import edit made by Save a copy", () => {
    const edit = saveCopyEdit({
      projectId: ProjectId.make("project"),
      workflow: SAMPLE_WORKFLOW_SLUG,
      name: "My landing page",
    });
    const decoded = decodeEdit(edit);
    expect(decoded._tag).toBe("import");
    expect(edit.definition.name).toBe("My landing page");
    expect(edit.skills.map((skill) => skill.name)).toContain("review");
  });
});
