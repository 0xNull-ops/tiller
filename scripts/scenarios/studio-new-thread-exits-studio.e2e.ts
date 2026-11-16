import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Global New thread leaves Theme Studio for a normal project",
  WEB,
  async ({ t3, app, screen, browser }) => {
    await t3.project("demo");
    await t3.project("Tiller Theme Studio");
    await t3.open();
    await screen.getByRole("button", "New thread", { exact: true }).waitFor();
    await browser.evaluate(`(async () => {
      const { readProjects } = await import('/src/state/entities.ts');
      const { createNewThreadHandler } = await import('/src/hooks/useHandleNewThread.ts');
      const studio = readProjects().find(p => p.title === 'Tiller Theme Studio');
      if (!studio) throw new Error('Studio fixture was not loaded');
      await createNewThreadHandler(window.__TSR_ROUTER__)({ environmentId: studio.environmentId, projectId: studio.id });
    })()`);
    await screen.getByRole("button", "New thread in Tiller Theme Studio").waitFor();
    await screen.getByRole("button", "New thread", { exact: true }).tap();
    await app.screenshot("new-thread-destination");
    await expect(screen.getByRole("button", "New thread in demo")).toBeVisible();
  },
);
