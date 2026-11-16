import { describe, expect, it } from "vite-plus/test";

import { buildWorkflowRunGraph } from "./buildWorkflowRunGraph";
import type { RunGraph } from "./runGraph";
import { layoutRunGraph, RUN_GRAPH_NODE, type RunGraphNodeSize } from "./runGraphLayout";

function graph(ids: string[], edges: [string, string][]): RunGraph {
  return {
    nodes: ids.map((id) => ({
      id,
      kind: "task",
      title: id,
      detail: null,
      status: "done",
      childThreadId: null,
    })),
    edges: edges.map(([from, to]) => ({ id: `${from}->${to}`, from, to })),
  };
}

/** Per-card sizes, with the default size for every card the caller did not mention. */
function cardSizes(
  entries: Record<string, Partial<RunGraphNodeSize>>,
): Map<string, RunGraphNodeSize> {
  return new Map(
    Object.entries(entries).map(([id, size]) => [
      id,
      {
        width: size.width ?? RUN_GRAPH_NODE.width,
        height: size.height ?? RUN_GRAPH_NODE.height,
      },
    ]),
  );
}

/** No two cards may share canvas space, whatever their sizes. */
function expectNoOverlap(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  sizes: ReadonlyMap<string, RunGraphNodeSize>,
) {
  const ids = [...positions.keys()];
  for (const [index, id] of ids.entries()) {
    const position = positions.get(id)!;
    const size = sizes.get(id)!;
    for (const other of ids.slice(index + 1)) {
      const otherPosition = positions.get(other)!;
      const otherSize = sizes.get(other)!;
      const apart =
        position.x + size.width <= otherPosition.x ||
        otherPosition.x + otherSize.width <= position.x ||
        position.y + size.height <= otherPosition.y ||
        otherPosition.y + otherSize.height <= position.y;
      expect(apart, `${id} overlaps ${other}`).toBe(true);
    }
  }
}

