import type { Credential } from "@t3tools/contracts";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";

/** The type a credential was created from; a template this version dropped falls back to its id. */
export const credentialTypeName = (credential: Credential): string =>
  credentialTemplate(credential.templateId)?.name ?? credential.templateId;

export interface CredentialTypeGroup {
  readonly typeName: string;
  readonly credentials: ReadonlyArray<Credential>;
}

/**
 * One group per credential type, ordered by type name. Rows keep the server's
 * order, which is creation order, so the list matches web.
 */
export function groupCredentialsByType(
  credentials: ReadonlyArray<Credential>,
): ReadonlyArray<CredentialTypeGroup> {
  const groups = new Map<string, Credential[]>();
  for (const credential of credentials) {
    const typeName = credentialTypeName(credential);
    const group = groups.get(typeName);
    if (group === undefined) groups.set(typeName, [credential]);
    else group.push(credential);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([typeName, group]) => ({ typeName, credentials: group }));
}
