export const normalizeSkillName = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.replace(/ies$/, "y").replace(/s$/, ""))
    .join("");

export function rankSkill(query: string, skill: { name: string; description?: string | null }) {
  if (query === skill.name) return 100;
  const wanted = normalizeSkillName(query);
  const name = normalizeSkillName(skill.name);
  if (wanted === name) return 90;
  if (wanted.length < 3) return 0;
  if (name.includes(wanted) || wanted.includes(name)) return 60;
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  const text = `${skill.name} ${skill.description ?? ""}`.toLowerCase();
  return words.length
    ? (40 * words.filter((word) => text.includes(word)).length) / words.length
    : 0;
}

export function resolveSkillSource(
  name: string,
  template: Readonly<Record<string, string>>,
  hits: readonly { name: string; id: string; installs: number }[],
) {
  return (
    template[name] ??
    hits
      .filter((hit) => hit.name === name && !hit.id.startsWith("site/"))
      .toSorted((a, b) => b.installs - a.installs || a.id.localeCompare(b.id))[0]?.id ??
    null
  );
}

const EXACT_SCORE = 90;
const MIN_SCORE = 40;
const best = <T extends { name: string; description?: string | null }>(
  name: string,
  items: readonly T[],
) =>
  items
    .map((item) => ({ item, score: rankSkill(name, item) }))
    .toSorted((a, b) => b.score - a.score)[0];

export const hasExactLocalSkill = (
  name: string,
  local: readonly { name: string; description?: string | null }[],
) => (best(name, local)?.score ?? 0) >= EXACT_SCORE;

// A weak local hit (a description keyword) must not hide a skills.sh skill with the exact name.
export function chooseSkillMatch<
  L extends { name: string; description?: string | null },
  H extends { name: string; description?: string | null; installs: number },
>(name: string, local: readonly L[], hits: readonly H[]) {
  const mine = best(name, local);
  if (mine && mine.score >= EXACT_SCORE) return { kind: "local" as const, skill: mine.item };
  const theirs = hits
    .map((item) => ({ item, score: rankSkill(name, item) }))
    .toSorted((a, b) => b.score - a.score || b.item.installs - a.item.installs)[0];
  const localScore = mine?.score ?? 0;
  const hitScore = theirs?.score ?? 0;
  if (Math.max(localScore, hitScore) < MIN_SCORE) return null;
  return mine && localScore >= hitScore
    ? { kind: "local" as const, skill: mine.item }
    : { kind: "catalogue" as const, hit: theirs!.item };
}
