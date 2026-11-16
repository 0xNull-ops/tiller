import "./workflowGallery.css";
import * as Schema from "effect/Schema";
import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { observeResize } from "../lib/observeResize";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useResizeDrag } from "../hooks/useResizeDrag";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../components/ui/select";
import { galleryFiltersWidth } from "./galleryFiltersWidth";
import {
  EMPTY_GALLERY_FILTERS,
  filterAndSortGallery,
  galleryCounts,
  type GalleryFilters,
  type GalleryItem,
  type GallerySort,
} from "./workflowGallery";

export const GALLERY_VIEW_KEY = "tiller.workflow-gallery.view";
const GALLERY_FILTERS_WIDTH_KEY = "t3code:workflow-gallery-filters-width";
const FiltersWidth = Schema.NullOr(Schema.Number);
function readView(): "grid" | "list" {
  try {
    return localStorage.getItem(GALLERY_VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}
const toggle = <T,>(values: ReadonlyArray<T>, value: T) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

export function GalleryView<T extends GalleryItem>(props: {
  readonly initialSource?: GalleryItem["source"] | undefined;
  readonly items: ReadonlyArray<T>;
  readonly renderItem: (item: T, view: "grid" | "list", onTag: (tag: string) => void) => ReactNode;
}) {
  const [filters, setFilters] = useState<GalleryFilters>(() => ({
    ...EMPTY_GALLERY_FILTERS,
    sources: props.initialSource ? [props.initialSource] : [],
  }));
  const [sort, setSort] = useState<GallerySort>("recent");
  const [view, setView] = useState(readView);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [available, setAvailable] = useState(0);
  const [savedWidth, saveWidth] = useLocalStorage(GALLERY_FILTERS_WIDTH_KEY, null, FiltersWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const {
    width: filtersWidth,
    min: filtersMin,
    max: filtersMax,
  } = galleryFiltersWidth(available, dragWidth ?? savedWidth);
  const {
    refresh: _refresh,
    cancel: _cancel,
    ...filtersResize
  } = useResizeDrag<HTMLDivElement>(() => ({
    width: filtersWidth,
    edge: "right",
    bounds: { min: filtersMin, max: filtersMax },
    resize: (next) => {
      const clamped = galleryFiltersWidth(available, next).width;
      setDragWidth(clamped);
      return clamped;
    },
    finish: (next) => {
      saveWidth(next);
      setDragWidth(null);
    },
    cleanup: (committed) => {
      if (!committed) setDragWidth(null);
    },
  }));
  const observeLayout = (node: HTMLDivElement | null) => {
    if (!node) return;
    return observeResize(node, (entries) => {
      const rect = entries.at(-1)?.contentRect;
      if (rect) setAvailable(rect.width);
    });
  };
  const items = filterAndSortGallery(props.items, filters, sort);
  const counts = galleryCounts(props.items, filters);
  const chooseView = (value: "grid" | "list") => {
    setView(value);
    try {
      localStorage.setItem(GALLERY_VIEW_KEY, value);
    } catch {
      /* Storage may be unavailable in private clients. */
    }
  };
  const tag = (value: string) => setFilters((current) => ({ ...current, tags: [value] }));
  const check = (
    label: string,
    count: number,
    checked: boolean,
    onChange: () => void,
    disabled = false,
  ) => (
    <label
      key={label}
      className="flex cursor-pointer items-center gap-2 py-1.5 text-xs text-muted-foreground"
    >
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="flex-1">{label}</span>
      <span className="tabular-nums">{count}</span>
    </label>
  );
  const pinned = items.filter((item) => item.pinned && !item.scratch);
  const regular = items.filter((item) => !item.pinned && !item.scratch);
  const scratch = items.filter((item) => item.scratch);
  const sections = [
    ...(pinned.length ? [{ title: "Pinned", items: pinned }] : []),
    ...(regular.length ? [{ title: "Workflows", items: regular }] : []),
    ...(scratch.length
      ? [
          {
            title: "From threads",
            items: scratchOpen || filters.search.trim() ? scratch : [],
            count: scratch.length,
            onToggle: () => setScratchOpen((value) => !value),
            expanded: scratchOpen || !!filters.search.trim(),
          },
        ]
      : []),
  ];
  return (
    <div
      data-gallery-layout
      ref={observeLayout}
      style={{ "--gallery-filters-width": `${filtersWidth}px` } as CSSProperties}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <div data-gallery-filter-toggle>
          <Button
            variant="outline"
            size="xs"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            Filters
          </Button>
        </div>
        <div className="min-w-36 flex-1">
          <Input
            type="search"
            size="sm"
            aria-label="Search workflows"
            placeholder="Search workflows…"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>
        <Select
          value={sort}
          onValueChange={(value) => {
            if (value) setSort(value as GallerySort);
          }}
        >
          <SelectTrigger size="xs" aria-label="Sort workflows">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="recent">Recent</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="runs">Most run</SelectItem>
            <SelectItem value="steps">Steps</SelectItem>
          </SelectPopup>
        </Select>
        <div role="group" aria-label="Gallery view" className="flex gap-1">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={view === "grid"}
            onClick={() => chooseView("grid")}
          >
            Grid
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={view === "list"}
            onClick={() => chooseView("list")}
          >
            List
          </Button>
        </div>
        <span className="text-2xs text-muted-foreground" role="status">
          {items.length} workflows
        </span>
      </div>
      <div data-gallery-shell>
        <aside aria-label="Workflow filters" data-gallery-filters data-open={filtersOpen}>
          <div className="-ml-2">
            <Button variant="ghost" size="xs" onClick={() => setFilters(EMPTY_GALLERY_FILTERS)}>
              Clear filters
            </Button>
          </div>
          {check("Pinned", counts.pinned, filters.pinned, () =>
            setFilters({ ...filters, pinned: !filters.pinned }),
          )}
          {check("Running", counts.running, filters.running, () =>
            setFilters({ ...filters, running: !filters.running }),
          )}
          {check("Scheduled", counts.scheduled, filters.scheduled, () =>
            setFilters({ ...filters, scheduled: !filters.scheduled }),
          )}
          <fieldset className="mt-4 border-t pt-3">
            <legend className="text-2xs font-medium">Source</legend>
            {(["mine", "builtin", "marketplace"] as const).map((source) =>
              check(
                source === "mine"
                  ? "My workflows"
                  : source === "builtin"
                    ? "Built-in"
                    : "Marketplace · soon",
                counts.sources.get(source) ?? 0,
                filters.sources.includes(source),
                () => setFilters({ ...filters, sources: toggle(filters.sources, source) }),
                source === "marketplace",
              ),
            )}
          </fieldset>
          <fieldset className="mt-4 border-t pt-3">
            <legend className="text-2xs font-medium">Tags</legend>
            {[...counts.tags].map(([value, count]) =>
              check(value, count, filters.tags.includes(value), () =>
                setFilters({ ...filters, tags: toggle(filters.tags, value) }),
              ),
            )}
          </fieldset>
          <fieldset className="mt-4 border-t pt-3">
            <legend className="text-2xs font-medium">Project</legend>
            {[...counts.projects].map(([project, count]) =>
              check(
                props.items.find((item) => item.project === project)?.projectTitle ?? project,
                count,
                filters.projects.includes(project),
                () => setFilters({ ...filters, projects: toggle(filters.projects, project) }),
              ),
            )}
          </fieldset>
        </aside>
        <div
          role="separator"
          aria-label="Filter panel width"
          aria-orientation="vertical"
          aria-valuemin={filtersMin}
          aria-valuemax={filtersMax}
          aria-valuenow={filtersWidth}
          data-gallery-filters-handle
          tabIndex={0}
          className="flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center border-r border-border bg-background outline-none hover:border-ring hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          {...filtersResize}
          onPointerDown={(event) => {
            event.currentTarget.focus();
            filtersResize.onPointerDown(event);
          }}
          onDoubleClick={() => saveWidth(null)}
          onKeyDown={(event) => {
            const next =
              event.key === "Home"
                ? filtersMin
                : event.key === "End"
                  ? filtersMax
                  : event.key === "ArrowRight"
                    ? filtersWidth + 16
                    : event.key === "ArrowLeft"
                      ? filtersWidth - 16
                      : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            saveWidth(galleryFiltersWidth(available, next).width);
          }}
        >
          <span className="h-8 w-0.5 rounded-full bg-border" />
        </div>
        {items.length ? (
          <GalleryCollection
            sections={sections}
            view={view}
            renderItem={(item) => props.renderItem(item, view, tag)}
          />
        ) : (
          <p role="status" className="flex-1 py-16 text-center text-sm text-muted-foreground">
            {props.items.length
              ? "No workflows match these filters."
              : "No saved workflows yet. Create a workflow to get started."}
          </p>
        )}
      </div>
    </div>
  );
}

function GalleryCollection<T extends GalleryItem>(props: {
  readonly sections: ReadonlyArray<{
    readonly title: string;
    readonly items: ReadonlyArray<T>;
    readonly count?: number;
    readonly onToggle?: () => void;
    readonly expanded?: boolean;
  }>;
  readonly view: "grid" | "list";
  readonly renderItem: (item: T) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 800 });
  const [scrollTop, setScrollTop] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observe the scroll viewport to lay out and virtualize responsive gallery rows.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setViewport({ width: element.clientWidth - 40, height: element.clientHeight });
    return observeResize(element, ([entry]) => {
      if (entry)
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height + 24 });
    });
  }, []);
  const columns = props.view === "list" ? 1 : Math.max(1, Math.floor((viewport.width + 16) / 276));
  const coverHeight = (Math.max(1, (viewport.width - (columns - 1) * 16) / columns) * 9) / 16;
  const cardHeight = coverHeight + 182;
  const rows: Array<{ key: string; top: number; height: number; content: ReactNode }> = [];
  let top = 0;
  for (const section of props.sections) {
    rows.push({
      key: section.title,
      top,
      height: 40,
      content: section.onToggle ? (
        <button
          type="button"
          aria-expanded={section.expanded}
          onClick={section.onToggle}
          className="py-2 text-xs font-medium"
        >
          {section.expanded ? "▾" : "▸"} {section.title} ({section.count})
        </button>
      ) : (
        <h2 className="py-2 text-xs font-medium text-muted-foreground">{section.title}</h2>
      ),
    });
    top += 40;
    for (let index = 0; index < section.items.length; index += columns) {
      const chunk = section.items.slice(index, index + columns);
      const height = props.view === "list" ? 128 : cardHeight + 16;
      rows.push({
        key: chunk[0]!.key,
        top,
        height,
        content: (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {chunk.map((item) => (
              <div key={item.key}>{props.renderItem(item)}</div>
            ))}
          </div>
        ),
      });
      top += height;
    }
  }
  const virtual = props.sections.reduce((sum, section) => sum + section.items.length, 0) > 60;
  const visibleTop = Math.min(scrollTop, Math.max(0, top - viewport.height));
  const visible = virtual
    ? rows.filter(
        (row) =>
          row.top + row.height >= visibleTop - 400 && row.top <= visibleTop + viewport.height + 400,
      )
    : rows;
  return (
    <div
      data-gallery-scroll
      ref={ref}
      style={
        {
          "--gallery-cover-height": `${coverHeight}px`,
          "--gallery-card-height": `${cardHeight}px`,
        } as CSSProperties
      }
      className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-3"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: top }}>
        {visible.map((row) => (
          <div
            key={row.key}
            className="absolute inset-x-0"
            style={{ top: row.top, height: row.height }}
          >
            {row.content}
          </div>
        ))}
      </div>
    </div>
  );
}
