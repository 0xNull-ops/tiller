import { describe, expect, it } from "vite-plus/test";
import { CredentialFieldId, CredentialFieldKind } from "@t3tools/contracts";

import {
  CREDENTIAL_TEMPLATES,
  credentialFileExtension,
  credentialTemplate,
  credentialTemplateField,
  parseEnvBundle,
} from "./credentialTemplates.ts";

const decodeFieldId = (value: string) => CredentialFieldId.make(value);
const isFieldKind = (value: string) => CredentialFieldKind.literals.includes(value as never);

describe("credential templates", () => {
  it("has a unique, stable id for every template", () => {
    const ids = CREDENTIAL_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("gives every fixed template valid, unique fields with usable env vars", () => {
    for (const template of CREDENTIAL_TEMPLATES) {
      if (template.dynamic === true) {
        expect(template.fields).toEqual([]);
        continue;
      }
      expect(template.fields.length).toBeGreaterThan(0);
      const ids = template.fields.map((field) => field.id);
      expect(new Set(ids).size, `${template.id} repeats a field id`).toBe(ids.length);
      const envVars = template.fields.map((field) => field.envVar);
      expect(new Set(envVars).size, `${template.id} repeats an env var`).toBe(envVars.length);
      for (const field of template.fields) {
        expect(() => decodeFieldId(field.id), `${template.id}/${field.id}`).not.toThrow();
        expect(isFieldKind(field.kind)).toBe(true);
        expect(field.envVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
        if (field.kind === "secretFile") {
          // A file field with no extension list would accept anything, which is never intended.
          expect(field.extensions?.length ?? 0).toBeGreaterThan(0);
        } else {
          expect(field.extensions).toBeUndefined();
        }
      }
    }
  });

  it("names a brand icon or asks for a monogram, never something else", () => {
    for (const template of CREDENTIAL_TEMPLATES) {
      if (template.icon === null) continue;
      expect(template.icon).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("ships the templates the plan lists first", () => {
    for (const id of [
      "app-store-connect",
      "apple-signing",
      "revenuecat",
      "github",
      "vercel",
      "android-keystore",
      "google-service-account",
      "expo",
      "stripe",
      "supabase",
      "aws",
      "cloudflare",
      "docker-hub",
      "ssh",
      "username-password",
      "database-url",
      "env-bundle",
      "custom",
    ]) {
      expect(credentialTemplate(id), id).toBeDefined();
    }
    expect(credentialTemplate("app-store-connect")?.icon).toBe("appstore");
    expect(credentialTemplate("apple-signing")?.icon).toBe("apple");
    expect(credentialTemplate("aws")?.icon).toBeNull();
    expect(credentialTemplateField(credentialTemplate("github")!, "token")?.kind).toBe("secret");
    expect(
      credentialTemplateField(credentialTemplate("supabase")!, "service-role-key")?.highRisk,
    ).toBe(true);
  });
});

describe("parseEnvBundle", () => {
  it("reads keys, drops comments and blanks, and strips quotes", () => {
    expect(
      parseEnvBundle(
        [
          "# a comment",
          "",
          "STRIPE_SECRET_KEY=sk_live_123",
          "export DATABASE_URL='postgres://user:pw@host/db'",
          'PEM="line1\\nline2"',
          "not a pair",
          "1INVALID=x",
        ].join("\n"),
      ),
    ).toEqual([
      { key: "STRIPE_SECRET_KEY", value: "sk_live_123" },
      { key: "DATABASE_URL", value: "postgres://user:pw@host/db" },
      { key: "PEM", value: "line1\nline2" },
    ]);
  });

  it("keeps the last value for a repeated key, like a dotenv loader", () => {
    expect(parseEnvBundle("A=1\nA=2\r\nB=3")).toEqual([
      { key: "A", value: "2" },
      { key: "B", value: "3" },
    ]);
  });

  it("keeps an empty value rather than dropping the key", () => {
    expect(parseEnvBundle("EMPTY=")).toEqual([{ key: "EMPTY", value: "" }]);
  });
});

describe("credentialFileExtension", () => {
  it("matches the extension, or the whole name for a key with no dot", () => {
    expect(credentialFileExtension("AuthKey.P8")).toBe("p8");
    expect(credentialFileExtension("release.keystore")).toBe("keystore");
    expect(credentialFileExtension("id_ed25519")).toBe("id_ed25519");
    expect(credentialFileExtension(".env")).toBe(".env");
  });
});
