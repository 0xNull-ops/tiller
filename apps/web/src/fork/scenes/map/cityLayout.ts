export const CITY_SIZE = 600;
const STREET = 9;
const COAST = 96;

export type CityPoint = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

export type City = {
  water: string;
  highways: string;
  /** Centre lines of every street, drawn as lane markings or ink roads by the map style. */
  lanes: string;
  blocks: ReadonlyArray<Box>;
  parks: ReadonlyArray<Box>;
  xs: ReadonlyArray<number>;
  ys: ReadonlyArray<number>;
};

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function lines(random: () => number, from: number): ReadonlyArray<number> {
  const out = [from];
  while (out.at(-1)! < CITY_SIZE) out.push(out.at(-1)! + 34 + Math.round(random() * 26));
  return out;
}

/** A fixed, made-up city so every install sees the same map. */
export function buildCity(): City {
  const random = seeded(1986);
  const xs = lines(random, COAST);
  const ys = lines(random, 0);
  const blocks: Box[] = [];
  const parks: Box[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const box = {
        x: xs[i]! + STREET / 2,
        y: ys[j]! + STREET / 2,
        width: xs[i + 1]! - xs[i]! - STREET,
        height: ys[j + 1]! - ys[j]! - STREET,
      };
      (random() < 0.09 ? parks : blocks).push(box);
    }
  }
  let water = `M0 0 L${COAST - 14} 0`;
  for (let y = 40; y <= CITY_SIZE; y += 40) {
    water += ` Q${COAST - 4 - random() * 22} ${y - 20} ${COAST - 14 - random() * 10} ${y}`;
  }
  water += ` L0 ${CITY_SIZE} Z`;
  const highways =
    `M${COAST} ${CITY_SIZE * 0.72} C200 520 330 300 ${CITY_SIZE} 250 ` +
    `M${CITY_SIZE * 0.62} 0 C380 180 420 400 ${CITY_SIZE * 0.55} ${CITY_SIZE}`;
  const lanes = [
    ...xs.slice(0, -1).map((x) => `M${x} 0 V${CITY_SIZE}`),
    ...ys.slice(0, -1).map((y) => `M${COAST} ${y} H${CITY_SIZE}`),
  ].join(" ");
  return { water, highways, lanes, blocks, parks, xs: xs.slice(0, -1), ys: ys.slice(0, -1) };
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The same thread always lands on the same street corner. */
export function placeOnCity(city: City, id: string): CityPoint {
  const { i, j } = cornerFor(city, id);
  return { x: city.xs[i]!, y: city.ys[j]! };
}

function cornerFor(city: City, id: string): { i: number; j: number } {
  const h = hash(id);
  // Column 0 is the shoreline road; threads park inland.
  const inland = city.xs.length - 1;
  return { i: 1 + (h % inland), j: Math.floor(h / inland) % city.ys.length };
}

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/**
 * A street route for a thread: one corner per stop, starting at the thread's own corner.
 * The same thread and stop count always draw the same route, so the map never reshuffles.
 */
export function routeOnCity(city: City, id: string, stops: number): ReadonlyArray<CityPoint> {
  const random = seeded(hash(`${id}:route`));
  let { i, j } = cornerFor(city, id);
  let heading = Math.floor(random() * 4);
  const points: CityPoint[] = [{ x: city.xs[i]!, y: city.ys[j]! }];
  for (let step = 1; step < stops; step++) {
    // Mostly keep going, sometimes turn, never U-turn, stay on the map.
    const order =
      random() < 0.6 ? [heading, heading + 1, heading + 3] : [heading + 1, heading + 3, heading];
    const next = order
      .map((d) => d % 4)
      .find((d) => {
        const [di, dj] = DIRECTIONS[d]!;
        const ni = i + di;
        const nj = j + dj;
        return ni >= 0 && nj >= 0 && ni < city.xs.length && nj < city.ys.length;
      });
    heading = next ?? (heading + 2) % 4;
    const [di, dj] = DIRECTIONS[heading]!;
    i += di;
    j += dj;
    points.push({ x: city.xs[i]!, y: city.ys[j]! });
  }
  return points;
}
