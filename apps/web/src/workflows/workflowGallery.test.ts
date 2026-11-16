import { expect, it } from "vite-plus/test";
import {
  EMPTY_GALLERY_FILTERS,
  filterAndSortGallery,
  galleryCounts,
  type GalleryItem,
} from "./workflowGallery";
import { galleryFlowArt } from "./galleryFlowArt";

const item = (key: string, patch: Partial<GalleryItem> = {}): GalleryItem => ({
  key,
  source: "mine",
  title: key,
  tags: [],
  steps: [],
  edges: [],
  loops: [],
  digest: key,
  workSteps: 3,
  triggers: [],
  pinned: false,
  project: "project",
  projectTitle: "Project",
  scratch: false,
  updatedAt: "2026-10-01",
  status: { runCount: 0, missingSkills: [] },
  ...patch,
});
it("combines tags with OR and categories with AND, with contextual facet counts", () => {
  const items = [
    item("site", {
      tags: ["web", "design"],
      pinned: true,
      triggers: ["schedule"],
      status: { runCount: 0, missingSkills: [], running: { step: 1, total: 3 } },
    }),
    item("blog", { tags: ["content"], workSteps: 7 }),
    item("app", { tags: ["mobile"], source: "builtin", project: "other" }),
  ];
  const filters = { ...EMPTY_GALLERY_FILTERS, tags: ["web", "content"] };
  expect(filterAndSortGallery(items, filters, "name").map((value) => value.key)).toEqual([
    "site",
    "blog",
  ]);
  expect(
    filterAndSortGallery(items, { ...filters, scheduled: true }, "name").map((value) => value.key),
  ).toEqual(["site"]);
  expect(filterAndSortGallery(items, { ...filters, sources: ["builtin"] }, "name")).toEqual([]);
  expect(
    filterAndSortGallery(items, { ...EMPTY_GALLERY_FILTERS, projects: ["other"] }, "name").map(
      (value) => value.key,
    ),
  ).toEqual(["app"]);
  expect(
    filterAndSortGallery(items, { ...EMPTY_GALLERY_FILTERS, search: "DESIGN" }, "name").map(
      (value) => value.key,
    ),
  ).toEqual(["site"]);
  const counts = galleryCounts(items, filters);
  expect(counts.tags.get("mobile")).toBe(1);
  expect(counts.sources.get("builtin")).toBe(0);
  expect(counts.pinned).toBe(1);
  expect(counts.running).toBe(1);
  expect(
    filterAndSortGallery(items, { ...filters, running: true, projects: ["other"] }, "name"),
  ).toEqual([]);
});
it("sorts deterministically by recency, name, run count or steps with pins first", () => {
  const items = [
    item("z", { pinned: true }),
    item("b", { updatedAt: "2026-10-20", workSteps: 8 }),
    item("a", { status: { runCount: 5, missingSkills: [], lastRunAt: "2026-10-25" } }),
  ];
  for (const sort of ["recent", "name", "runs"] as const)
    expect(
      filterAndSortGallery(items, EMPTY_GALLERY_FILTERS, sort).map((value) => value.key),
    ).toEqual(["z", "a", "b"]);
  expect(
    filterAndSortGallery(items, EMPTY_GALLERY_FILTERS, "steps").map((value) => value.key),
  ).toEqual(["z", "b", "a"]);
  expect(
    filterAndSortGallery(items, { ...EMPTY_GALLERY_FILTERS, pinned: true }, "name"),
  ).toHaveLength(1);
});
it("caches deterministic flow geometry by digest and compresses more than twelve steps into a wave", () => {
  const steps = Array.from({ length: 13 }, (_, index) => ({
    id: `step-${index}`,
    kind: "skill" as const,
  }));
  const graph = item("graph", {
    steps,
    edges: [{ from: "step-0", to: "step-3" }],
    loops: [{ from: "step-12", to: "step-1" }],
    tags: ["web"],
  });
  const art = galleryFlowArt(graph);
  expect(galleryFlowArt({ ...graph })).toBe(art);
  expect(art.wave).toBe(true);
  expect(new Set(art.dots.map((dot) => dot.y)).size).toBeGreaterThan(1);
  expect(art.dots).toHaveLength(13);
  expect(galleryFlowArt({ ...graph, digest: "changed", edges: [] }).edges).toEqual([]);
  expect(art.edges).toHaveLength(1);
  expect(art.loops).toHaveLength(1);
  expect(galleryFlowArt({ ...graph, digest: "short", steps: steps.slice(0, 12) }).wave).toBe(false);
});
