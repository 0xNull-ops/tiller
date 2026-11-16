import type { WorkflowListing } from "@t3tools/contracts";
import { useState, type DragEvent } from "react";
import { toCanvasPoint, type Camera } from "./canvasCamera";
import type { RunGraph } from "./runGraph";
import type { RunGraphLayout } from "./runGraphLayout";
import { skillNameFromFile } from "./workflowEditing";
import { stepAtPoint } from "./canvasSpots";

type Confirmation = {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
};

export function useWorkflowSkillDrop(options: {
  readonly editable: boolean;
  readonly listing: WorkflowListing | null;
  readonly graph: RunGraph;
  readonly layout: RunGraphLayout;
  readonly view: Camera;
  readonly nodeSize: { readonly width: number; readonly height: number };
  readonly onDropSkill: (name: string, content: string, stepId: string | null) => Promise<unknown>;
  readonly onError: (message: string) => void;
  readonly onConfirm: (confirmation: Confirmation) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!options.editable) return;
    event.preventDefault();
    setDropActive(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!options.editable) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = toCanvasPoint(options.view, rect, event.clientX, event.clientY);
    const stepId = stepAtPoint(options.graph, options.layout, options.nodeSize, point);
    setDropTarget((previous) => (previous === stepId ? previous : stepId));
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Moving onto a card inside the canvas is not leaving it.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropActive(false);
      setDropTarget(null);
    }
  };
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(false);
    if (!options.editable) return;
    const file = Array.from(event.dataTransfer.files).find((item) =>
      item.name.toLowerCase().endsWith(".md"),
    );
    if (!file) {
      options.onError("Drop the SKILL.md file itself; folders come later");
      return;
    }
    const content = await file.text();
    const name = skillNameFromFile(content, file.name);
    if (!name) {
      options.onError("Add `name:` to the skill's frontmatter");
      return;
    }
    const stepId = dropTarget;
    setDropTarget(null);
    const exists = options.listing?.skills.some(
      (skill) => skill.scope === "project" && skill.name.toLowerCase() === name.toLowerCase(),
    );
    if (!exists) {
      await options.onDropSkill(name, content, stepId);
      return;
    }
    options.onConfirm({
      title: "Overwrite project skill?",
      description: `The project skill “${name}” already exists. Replace it with this SKILL.md?`,
      confirmLabel: "Overwrite skill",
      onConfirm: () => void options.onDropSkill(name, content, stepId),
    });
  };

  return { dropActive, dropTarget, onDragEnter, onDragOver, onDragLeave, onDrop };
}
