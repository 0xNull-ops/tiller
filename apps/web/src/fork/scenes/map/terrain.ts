import type { SceneManifest } from "../manifest";
import { buildCity } from "./cityLayout";

type Terrain = NonNullable<SceneManifest["map"]["terrain"]>;
type Decoration = { kind: string; d: string };
const city = buildCity();

function build(terrain: Terrain): Decoration[] {
  const out: Decoration[] = [];
  for (const [index, box] of [...city.blocks, ...city.parks].entries()) {
    let seed = (box.x * 73856093 + box.y * 19349663) >>> 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const trees = terrain === "forest" || (terrain === "meadow" && index >= city.blocks.length);
    const count = trees ? (index >= city.blocks.length ? 7 : 3 + Math.floor(random() * 5)) : 3;
    // Each block contributes at most seven paths; the global cap bounds SVG work.
    for (let i = 0; i < count && out.length < 900; i++) {
      const x = box.x + 8 + random() * (box.width - 16);
      const y = box.y + 8 + random() * (box.height - 16);
      const r = 2 + random() * 3;
      if (trees) {
        out.push({
          kind: "tree",
          d: `M${x - r} ${y} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0`,
        });
      } else if (terrain === "city") {
        out.push({ kind: "building", d: `M${x - 3} ${y - 3} h6 v6 h-6 Z` });
      } else if (terrain === "snow") {
        out.push({ kind: "pine", d: `M${x} ${y - 5} l4 9 h-8 Z` });
      } else if (terrain === "meadow") {
        out.push({
          kind: i === 0 ? "flower" : "grass",
          d: i === 0 ? `M${x} ${y} h1` : `M${x - 3} ${y - 3} l3 4 v-6 m0 6 l3 -4`,
        });
      } else {
        const inset = 4 + i * 4;
        const left = box.x + inset,
          top = box.y + inset;
        const w = box.width - inset * 2,
          h = box.height - inset * 2;
        out.push({
          kind: "contour",
          d:
            terrain === "desert"
              ? `M${left} ${top + h / 2} q${w / 2} ${-h / 2} ${w} 0`
              : `M${left + 6} ${top} h${w - 12} q6 0 6 6 v${h - 12} q0 6 -6 6 h${12 - w} q-6 0 -6 -6 v${12 - h} q0 -6 6 -6 Z`,
        });
      }
    }
  }
  return out;
}

export const TERRAIN = {
  city: build("city"),
  forest: build("forest"),
  meadow: build("meadow"),
  hills: build("hills"),
  desert: build("desert"),
  snow: build("snow"),
};
