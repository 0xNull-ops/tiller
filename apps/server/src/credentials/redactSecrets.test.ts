import { describe, expect, it } from "vite-plus/test";

import {
  REDACTION_PLACEHOLDER,
  redactKnownSecrets,
  credentialRedactor,
  redactedOutputHead,
} from "./redactSecrets.ts";

const secret = "sk_live_51H8xQ2abcDEF";

describe("redactKnownSecrets", () => {
  it("scrubs the value as typed, base64-encoded, URL-encoded and JSON-escaped", () => {
    const text = [
      `token=${secret}`,
      `header=Bearer ${Buffer.from(secret).toString("base64")}`,
      `url=/v1?key=${encodeURIComponent(secret)}`,
      `body={"key":"${secret}"}`,
    ].join("\n");
    const redacted = redactKnownSecrets({ text, secrets: [secret] });
    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain(Buffer.from(secret).toString("base64"));
    expect(redacted).not.toContain(encodeURIComponent(secret));
    expect(redacted.split(REDACTION_PLACEHOLDER).length - 1).toBe(4);
  });

  it("also scrubs a base64 form with the padding stripped", () => {
    const redacted = redactKnownSecrets({
      text: `value=${Buffer.from(secret).toString("base64").replace(/=+$/, "")}`,
      secrets: [secret],
    });
    expect(redacted).toBe(`value=${REDACTION_PLACEHOLDER}`);
  });

  it("scrubs a multi-line key body and its escaped form", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----";
    const escaped = JSON.stringify(pem).slice(1, -1);
    expect(redactKnownSecrets({ text: pem, secrets: [pem] })).toBe(REDACTION_PLACEHOLDER);
    expect(redactKnownSecrets({ text: escaped, secrets: [pem] })).toBe(REDACTION_PLACEHOLDER);
  });

  it("replaces a longer secret before a shorter one it contains", () => {
    expect(
      redactKnownSecrets({ text: "abc12345 and abc123", secrets: ["abc123", "abc12345"] }),
    ).toBe(`${REDACTION_PLACEHOLDER} and ${REDACTION_PLACEHOLDER}`);
  });

  it("also redacts short nonempty values", () => {
    expect(redactKnownSecrets({ text: "the api is up", secrets: ["api"] })).toBe(
      "the [redacted] is up",
    );
  });

  it("leaves text with no known value untouched", () => {
    expect(redactKnownSecrets({ text: "nothing to see", secrets: [secret] })).toBe(
      "nothing to see",
    );
  });
});

it("redacts individual multiline lines and form-url encodings", () => {
  const lines = ["line/one+with spaces", "lineTwo123"];
  const value = lines.join("\n");
  const text = lines
    .flatMap((line) => [
      line,
      Buffer.from(line).toString("base64"),
      encodeURIComponent(line),
      new URLSearchParams({ v: line }).toString().slice(2),
    ])
    .join("|");
  expect(redactKnownSecrets({ text, secrets: [value] })).toBe(
    Array(8).fill(REDACTION_PLACEHOLDER).join("|"),
  );
});

