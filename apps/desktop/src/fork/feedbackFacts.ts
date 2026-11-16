import {
  describeFeedbackOs,
  type FeedbackFacts,
  feedbackArch,
} from "@t3tools/shared/fork/feedback";

/** Electron's own OS version, which the renderer cannot read. */
export function readSystemVersion(read: () => string = () => process.getSystemVersion()) {
  try {
    const version = read();
    return version === "" ? undefined : version;
  } catch {
    return undefined;
  }
}

export function desktopFeedbackFacts(input: {
  readonly appVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly systemVersion: string | undefined;
}): FeedbackFacts {
  return {
    appVersion: input.appVersion,
    os: describeFeedbackOs(input.platform, input.systemVersion),
    arch: feedbackArch(input.arch),
  };
}
