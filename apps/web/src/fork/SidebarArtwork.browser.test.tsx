import type { CSSProperties } from "react";
import { expect, it, vi } from "vite-plus/test";
import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import "~/index.css";
import { render } from "../../test/render";
import { getThemeColorsForMode } from "../themePalette";
import { SidebarArtworkHeaderArt, SidebarKineticMesh } from "./SidebarArtwork";

type SurfaceColors = Readonly<{
  sidebar: string;
  sidebarForeground: string;
  primary: string;
}>;

const DARK: SurfaceColors = {
  sidebar: "#141414",
  sidebarForeground: "#ededed",
  primary: "#1b4ed8",
};

function SidebarSurface({
  enabled,
  mobile = false,
  width = 260,
  colors = DARK,
}: {
  readonly enabled: boolean;
  readonly mobile?: boolean;
  readonly width?: number;
  readonly colors?: SurfaceColors;
}) {
  const style: CSSProperties & Record<`--${string}`, string> = {
    width,
    height: 500,
    backgroundColor: colors.sidebar,
    "--sidebar": colors.sidebar,
    "--sidebar-foreground": colors.sidebarForeground,
    "--primary": colors.primary,
    "--surface-grain": "none",
    "--stage-art-line": "#bfaad0",
  };
  return (
    <div data-app-sidebar data-slot={mobile ? "sidebar" : "sidebar-container"} style={style}>
      <div
        data-slot={mobile ? undefined : "sidebar-inner"}
        className="bg-sidebar surface-grain"
        data-testid="surface"
      >
        <div
          data-sidebar-artwork-header={enabled ? "enabled" : undefined}
          className="relative"
          data-testid="art-header"
          style={{ height: 52 }}
        >
          {enabled ? <SidebarArtworkHeaderArt variant={null} /> : null}
          {enabled ? <SidebarKineticMesh /> : null}
        </div>
        Thread list
      </div>
    </div>
  );
}

function headerArt(screen: Awaited<ReturnType<typeof render>>) {
  return screen.container.querySelector<HTMLElement>("[data-shipyard-header-art]");
}

it.each(BUILT_IN_THEMES)(
  "preserves $label light and dark sidebar colours under the texture",
  async (theme) => {
    const light = getThemeColorsForMode(theme, "light")!;
    await using screen = await render(
      <SidebarSurface
        enabled
        colors={{
          sidebar: light.sidebar,
          sidebarForeground: light.sidebarForeground,
          primary: light.accent,
        }}
      />,
    );
    const surface = screen.getByTestId("surface").element();
    const backdrop = surface.parentElement!;
    expect(getComputedStyle(surface).backgroundImage).toContain("linear-gradient");
    expect(getComputedStyle(surface).backgroundColor).toBe(
      getComputedStyle(backdrop).backgroundColor,
    );

    const dark = getThemeColorsForMode(theme, "dark")!;
    await screen.rerender(
      <SidebarSurface
        enabled
        colors={{
          sidebar: dark.sidebar,
          sidebarForeground: dark.sidebarForeground,
          primary: dark.accent,
        }}
      />,
    );
    expect(getComputedStyle(surface).backgroundColor).toBe(
      getComputedStyle(backdrop).backgroundColor,
    );
  },
);

