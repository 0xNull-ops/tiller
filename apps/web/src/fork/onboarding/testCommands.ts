import type { BrowserCommand } from "vite-plus/test/node";

export const setWelcomeReducedMotion: BrowserCommand<[enabled: boolean]> = async (
  { page },
  enabled,
) => {
  await page.emulateMedia({ reducedMotion: enabled ? "reduce" : "no-preference" });
};

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    setWelcomeReducedMotion: (enabled: boolean) => Promise<void>;
  }
}
