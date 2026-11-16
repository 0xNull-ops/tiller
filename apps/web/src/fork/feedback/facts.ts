import {
  describeFeedbackOs,
  type FeedbackFacts,
  feedbackArch,
} from "@t3tools/shared/fork/feedback";

import { APP_VERSION } from "~/branding";

/** The two high-entropy hints this build reads: Chromium only, which is what Electron ships. */
export interface UserAgentHighEntropyValues {
  readonly platformVersion?: string;
  readonly architecture?: string;
}

interface UserAgentDataLike {
  readonly platform?: string;
  readonly getHighEntropyValues?: (
    hints: ReadonlyArray<string>,
  ) => Promise<UserAgentHighEntropyValues>;
}

const readUserAgentData = (): UserAgentDataLike | undefined => {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { readonly userAgentData?: UserAgentDataLike }).userAgentData;
};

const readHighEntropyValues = async (): Promise<UserAgentHighEntropyValues> => {
  try {
    const values = await readUserAgentData()?.getHighEntropyValues?.([
      "architecture",
      "platformVersion",
    ]);
    return values ?? {};
  } catch {
    return {};
  }
};

const electronPlatform = (): string | undefined => {
  try {
    return window.desktopBridge?.getClientPlatform();
  } catch {
    return undefined;
  }
};

/**
 * The OS version comes from the browser's high-entropy hints, which only
 * Chromium (and so Electron) answers. Everything else reports the OS name and
 * an unknown architecture rather than guessing from a user agent.
 */
export function feedbackFactsFrom(input: {
  readonly appVersion: string;
  readonly desktopPlatform: string | undefined;
  readonly browserPlatform: string | undefined;
  readonly entropy: UserAgentHighEntropyValues;
}): FeedbackFacts {
  const platform = input.desktopPlatform ?? input.browserPlatform;
  return {
    appVersion: input.appVersion,
    os: describeFeedbackOs(platform, input.entropy.platformVersion),
    arch: feedbackArch(input.entropy.architecture),
  };
}

export async function readFeedbackFacts(): Promise<FeedbackFacts> {
  return feedbackFactsFrom({
    appVersion: APP_VERSION,
    desktopPlatform: electronPlatform(),
    browserPlatform: readUserAgentData()?.platform,
    entropy: await readHighEntropyValues(),
  });
}