describe("a JSON secret file", () => {
  const privateKey = [
    "-----BEGIN PRIVATE KEY-----",
    "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const serviceAccount = JSON.stringify({
    type: "service_account",
    project_id: "demo-project",
    private_key: privateKey,
    client_email: "deployer@demo-project.iam.gserviceaccount.com",
    extra: { nested_secret: "nested-secret-value-that-is-long" },
  });

  it("redacts a field printed on its own, and each of its PEM lines", () => {
    // `jq -r .private_key` prints the decoded string, never the file the matcher first saw.
    expect(redactKnownSecrets({ text: `${privateKey}\n`, secrets: [serviceAccount] })).toBe(
      `${REDACTION_PLACEHOLDER}\n`,
    );
    expect(redactKnownSecrets({ text: privateKey, secrets: [serviceAccount] })).toBe(
      REDACTION_PLACEHOLDER,
    );
    expect(
      redactKnownSecrets({
        text: "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg",
        secrets: [serviceAccount],
      }),
    ).toBe(REDACTION_PLACEHOLDER);
    expect(
      redactKnownSecrets({
        text: '{"key":"nested-secret-value-that-is-long"}',
        secrets: [serviceAccount],
      }),
    ).toBe(`{"key":"${REDACTION_PLACEHOLDER}"}`);
    expect(redactKnownSecrets({ text: serviceAccount, secrets: [serviceAccount] })).toBe(
      REDACTION_PLACEHOLDER,
    );
  });

  it("redacts the JSON-escaped form of a leaf, as the file stores it", () => {
    expect(
      redactKnownSecrets({
        text: JSON.stringify(privateKey).slice(1, -1),
        secrets: [serviceAccount],
      }),
    ).toBe(REDACTION_PLACEHOLDER);
  });

  it("redacts a short leaf under a secret-named key when it is printed alone", () => {
    const file = JSON.stringify({ username: "alice", password: "hunter2pass" });
    expect(redactKnownSecrets({ text: "hunter2pass\n", secrets: [file] })).toBe(
      `${REDACTION_PLACEHOLDER}\n`,
    );
    expect(redactKnownSecrets({ text: "user alice", secrets: [file] })).toBe("user alice");
  });

  it("redacts array elements under a secret-named key", () => {
    const file = JSON.stringify({ tokens: ["ghp_a1", "x9ab"] });
    expect(redactKnownSecrets({ text: "ghp_a1 x9ab", secrets: [file] })).toBe(
      `${REDACTION_PLACEHOLDER} ${REDACTION_PLACEHOLDER}`,
    );
  });

  it("keeps a value shorter than four characters out of the needles", () => {
    const file = JSON.stringify({ pin: "123" });
    expect(redactKnownSecrets({ text: "the pin is 123", secrets: [file] })).toBe("the pin is 123");
  });

  it("redacts a four-character value under a secret-named key", () => {
    const file = JSON.stringify({ pin: "1234" });
    expect(redactKnownSecrets({ text: "the pin is 1234", secrets: [file] })).toBe(
      `the pin is ${REDACTION_PLACEHOLDER}`,
    );
  });

  it("keeps short non-secret leaves as ordinary output beside a short secret one", () => {
    const file = JSON.stringify({ type: "service_account", password: "hunter2pass" });
    expect(redactKnownSecrets({ text: "service_account\nhunter2pass", secrets: [file] })).toBe(
      `service_account\n${REDACTION_PLACEHOLDER}`,
    );
  });

  it("leaves ordinary output alone when the file's leaves are too short to be secrets", () => {
    const file = JSON.stringify({ type: "service_account", universe_domain: "googleapis.com" });
    expect(redactKnownSecrets({ text: "type is service_account", secrets: [file] })).toBe(
      "type is service_account",
    );
    expect(redactKnownSecrets({ text: "host googleapis.com", secrets: [file] })).toBe(
      "host googleapis.com",
    );
  });
});

it("keeps a redacted head and drops partial secrets in every encoded form at the cut", () => {
  const secret = "private/value with + encoded?bytes";
  const redact = credentialRedactor([secret]);
  const forms = [
    secret,
    Buffer.from(secret).toString("base64"),
    encodeURIComponent(secret),
    JSON.stringify(secret).slice(1, -1),
  ];
  for (const form of forms) {
    for (let split = 1; split < form.length; split++) {
      const text = `Useful header\n${secret}\n${"padding\n".repeat(100)}${form.slice(0, split)}`;
      const head = redactedOutputHead(text, true, redact, redact);
      expect(head).toContain("Useful header\n[redacted]\n");
      expect(head).toContain("[output truncated]");
      expect(head).not.toContain(form);
      expect(head).toMatch(/padding\n\[output truncated\]$/);
    }
  }
  expect(redact.safeMargin).toBeGreaterThanOrEqual(
    secret.length + Buffer.from(secret).toString("base64").length,
  );
});
