import type { SkillsShResult } from "@t3tools/contracts";

export function mergeSkillResults(
  current: readonly (typeof SkillsShResult.Type)[],
  incoming: readonly (typeof SkillsShResult.Type)[],
) {
  const unique = new Map(current.map((skill) => [skill.id, skill]));
  for (const skill of incoming) unique.set(skill.id, skill);
  return [...unique.values()];
}
