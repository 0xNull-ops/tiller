import type { CredentialPolicy, ProjectId } from "@t3tools/contracts";

/** A stored file's size, in the units a phone screen has room for. */
export function credentialFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * Which projects a credential is offered to, by name. Ids this device cannot
 * resolve are counted rather than dropped: a project deleted elsewhere must not
 * make the scope look narrower than it is.
 */
export function credentialProjectScopeLabel(
  policy: CredentialPolicy,
  projectTitleById: ReadonlyMap<ProjectId, string>,
): string {
  if (policy.projects === "all") return "All projects";
  if (policy.projects.length === 0) return "No projects";
  const titles: string[] = [];
  for (const projectId of policy.projects) {
    const title = projectTitleById.get(projectId);
    if (title !== undefined) titles.push(title);
  }
  const unavailable = policy.projects.length - titles.length;
  if (unavailable === policy.projects.length) {
    return `${unavailable} unavailable ${unavailable === 1 ? "project" : "projects"}`;
  }
  const listed = titles.join(", ");
  return unavailable === 0 ? listed : `${listed} + ${unavailable} unavailable`;
}
