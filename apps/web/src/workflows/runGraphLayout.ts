import type { RunGraph, RunGraphNode } from "./runGraph";

export const RUN_GRAPH_NODE = { width: 200, height: 64, columnGap: 56, rowGap: 16 } as const;

/** The size of one card on the canvas. */
export interface RunGraphNodeSize {
  readonly width: number;
  readonly height: number;
}

export interface RunGraphLayout {
  positions: ReadonlyMap<string, { x: number; y: number }>;
  width: number;
  height: number;
  /** The size of every card, when the graph was laid out with per-card sizes. */
  readonly nodeSizes?: ReadonlyMap<string, RunGraphNodeSize>;
}

/** Horizontal runs left to right; vertical runs top to bottom, which suits a tall, narrow panel. */
export type RunGraphDirection = "horizontal" | "vertical";

/** How much of the cross axis a subtree takes, and where its parts sit inside that span. */
interface SubtreeSpan {
  /** The whole subtree's cross-axis extent. */
  readonly span: number;
  /** Where the card sits inside that extent. */
  readonly cardOffset: number;
  /** Where the children start inside that extent. */
  readonly childOffset: number;
}

export function layoutRunGraph(
  graph: RunGraph,
  nodeSize: { width: number; height: number; columnGap: number; rowGap: number } = RUN_GRAPH_NODE,
  direction: RunGraphDirection = "horizontal",
  nodeSizes?: ReadonlyMap<string, RunGraphNodeSize>,
): RunGraphLayout {
  const vertical = direction === "vertical";
  const mainGap = vertical ? nodeSize.columnGap * 0.75 : nodeSize.columnGap;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ownerOf = new Map<string, string>();
  for (const edge of graph.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (
      from?.kind === "approval" &&
      to?.kind === "step" &&
      from.approvalFor !== undefined &&
      from.approvalFor === to.workflowStepId
    ) {
      ownerOf.set(from.id, to.id);
    } else if (
      from?.kind === "step" &&
      to?.kind === "check" &&
      to.checkFor !== undefined &&
      to.checkFor === from.workflowStepId
    ) {
      ownerOf.set(to.id, from.id);
    }
  }
  if (ownerOf.size === 0) return layoutGraph(graph, nodeSize, direction, nodeSizes);

  // Reserve a whole gate/step/check chain before placing siblings, so derived cards cannot
  // occupy a sibling's column or drift into another lane at a dependency join.
  const bundles = new Map<string, RunGraphNode[]>();
  const sizes = new Map<string, RunGraphNodeSize>();
  for (const node of graph.nodes) {
    const owner = ownerOf.get(node.id) ?? node.id;
    const members = bundles.get(owner) ?? [];
    members.push(node);
    bundles.set(owner, members);
    sizes.set(node.id, nodeSizes?.get(node.id) ?? nodeSize);
  }
  const bundleSizes = new Map<string, RunGraphNodeSize>();
  const order = (node: RunGraphNode) =>
    node.kind === "approval" ? 0 : node.kind === "check" ? 2 : 1;
  for (const [id, members] of bundles) {
    members.sort((a, b) => order(a) - order(b));
    let main = -mainGap;
    let cross = 0;
    for (const member of members) {
      const size = sizes.get(member.id)!;
      main += (vertical ? size.height : size.width) + mainGap;
      cross = Math.max(cross, vertical ? size.width : size.height);
    }
    bundleSizes.set(id, vertical ? { width: cross, height: main } : { width: main, height: cross });
  }
  const bundledGraph = {
    nodes: graph.nodes.filter((node) => !ownerOf.has(node.id)),
    edges: graph.edges.flatMap((edge) => {
      if (edge.kind === "feedback") return [];
      const from = ownerOf.get(edge.from) ?? edge.from;
      const to = ownerOf.get(edge.to) ?? edge.to;
      return from === to ? [] : [{ ...edge, from, to }];
    }),
  };
  const layout = layoutGraph(bundledGraph, nodeSize, direction, bundleSizes);
  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, members] of bundles) {
    const origin = layout.positions.get(id)!;
    const bundleSize = bundleSizes.get(id)!;
    let main = 0;
    for (const member of members) {
      const size = sizes.get(member.id)!;
      positions.set(
        member.id,
        vertical
          ? { x: origin.x + (bundleSize.width - size.width) / 2, y: origin.y + main }
          : { x: origin.x + main, y: origin.y + (bundleSize.height - size.height) / 2 },
      );
      main += (vertical ? size.height : size.width) + mainGap;
    }
  }
  return nodeSizes === undefined
    ? { positions, width: layout.width, height: layout.height }
    : { positions, width: layout.width, height: layout.height, nodeSizes: sizes };
}

