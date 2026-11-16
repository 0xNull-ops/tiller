// Keep this module dependency-free: Electron and packaging scripts also read it.
export const FORK_BRAND = {
  name: "Tiller",
  shortName: "Tiller",
  logo: { label: "Tiller", suffix: "Tiller", viewBox: "0 0 1000 1000" },
} as const;

export const FORK_WEB_ICON_PATHS = {
  faviconIco: "apps/web/src/fork/assets/tiller-favicon.ico",
  favicon16Png: "apps/web/src/fork/assets/tiller-16.png",
  favicon32Png: "apps/web/src/fork/assets/tiller-32.png",
  appleTouchIconPng: "apps/web/src/fork/assets/tiller-touch.png",
} as const;

export function tillerWebIconOverrides(targetDirectory: string) {
  return [
    {
      sourceRelativePath: FORK_WEB_ICON_PATHS.faviconIco,
      targetRelativePath: `${targetDirectory}/favicon.ico`,
    },
    {
      sourceRelativePath: FORK_WEB_ICON_PATHS.favicon16Png,
      targetRelativePath: `${targetDirectory}/favicon-16x16.png`,
    },
    {
      sourceRelativePath: FORK_WEB_ICON_PATHS.favicon32Png,
      targetRelativePath: `${targetDirectory}/favicon-32x32.png`,
    },
    {
      sourceRelativePath: FORK_WEB_ICON_PATHS.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/apple-touch-icon.png`,
    },
  ];
}

export function isTillerLaunch() {
  return true;
}
