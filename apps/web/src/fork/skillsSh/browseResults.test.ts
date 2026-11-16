import { expect, it } from "vite-plus/test";
import { mergeSkillResults } from "./browseResults";

it("keeps existing rows stable when larger searches reorder or repeat results", () => {
  const skill = (id: string, installs = 1) => ({
    id,
    name: id,
    skillId: id,
    source: "acme/skills",
    installs,
  });
  expect(
    mergeSkillResults(
      [skill("first"), skill("second")],
      [skill("second", 2), skill("third"), skill("first")],
    ),
  ).toEqual([skill("first"), skill("second", 2), skill("third")]);
});
