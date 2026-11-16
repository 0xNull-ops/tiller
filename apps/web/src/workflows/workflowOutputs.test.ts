import { expect, it } from "vite-plus/test";
import { workflowCardSizes, workflowOutputLayout, workflowOutputs } from "./workflowOutputs";
import { workflowRunFixture } from "./workflowTestFixture";
import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";

it("recognizes web outputs and image paths without making unsafe URLs navigable", () => {
  expect(
    workflowOutputs({
      site: "https://example.com",
      image: "art/hero.PNG",
      file: "report.md",
      html: ".t3/workflows/out/mascot.html",
      note: "finished",
      bad: "javascript:alert(1)",
      empty: " ",
    }).map((output) => output.kind),
  ).toEqual(["url", "image", "file", "html", "text", "text"]);
});
it("splits the outputs into one thumbnail, a few chips and a couple of text rows", () => {
  const layout = workflowOutputLayout(
    workflowOutputs({
      site: "https://example.com",
      hero: "art/hero.png",
      page: "out/index.html",
      report: "report.md",
      first: "one",
      second: "two",
      third: "three",
    }),
  );
  expect(layout.main?.key).toBe("site");
  expect(layout.chips.map((chip) => chip.key)).toEqual(["hero", "page", "report"]);
  expect(layout.texts.map((text) => text.key)).toEqual(["first", "second"]);
  expect(layout.hidden).toBe(1);
});
it("grows completed output cards while leaving drafts and unfinished steps compact", () => {
  const run = {
    ...workflowRunFixture,
    steps: workflowRunFixture.steps.map((step) => ({ ...step, outputs: { image: "hero.png" } })),
  };
  const graph = buildWorkflowRunGraph(run, run.definition);
  const base = { width: 200, height: 112 };
  const sizes = workflowCardSizes(graph, run, base, true);
  expect(sizes.get("run-one:research")).toEqual({ width: 200, height: 267 });
  expect(sizes.get("run-one:build")).toEqual(base);
  expect(workflowCardSizes(graph, run, base, false).get("run-one:research")).toEqual(base);
});
it("grows a card for the text rows an agent reported", () => {
  const run = {
    ...workflowRunFixture,
    steps: workflowRunFixture.steps.map((step) => ({
      ...step,
      outputs: { validation: "Syntax check passed" },
    })),
  };
  const graph = buildWorkflowRunGraph(run, run.definition);
  expect(
    workflowCardSizes(graph, run, { width: 200, height: 112 }, true).get("run-one:research"),
  ).toEqual({ width: 200, height: 140 });
});
