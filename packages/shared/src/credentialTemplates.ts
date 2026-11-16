import type { CredentialFieldKind } from "@t3tools/contracts";

/**
 * A credential template is data, so adding a type is one entry here and every client, the
 * server's validation and the agent tools pick it up without code of their own.
 */
export interface CredentialTemplateField {
  readonly id: string;
  readonly label: string;
  readonly kind: CredentialFieldKind;
  readonly envVar: string;
  readonly required?: boolean;
  /** A value that is dangerous to hand to an agent, such as a service-role key. */
  readonly highRisk?: boolean;
  /** `secretFile` only: accepted file extensions, matched case-insensitively. */
  readonly extensions?: readonly string[];
  /** `secretFile` only: the upload ceiling. Defaults to {@link DEFAULT_CREDENTIAL_FILE_MAX_BYTES}. */
  readonly maxBytes?: number;
}

export interface CredentialTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** A Simple Icons slug, or null for a monogram. */
  readonly icon: string | null;
  /** The user supplies the field list (`.env` paste or Custom) instead of the template. */
  readonly dynamic?: boolean;
  /** Shown first in the gallery. */
  readonly popular?: boolean;
  readonly fields: readonly CredentialTemplateField[];
}

export const DEFAULT_CREDENTIAL_FILE_MAX_BYTES = 1024 * 1024;

/** Matches the server's per-credential field ceiling, so the form fails before the RPC does. */
export const MAX_CREDENTIAL_FIELDS = 40;

const file = (
  id: string,
  label: string,
  envVar: string,
  extensions: readonly string[],
  options: { readonly required?: boolean; readonly maxBytes?: number } = {},
): CredentialTemplateField => ({
  id,
  label,
  kind: "secretFile",
  envVar,
  extensions,
  ...options,
});

const secret = (
  id: string,
  label: string,
  envVar: string,
  options: { readonly required?: boolean; readonly highRisk?: boolean } = {},
): CredentialTemplateField => ({ id, label, kind: "secret", envVar, ...options });

const text = (
  id: string,
  label: string,
  envVar: string,
  options: { readonly required?: boolean } = {},
): CredentialTemplateField => ({ id, label, kind: "text", envVar, ...options });

