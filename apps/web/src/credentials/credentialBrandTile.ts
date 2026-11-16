/** One square for every credential brand surface, so a late icon load cannot shift layout. */
export type CredentialBrandIconSize = "xs" | "sm" | "md" | "lg";

export const CREDENTIAL_BRAND_TILE_CLASS: Readonly<Record<CredentialBrandIconSize, string>> = {
  xs: "size-3.5 rounded-[.25rem]",
  sm: "size-6 rounded-md",
  md: "size-8 rounded-lg",
  lg: "size-10 rounded-xl",
};

/** The monogram tile carries its own rounding, so it only needs the square size. */
export const CREDENTIAL_BRAND_MONOGRAM_CLASS: Readonly<Record<CredentialBrandIconSize, string>> = {
  xs: "size-3.5",
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
};

export const CREDENTIAL_BRAND_GLYPH_CLASS: Readonly<Record<CredentialBrandIconSize, string>> = {
  xs: "size-2.5",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};
