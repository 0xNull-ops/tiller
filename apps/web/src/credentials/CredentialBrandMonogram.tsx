import { ProjectMonogram } from "../components/ProjectMonogram";
import { deriveProjectIdentity } from "../projectIdentity";
import {
  CREDENTIAL_BRAND_MONOGRAM_CLASS,
  type CredentialBrandIconSize,
} from "./credentialBrandTile";

/**
 * The fallback for a credential with no brand, and the placeholder while a brand
 * icon chunk loads. Reuses the project monogram so both look like siblings.
 */
export function CredentialBrandMonogram({
  name,
  size = "md",
}: {
  readonly name: string;
  readonly size?: CredentialBrandIconSize | undefined;
}) {
  const identity = deriveProjectIdentity(name);
  return (
    <ProjectMonogram
      text={identity.monogram}
      color={identity.color}
      className={CREDENTIAL_BRAND_MONOGRAM_CLASS[size]}
    />
  );
}
