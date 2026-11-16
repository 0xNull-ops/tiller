import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../test/render";
import { GalleryView, GALLERY_VIEW_KEY } from "./GalleryView";
import { GalleryCard } from "./GalleryCard";
import type { GalleryItem } from "./workflowGallery";

it("filters by a card tag and remembers Grid/List across remounts", async () => {
  localStorage.removeItem(GALLERY_VIEW_KEY);
  const items: GalleryItem[] = ["web", "video"].map((tag) => ({
    key: tag,
    title: `${tag} workflow`,
    source: "mine",
    tags: [tag],
    steps: [],
    edges: [],
    loops: [],
    digest: tag,
    workSteps: 2,
    triggers: [],
    pinned: false,
    project: "p",
    projectTitle: "Project",
    scratch: false,
    updatedAt: "2026-10-01",
    status: { runCount: 0, missingSkills: [] },
  }));
  const renderItem = (item: GalleryItem, view: "grid" | "list", onTag: (tag: string) => void) => (
    <GalleryCard
      item={item}
      view={view}
      onTag={onTag}
      canEdit={false}
      canRun={false}
      onOpen={() => {}}
      onRun={() => {}}
      onPin={() => {}}
      actions={null}
    />
  );
  // The gallery owns its controls and has no router-dependent actions in this fixture.
  await using screen = await render(
    <div style={{ height: 800, display: "flex" }}>
      <GalleryView items={items} renderItem={renderItem} />
    </div>,
    { router: false },
  );
  try {
    await userEvent.click(screen.getByRole("button", { name: "#web", exact: true }));
    await expect.element(screen.getByRole("article", { name: "web workflow" })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("article", { name: "video workflow" }))
      .not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "List", exact: true }));
    await screen.rerender(
      <div style={{ height: 800, display: "flex" }}>
        <GalleryView key="remount" items={items} renderItem={renderItem} />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "List", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Grid", exact: true }));
    await expect
      .element(screen.getByRole("button", { name: "Grid", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    const many = Array.from({ length: 100 }, (_, index) => ({
      ...items[0]!,
      key: `item-${index}`,
      title: `Workflow ${String(index).padStart(3, "0")}`,
    }));
    await screen.rerender(
      <div style={{ height: 800, display: "flex" }}>
        <GalleryView key="many" items={many} renderItem={renderItem} />
      </div>,
    );
    await expect
      .element(screen.getByRole("article", { name: "Workflow 099" }))
      .not.toBeInTheDocument();
    const scroller = screen.container.querySelector<HTMLElement>("[data-gallery-scroll]");
    if (!scroller) throw new Error("Missing gallery scroll viewport");
    scroller.scrollTop = scroller.scrollHeight;
    await expect.element(screen.getByRole("article", { name: "Workflow 099" })).toBeInTheDocument();
  } finally {
    localStorage.removeItem(GALLERY_VIEW_KEY);
  }
});

it("widens the filter sidebar by keyboard and remembers the width", async () => {
  const key = "t3code:workflow-gallery-filters-width";
  localStorage.removeItem(key);
  using _storage = {
    [Symbol.dispose]() {
      localStorage.removeItem(key);
    },
  };
  const item: GalleryItem = {
    key: "web",
    title: "web workflow",
    source: "mine",
    tags: ["web"],
    steps: [],
    edges: [],
    loops: [],
    digest: "web",
    workSteps: 2,
    triggers: [],
    pinned: false,
    project: "p",
    projectTitle: "Project",
    scratch: false,
    updatedAt: "2026-10-01",
    status: { runCount: 0, missingSkills: [] },
  };
  const gallery = (remount?: string) => (
    <div style={{ height: 800, width: 1200, display: "flex" }}>
      <GalleryView
        key={remount}
        items={[item]}
        renderItem={(value, view, onTag) => (
          <GalleryCard
            item={value}
            view={view}
            onTag={onTag}
            canEdit={false}
            canRun={false}
            onOpen={() => {}}
            onRun={() => {}}
            onPin={() => {}}
            actions={null}
          />
        )}
      />
    </div>
  );
  await using screen = await render(gallery(), { router: false });
  const separator = screen.getByRole("separator", { name: "Filter panel width" });
  await expect.element(separator).toHaveAttribute("aria-valuenow", "208");
  await separator.click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(separator).toHaveAttribute("aria-valuenow", "224");
  await vi.waitFor(() =>
    expect(
      screen.container.querySelector("[data-gallery-filters]")!.getBoundingClientRect().width,
    ).toBe(224),
  );
  expect(localStorage.getItem(key)).toBe("224");
  await screen.rerender(gallery("remount"));
  await expect
    .element(screen.getByRole("separator", { name: "Filter panel width" }))
    .toHaveAttribute("aria-valuenow", "224");
});
