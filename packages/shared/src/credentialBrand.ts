/**
 * Brand detection for credentials, shared so web and mobile agree on which logo a
 * credential shows. Everything here is dependency-free: the brand list is a
 * generated string of slug/title/hex/aliases (see
 * `apps/web/scripts/generate-credential-brand-index.ts`), never simple-icons'
 * icon paths, so importing this module cannot pull the icon set into a bundle.
 *
 * Brands that simple-icons dropped at the owner's request (AWS, OpenAI, Slack,
 * Twilio, Heroku) match nothing here on purpose: there is no licence-clear mark
 * to bundle for them, so they fall through to the monogram.
 */
import { CREDENTIAL_BRAND_ROWS } from "./credentialBrandIndex.ts";

export interface CredentialBrandRecord {
  readonly slug: string;
  readonly title: string;
  /** `#rrggbb`, from the brand's simple-icons entry. */
  readonly hex: string;
  readonly aliases: readonly string[];
}

export interface CredentialBrandMatchInput {
  /** The credential's name, e.g. "App Store Connect — Acme". */
  readonly name: string;
  /** A slug the user picked. Wins over everything else. */
  readonly iconOverride?: string | null | undefined;
  /** A slug the credential's template names. Wins over detection. */
  readonly templateIcon?: string | null | undefined;
  /** Env-var names the credential stores, e.g. `STRIPE_SECRET_KEY`. */
  readonly envVars?: readonly string[] | undefined;
  /** URLs or bare hosts the credential points at, e.g. `api.stripe.com`. */
  readonly urls?: readonly string[] | undefined;
}

export interface CredentialBrandMatch {
  readonly slug: string;
}

interface BrandIndex {
  readonly records: readonly CredentialBrandRecord[];
  readonly bySlug: ReadonlyMap<string, CredentialBrandRecord>;
  /** Normalized title, alias or slug words to slug. Longest match wins at lookup time. */
  readonly byName: ReadonlyMap<string, string>;
}

/** Hosts whose registrable label is not the brand's slug. Longest suffix wins. */
const HOST_SLUGS: ReadonlyArray<readonly [host: string, slug: string]> = [
  ["appstoreconnect.apple.com", "appstore"],
  ["itunesconnect.apple.com", "appstore"],
  ["firebase.google.com", "firebase"],
  ["api.stripe.com", "stripe"],
  ["stripe.com", "stripe"],
  ["supabase.co", "supabase"],
  ["supabase.com", "supabase"],
  ["firebaseio.com", "firebase"],
  ["github.com", "github"],
  ["githubusercontent.com", "github"],
  ["vercel.com", "vercel"],
  ["vercel.app", "vercel"],
  ["revenuecat.com", "revenuecat"],
  ["cloudflare.com", "cloudflare"],
  ["cloudflareapi.com", "cloudflare"],
  ["sentry.io", "sentry"],
  ["docker.io", "docker"],
  ["docker.com", "docker"],
  ["netlify.app", "netlify"],
  ["netlify.com", "netlify"],
  ["resend.com", "resend"],
  ["linear.app", "linear"],
  ["notion.so", "notion"],
  ["notion.com", "notion"],
  ["expo.dev", "expo"],
  ["npmjs.com", "npm"],
  ["npmjs.org", "npm"],
  ["apple.com", "apple"],
  ["myshopify.com", "shopify"],
  ["shopify.com", "shopify"],
  ["neon.tech", "neon"],
  ["planetscale.com", "planetscale"],
  ["railway.app", "railway"],
  ["fly.io", "flydotio"],
  ["digitalocean.com", "digitalocean"],
  ["mongodb.com", "mongodb"],
  ["mongodb.net", "mongodb"],
  ["redis.io", "redis"],
  ["googleapis.com", "googlecloud"],
  ["anthropic.com", "anthropic"],
];

