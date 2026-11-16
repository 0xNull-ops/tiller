import { describe, expect, it } from "vite-plus/test";

import {
  credentialBrandGlyphTone,
  credentialBrandRecord,
  matchCredentialBrand,
  relativeLuminance,
  searchCredentialBrands,
} from "./credentialBrand.ts";

const slugOf = (input: Parameters<typeof matchCredentialBrand>[0]) =>
  matchCredentialBrand(input)?.slug ?? null;

describe("matchCredentialBrand", () => {
  it("prefers a picked icon over everything else", () => {
    expect(
      slugOf({
        name: "Stripe live",
        iconOverride: "linear",
        templateIcon: "github",
        envVars: ["STRIPE_SECRET_KEY"],
        urls: ["api.stripe.com"],
      }),
    ).toBe("linear");
  });

  it("takes the template icon when there is no override, and falls back when it is unknown", () => {
    expect(slugOf({ name: "Untitled", templateIcon: "revenuecat" })).toBe("revenuecat");
    expect(slugOf({ name: "Stripe live", templateIcon: "not-a-brand" })).toBe("stripe");
  });

  it("matches a provider console host", () => {
    expect(slugOf({ name: "Backend key", urls: ["https://xyzcompany.supabase.co/rest/v1"] })).toBe(
      "supabase",
    );
    expect(slugOf({ name: "Payments", urls: ["api.stripe.com"] })).toBe("stripe");
    expect(slugOf({ name: "Repo token", urls: ["https://github.com/org/repo"] })).toBe("github");
    expect(slugOf({ name: "Deploy hook", urls: ["https://api.vercel.com/v13"] })).toBe("vercel");
    expect(slugOf({ name: "Store key", urls: ["https://appstoreconnect.apple.com"] })).toBe(
      "appstore",
    );
  });

  it("falls back from the provider console to a bare brand host", () => {
    expect(slugOf({ name: "Newsletter", urls: ["https://mail.notion.so"] })).toBe("notion");
    expect(slugOf({ name: "Analytics", urls: ["https://o123.sentry.io"] })).toBe("sentry");
  });

  it("reads the brand out of an environment variable prefix", () => {
    expect(slugOf({ name: "Payments", envVars: ["STRIPE_SECRET_KEY"] })).toBe("stripe");
    expect(slugOf({ name: "Actions", envVars: ["GITHUB_TOKEN"] })).toBe("github");
    expect(slugOf({ name: "Automation", envVars: ["GH_TOKEN"] })).toBe("github");
    expect(slugOf({ name: "Entitlements", envVars: ["REVENUECAT_API_KEY"] })).toBe("revenuecat");
    expect(slugOf({ name: "Upload key", envVars: ["ASC_KEY_ID"] })).toBe("appstore");
    expect(slugOf({ name: "Builds", envVars: ["EAS_PROJECT_ID"] })).toBe("expo");
    expect(slugOf({ name: "Zone token", envVars: ["CF_API_TOKEN"] })).toBe("cloudflare");
    expect(slugOf({ name: "Model key", envVars: ["ANTHROPIC_API_KEY"] })).toBe("anthropic");
    expect(slugOf({ name: "Errors", envVars: ["SENTRY_AUTH_TOKEN"] })).toBe("sentry");
    expect(slugOf({ name: "Postgres", envVars: ["SUPABASE_SERVICE_ROLE_KEY"] })).toBe("supabase");
  });

  it("prefers a URL over an environment variable", () => {
    expect(
      slugOf({
        name: "Deploy",
        urls: ["https://vercel.com/team"],
        envVars: ["STRIPE_SECRET_KEY"],
      }),
    ).toBe("vercel");
  });

  it("matches a brand named in the credential name, longest run first", () => {
    expect(slugOf({ name: "App Store Connect — Acme", envVars: [] })).toBe("appstore");
    expect(slugOf({ name: "Stripe live" })).toBe("stripe");
    expect(slugOf({ name: "github deploy key" })).toBe("github");
  });

  it("ignores case, punctuation and accents", () => {
    expect(slugOf({ name: "  GITHUB   deploy key " })).toBe("github");
    expect(slugOf({ name: "GitHub Actions runner" })).toBe("githubactions");
    expect(slugOf({ name: "NPM registry (read-only)" })).toBe("npm");
    expect(slugOf({ name: "RÉVENUECAT" })).toBe("revenuecat");
  });

  it("does not match a brand inside a longer word", () => {
    expect(slugOf({ name: "Striped blanket inventory" })).toBeNull();
    expect(slugOf({ name: "My keys" })).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchCredentialBrand({ name: "Office wifi" })).toBeNull();
    expect(
      matchCredentialBrand({
        name: "Office wifi",
        envVars: ["OFFICE_WIFI_PASSWORD"],
        urls: ["https://intranet.example.com"],
        iconOverride: null,
        templateIcon: null,
      }),
    ).toBeNull();
  });

  it("knows the records it matches", () => {
    expect(credentialBrandRecord("appstore")).toMatchObject({
      slug: "appstore",
      title: "App Store",
      hex: "#0d96f6",
    });
    expect(credentialBrandRecord("aws")).toBeNull();
  });
});

describe("searchCredentialBrands", () => {
  it("puts title prefixes before everything else and caps the list", () => {
    const results = searchCredentialBrands("app");
    expect(results[0]?.slug).toBe("appstore");
    expect(results.length).toBeLessThanOrEqual(60);
    expect(searchCredentialBrands("a", 5)).toHaveLength(5);
  });

  it("matches aliases", () => {
    expect(searchCredentialBrands("app store connect").map((record) => record.slug)).toContain(
      "appstore",
    );
  });

  it("returns the first brands alphabetically for an empty query", () => {
    const results = searchCredentialBrands("");
    expect(results.length).toBeGreaterThan(0);
    const titles = results.map((record) => record.title);
    expect(titles).toEqual(titles.toSorted());
  });
});

describe("credentialBrandGlyphTone", () => {
  it("uses the brand colour when it is readable on both themes", () => {
    expect(credentialBrandGlyphTone("#635bff")).toBe("brand");
    expect(credentialBrandGlyphTone("#3fcf8e")).toBe("brand");
    expect(credentialBrandGlyphTone("#f38020")).toBe("brand");
  });

  it("takes the theme foreground for near-black and near-white brands", () => {
    for (const hex of ["#181717", "#000000", "#191919", "#1c2024", "#362d59", "#ffffff"]) {
      expect(credentialBrandGlyphTone(hex)).toBe("foreground");
    }
  });

  it("treats an unparseable colour as unreadable", () => {
    expect(credentialBrandGlyphTone("not-a-colour")).toBe("foreground");
    expect(relativeLuminance("not-a-colour")).toBeNull();
  });

  it("orders luminance dark to light", () => {
    const black = relativeLuminance("#000000") ?? 1;
    const stripe = relativeLuminance("#635bff") ?? 0;
    const white = relativeLuminance("#ffffff") ?? 0;
    expect(black).toBeLessThan(stripe);
    expect(stripe).toBeLessThan(white);
  });
});
