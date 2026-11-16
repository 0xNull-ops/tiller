import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

export const STUDIO_PROJECT_TITLE = "Tiller Theme Studio";

/** Matched by title so the studio stays hidden on every device, not only the one that made it. */
export function isStudioProject(project: Pick<EnvironmentProject, "title"> | null | undefined) {
  return project?.title === STUDIO_PROJECT_TITLE;
}

export function withoutStudioProjects<T extends Pick<EnvironmentProject, "title">>(
  projects: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return projects.some(isStudioProject)
    ? projects.filter((project) => !isStudioProject(project))
    : projects;
}

export function isStudioThreadContext(
  thread: { readonly environmentId: string; readonly projectId: string } | null | undefined,
  projects: ReadonlyArray<Pick<EnvironmentProject, "id" | "environmentId" | "title">>,
): boolean {
  return (
    thread != null &&
    projects.some(
      (project) =>
        project.id === thread.projectId &&
        project.environmentId === thread.environmentId &&
        isStudioProject(project),
    )
  );
}