/** Workflow joins must clear every producer; generic run graphs retain their first-parent tree. */
function workflowDepths(graph: RunGraph): ReadonlyMap<string, number> | undefined {
  if (!graph.nodes.some((node) => node.kind === "step" && node.workflowStepId !== undefined))
    return;
  const remaining = new Map(graph.nodes.map((node) => [node.id, 0]));
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind === "feedback" || !remaining.has(edge.from) || !remaining.has(edge.to)) continue;
    remaining.set(edge.to, remaining.get(edge.to)! + 1);
    const kids = children.get(edge.from) ?? [];
    kids.push(edge.to);
    children.set(edge.from, kids);
  }
  const queue = graph.nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
  const depths = new Map(queue.map((id) => [id, 0]));
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    for (const child of children.get(id) ?? []) {
      depths.set(child, Math.max(depths.get(child) ?? 0, depths.get(id)! + 1));
      remaining.set(child, remaining.get(child)! - 1);
      if (remaining.get(child) === 0) queue.push(child);
    }
  }
  // Malformed cyclic definitions still use the cycle-breaking forest below.
  return queue.length === graph.nodes.length ? depths : undefined;
}

function layoutGraph(
  graph: RunGraph,
  nodeSize: { width: number; height: number; columnGap: number; rowGap: number },
  direction: RunGraphDirection,
  nodeSizes?: ReadonlyMap<string, RunGraphNodeSize>,
): RunGraphLayout {
  // Lay out along a main axis (depth) and a cross axis (siblings), then map them to x and y.
  const vertical = direction === "vertical";
  const mainGap = vertical ? nodeSize.columnGap * 0.75 : nodeSize.columnGap;
  const crossGap = vertical ? nodeSize.rowGap * 2 : nodeSize.rowGap;
  const sizes = new Map<string, RunGraphNodeSize>();
  for (const node of graph.nodes) {
    sizes.set(
      node.id,
      nodeSizes?.get(node.id) ?? { width: nodeSize.width, height: nodeSize.height },
    );
  }
  const sizeOf = (id: string): RunGraphNodeSize => sizes.get(id)!;
  const mainSizeOf = (id: string) => (vertical ? sizeOf(id).height : sizeOf(id).width);
  const crossSizeOf = (id: string) => (vertical ? sizeOf(id).width : sizeOf(id).height);

  const ids = new Set(graph.nodes.map((node) => node.id));
  const parents = new Set<string>();
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (
      edge.kind === "feedback" ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      parents.has(edge.to)
    )
      continue;
    parents.add(edge.to);
    const siblings = children.get(edge.from) ?? [];
    siblings.push(edge.to);
    children.set(edge.from, siblings);
  }

  const roots = [
    ...graph.nodes.filter((node) => !parents.has(node.id)),
    // A component made entirely of a cycle has no source.
    ...graph.nodes.filter((node) => parents.has(node.id)),
  ];
  // A subtree's cross-axis span is what its siblings have to make room for, so it is measured
  // from the cards it holds, bottom up.
  const spans = new Map<string, SubtreeSpan>();
  const treeChildren = new Map<string, string[]>();
  const depthOf = new Map<string, number>();
  const dependencyDepths = workflowDepths(graph);
  const forest: string[] = [];
  const visited = new Set<string>();

  function measure(id: string, kids: string[]): SubtreeSpan {
    const own = crossSizeOf(id);
    if (kids.length === 0) return { span: own, cardOffset: 0, childOffset: 0 };
    let childrenSpan = 0;
    let firstCenter = 0;
    let lastCenter = 0;
    for (const [index, kid] of kids.entries()) {
      const kidSpan = spans.get(kid)!;
      const center = childrenSpan + kidSpan.cardOffset + crossSizeOf(kid) / 2;
      if (index === 0) firstCenter = center;
      lastCenter = center;
      childrenSpan += kidSpan.span + crossGap;
    }
    childrenSpan -= crossGap;
    // The card sits between its first and last child, the way it did with equal cards.
    const cardCenter = (firstCenter + lastCenter) / 2;
    const cardTop = cardCenter - own / 2;
    const start = Math.min(0, cardTop);
    const end = Math.max(childrenSpan, cardCenter + own / 2);
    return { span: end - start, cardOffset: cardTop - start, childOffset: -start };
  }

  for (const root of roots) {
    if (visited.has(root.id)) continue;
    forest.push(root.id);
    visited.add(root.id);
    depthOf.set(root.id, dependencyDepths?.get(root.id) ?? 0);
    const stack = [{ id: root.id, depth: 0, index: 0, children: [] as string[] }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const candidates = children.get(frame.id) ?? [];
      const child = candidates[frame.index];
      if (child !== undefined) {
        frame.index += 1;
        // A node that is already being laid out is a cycle: it cannot be a child.
        if (visited.has(child)) continue;
        visited.add(child);
        frame.children.push(child);
        depthOf.set(child, dependencyDepths?.get(child) ?? frame.depth + 1);
        stack.push({ id: child, depth: frame.depth + 1, index: 0, children: [] });
        continue;
      }
      treeChildren.set(frame.id, frame.children);
      spans.set(frame.id, measure(frame.id, frame.children));
      stack.pop();
    }
  }

  // Cards on the same depth share a main-axis start, so a depth has to clear the widest
  // card on the depth before it.
  const mainExtentByDepth: number[] = [];
  for (const [id, depth] of depthOf) {
    mainExtentByDepth[depth] = Math.max(mainExtentByDepth[depth] ?? 0, mainSizeOf(id));
  }
  const mainStartByDepth = [0];
  for (const [depth, extent] of mainExtentByDepth.entries()) {
    mainStartByDepth[depth + 1] = mainStartByDepth[depth]! + extent + mainGap;
  }

  const positions = new Map<string, { x: number; y: number }>();
  let crossCursor = 0;
  for (const root of forest) {
    const stack = [{ id: root, origin: crossCursor }];
    crossCursor += spans.get(root)!.span + crossGap;
    while (stack.length > 0) {
      const frame = stack.pop()!;
      const span = spans.get(frame.id)!;
      const cross = frame.origin + span.cardOffset;
      const along = mainStartByDepth[depthOf.get(frame.id)!]!;
      positions.set(frame.id, vertical ? { x: cross, y: along } : { x: along, y: cross });
      let childOrigin = frame.origin + span.childOffset;
      for (const kid of treeChildren.get(frame.id) ?? []) {
        stack.push({ id: kid, origin: childOrigin });
        childOrigin += spans.get(kid)!.span + crossGap;
      }
    }
  }

  let width = 0;
  let height = 0;
  for (const node of graph.nodes) {
    const position = positions.get(node.id);
    if (position === undefined) continue;
    const size = sizeOf(node.id);
    width = Math.max(width, position.x + size.width);
    height = Math.max(height, position.y + size.height);
  }
  return nodeSizes === undefined
    ? { positions, width, height }
    : { positions, width, height, nodeSizes: sizes };
}
