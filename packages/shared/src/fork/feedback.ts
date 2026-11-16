/**
 * The public issue tracker this build files into, and the only facts the app may
 * prefill there. Nothing else from the user's machine belongs in the URL: no logs,
 * prompts, file paths or project names.
 */
const FEEDBACK_REPOSITORY = "Antler-Web-Studios/tiller";
export const FEEDBACK_REPOSITORY_URL = `https://github.com/${FEEDBACK_REPOSITORY}`;
export const FEEDBACK_NEW_ISSUE_URL = `${FEEDBACK_REPOSITORY_URL}/issues/new`;

const FEEDBACK_TEMPLATE_FILES = {
  bug: "bug.yml",
  feature: "feature.yml",
} as const;

export type FeedbackKind = keyof typeof FEEDBACK_TEMPLATE_FILES;

export const FEEDBACK_KIND_LABELS: Readonly<Record<FeedbackKind, string>> = {
  bug: "Report a bug",
  feature: "Request a feature",
};

/** The issue-form fields the app fills in. Both public templates define exactly these ids. */
export const FEEDBACK_PREFILLED_FIELDS = ["version", "os", "arch"] as const;

export interface FeedbackFacts {
  readonly appVersion: string;
  readonly os: string;
  readonly arch?: string;
}

// Long enough for "0.1.6-nightly.20261102.3707", short enough to stay a URL parameter.
const MAX_FACT_CHARS = 60;
// A path, home directory, email or URL cannot survive this: they all need / \ @ : or ?.
const SAFE_FACT = /^[\w .,()+-]+$/;

/** Drops anything that could be a path or a secret instead of trying to redact it. */
export function safeFeedbackFact(value: string | undefined, fallback = "unknown"): string {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > MAX_FACT_CHARS) return fallback;
  return SAFE_FACT.test(trimmed) ? trimmed : fallback;
}

const OS_NAMES: Readonly<Record<string, string>> = {
  darwin: "macOS",
  macos: "macOS",
  win32: "Windows",
  windows: "Windows",
  linux: "Linux",
  "chrome os": "ChromeOS",
  cros: "ChromeOS",
  android: "Android",
  ios: "iOS",
};

/** Accepts an Electron platform ("darwin") or a browser one ("macOS", "MacIntel"). */
export function feedbackOsName(platform: string | undefined): string {
  const key = (platform ?? "").trim().toLowerCase();
  const exact = OS_NAMES[key];
  if (exact !== undefined) return exact;
  if (key.startsWith("mac")) return "macOS";
  if (key.startsWith("win")) return "Windows";
  if (key.startsWith("linux")) return "Linux";
  return "unknown OS";
}

export function describeFeedbackOs(
  platform: string | undefined,
  version: string | undefined,
): string {
  const name = feedbackOsName(platform);
  const cleanVersion = safeFeedbackFact(version, "");
  return cleanVersion === "" ? name : `${name} ${cleanVersion}`;
}

/** Chromium reports "arm" and "x86"; Electron reports "arm64" and "x64". */
export function feedbackArch(arch: string | undefined): string {
  switch ((arch ?? "").trim().toLowerCase()) {
    case "arm64":
    case "aarch64":
    case "arm":
      return "arm64";
    case "x64":
    case "x86_64":
    case "amd64":
    case "x86":
      return "x64";
    default:
      return "unknown";
  }
}

export function buildFeedbackIssueUrl(input: {
  readonly kind: FeedbackKind;
  readonly facts: FeedbackFacts;
}): string {
  const url = new URL(FEEDBACK_NEW_ISSUE_URL);
  url.searchParams.set("template", FEEDBACK_TEMPLATE_FILES[input.kind]);
  url.searchParams.set("version", safeFeedbackFact(input.facts.appVersion));
  url.searchParams.set("os", safeFeedbackFact(input.facts.os));
  // The crash screen has no architecture to report; leave the field empty there.
  if (input.facts.arch !== undefined) {
    url.searchParams.set("arch", safeFeedbackFact(input.facts.arch));
  }
  return url.href;
}