it("tints the diagonal panels from the sidebar foreground in both appearances", async () => {
  const theme = BUILT_IN_THEMES.find((candidate) => getThemeColorsForMode(candidate, "light"))!;
  const light = getThemeColorsForMode(theme, "light")!;
  const dark = getThemeColorsForMode(theme, "dark")!;
  const colors = (palette: { sidebar: string; sidebarForeground: string; accent: string }) => ({
    sidebar: palette.sidebar,
    sidebarForeground: palette.sidebarForeground,
    primary: palette.accent,
  });

  await using screen = await render(<SidebarSurface enabled colors={colors(light)} />);
  const nearPanel = screen.container.querySelector<HTMLElement>('[data-shipyard-art-panel="near"]');
  const farPanel = screen.container.querySelector<HTMLElement>('[data-shipyard-art-panel="far"]');
  expect(nearPanel).not.toBeNull();
  expect(farPanel).not.toBeNull();
  const lightNear = getComputedStyle(nearPanel!).backgroundImage;
  const lightFar = getComputedStyle(farPanel!).backgroundImage;
  expect(lightNear).toContain("oklab(");
  expect(lightFar).toContain("oklab(");

  await screen.rerender(<SidebarSurface enabled colors={colors(dark)} />);
  const darkNear = getComputedStyle(nearPanel!).backgroundImage;
  expect(darkNear).not.toBe(lightNear);
  expect(getComputedStyle(farPanel!).backgroundImage).not.toBe(lightFar);
  // Panel tint follows the sidebar foreground: it darkens light sidebars and
  // lightens dark ones, so the lockup keeps its contrast in both appearances.
  const tintLightness = (image: string) => Number(image.match(/oklab\(([\d.]+)/)?.[1]);
  expect(tintLightness(lightNear)).toBeLessThan(tintLightness(darkNear));
});

it("keeps the accent slash theme-colored and visible at real sidebar widths", async () => {
  await using screen = await render(<SidebarSurface enabled />);
  const accent = screen.container.querySelector<HTMLElement>("[data-shipyard-art-accent]")!;
  const initialColor = getComputedStyle(accent).backgroundColor;
  expect(initialColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(getComputedStyle(accent).width)).toBeLessThanOrEqual(2);

  await screen.rerender(
    <SidebarSurface
      enabled
      colors={{ sidebar: "#fafafa", sidebarForeground: "#27272a", primary: "#d35400" }}
    />,
  );
  expect(getComputedStyle(accent).backgroundColor).not.toBe(initialColor);

  for (const width of [200, 260, 360]) {
    await screen.rerender(<SidebarSurface enabled width={width} />);
    const header = screen.getByTestId("art-header").element();
    const headerRect = header.getBoundingClientRect();
    const accentRect = accent.getBoundingClientRect();
    const transform = getComputedStyle(accent).transform;
    const [, cosine, sine] = transform.match(/matrix\(([^,]+),\s*([^,]+)/) ?? [];
    const angle = Math.abs((Math.atan2(Number(sine), Number(cosine)) * 180) / Math.PI);

    expect(angle).toBeGreaterThanOrEqual(40);
    expect(angle).toBeLessThanOrEqual(50);
    expect(accentRect.left + accentRect.width / 2).toBeGreaterThan(headerRect.width * 0.6);
    expect(accentRect.right).toBeLessThan(headerRect.right - 12);
    expect(accentRect.width).toBeGreaterThan(headerRect.width * 0.2);
    expect(getComputedStyle(accent).opacity).toBe("1");
    expect(getComputedStyle(accent).maskImage).toBe("none");
  }
});

it("keeps the header art inside a narrow sidebar and removes it when decoration is off", async () => {
  await using screen = await render(<SidebarSurface enabled width={200} />);
  const header = screen.getByTestId("art-header").element();
  const accent = screen.container.querySelector<HTMLElement>("[data-shipyard-art-accent]")!;
  const headerRect = header.getBoundingClientRect();
  const artRect = headerArt(screen)!.getBoundingClientRect();
  const accentRect = accent.getBoundingClientRect();
  expect(artRect.width).toBeCloseTo(headerRect.width, 0);
  expect(artRect.height).toBeCloseTo(headerRect.height, 0);
  expect(accentRect.left).toBeGreaterThanOrEqual(headerRect.left);
  expect(accentRect.right).toBeLessThanOrEqual(headerRect.right);

  await screen.rerender(<SidebarSurface enabled={false} width={200} />);
  expect(getComputedStyle(screen.getByTestId("surface").element()).backgroundImage).toBe("none");
  expect(headerArt(screen)).toBeNull();
});

it("keeps the measured mesh decorative and static under reduced motion", async () => {
  const original = window.matchMedia.bind(window);
  using _motion = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const result = original(query);
    return query === "(prefers-reduced-motion: reduce)"
      ? ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => true,
        } as unknown as MediaQueryList)
      : result;
  });
  using _frame = vi.spyOn(window, "requestAnimationFrame");
  await using screen = await render(<SidebarSurface enabled />);
  const canvas = screen.container.querySelector<HTMLCanvasElement>(
    "canvas[data-sidebar-kinetic-mesh]",
  )!;
  expect(canvas.getAttribute("aria-hidden")).toBe("true");
  expect(getComputedStyle(canvas).pointerEvents).toBe("none");
  await vi.waitFor(() => expect(canvas.width).toBeGreaterThan(0));
  expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  await screen.unmount();
  expect(screen.container.querySelector("canvas[data-sidebar-kinetic-mesh]")).toBeNull();
});

it("schedules only a bounded delayed pulse and clears it when the page is hidden", async () => {
  using scheduleSpy = vi.spyOn(window, "setTimeout");
  using clearSpy = vi.spyOn(window, "clearTimeout");
  await using screen = await render(<SidebarSurface enabled />);
  await vi.waitFor(() =>
    expect(
      scheduleSpy.mock.calls.some((call) => typeof call[1] === "number" && call[1] >= 8_000),
    ).toBe(true),
  );
  const scheduleCall = scheduleSpy.mock.calls.find(
    (call) => typeof call[1] === "number" && call[1] >= 8_000,
  );
  const timerId = scheduleSpy.mock.results[scheduleSpy.mock.calls.indexOf(scheduleCall!)]?.value;
  expect(scheduleCall?.[1]).toBeLessThanOrEqual(12_000);

  using _hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(clearSpy).toHaveBeenCalledWith(timerId);
  await screen.unmount();
});

it("paints the mobile sheet background without changing the thread surface", async () => {
  await using screen = await render(<SidebarSurface enabled mobile />);
  const surface = screen.getByTestId("surface").element();
  expect(getComputedStyle(surface.parentElement!).backgroundImage).toContain("linear-gradient");
  expect(getComputedStyle(surface).backgroundImage).toBe("none");
  await screen.rerender(<SidebarSurface enabled={false} mobile />);
  expect(getComputedStyle(surface.parentElement!).backgroundImage).toBe("none");
});
