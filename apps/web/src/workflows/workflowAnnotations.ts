import type { WorkflowDefinition, WorkflowNote } from "@t3tools/contracts";
import type { RunGraph } from "./runGraph";
import type { RunGraphDirection, RunGraphLayout } from "./runGraphLayout";
import {
  resourceAttachmentsOf,
  workflowCredentialCardHeight,
} from "./workflowCredentialAttachments";

const WORKFLOW_NOTE_SIZE = { width: 208, height: 96 } as const;
/** Tall enough for an attachment card's three rows: kind, name and readiness. */
export const WORKFLOW_RESOURCE_SIZE = { width: 184, height: 62 } as const;

export type WorkflowAnnotationPosition = { readonly x: number; readonly y: number };

export function workflowAnnotationPositions(input: {
  readonly definition: WorkflowDefinition;
  readonly graph: RunGraph;
  readonly layout: RunGraphLayout;
  readonly visualNodeSizes?: ReadonlyMap<
    string,
    { readonly width: number; readonly height: number }
  >;
  readonly direction: RunGraphDirection;
  readonly expandedResourceOwners: ReadonlySet<string>;
}): {
  readonly notes: ReadonlyMap<string, WorkflowAnnotationPosition>;
  readonly resources: ReadonlyMap<string, WorkflowAnnotationPosition>;
  readonly credentials: ReadonlyMap<string, WorkflowAnnotationPosition>;
  readonly width: number;
  readonly height: number;
} {
  const positions = input.layout.positions;
  const sizes = input.visualNodeSizes ?? input.layout.nodeSizes;
  const nodeByStep = new Map(
    input.graph.nodes
      .filter((node) => node.kind === "step" && node.workflowStepId)
      .map((node) => [node.workflowStepId!, node.id]),
  );
  const notes = new Map<string, WorkflowAnnotationPosition>();
  const resources = new Map<string, WorkflowAnnotationPosition>();
  const credentials = new Map<string, WorkflowAnnotationPosition>();
  const anchoredCounts = new Map<string, number>();
  const maxResourceRows = new Map(
    input.definition.steps.map((step) => {
      const rows = resourceAttachmentsOf(step).length;
      return [step.id, rows + (rows > 3 ? 1 : 0)];
    }),
  );
  const unanchoredNotes = (input.definition.notes ?? []).filter((note) => !note.anchorStepId);
  let width = input.layout.width;
  let height = input.layout.height;

  for (const note of input.definition.notes ?? []) {
    const explicit = finitePosition(note);
    if (explicit) {
      notes.set(note.id, explicit);
    } else if (note.anchorStepId) {
      const nodeId = nodeByStep.get(note.anchorStepId);
      const ownerPosition = nodeId ? positions.get(nodeId) : undefined;
      if (!nodeId || !ownerPosition) continue;
      const index = anchoredCounts.get(note.anchorStepId) ?? 0;
      anchoredCounts.set(note.anchorStepId, index + 1);
      const ownerSize = sizes?.get(nodeId) ?? { width: 200, height: 112 };
      const credentialHeight = (
        input.graph.nodes.find((node) => node.id === nodeId)?.credentials ?? []
      ).reduce((total, entry) => total + workflowCredentialCardHeight(entry) + 12, 0);
      const resourceHeight =
        (maxResourceRows.get(note.anchorStepId) ?? 0) * (WORKFLOW_RESOURCE_SIZE.height + 6);
      notes.set(note.id, {
        x: ownerPosition.x,
        y:
          ownerPosition.y + ownerSize.height + 16 + resourceHeight + credentialHeight + index * 108,
      });
    } else {
      const index = unanchoredNotes.indexOf(note);
      notes.set(
        note.id,
        input.direction === "vertical"
          ? { x: 0, y: input.layout.height + 28 + index * 108 }
          : { x: input.layout.width + 28, y: index * 108 },
      );
    }
  }

  const resourceRows = new Map<string, number>();
  for (const step of input.definition.steps) {
    const attachments = resourceAttachmentsOf(step);
    if (!attachments.length) continue;
    const nodeId = nodeByStep.get(step.id);
    const ownerPosition = nodeId ? positions.get(nodeId) : undefined;
    if (!nodeId || !ownerPosition) continue;
    const ownerSize = sizes?.get(nodeId) ?? { width: 200, height: 112 };
    const isExpanded = input.expandedResourceOwners.has(step.id);
    const visible = isExpanded ? attachments : attachments.slice(0, 3);
    for (const [index, attachment] of visible.entries()) {
      resources.set(
        `${step.id}/${attachment.id}`,
        input.definition.layout?.[`resource:${step.id}:${attachment.id}`] ?? {
          x: ownerPosition.x,
          y: ownerPosition.y + ownerSize.height + 12 + index * (WORKFLOW_RESOURCE_SIZE.height + 6),
        },
      );
    }
    if (!isExpanded && attachments.length > 3) {
      const index = visible.length;
      resourceRows.set(step.id, index + 1);
      resources.set(`${step.id}/__more`, {
        x: ownerPosition.x,
        y: ownerPosition.y + ownerSize.height + 12 + index * (WORKFLOW_RESOURCE_SIZE.height + 6),
      });
    } else {
      resourceRows.set(step.id, attachments.length + (attachments.length > 3 ? 1 : 0));
    }
  }

  for (const [stepId, rows] of resourceRows) {
    const nodeId = nodeByStep.get(stepId);
    const ownerPosition = nodeId ? positions.get(nodeId) : undefined;
    const ownerSize = nodeId ? sizes?.get(nodeId) : undefined;
    if (!ownerPosition) continue;
    width = Math.max(
      width,
      ownerPosition.x + (ownerSize?.width ?? 200),
      WORKFLOW_RESOURCE_SIZE.width,
    );
    height = Math.max(
      height,
      ownerPosition.y +
        (ownerSize?.height ?? 112) +
        12 +
        rows * (WORKFLOW_RESOURCE_SIZE.height + 6),
    );
  }
  for (const position of resources.values()) {
    width = Math.max(width, position.x + WORKFLOW_RESOURCE_SIZE.width);
    height = Math.max(height, position.y + WORKFLOW_RESOURCE_SIZE.height);
  }
  for (const node of input.graph.nodes) {
    if (!node.workflowStepId || !node.credentials?.length) continue;
    const owner = positions.get(node.id);
    if (!owner) continue;
    const ownerSize = sizes?.get(node.id) ?? { width: 200, height: 112 };
    let y =
      owner.y +
      ownerSize.height +
      12 +
      (resourceRows.get(node.workflowStepId) ?? 0) * (WORKFLOW_RESOURCE_SIZE.height + 6);
    for (const entry of node.credentials) {
      // Attached credentials key their card by attachment id, so binding one never moves it.
      const key = entry.key;
      const position = input.definition.layout?.[key] ?? { x: owner.x, y };
      credentials.set(key, position);
      const cardHeight = workflowCredentialCardHeight(entry);
      width = Math.max(width, position.x + 360);
      height = Math.max(height, position.y + cardHeight);
      y += cardHeight + 12;
    }
  }
  for (const position of notes.values()) {
    width = Math.max(width, position.x + WORKFLOW_NOTE_SIZE.width);
    height = Math.max(height, position.y + WORKFLOW_NOTE_SIZE.height);
  }

  return { notes, resources, credentials, width, height };
}

function finitePosition(note: WorkflowNote): WorkflowAnnotationPosition | null {
  return Number.isFinite(note.x) && Number.isFinite(note.y) ? { x: note.x!, y: note.y! } : null;
}

export function workflowNoteId(noteId: string) {
  return `note/${noteId}`;
}

export function workflowAttachmentId(stepId: string, attachmentId: string) {
  return `attachment/${stepId}/${attachmentId}`;
}