/** Env prefixes whose spelling is not a brand title, longest first within a var. */
const ENV_PREFIX_SLUGS: Readonly<Record<string, string>> = {
  APP_STORE: "appstore",
  APP_STORE_CONNECT: "appstore",
  APPSTORE: "appstore",
  ASC: "appstore",
  CF: "cloudflare",
  CLOUDFLARE: "cloudflare",
  EAS: "expo",
  EXPO: "expo",
  GCP: "googlecloud",
  GH: "github",
  GOOGLE_CLOUD: "googlecloud",
  NPM: "npm",
  REVENUECAT: "revenuecat",
  STRIPE: "stripe",
};

/** A title, alias or slug under this length is too ambiguous to match by word. */
const MIN_NAME_KEY_LENGTH = 3;

/** Longest environment prefix considered, in underscore-separated tokens. */
const MAX_ENV_PREFIX_TOKENS = 3;

/** Longest run of words considered when matching a brand title. */
const MAX_NAME_WORDS = 4;

let cachedIndex: BrandIndex | null = null;

/**
 * Strips accents, case and punctuation so "App Store Connect — Acme" and
 * "appstore connect" compare equal. Scripts without ASCII letters normalize to
 * an empty string, which makes them unmatchable rather than wrongly matched.
 */
function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function nameKey(value: string): string | null {
  const normalized = normalizeWords(value);
  return normalized.replaceAll(" ", "").length >= MIN_NAME_KEY_LENGTH ? normalized : null;
}

function buildIndex(): BrandIndex {
  const records: CredentialBrandRecord[] = [];
  for (const row of CREDENTIAL_BRAND_ROWS.split("\n")) {
    const [slug, title, hex, aliases = ""] = row.split("\t");
    if (!slug || !title || !hex) continue;
    records.push({
      slug,
      title,
      hex: `#${hex.toLowerCase()}`,
      aliases: aliases.split("|").filter(Boolean),
    });
  }

  const bySlug = new Map(records.map((record) => [record.slug, record] as const));
  records.sort((left, right) => (left.title < right.title ? -1 : left.title > right.title ? 1 : 0));

  // Titles win over aliases, which win over slug words: an alias that repeats
  // another brand's title should not shadow that brand.
  const byName = new Map<string, string>();
  const addKeys = (values: Iterable<string>, slug: string) => {
    for (const value of values) {
      const key = nameKey(value);
      if (key && !byName.has(key)) byName.set(key, slug);
    }
  };
  for (const record of records) addKeys([record.title], record.slug);
  for (const record of records) addKeys(record.aliases, record.slug);
  for (const record of records) addKeys([record.slug.replaceAll(/-/g, " ")], record.slug);

  return { records, bySlug, byName };
}

function brandIndex(): BrandIndex {
  cachedIndex ??= buildIndex();
  return cachedIndex;
}

export function credentialBrandRecord(slug: string): CredentialBrandRecord | null {
  return brandIndex().bySlug.get(slug) ?? null;
}

function matchNameWords(value: string): string | null {
  const index = brandIndex();
  const words = normalizeWords(value).split(" ").filter(Boolean);
  // Longest run first: "App Store Connect" beats "App Store".
  for (let length = Math.min(words.length, MAX_NAME_WORDS); length >= 1; length -= 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const slug = index.byName.get(words.slice(start, start + length).join(" "));
      if (slug) return slug;
    }
  }
  return null;
}

function matchHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  let host: string;
  try {
    host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/u, "").replace(/^www\./u, "");
  if (!host) return null;

  let best: { readonly length: number; readonly slug: string } | null = null;
  for (const [ruleHost, slug] of HOST_SLUGS) {
    if (host === ruleHost || host.endsWith(`.${ruleHost}`)) {
      if (!best || ruleHost.length > best.length) best = { length: ruleHost.length, slug };
    }
  }
  if (best) return best.slug;

  // "api.stripe.com" and "xyz.supabase.co" name their brand in a non-final label.
  const labels = host.split(".");
  for (let start = 0; start <= labels.length - 2; start += 1) {
    const candidate = labels.slice(start, -1).join(" ");
    const slug = brandIndex().byName.get(nameKey(candidate) ?? "");
    if (slug) return slug;
  }
  return null;
}

