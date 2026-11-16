import {
  credentialBrandRecord,
  matchCredentialBrand,
  relativeLuminance,
} from "@t3tools/shared/credentialBrand";

import { projectMonogram } from "../../lib/projectIcon";

export interface CredentialBrandMarkInput {
  readonly name: string;
  readonly templateIcon?: string | null | undefined;
  readonly iconOverride?: string | null | undefined;
  readonly envVars?: readonly string[] | undefined;
}

export interface CredentialBrandMark {
  /** One or two letters drawn in the tile. */
  readonly text: string;
  /** `#rrggbb` of a matched brand, or null for the neutral tile. */
  readonly background: string | null;
  /** Text colour that stays readable on `background`; null means the theme foreground. */
  readonly foreground: string | null;
}

/**
 * White text stops clearing 4.5:1 against a brand colour above this luminance,
 * so brighter tiles get near-black text instead.
 */
const LIGHT_TEXT_MAX_LUMINANCE = 0.179;

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#111111";

/**
 * Mobile draws brands as a coloured monogram: the simple-icons paths live in a
 * web-only dependency, and bundling them here for a 20-point tile is not worth
 * the app size. The shared matcher still decides the brand and its colour.
 */
export function credentialBrandMark(input: CredentialBrandMarkInput): CredentialBrandMark {
  const match = matchCredentialBrand({
    name: input.name,
    iconOverride: input.iconOverride,
    templateIcon: input.templateIcon,
    envVars: input.envVars,
  });
  const record = match === null ? null : credentialBrandRecord(match.slug);
  if (record === null) {
    return { text: projectMonogram(input.name), background: null, foreground: null };
  }
  const luminance = relativeLuminance(record.hex);
  return {
    text: projectMonogram(record.title),
    background: record.hex,
    foreground:
      luminance !== null && luminance <= LIGHT_TEXT_MAX_LUMINANCE ? LIGHT_TEXT : DARK_TEXT,
  };
}
