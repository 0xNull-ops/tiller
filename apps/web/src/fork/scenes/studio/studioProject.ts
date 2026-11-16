// fork(scenes): the hidden project the Theme Studio's threads run in.
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, ProjectId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { readProject, readProjects, waitForProject } from "../../../state/entities";
import { projectEnvironment } from "../../../state/projects";
import { STUDIO_INSTRUCTIONS } from "./studioInstructions";

import { isStudioProject, STUDIO_PROJECT_TITLE } from "./studioProjectIdentity";
export { isStudioProject, withoutStudioProjects } from "./studioProjectIdentity";

const STORAGE_KEY = "tiller:theme-studio-project:v1";
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

let studioKeysFor: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly keys: ReadonlySet<string>;
} | null = null;

/** Whether a thread runs in a studio project; the key set is rebuilt only when projects change. */
export function isStudioThread(thread: {
  readonly environmentId: string;
  readonly projectId: string;
}): boolean {
  const projects = readProjects();
  if (studioKeysFor?.projects !== projects) {
    studioKeysFor = {
      projects,
      keys: new Set(
        projects.filter(isStudioProject).map((project) => `${project.environmentId}:${project.id}`),
      ),
    };
  }
  return (
    studioKeysFor.keys.size > 0 &&
    studioKeysFor.keys.has(`${thread.environmentId}:${thread.projectId}`)
  );
}

function readRemembered(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function remember(environmentId: EnvironmentId, projectId: ProjectId) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readRemembered(), [environmentId]: projectId }),
    );
  } catch {
    // Storage can be blocked; the studio is found again by its title.
  }
}

function findStudioProject(environmentId: EnvironmentId): EnvironmentProject | null {
  const rememberedId = readRemembered()[environmentId];
  const remembered =
    typeof rememberedId === "string"
      ? readProject(scopeProjectRef(environmentId, ProjectId.make(rememberedId)))
      : null;
  if (isStudioProject(remembered)) return remembered;
  const candidates = readProjects().filter(
    (project) => project.environmentId === environmentId && isStudioProject(project),
  );
  return candidates.find((project) => project.archivedAt == null) ?? candidates[0] ?? null;
}

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}

/** Finds or creates the studio project and refreshes its agent instructions. */
export async function ensureStudioProject(
  environmentId: EnvironmentId,
): Promise<EnvironmentProject> {
  let project = findStudioProject(environmentId);
  if (project === null) {
    const created = await runAtomCommand(
      appAtomRegistry,
      projectEnvironment.createNew,
      { environmentId, input: { name: STUDIO_PROJECT_TITLE } },
      { reportFailure: false },
    );
    if (created._tag === "Failure") {
      throw new Error(
        failureMessage(squashAtomCommandFailure(created), "Could not create the studio project."),
      );
    }
    project = await waitForProject(scopeProjectRef(environmentId, created.value.projectId));
  }
  remember(environmentId, project.id);
  for (const relativePath of INSTRUCTION_FILES) {
    const written = await runAtomCommand(
      appAtomRegistry,
      projectEnvironment.writeFile,
      {
        environmentId,
        input: { cwd: project.workspaceRoot, relativePath, contents: STUDIO_INSTRUCTIONS },
      },
      { reportFailure: false },
    );
    if (written._tag === "Failure") {
      throw new Error(
        failureMessage(
          squashAtomCommandFailure(written),
          "Could not write the studio's agent instructions.",
        ),
      );
    }
  }
  return project;
}
