import type { ProjectEntry } from "@t3tools/contracts";

import { checkScene, type SceneGateIssue } from "./qualityGate";
import {
  isStudioSceneSlug,
  parseSceneFile,
  STUDIO_ART_KEYS,
  studioSceneThemeId,
  type StudioSceneFile,
} from "./sceneFile";

export const SCENES_DIRECTORY = "scenes";
export const SCENE_FILE_NAME = "scene.json";

export type StudioSceneReport = {
  readonly slug: string;
  readonly themeId: string;
  readonly rawJson: string;
  readonly file: StudioSceneFile | null;
  readonly issues: ReadonlyArray<SceneGateIssue>;
};

/** Folder names directly under `scenes/`, from a `projects.listEntries` result for that folder. */
export function sceneSlugs(entries: ReadonlyArray<ProjectEntry>): string[] {
  const prefix = `${SCENES_DIRECTORY}/`;
  return entries
    .filter((entry) => entry.kind === "directory" && entry.path.startsWith(prefix))
    .map((entry) => entry.path.slice(prefix.length))
    .filter((slug) => slug.length > 0 && !slug.includes("/"))
    .toSorted();
}

/** Names of the files directly inside `folder`. */
export function fileNamesIn(entries: ReadonlyArray<ProjectEntry>, folder: string): Set<string> {
  const prefix = `${folder}/`;
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.path.startsWith(prefix)) continue;
    const name = entry.path.slice(prefix.length);
    if (!name.includes("/")) names.add(name);
  }
  return names;
}

/** The banner's file name when the scene names one and it exists. */
export function existingBanner(
  file: StudioSceneFile | null,
  fileNames: ReadonlySet<string>,
): string | null {
  const banner = file?.art?.banner;
  return banner !== undefined && fileNames.has(banner) ? banner : null;
}

export function inspectStudioScene(input: {
  readonly slug: string;
  readonly rawJson: string;
  readonly fileNames: ReadonlySet<string>;
  readonly travelerSize?: { readonly width: number; readonly height: number };
  readonly bannerSize?: { readonly width: number; readonly height: number };
}): StudioSceneReport {
  const { slug, rawJson } = input;
  const themeId = studioSceneThemeId(slug);
  const slugIssues: SceneGateIssue[] = isStudioSceneSlug(slug)
    ? []
    : [
        {
          level: "error",
          message: "Folder name must use only lowercase letters, numbers and hyphens (max 41).",
        },
      ];
  const parsed = parseSceneFile(rawJson);
  if (!parsed.ok) {
    return {
      slug,
      themeId,
      rawJson,
      file: null,
      issues: [
        ...slugIssues,
        { level: "error", message: `scene.json is invalid: ${parsed.error}` },
      ],
    };
  }
  const missingFiles = [
    ...new Set(
      STUDIO_ART_KEYS.flatMap((key) => {
        const name = parsed.file.art?.[key];
        return name === undefined || input.fileNames.has(name) ? [] : [name];
      }),
    ),
  ];
  if (
    typeof parsed.file.map.traveler === "object" &&
    !input.fileNames.has(parsed.file.map.traveler.image)
  )
    missingFiles.push(parsed.file.map.traveler.image);
  const issues = checkScene(parsed.file, {
    ...(input.travelerSize === undefined ? {} : { travelerSize: input.travelerSize }),
    missingFiles,
    ...(input.bannerSize === undefined ? {} : { bannerSize: input.bannerSize }),
  });
  return { slug, themeId, rawJson, file: parsed.file, issues: [...slugIssues, ...issues] };
}

/** A composer message asking the agent to fix a scene's issues. */
export function sceneFixPrompt(report: StudioSceneReport): string {
  const name = report.file?.name ?? report.slug;
  return [
    `Please fix these issues in the "${name}" theme (${SCENES_DIRECTORY}/${report.slug}/${SCENE_FILE_NAME}):`,
    ...report.issues.map((issue) => `- ${issue.message}`),
  ].join("\n");
}