describe("layoutRunGraph", () => {
  it.each(["horizontal", "vertical"] as const)(
    "keeps the Capture → Summarize → gated Publish bundles ordered in %s layout",
    (direction) => {
      const workflow = buildWorkflowRunGraph(null, {
        version: 3,
        name: "Three steps",
        steps: [
          { id: "capture", skill: "capture", checks: [{ kind: "file", path: "capture.md" }] },
          {
            id: "summarize",
            skill: "summarize",
            readsFrom: ["capture"],
            checks: [{ kind: "file", path: "summary.md" }],
          },
          {
            id: "publish",
            skill: "publish",
            gate: true,
            readsFrom: ["capture", "summarize"],
            checks: [{ kind: "file", path: "published.md" }],
          },
        ],
      });
      const prefix = "draft:Three steps:";
      for (const overrides of [
        {},
        {
          [`${prefix}capture`]: { width: 320, height: 150 },
          [`${prefix}approval:publish`]: { width: 240, height: 100 },
          [`${prefix}check:summarize`]: { width: 260, height: 190 },
        },
      ]) {
        const sizes = cardSizes(Object.fromEntries(workflow.nodes.map((node) => [node.id, {}])));
        for (const [id, size] of cardSizes(overrides)) sizes.set(id, size);
        const layout = layoutRunGraph(workflow, RUN_GRAPH_NODE, direction, sizes);
        const main = (id: string) =>
          direction === "horizontal" ? layout.positions.get(id)!.x : layout.positions.get(id)!.y;
        const mainSize = (id: string) =>
          direction === "horizontal" ? sizes.get(id)!.width : sizes.get(id)!.height;
        const crossCenter = (id: string) =>
          direction === "horizontal"
            ? layout.positions.get(id)!.y + sizes.get(id)!.height / 2
            : layout.positions.get(id)!.x + sizes.get(id)!.width / 2;
        const gap = RUN_GRAPH_NODE.columnGap * (direction === "vertical" ? 0.75 : 1);
        const gate = `${prefix}approval:publish`;
        const publish = `${prefix}publish`;
        expect(crossCenter(gate)).toBe(crossCenter(publish));
        expect(main(gate) + mainSize(gate) + gap).toBe(main(publish));
        for (const step of ["capture", "summarize", "publish"]) {
          const owner = `${prefix}${step}`;
          const check = `${prefix}check:${step}`;
          expect(crossCenter(check)).toBe(crossCenter(owner));
          expect(main(owner) + mainSize(owner) + gap).toBe(main(check));
        }
        for (const { from, to } of workflow.edges) {
          expect(main(from) + mainSize(from)).toBeLessThan(main(to));
        }
        expectNoOverlap(layout.positions, layout.nodeSizes!);
        expect(layout.positions.size).toBe(workflow.nodes.length);
        expect(layout.width).toBe(
          Math.max(
            ...workflow.nodes.map(({ id }) => layout.positions.get(id)!.x + sizes.get(id)!.width),
          ),
        );
        expect(layout.height).toBe(
          Math.max(
            ...workflow.nodes.map(({ id }) => layout.positions.get(id)!.y + sizes.get(id)!.height),
          ),
        );
      }
    },
  );

  it("uses every workflow dependency even without derived cards", () => {
    const workflow = buildWorkflowRunGraph(null, {
      version: 3,
      name: "Join",
      steps: [
        { id: "capture", skill: "capture" },
        { id: "summarize", skill: "summarize", readsFrom: ["capture"] },
        { id: "publish", skill: "publish", readsFrom: ["capture", "summarize"] },
      ],
    });
    const layout = layoutRunGraph(workflow);
    expect(layout.positions.get("draft:Join:publish")!.x).toBe(
      3 * (RUN_GRAPH_NODE.width + RUN_GRAPH_NODE.columnGap),
    );
  });

  it("places depths left to right and centres parents over their first and last child", () => {
    const layout = layoutRunGraph(
      graph(
        ["root", "a", "b", "c", "d"],
        [
          ["root", "a"],
          ["root", "b"],
          ["a", "c"],
          ["a", "d"],
        ],
      ),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      c: { x: 512, y: 0 },
      d: { x: 512, y: 80 },
      a: { x: 256, y: 40 },
      b: { x: 256, y: 160 },
      root: { x: 0, y: 100 },
    });
    expect([layout.width, layout.height]).toEqual([712, 224]);
  });

  it("preserves edge order and stacks entire trees without overlapping", () => {
    const layout = layoutRunGraph(
      graph(
        ["one", "two", "a", "b", "c"],
        [
          ["one", "b"],
          ["one", "a"],
          ["two", "c"],
        ],
      ),
    );
    expect(layout.positions.get("b")?.y).toBe(0);
    expect(layout.positions.get("a")?.y).toBe(80);
    expect(layout.positions.get("one")?.y).toBe(40);
    expect(layout.positions.get("two")?.y).toBe(160);
    expect(layout.positions.get("c")?.y).toBe(160);
    expect(layout.height).toBe(160 + RUN_GRAPH_NODE.height);
  });

  it("returns zero bounds for an empty graph", () => {
    expect(layoutRunGraph({ nodes: [], edges: [] })).toEqual({
      positions: new Map(),
      width: 0,
      height: 0,
    });
  });

  it("breaks cycles, including self edges, and still places every node", () => {
    const layout = layoutRunGraph(
      graph(
        ["a", "b", "c", "self"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "a"],
          ["self", "self"],
        ],
      ),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      c: { x: 512, y: 0 },
      b: { x: 256, y: 0 },
      a: { x: 0, y: 0 },
      self: { x: 0, y: 80 },
    });
  });

  it("ignores second incoming edges and edges with missing endpoints", () => {
    const layout = layoutRunGraph(
      graph(
        ["a", "b", "child"],
        [
          ["a", "child"],
          ["b", "child"],
          ["missing", "a"],
          ["a", "missing"],
        ],
      ),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      child: { x: 256, y: 0 },
      a: { x: 0, y: 0 },
      b: { x: 0, y: 80 },
    });
  });

  it("reports no card sizes when the graph was laid out without them", () => {
    expect(layoutRunGraph(graph(["a"], [])).nodeSizes).toBeUndefined();
  });

  it("keeps tall siblings apart and leaves the widest card of a depth its room", () => {
    const layout = layoutRunGraph(
      graph(
        ["root", "a", "b"],
        [
          ["root", "a"],
          ["root", "b"],
        ],
      ),
      RUN_GRAPH_NODE,
      "horizontal",
      cardSizes({ a: { height: 200 } }),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      root: { x: 0, y: 142 },
      a: { x: 256, y: 0 },
      b: { x: 256, y: 216 },
    });
    expect([layout.width, layout.height]).toEqual([456, 280]);
    expectNoOverlap(layout.positions, layout.nodeSizes!);
  });

  it("centres the children of a tall card inside it", () => {
    const layout = layoutRunGraph(
      graph(["root", "a"], [["root", "a"]]),
      RUN_GRAPH_NODE,
      "horizontal",
      cardSizes({ root: { height: 200 } }),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      root: { x: 0, y: 0 },
      a: { x: 256, y: 68 },
    });
    expect([layout.width, layout.height]).toEqual([456, 200]);
    expectNoOverlap(layout.positions, layout.nodeSizes!);
  });

  it("stacks forests of different heights without overlapping them", () => {
    const layout = layoutRunGraph(
      graph(
        ["one", "two", "a", "b"],
        [
          ["one", "a"],
          ["two", "b"],
        ],
      ),
      RUN_GRAPH_NODE,
      "horizontal",
      cardSizes({ a: { height: 200 } }),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      one: { x: 0, y: 68 },
      a: { x: 256, y: 0 },
      two: { x: 0, y: 216 },
      b: { x: 256, y: 216 },
    });
    expect([layout.width, layout.height]).toEqual([456, 280]);
    expectNoOverlap(layout.positions, layout.nodeSizes!);
  });

  it("runs cards of different heights down a vertical graph", () => {
    const layout = layoutRunGraph(
      graph(
        ["root", "a", "b", "c"],
        [
          ["root", "a"],
          ["a", "b"],
          ["b", "c"],
        ],
      ),
      RUN_GRAPH_NODE,
      "vertical",
      cardSizes({ a: { height: 100 }, b: { height: 160 } }),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      root: { x: 0, y: 0 },
      a: { x: 0, y: 106 },
      b: { x: 0, y: 248 },
      c: { x: 0, y: 450 },
    });
    expect([layout.width, layout.height]).toEqual([200, 514]);
    expectNoOverlap(layout.positions, layout.nodeSizes!);
  });

  it("lays out vertical branches of different widths side by side", () => {
    const layout = layoutRunGraph(
      graph(
        ["root", "a", "b"],
        [
          ["root", "a"],
          ["root", "b"],
        ],
      ),
      RUN_GRAPH_NODE,
      "vertical",
      cardSizes({ a: { width: 300 }, b: { width: 200 } }),
    );
    expect(Object.fromEntries(layout.positions)).toEqual({
      root: { x: 191, y: 0 },
      a: { x: 0, y: 106 },
      b: { x: 332, y: 106 },
    });
    expect([layout.width, layout.height]).toEqual([532, 170]);
    expectNoOverlap(layout.positions, layout.nodeSizes!);
  });
});
