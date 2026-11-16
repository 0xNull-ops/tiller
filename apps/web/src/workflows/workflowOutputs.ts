import type { WorkflowDefinition, WorkflowRun } from "@t3tools/contracts";
import type { RunGraph } from "./runGraph";
import {
  resourceAttachmentsOf,
  workflowCredentialCardHeight,
} from "./workflowCredentialAttachments";

export type WorkflowOutput = {
  readonly key: string;
  readonly value: string;
  readonly kind: "url" | "image" | "html" | "file" | "text";
};
const IMAGE_PATH = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg|ico)$/i;
const HTML_PATH = /\.html?$/i;
const FILE_PATH = /(?:[/\\]|\.[a-z0-9]{1,12}$)/i;
const PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

export function workflowOutputs(
  outputs: Readonly<Record<string, string>> | undefined,
): WorkflowOutput[] {
  return Object.entries(outputs ?? {})
    .filter(([, value]) => value.trim())
    .map(([key, value]) => {
      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const url = new URL(trimmed);
          return { key, value: url.href, kind: "url" };
        } catch {
          /* Show malformed URLs as text. */
        }
      }
      const local = !PROTOCOL.test(trimmed) || /^[a-z]:[/\\]/i.test(trimmed);
      return {
        key,
        value: trimmed,
        kind:
          local && IMAGE_PATH.test(trimmed)
            ? "image"
            : local && HTML_PATH.test(trimmed)
              ? "html"
              : local && FILE_PATH.test(trimmed)
                ? "file"
                : "text",
      };
    });
}

/** An output a card can show as a thumbnail. */
export type WorkflowThumbnailOutput = WorkflowOutput & {
  readonly kind: "url" | "image" | "html";
};

/** How one step's outputs are split across the card's thumbnail, chips and text rows. */
export type WorkflowOutputLayout = {
  /** The first output a card can show as a thumbnail. */
  readonly main: WorkflowThumbnailOutput | null;
  /** The remaining files and links, shown as chips. */
  readonly chips: readonly WorkflowOutput[];
  /** Plain values, shown as rows of text. */
  readonly texts: readonly WorkflowOutput[];
  /** Outputs the strip leaves out; the step detail still lists them. */
  readonly hidden: number;
};

const MAX_CHIPS = 3;
const MAX_TEXTS = 2;

const isThumbnail = (output: WorkflowOutput): output is WorkflowThumbnailOutput =>
  output.kind === "url" || output.kind === "image" || output.kind === "html";

export function workflowOutputLayout(outputs: readonly WorkflowOutput[]): WorkflowOutputLayout {
  const main = outputs.find(isThumbnail) ?? null;
  const rest = outputs.filter((output) => output !== main);
  const chips = rest.filter((output) => output.kind !== "text");
  const texts = rest.filter((output) => output.kind === "text");
  return {
    main,
    chips: chips.slice(0, MAX_CHIPS),
    texts: texts.slice(0, MAX_TEXTS),
    hidden: Math.max(0, chips.length - MAX_CHIPS) + Math.max(0, texts.length - MAX_TEXTS),
  };
}

/**
 * The canvas lays the cards out before they render, so the strip's height has to be
 * known up front. These are the sizes the strip draws itself at, measured from the
 * card's width rather than from the DOM.
 */
const CARD_CONTENT_WIDTH = 178; // the 200px card, less its border and padding
const THUMBNAIL_HEIGHT = 111; // the 16:10 thumbnail at that width
const LABEL_HEIGHT = 28; // the size="xs" button under the thumbnail, at its tallest
const CHIP_HEIGHT = 26; // a chip around one text-2xs line
const TEXT_HEIGHT = 16; // one text-2xs line
const ROW_GAP = 4; // gap-1 between the strip's rows
const STRIP_PADDING = 8; // py-1
const CARD_GAP = 4; // gap-1 between the card body and the strip
const CHIP_CHROME = 34; // the chip's icon, its gap, its padding and its border
const CHIP_CHAR_WIDTH = 6; // one text-2xs character
const CHIP_LABEL_WIDTH = 128; // max-w-32 on the chip's label
const MORE_WIDTH = 48; // the "+N more" button