function matchEnvVar(value: string): string | null {
  const tokens = value.trim().toUpperCase().split("_").filter(Boolean);
  if (tokens.length === 0) return null;
  const index = brandIndex();
  for (let length = Math.min(tokens.length, MAX_ENV_PREFIX_TOKENS); length >= 1; length -= 1) {
    const prefix = tokens.slice(0, length).join("_");
    const hint = ENV_PREFIX_SLUGS[prefix];
    if (hint) return hint;
    const slug = index.byName.get(nameKey(prefix) ?? "");
    if (slug) return slug;
  }
  return null;
}

/**
 * Which brand a credential belongs to, or null when nothing matches and the
 * caller should draw a monogram. Detection order is override, template, URL,
 * env prefix, then name, and the first hit wins.
 */
export function matchCredentialBrand(
  input: CredentialBrandMatchInput,
): CredentialBrandMatch | null {
  const index = brandIndex();
  const lookup = (slug: string | null | undefined) => {
    const trimmed = slug?.trim().toLowerCase();
    return trimmed ? (index.bySlug.get(trimmed)?.slug ?? null) : null;
  };

  const override = lookup(input.iconOverride);
  if (override) return { slug: override };
  const template = lookup(input.templateIcon);
  if (template) return { slug: template };

  for (const url of input.urls ?? []) {
    const slug = matchHost(url);
    if (slug) return { slug };
  }
  for (const envVar of input.envVars ?? []) {
    const slug = matchEnvVar(envVar);
    if (slug) return { slug };
  }
  const name = matchNameWords(input.name);
  return name ? { slug: name } : null;
}

/**
 * Picker results, best first: title prefixes, then title fragments, then slugs,
 * then anything else. Capped because a search for "a" matches most of the set.
 */
export function searchCredentialBrands(
  query: string,
  limit = 60,
): readonly CredentialBrandRecord[] {
  const records = brandIndex().records;
  const needle = query.trim().toLowerCase();
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  const target = compact(needle);
  if (!target) return records.slice(0, limit);

  const ranked: Array<{ readonly record: CredentialBrandRecord; readonly rank: number }> = [];
  for (const record of records) {
    const title = compact(record.title);
    const rank = title.startsWith(target)
      ? 0
      : title.includes(target)
        ? 1
        : compact(record.slug).includes(target)
          ? 2
          : record.aliases.some((alias) => compact(alias).includes(target))
            ? 3
            : -1;
    if (rank >= 0) ranked.push({ record, rank });
  }
  ranked.sort(
    (left, right) =>
      left.rank - right.rank ||
      (left.record.title < right.record.title
        ? -1
        : left.record.title > right.record.title
          ? 1
          : 0),
  );
  return ranked.slice(0, limit).map((entry) => entry.record);
}

export type CredentialBrandGlyphTone = "brand" | "foreground";

/**
 * Below this relative luminance a brand colour (GitHub, Vercel, Apple, Expo,
 * Anthropic, Notion, PlanetScale…) disappears on a dark surface.
 */
const NEAR_BLACK_LUMINANCE = 0.13;

/** Above this it disappears on a light surface. */
const NEAR_WHITE_LUMINANCE = 0.86;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb`, or null when the hex is not parseable. */
export function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const value = Number.parseInt(digits, 16);
  return (
    0.2126 * channelLuminance((value >> 16) & 0xff) +
    0.7152 * channelLuminance((value >> 8) & 0xff) +
    0.0722 * channelLuminance(value & 0xff)
  );
}

/**
 * Whether a brand's own colour can carry the glyph, or the glyph has to take the
 * theme foreground on a muted tile. Near-black and near-white are unreadable on
 * one of the two themes, and no single colour works for both.
 */
export function credentialBrandGlyphTone(hex: string): CredentialBrandGlyphTone {
  const luminance = relativeLuminance(hex);
  if (luminance === null) return "foreground";
  return luminance < NEAR_BLACK_LUMINANCE || luminance > NEAR_WHITE_LUMINANCE
    ? "foreground"
    : "brand";
}
