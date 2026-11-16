import type { GalleryItem } from "./workflowGallery";

const HUES = [211, 168, 266, 322, 28, 192, 96, 239];
const cache = new Map<string, ReturnType<typeof buildFlowArt>>();
const hash = (text: string) => {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
};
function buildFlowArt(item: Pick<GalleryItem, "key" | "steps" | "edges" | "loops" | "tags">) {
  const hue = HUES[hash(item.tags[0] ?? "workflow") % HUES.length] ?? 211;
  const wave = item.steps.length > 12;
  const dots = item.steps.map((step, index) => ({
    id: step.id,
    x: item.steps.length === 1 ? 200 : 40 + (index * 320) / Math.max(1, item.steps.length - 1),
    y: wave ? 118 + Math.sin((index * Math.PI) / 2) * 20 : 118,
  }));
  const spine = dots
    .map((dot, index) => {
      const previous = dots[index - 1];
      return previous
        ? `C${(previous.x + dot.x) / 2},${previous.y} ${(previous.x + dot.x) / 2},${dot.y} ${dot.x},${dot.y}`
        : `M${dot.x},${dot.y}`;
    })
    .join(" ");
  const arc = (edge: { readonly from: string; readonly to: string }, below: boolean) => {
    const from = dots.find((dot) => dot.id === edge.from);
    const to = dots.find((dot) => dot.id === edge.to);
    if (!from || !to) return [];
    const rise = Math.min(82, 24 + Math.abs(from.x - to.x) * 0.2);
    return [
      `M${from.x},${from.y} Q${(from.x + to.x) / 2},${below ? 118 + rise : 118 - rise} ${to.x},${to.y}`,
    ];
  };
  return {
    hue,
    angle: hash(item.key) % 360,
    wave,
    dots,
    spine,
    edges: item.edges.flatMap((edge) => arc(edge, false)),
    loops: item.loops.flatMap((loop) => arc(loop, true)),
  };
}
export function galleryFlowArt(
  item: Pick<GalleryItem, "key" | "digest" | "steps" | "edges" | "loops" | "tags">,
) {
  const key = JSON.stringify([item.key, item.digest, item.tags[0]]);
  const existing = cache.get(key);
  if (existing) return existing;
  const art = buildFlowArt(item);
  // Bound retained geometry when users browse many projects or edit definitions repeatedly.
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, art);
  return art;
}
