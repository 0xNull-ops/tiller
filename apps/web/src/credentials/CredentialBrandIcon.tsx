import { lazy, Suspense } from "react";

import { CredentialBrandMonogram } from "./CredentialBrandMonogram";
import type { CredentialBrandGlyphProps } from "./CredentialBrandGlyph";

// The brand index and the icon loader map live in this chunk, so a credential
// card costs its monogram until a brand has actually been resolved.
const LazyCredentialBrandGlyph = lazy(() =>
  import("./CredentialBrandGlyph").then(({ CredentialBrandGlyph }) => ({
    default: CredentialBrandGlyph,
  })),
);

export type CredentialBrandIconProps = CredentialBrandGlyphProps;

/**
 * A credential's brand icon, detected from its name, URLs and environment
 * variables unless the caller overrides or the template names one. Falls back to a
 * monogram: while loading, and whenever nothing matches.
 */
export function CredentialBrandIcon(props: CredentialBrandIconProps) {
  const size = props.size ?? "md";
  return (
    <Suspense fallback={<CredentialBrandMonogram name={props.name} size={size} />}>
      <LazyCredentialBrandGlyph {...props} />
    </Suspense>
  );
}
