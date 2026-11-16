import { workflowTemplates } from "@t3tools/shared/workflowTemplates";
import type { GalleryItem } from "../../workflows/workflowGallery";
export type BuiltinTemplate = (typeof workflowTemplates)[number];
export interface BuiltinGalleryItem extends GalleryItem {
  readonly template: BuiltinTemplate;
}
export function templateGalleryItems(
  installed: ReadonlySet<string>,
  hidden: ReadonlyArray<string>,
  showHidden: boolean,
): BuiltinGalleryItem[] {
  return workflowTemplates
    .filter((template) => showHidden || !hidden.includes(template.id))
    .map((template) => {
      const definition = template.definition;
      return {
        key: `builtin:${template.id}`,
        source: "builtin",
        template,
        title: definition.name,
        brief: definition.brief,
        tags: definition.tags ?? [],
        steps: definition.steps.map((step) => ({
          id: step.id,
          kind: step.kind === "workflow" ? "workflow" : "skill",
        })),
        edges: definition.steps.flatMap((step) =>
          (step.readsFrom ?? []).map((from) => ({ from, to: step.id })),
        ),
        loops: (definition.loops ?? []).map(({ from, to }) => ({ from, to })),
        digest: JSON.stringify(definition),
        workSteps: definition.steps.length,
        triggers: template.schedule ? ["schedule"] : [],
        pinned: false,
        project: "builtin",
        projectTitle: "Built-in",
        scratch: false,
        updatedAt: "",
        status: {
          runCount: 0,
          missingSkills: Object.keys(template.skills).filter((name) => !installed.has(name)),
        },
      };
    });
}
