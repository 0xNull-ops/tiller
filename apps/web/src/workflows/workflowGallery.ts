export interface GalleryItem {
  readonly key: string;
  readonly source: "mine" | "builtin" | "marketplace";
  readonly title: string;
  readonly brief?: string | undefined;
  readonly tags: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<{ readonly id: string; readonly kind: "skill" | "workflow" }>;
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  readonly loops: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  readonly digest: string;
  readonly workSteps: number;
  readonly triggers: ReadonlyArray<"schedule" | "webhook" | "after">;
  readonly pinned: boolean;
  readonly project: string;
  readonly projectTitle: string;
  readonly scratch: boolean;
  readonly updatedAt: string;
  readonly status: {
    readonly running?: { readonly step: number; readonly total: number } | undefined;
    readonly nextRunAt?: string | undefined;
    readonly lastRunAt?: string | undefined;
    readonly runCount: number;
    readonly problem?: string | undefined;
    readonly missingSkills: ReadonlyArray<string>;
  };
  readonly author?: string;
  readonly installs?: number;
}
export interface GalleryFilters {
  readonly search: string;
  readonly pinned: boolean;
  readonly running: boolean;
  readonly scheduled: boolean;
  readonly sources: ReadonlyArray<GalleryItem["source"]>;
  readonly tags: ReadonlyArray<string>;
  readonly projects: ReadonlyArray<string>;
}
export type GallerySort = "recent" | "name" | "runs" | "steps";
export const EMPTY_GALLERY_FILTERS: GalleryFilters = {
  search: "",
  pinned: false,
  running: false,
  scheduled: false,
  sources: [],
  tags: [],
  projects: [],
};
function matchesGalleryFilters(item: GalleryItem, filters: GalleryFilters): boolean {
  const query = filters.search.trim().toLowerCase();
  return (
    (!query ||
      [item.title, item.brief ?? "", item.projectTitle, ...item.tags].some((text) =>
        text.toLowerCase().includes(query),
      )) &&
    (!filters.pinned || item.pinned) &&
    (!filters.running || !!item.status.running) &&
    (!filters.scheduled || item.triggers.includes("schedule")) &&
    (!filters.sources.length || filters.sources.includes(item.source)) &&
    (!filters.tags.length || filters.tags.some((tag) => item.tags.includes(tag))) &&
    (!filters.projects.length || filters.projects.includes(item.project))
  );
}
export function filterAndSortGallery<T extends GalleryItem>(
  items: ReadonlyArray<T>,
  filters: GalleryFilters,
  sort: GallerySort,
): T[] {
  const recent = (item: GalleryItem) =>
    [item.updatedAt, item.status.lastRunAt ?? ""].toSorted().at(-1) ?? "";
  return items
    .filter((item) => matchesGalleryFilters(item, filters))
    .toSorted(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sort === "name"
          ? a.title.localeCompare(b.title)
          : sort === "runs"
            ? b.status.runCount - a.status.runCount
            : sort === "steps"
              ? b.workSteps - a.workSteps
              : recent(b).localeCompare(recent(a))) ||
        a.title.localeCompare(b.title) ||
        a.key.localeCompare(b.key),
    );
}
export function galleryCounts(items: ReadonlyArray<GalleryItem>, filters: GalleryFilters) {
  const count = (patch: Partial<GalleryFilters>) =>
    items.filter((item) => matchesGalleryFilters(item, { ...filters, ...patch })).length;
  return {
    pinned: count({ pinned: true }),
    running: count({ running: true }),
    scheduled: count({ scheduled: true }),
    sources: new Map(
      (["mine", "builtin", "marketplace"] as const).map((source) => [
        source,
        count({ sources: [source] }),
      ]),
    ),
    tags: new Map(
      [...new Set(items.flatMap((item) => item.tags))]
        .toSorted()
        .map((tag) => [tag, count({ tags: [tag] })]),
    ),
    projects: new Map(
      [...new Set(items.map((item) => item.project))].map((project) => [
        project,
        count({ projects: [project] }),
      ]),
    ),
  };
}
