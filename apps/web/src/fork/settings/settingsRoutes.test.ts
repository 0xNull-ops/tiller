import { createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { routeTree } from "../../routeTree.gen";

describe("fork settings routes", () => {
  it.each(["/settings/workflows", "/settings/credentials"] as const)(
    "%s renders inside the settings layout that provides settings scope",
    (path) => {
      const router = createRouter({ routeTree });

      expect(router.routesByPath[path].parentRoute?.id).toBe("/_chat/settings");
    },
  );
});
