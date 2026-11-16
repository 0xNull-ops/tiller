import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  base64FromBytes,
  buildCredentialCreateInput,
  credentialFieldId,
  emptyCredentialFormDraft,
  envBundleFields,
  envVarFromLabel,
  pinValidationError,
  validateCredentialFile,
} from "./credentialDraft";

describe("envBundleFields", () => {
  it("parses comments, exports, quotes, blank lines and later duplicates", () => {
    const fields = envBundleFields(
      [
        "# a comment",
        "",
        "export STRIPE_SECRET_KEY=sk_live_123",
        'QUOTED="line one\\nline two"',
        "SINGLE='keep \\n literal'",
        "EMPTY=",
        "STRIPE_SECRET_KEY=later",
        "not a key",
      ].join("\n"),
    );

    expect(fields.map(({ envVar, value }) => ({ envVar, value }))).toEqual([
      { envVar: "STRIPE_SECRET_KEY", value: "later" },
      { envVar: "QUOTED", value: "line one\nline two" },
      { envVar: "SINGLE", value: "keep \\n literal" },
      { envVar: "EMPTY", value: "" },
    ]);
    expect(fields.map((field) => field.id)).toEqual([
      "stripe_secret_key",
      "quoted",
      "single",
      "empty",
    ]);
  });

  it("gives underscore-prefixed keys a filename-safe id", () => {
    const fields = envBundleFields("_PRIVATE=1\nA=1");
    expect(fields.map((field) => field.id)).toEqual(["private", "a"]);
  });
});

describe("credentialFieldId", () => {
  it("slugs names and suffixes collisions", () => {
    const taken = new Set(["api-key"]);
    expect(credentialFieldId("API key", taken)).toBe("api-key-2");
    expect(credentialFieldId("???", taken)).toBe("field");
  });
});

describe("envVarFromLabel", () => {
  it("upper-snake-cases a label", () => {
    expect(envVarFromLabel("Stripe secret key")).toBe("STRIPE_SECRET_KEY");
    expect(envVarFromLabel("2FA code")).toBe("VAR_2FA_CODE");
    expect(envVarFromLabel("  ")).toBe("");
  });
});

describe("buildCredentialCreateInput", () => {
  it("builds a fixed template with plain and secret fields", () => {
    const draft = {
      ...emptyCredentialFormDraft("app-store-connect"),
      name: "App Store Connect",
      plainValues: { "key-id": "7QK2", "issuer-id": "69a6" },
      secretValues: {
        "private-key": {
          value: "",
          file: { base64: "cDI=", fileName: "AuthKey.p8", size: 2 },
        },
      },
      notes: "Acme",
    };
    const result = buildCredentialCreateInput(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      templateId: "app-store-connect",
      name: "App Store Connect",
      notes: "Acme",
      plainFields: { "key-id": "7QK2", "issuer-id": "69a6" },
      secrets: [{ fieldId: "private-key", base64: "cDI=", fileName: "AuthKey.p8" }],
      policy: { projects: "all", alwaysAsk: true, revealAllowed: false },
    });
  });

  it("refuses to submit without a required secret", () => {
    const draft = { ...emptyCredentialFormDraft("github"), name: "GitHub" };
    const result = buildCredentialCreateInput(draft);
    expect(result).toEqual({
      ok: false,
      message: "Token is required.",
      fieldId: "token",
    });
  });

  it("builds custom fields of every kind", () => {
    const draft = {
      ...emptyCredentialFormDraft("custom"),
      name: "Custom",
      customFields: [
        {
          id: "field-1",
          label: "Account",
          kind: "text" as const,
          envVar: "ACCOUNT",
          required: true,
          extensions: "",
          value: "acme",
          file: null,
        },
        {
          id: "field-2",
          label: "Token",
          kind: "secret" as const,
          envVar: "TOKEN",
          required: true,
          extensions: "",
          value: "secret",
          file: null,
        },
        {
          id: "field-3",
          label: "Key file",
          kind: "secretFile" as const,
          envVar: "KEY_PATH",
          required: false,
          extensions: ".P8, .pem",
          value: "",
          file: { base64: "a2V5", fileName: "key.p8", size: 3 },
        },
      ],
    };
    const result = buildCredentialCreateInput(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.fields).toEqual([
      { id: "field-1", label: "Account", kind: "text", envVar: "ACCOUNT", required: true },
      { id: "field-2", label: "Token", kind: "secret", envVar: "TOKEN", required: true },
      {
        id: "field-3",
        label: "Key file",
        kind: "secretFile",
        envVar: "KEY_PATH",
        required: false,
        extensions: ["p8", "pem"],
      },
    ]);
    expect(result.input.plainFields).toEqual({ "field-1": "acme" });
    expect(result.input.secrets).toEqual([
      { fieldId: "field-2", value: "secret" },
      { fieldId: "field-3", base64: "a2V5", fileName: "key.p8" },
    ]);
  });

  it("builds an .env bundle from the parsed keys", () => {
    const draft = {
      ...emptyCredentialFormDraft("env-bundle"),
      name: "Staging",
      envFields: envBundleFields("API=one\nTOKEN=two"),
    };
    const result = buildCredentialCreateInput(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      templateId: "env-bundle",
      name: "Staging",
      fields: [
        { id: "api", label: "API", kind: "secret", envVar: "API" },
        { id: "token", label: "TOKEN", kind: "secret", envVar: "TOKEN" },
      ],
      secrets: [
        { fieldId: "api", value: "one" },
        { fieldId: "token", value: "two" },
      ],
    });
  });

  it("keeps the project restriction the user picked", () => {
    const draft = {
      ...emptyCredentialFormDraft("github"),
      name: "GitHub",
      secretValues: { token: { value: "x", file: null } },
      scope: "selected" as const,
      projectIds: [ProjectId.make("proj-1")],
    };
    const result = buildCredentialCreateInput(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.policy?.projects).toEqual(["proj-1"]);
  });
});

describe("validateCredentialFile", () => {
  it("checks the extension and the size", () => {
    expect(validateCredentialFile("AuthKey.p8", 10, ["p8"], 16)).toBeNull();
    expect(validateCredentialFile("AuthKey.pem", 10, ["p8"], 16)).toBe("Use a .p8 file.");
    expect(validateCredentialFile("AuthKey.p8", 20, ["p8"], 16)).toBe(
      "This file is larger than 16 B.",
    );
  });
});

describe("pinValidationError", () => {
  it("validates the PIN before the server sees it", () => {
    expect(pinValidationError("123", "123")).toContain("at least four digits");
    expect(pinValidationError("1234", "1235")).toContain("do not match");
    expect(pinValidationError("1234", "1234")).toBeNull();
  });

  it("applies the server's rule: four digits, or a passphrase of six or more", () => {
    // Four letters are too short for a passphrase, so the server would reject them too.
    expect(pinValidationError("abcd", "abcd")).toContain("six or more characters");
    expect(pinValidationError("abcdef", "abcdef")).toBeNull();
    expect(pinValidationError("12345", "12345")).toBeNull();
  });
});

describe("base64FromBytes", () => {
  it("encodes bytes in chunks", () => {
    expect(base64FromBytes(new Uint8Array([104, 105]))).toBe("aGk=");
    expect(base64FromBytes(new Uint8Array(60_000).fill(65))).toBe(btoa("A".repeat(60_000)));
  });
});
