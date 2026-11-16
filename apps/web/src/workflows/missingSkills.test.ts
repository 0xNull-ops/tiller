import { expect, it } from "vite-plus/test";
import {
  chooseSkillMatch,
  normalizeSkillName,
  rankSkill,
  resolveSkillSource,
} from "./missingSkills";
it("normalizes case, separators and plurals without fuzzy source resolution", () => {
  expect(normalizeSkillName("Copy_Writings")).toBe(normalizeSkillName("copy-writing"));
  expect(rankSkill("copywriting", { name: "copy-writing", description: null })).toBeGreaterThan(
    rankSkill("copywriting", { name: "video", description: null }),
  );
  expect(
    rankSkill("captions", { name: "subtitles", description: "Create captions" }),
  ).toBeGreaterThan(0);
  const hits = [{ name: "copy-writing", id: "a/b/c", installs: 100 }];
  expect(resolveSkillSource("copywriting", {}, hits)).toBeNull();
  expect(resolveSkillSource("copywriting", { copywriting: "trusted/repo/skill" }, hits)).toBe(
    "trusted/repo/skill",
  );
  expect(resolveSkillSource("copy-writing", {}, hits)).toBe("a/b/c");
  expect(resolveSkillSource("missing", {}, hits)).toBeNull();
});

it("prefers an exact skills.sh name over a weak local keyword match", () => {
  const local = [{ name: "video-tools", description: "Helpers for remotion projects" }];
  const hits = [
    { name: "remotion-render", description: null, installs: 10 },
    { name: "render-farm", description: null, installs: 500 },
  ];
  expect(chooseSkillMatch("remotion-render", local, hits)).toEqual({
    kind: "catalogue",
    hit: hits[0],
  });
  expect(chooseSkillMatch("copywriting", [{ name: "Copy_Writing" }], hits)).toEqual({
    kind: "local",
    skill: { name: "Copy_Writing" },
  });
  expect(chooseSkillMatch("captions", [{ name: "video-tools", description: "edits" }], [])).toBe(
    null,
  );
});