export const CREDENTIAL_TEMPLATES: readonly CredentialTemplate[] = [
  {
    id: "app-store-connect",
    name: "App Store Connect API key",
    description: "Upload builds and read App Store data with an App Store Connect API key.",
    icon: "appstore",
    popular: true,
    fields: [
      text("key-id", "Key ID", "ASC_KEY_ID", { required: true }),
      text("issuer-id", "Issuer ID", "ASC_ISSUER_ID", { required: true }),
      file("private-key", "Private key (.p8)", "ASC_PRIVATE_KEY_PATH", ["p8"], {
        required: true,
        maxBytes: 16 * 1024,
      }),
    ],
  },
  {
    id: "apple-signing",
    name: "Apple signing",
    description: "A distribution certificate and its password for codesigning and notarizing.",
    icon: "apple",
    popular: true,
    fields: [
      file("certificate", "Signing certificate (.p12)", "APPLE_SIGNING_CERT_PATH", ["p12"], {
        required: true,
      }),
      secret("certificate-password", "Certificate password", "APPLE_SIGNING_CERT_PASSWORD", {
        required: true,
      }),
      text("team-id", "Team ID", "APPLE_TEAM_ID", { required: true }),
    ],
  },
  {
    id: "revenuecat",
    name: "RevenueCat",
    description: "RevenueCat's secret API key for a project.",
    icon: "revenuecat",
    popular: true,
    fields: [
      secret("api-key", "Secret API key", "REVENUECAT_API_KEY", { required: true }),
      text("project-id", "Project ID", "REVENUECAT_PROJECT_ID", { required: true }),
    ],
  },
  {
    id: "github",
    name: "GitHub token",
    description: "A personal access token or fine-grained token for the GitHub CLI and API.",
    icon: "github",
    popular: true,
    fields: [secret("token", "Token", "GITHUB_TOKEN", { required: true })],
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deploy with a Vercel access token.",
    icon: "vercel",
    popular: true,
    fields: [
      secret("token", "Access token", "VERCEL_TOKEN", { required: true }),
      text("team-id", "Team ID", "VERCEL_TEAM_ID"),
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Stripe's secret key, plus a webhook signing secret when you test webhooks.",
    icon: "stripe",
    popular: true,
    fields: [
      secret("secret-key", "Secret key", "STRIPE_SECRET_KEY", { required: true }),
      secret("webhook-secret", "Webhook signing secret", "STRIPE_WEBHOOK_SECRET"),
    ],
  },
  {
    id: "android-keystore",
    name: "Android keystore",
    description: "A release keystore and the passwords that unlock it.",
    icon: "android",
    fields: [
      file(
        "keystore",
        "Keystore (.jks or .keystore)",
        "ANDROID_KEYSTORE_PATH",
        ["jks", "keystore"],
        { required: true },
      ),
      secret("store-password", "Store password", "ANDROID_KEYSTORE_PASSWORD", { required: true }),
      text("key-alias", "Key alias", "ANDROID_KEY_ALIAS", { required: true }),
      secret("key-password", "Key password", "ANDROID_KEY_PASSWORD"),
    ],
  },
  {
    id: "google-service-account",
    name: "Google service account",
    description: "A service account JSON file for Firebase and Google Cloud APIs.",
    icon: "googlecloud",
    fields: [
      file("json", "Service account (.json)", "GOOGLE_APPLICATION_CREDENTIALS", ["json"], {
        required: true,
      }),
    ],
  },
  {
    id: "expo",
    name: "Expo / EAS token",
    description: "An Expo access token for EAS builds and submissions.",
    icon: "expo",
    fields: [secret("token", "Access token", "EXPO_TOKEN", { required: true })],
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "A project URL and its API keys. The service-role key bypasses row-level security.",
    icon: "supabase",
    fields: [
      text("url", "Project URL", "SUPABASE_URL", { required: true }),
      secret("anon-key", "Anon key", "SUPABASE_ANON_KEY"),
      secret("service-role-key", "Service-role key", "SUPABASE_SERVICE_ROLE_KEY", {
        required: true,
        highRisk: true,
      }),
    ],
  },
  {
    id: "aws",
    name: "AWS",
    description:
      "An IAM access key. Brand icons are not distributed for AWS, so this shows a monogram.",
    icon: null,
    fields: [
      text("access-key-id", "Access key ID", "AWS_ACCESS_KEY_ID", { required: true }),
      secret("secret-access-key", "Secret access key", "AWS_SECRET_ACCESS_KEY", { required: true }),
      text("region", "Region", "AWS_REGION", { required: true }),
      secret("session-token", "Session token", "AWS_SESSION_TOKEN"),
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare API token",
    description: "A scoped Cloudflare API token.",
    icon: "cloudflare",
    fields: [secret("api-token", "API token", "CLOUDFLARE_API_TOKEN", { required: true })],
  },
  {
    id: "docker-hub",
    name: "Docker Hub",
    description: "A Docker Hub username and access token for pushes.",
    icon: "docker",
    fields: [
      text("username", "Username", "DOCKERHUB_USERNAME", { required: true }),
      secret("password", "Password or access token", "DOCKERHUB_TOKEN", { required: true }),
    ],
  },
  {
    id: "ssh",
    name: "SSH",
    description:
      "A host, a user and a private key. Leave the key empty to use an ssh-agent identity instead.",
    icon: null,
    fields: [
      text("host", "Host", "SSH_HOST", { required: true }),
      text("user", "User", "SSH_USER", { required: true }),
      file("private-key", "Private key", "SSH_PRIVATE_KEY_PATH", [
        "pem",
        "key",
        "ppk",
        "id_rsa",
        "id_ed25519",
      ]),
      secret("passphrase", "Key passphrase", "SSH_KEY_PASSPHRASE"),
    ],
  },
  {
    id: "username-password",
    name: "Username and password",
    description: "A login for a service that has no token.",
    icon: null,
    fields: [
      text("username", "Username", "USERNAME", { required: true }),
      secret("password", "Password", "PASSWORD", { required: true }),
    ],
  },
  {
    id: "database-url",
    name: "Database URL",
    description: "A connection string, kept secret because it usually carries a password.",
    icon: null,
    fields: [secret("url", "Connection URL", "DATABASE_URL", { required: true })],
  },
  {
    id: "env-bundle",
    name: ".env bundle",
    description: "Paste a .env file; every key becomes a secret field.",
    icon: null,
    dynamic: true,
    fields: [],
  },
  {
    id: "custom",
    name: "Custom",
    description: "Choose your own fields, their kinds and their environment variable names.",
    icon: null,
    dynamic: true,
    fields: [],
  },
];

export const credentialTemplate = (id: string): CredentialTemplate | undefined =>
  CREDENTIAL_TEMPLATES.find((template) => template.id === id);

export const credentialTemplateField = (
  template: CredentialTemplate,
  fieldId: string,
): CredentialTemplateField | undefined => template.fields.find((field) => field.id === fieldId);

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const unquote = (raw: string): string => {
  const value = raw.trim();
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== `"` && quote !== `'`) || value.at(-1) !== quote) return value;
  const inner = value.slice(1, -1);
  // Only a double-quoted dotenv value treats escapes as escapes; a single-quoted one is literal.
  return quote === `"` ? inner.replace(/\\n/g, "\n").replace(/\\"/g, `"`) : inner;
};

/**
 * Splits a pasted `.env` file into fields. Later keys win, matching how a dotenv loader reads
 * the same file. Pure so the client can preview the fields before it saves anything.
 */
export const parseEnvBundle = (text: string): ReadonlyArray<{ key: string; value: string }> => {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : trimmed;
    const separator = assignment.indexOf("=");
    if (separator <= 0) continue;
    const key = assignment.slice(0, separator).trim();
    if (!ENV_KEY.test(key)) continue;
    entries.set(key, unquote(assignment.slice(separator + 1)));
  }
  return [...entries].map(([key, value]) => ({ key, value }));
};

/** The lowercased extension after the last dot, or the whole name when there is none. */
export const credentialFileExtension = (fileName: string): string => {
  const name = fileName.trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(dot + 1);
};
