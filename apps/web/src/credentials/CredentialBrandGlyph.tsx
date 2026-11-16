import {
  credentialBrandGlyphTone,
  credentialBrandRecord,
  matchCredentialBrand,
} from "@t3tools/shared/credentialBrand";
import { Suspense, use } from "react";

import { cn } from "~/lib/utils";
import { CredentialBrandMonogram } from "./CredentialBrandMonogram";
import {
  CREDENTIAL_BRAND_GLYPH_CLASS,
  CREDENTIAL_BRAND_TILE_CLASS,
  type CredentialBrandIconSize,
} from "./credentialBrandTile";

/**
 * Every simple-icons glyph as its own lazy chunk (`?raw` keeps the module cost to
 * the 1 KB SVG). The glob is the loader map only: nothing here is bundled until a
 * slug asks for it, and the map itself is a few hundred KB of function stubs that
 * lives in this credential-only chunk.
 */
const iconLoaders = import.meta.glob("../../node_modules/simple-icons/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: false,
}) as Readonly<Record<string, () => Promise<string>>>;

const ICON_PATH_PREFIX = "../../node_modules/simple-icons/icons/";

interface CredentialBrandGlyphData {
  readonly path: string;
}

/** Parsed icon promise per slug, so `use` sees the same promise on every render. */
const iconCache = new Map<string, Promise<CredentialBrandGlyphData | null>>();

function readGlyph(source: string): CredentialBrandGlyphData | null {
  // simple-icons ships one `<path d>` per icon on a 24x24 viewBox.
  const commands = [...source.matchAll(/<path[^>]*\sd="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((command): command is string => Boolean(command));
  return commands.length > 0 ? { path: commands.join(" ") } : null;
}

function loadGlyph(slug: string): Promise<CredentialBrandGlyphData | null> {
  const cached = iconCache.get(slug);
  if (cached) return cached;
  const load = iconLoaders[`${ICON_PATH_PREFIX}${slug}.svg`];
  const pending = load
    ? load().then(readGlyph, () => null)
    : Promise.resolve<CredentialBrandGlyphData | null>(null);
  iconCache.set(slug, pending);
  return pending;
}

export interface CredentialBrandGlyphProps {
  readonly name: string;
  readonly templateIcon?: string | null | undefined;
  readonly iconOverride?: string | null | undefined;
  readonly envVars?: readonly string[] | undefined;
  readonly urls?: readonly string[] | undefined;
  readonly size?: CredentialBrandIconSize | undefined;
}

/**
 * Resolves a credential to a brand and draws it. Lives in its own chunk because it
 * imports the brand index; callers render it through `CredentialBrandIcon`.
 */
export function CredentialBrandGlyph(props: CredentialBrandGlyphProps) {
  const size = props.size ?? "md";
  const match = matchCredentialBrand(props);
  const record = match ? credentialBrandRecord(match.slug) : null;
  if (!record) return <CredentialBrandMonogram name={props.name} size={size} />;
  return (
    <Suspense fallback={<CredentialBrandMonogram name={props.name} size={size} />}>
      <BrandGlyphTile slug={record.slug} hex={record.hex} name={props.name} size={size} />
    </Suspense>
  );
}

function BrandGlyphTile({
  slug,
  hex,
  name,
  size,
}: {
  readonly slug: string;
  readonly hex: string;
  readonly name: string;
  readonly size: CredentialBrandIconSize;
}) {
  const glyph = use(loadGlyph(slug));
  if (!glyph) return <CredentialBrandMonogram name={name} size={size} />;
  const tone = credentialBrandGlyphTone(hex);
  // The brand colour is data, not a design token, so it is the one value that
  // cannot come from a class. The tint derives from the same colour, as the
  // project monogram does, and the opposite branch uses theme tokens instead.
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        CREDENTIAL_BRAND_TILE_CLASS[size],
        tone === "foreground" && "bg-foreground/8",
      )}
      style={
        tone === "brand"
          ? { backgroundColor: `color-mix(in srgb, ${hex} 16%, transparent)` }
          : undefined
      }
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        className={cn(
          CREDENTIAL_BRAND_GLYPH_CLASS[size],
          tone === "foreground" && "text-foreground",
        )}
        style={tone === "brand" ? { color: hex } : undefined}
      >
        <path d={glyph.path} fill="currentColor" />
      </svg>
    </span>
  );
}
