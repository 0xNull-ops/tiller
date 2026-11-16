export const REDACTION_PLACEHOLDER = "[redacted]";

/**
 * A JSON secret file (a service-account key, a kubeconfig) is one needle as a whole, but a command
 * that prints one field (`jq -r .private_key`) only exposes that leaf, which the whole-file needle
 * never matches. String leaves become needles of their own; shorter ones are ordinary output, so
 * this floor keeps `"service_account"` (15 characters) from redacting prose.
 */
const MIN_JSON_LEAF_LENGTH = 16;
/**
 * A leaf under a key that names a secret (`"password": "hunter2pass"`) is a needle on its own,
 * but a very short one is ordinary output: a one-character PIN would scrub every digit in the
 * command output. Four characters still covers a PIN and stays rare enough not to match prose.
 */
const MIN_SECRET_KEY_LEAF_LENGTH = 4;
const SECRET_KEY_HINTS = [
  "password",
  "passwd",
  "pass",
  "secret",
  "token",
  "key",
  "apikey",
  "api_key",
  "private",
  "credential",
  "auth",
  "pin",
  "otp",
] as const;
/** A cap for pathological files: enough to cover any real credential, cheap to compile. */
const MAX_JSON_LEAVES = 256;
const MAX_JSON_DEPTH = 32;

const isSecretKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SECRET_KEY_HINTS.some((hint) => lower.includes(hint));
};

const jsonStringLeaves = (text: string): ReadonlyArray<string> => {
  const trimmed = text.trim();
  // Cheap rejection first: most secrets are not JSON, and this runs on every vault change.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // A truncated or quoted form of the same secret; the whole-value needle still covers it.
    return [];
  }
  const leaves: string[] = [];
  // Array elements have no key of their own, so they inherit the key of the array they sit in.
  const walk = (value: unknown, depth: number, key: string) => {
    if (leaves.length >= MAX_JSON_LEAVES || depth > MAX_JSON_DEPTH) return;
    if (typeof value === "string") {
      const floor = isSecretKey(key) ? MIN_SECRET_KEY_LEAF_LENGTH : MIN_JSON_LEAF_LENGTH;
      if (value.length >= floor) leaves.push(value);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const isArray = Array.isArray(value);
    for (const [childKey, child] of Object.entries(value)) {
      walk(child, depth + 1, isArray ? key : childKey);
    }
  };
  walk(parsed, 0, "");
  return leaves;
};

/** Compile once per vault revision; callers never send values to telemetry or consumers. */
export const credentialRedactor = (secrets: ReadonlyArray<string>) => {
  const forms = new Set<string>();
  // A leaf that decodes to a PEM body carries real newlines, so its lines get their own forms.
  for (const secret of secrets.flatMap((whole) => [whole, ...jsonStringLeaves(whole)])) {
    for (const value of [secret, ...secret.split(/\r?\n/)]) {
      if (value.length === 0) continue;
      forms.add(value);
      const base64 = Buffer.from(value, "utf8").toString("base64");
      forms.add(base64);
      forms.add(Buffer.from(value, "utf8").toString("base64url"));
      forms.add(base64.replace(/=+$/, ""));
      forms.add(encodeURIComponent(value));
      forms.add(encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, (s) => s.toLowerCase()));
      forms.add(new URLSearchParams({ v: value }).toString().slice(2));
      forms.add(JSON.stringify(value).slice(1, -1));
    }
  }
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  let matcher: RegExp | undefined;
  try {
    matcher =
      ordered.length === 0
        ? undefined
        : new RegExp(ordered.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  } catch {
    // RegExp errors may echo the whole pattern, which contains the values being protected.
    throw new Error("Could not prepare credential output redaction.");
  }
  return Object.assign(
    (text: string) =>
      matcher === undefined ? text : text.replace(matcher, () => REDACTION_PLACEHOLDER),
    { safeMargin: (ordered[0]?.length ?? 0) + Math.max(0, ...secrets.map((s) => s.length)) },
  );
};
export const redactKnownSecrets = (input: {
  readonly text: string;
  readonly secrets: ReadonlyArray<string>;
}): string => credentialRedactor(input.secrets)(input.text);

/** Drop any incomplete value at the capture boundary before redacting complete lines. */
export function redactedOutputHead(
  text: string,
  truncated: boolean,
  original: ReturnType<typeof credentialRedactor>,
  current: ReturnType<typeof credentialRedactor>,
): string {
  if (!truncated) return current(original(text));
  const safeEnd = Math.max(0, text.length - Math.max(original.safeMargin, current.safeMargin));
  const newline = safeEnd > 0 ? text.lastIndexOf("\n", safeEnd - 1) : -1;
  return `${current(original(text.slice(0, newline + 1)))}[output truncated]`;
}
