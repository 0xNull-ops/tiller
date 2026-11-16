// Keep paths repository-relative so packaging and source-tree runtime resolution
// use the same fork-owned artwork without changing packaged resource names.
export const FORK_DESKTOP_ICON_ASSETS = {
  macIconPng: "apps/web/src/fork/assets/tiller-app-icon.png",
  linuxIconPng: "apps/web/src/fork/assets/tiller-512.png",
  windowsIconIco: "apps/web/src/fork/assets/tiller.ico",
  macIconIcns: "apps/web/src/fork/assets/tiller.icns",
} as const;