/** How many rows the chips wrap into, estimated from how wide their labels read. */
function chipRows(chips: readonly WorkflowOutput[], hidden: number): number {
  if (chips.length === 0 && hidden === 0) return 0;
  let rows = 1;
  let used = 0;
  const place = (width: number) => {
    if (used > 0 && used + ROW_GAP + width > CARD_CONTENT_WIDTH) {
      rows += 1;
      used = width;
      return;
    }
    used += (used > 0 ? ROW_GAP : 0) + width;
  };
  for (const chip of chips) {
    place(CHIP_CHROME + Math.min(chip.key.length * CHIP_CHAR_WIDTH, CHIP_LABEL_WIDTH));
  }
  if (hidden > 0) place(MORE_WIDTH);
  return rows;
}

function workflowOutputStripHeight(outputs: readonly WorkflowOutput[]): number {
  const layout = workflowOutputLayout(outputs);
  const rows: number[] = [];
  if (layout.main) rows.push(THUMBNAIL_HEIGHT + ROW_GAP + LABEL_HEIGHT);
  const chips = chipRows(layout.chips, layout.hidden);
  if (chips > 0) rows.push(chips * CHIP_HEIGHT + (chips - 1) * ROW_GAP);
  if (layout.texts.length > 0) rows.push(layout.texts.length * TEXT_HEIGHT);
  const content = rows.reduce((total, row) => total + row, 0);
  return STRIP_PADDING + content + ROW_GAP * Math.max(0, rows.length - 1);
}

const START_CARD_MIN = { width: 240, height: 116 } as const;

export function workflowCardSizes(
  graph: RunGraph,
  run: WorkflowRun | null,
  baseSize: { readonly width: number; readonly height: number },
  showOutputs: boolean,
) {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const node of graph.nodes) {
    sizes.set(node.id, {
      width: baseSize.width,
      height: baseSize.height + (node.credentials?.length ? 36 : 0),
    });
    if (node.kind === "check") sizes.set(node.id, { width: 168, height: 54 });
    // The start card holds a title row, triggers and an input list, so it never shrinks.
    if (node.kind === "workflow" && showOutputs)
      sizes.set(node.id, {
        width: Math.max(baseSize.width, START_CARD_MIN.width),
        height: Math.max(baseSize.height, START_CARD_MIN.height),
      });
  }
  if (!run || !showOutputs) return sizes;
  for (const step of run.steps) {
    if (step.status !== "done" && !(step.status === "waiting" && step.waitingFor === "resume"))
      continue;
    const outputs = workflowOutputs(step.outputs);
    if (!outputs.length) continue;
    const id = `${run.id}:${step.stepId}`;
    if (!graph.nodes.some((node) => node.id === id)) continue;
    sizes.set(id, {
      width: baseSize.width,
      height:
        (sizes.get(id)?.height ?? baseSize.height) + CARD_GAP + workflowOutputStripHeight(outputs),
    });
  }
  return sizes;
}

/** Reserves owner lanes in graph layout while keeping satellite cards outside the execution graph. */
export function workflowAnnotationLayoutSizes(
  cardSizes: ReadonlyMap<string, { readonly width: number; readonly height: number }>,
  graph: RunGraph,
  definition: WorkflowDefinition | null,
) {
  const sizes = new Map(cardSizes);
  if (!definition) return sizes;
  const nodeByStep = new Map(
    graph.nodes
      .filter((node) => node.kind === "step" && node.workflowStepId)
      .map((node) => [node.workflowStepId!, node.id]),
  );
  for (const step of definition.steps) {
    const nodeId = nodeByStep.get(step.id);
    if (!nodeId) continue;
    const resourceCount = resourceAttachmentsOf(step).length;
    const anchoredNoteCount =
      definition.notes?.filter((note) => note.anchorStepId === step.id).length ?? 0;
    const resourceRows = resourceCount + (resourceCount > 3 ? 1 : 0);
    const credentialEntries = graph.nodes.find((node) => node.id === nodeId)?.credentials ?? [];
    const credentialHeight = credentialEntries.reduce(
      (total, entry) => total + workflowCredentialCardHeight(entry) + 12,
      0,
    );
    const reserved =
      (resourceRows ? 12 + resourceRows * 62 : 0) + anchoredNoteCount * 108 + credentialHeight;
    if (reserved === 0) continue;
    const current = sizes.get(nodeId) ?? { width: 200, height: 112 };
    sizes.set(nodeId, { ...current, height: current.height + reserved });
  }
  return sizes;
}
