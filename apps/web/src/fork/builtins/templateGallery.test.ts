import { expect, it } from "vite-plus/test";
import { templateGalleryItems } from "./templateGallery";
import { filterAndSortGallery, EMPTY_GALLERY_FILTERS } from "../../workflows/workflowGallery";
it("filters built-ins, preserves graph dependencies, and counts missing skills by name", () => {
  const all = templateGalleryItems(new Set(["research", "copywriting"]), [], false);
  expect(all).toHaveLength(10);
  const landing = all.find((item) => item.template.id === "landing-page-in-an-afternoon")!;
  expect(landing.status.missingSkills).not.toContain("research");
  expect(landing.status.missingSkills).toHaveLength(3);
  expect(landing.status.runCount).toBe(0);
  expect(all.find((item) => item.template.id === "product-launch-pack")?.edges).toContainEqual({
    from: "positioning",
    to: "landing-page",
  });
  expect(all.find((item) => item.template.id === "brand-kit")?.loops).toEqual([
    { from: "review", to: "logo" },
  ]);
  const hidden = [landing.template.id];
  expect(templateGalleryItems(new Set(), hidden, false)).toHaveLength(9);
  expect(templateGalleryItems(new Set(), hidden, true)).toHaveLength(10);
  expect(
    filterAndSortGallery(all, { ...EMPTY_GALLERY_FILTERS, sources: ["mine"] }, "name"),
  ).toEqual([]);
  expect(
    filterAndSortGallery(all, { ...EMPTY_GALLERY_FILTERS, sources: ["builtin"] }, "name"),
  ).toHaveLength(10);
});
