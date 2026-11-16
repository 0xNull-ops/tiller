import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetCreateUrlResult, AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { refreshTheme } from "../../../hooks/useTheme";
import { assetEnvironment } from "../../../state/assets";
import { usePrimaryEnvironmentId } from "../../../state/environments";
import { usePreparedConnection } from "../../../state/session";
import { useAtomQueryRunner } from "../../../state/use-atom-query-runner";
import {
  getCustomThemes,
  installCustomTheme,
  removeCustomTheme,
  updateCustomTheme,
} from "../../../themePalette";
import type { SceneManifest } from "../manifest";
import {
  isStudioSceneSlug,
  parseSceneFile,
  STUDIO_ART_KEYS,
  studioSceneToManifest,
  type StudioSceneFile,
} from "./sceneFile";

/** A studio scene the user applied: its file lives at `<cwd>/scenes/<slug>/scene.json`. */
export type StudioSceneEntry = {
  readonly themeId: string;
  readonly cwd: string;
  readonly slug: string;
  readonly rawJson: string;
  readonly revision?: number;
};

const STORAGE_KEY = "tiller:studio-scenes:v1";
// Re-mint art URLs this long before they expire.
const URL_REFRESH_LEAD_MS = 5 * 60_000;

const EMPTY_ENTRIES: ReadonlyArray<StudioSceneEntry> = [];
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<StudioSceneEntry> | null = null;

function isEntry(value: unknown): value is StudioSceneEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.themeId === "string" &&
    typeof entry.cwd === "string" &&
    typeof entry.slug === "string" &&
    typeof entry.rawJson === "string"
  );
}

function readStudioScenes(): ReadonlyArray<StudioSceneEntry> {
  if (snapshot !== null) return snapshot;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    snapshot = Array.isArray(parsed) ? parsed.filter(isEntry) : EMPTY_ENTRIES;
  } catch {
    snapshot = EMPTY_ENTRIES;
  }
  return snapshot;
}

function writeStudioScenes(entries: ReadonlyArray<StudioSceneEntry>) {
  snapshot = entries;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be blocked; the scene still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribeStudioScenes(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    snapshot = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The studio scenes the user applied, in the order they were applied. */
export function useStudioSceneEntries(): ReadonlyArray<StudioSceneEntry> {
  return useSyncExternalStore(subscribeStudioScenes, readStudioScenes, () => EMPTY_ENTRIES);
}

/**
 * Installs the scene's palette as a custom theme (replacing an earlier version, so the picker
 * shows it) and remembers where its art lives. Throws when the file does not parse.
 */
export function applyStudioScene(input: {
  readonly cwd: string;
  readonly slug: string;
  readonly rawJson: string;
  readonly revision?: number;
}): StudioSceneEntry {
  if (!isStudioSceneSlug(input.slug)) {
    throw new Error("Scene folder names may only use lowercase letters, numbers and hyphens.");
  }
  const parsed = parseSceneFile(input.rawJson);
  if (!parsed.ok) throw new Error(parsed.error);
  const { theme } = studioSceneToManifest(parsed.file, input.slug, () => undefined);
  if (getCustomThemes().some((existing) => existing.id === theme.id)) updateCustomTheme(theme);
  else installCustomTheme(theme);
  const entry: StudioSceneEntry = { themeId: theme.id, ...input, revision: Date.now() };
  writeStudioScenes([
    ...readStudioScenes().filter((existing) => existing.themeId !== theme.id),
    entry,
  ]);
  refreshTheme({ preservePreview: true });
  return entry;
}

export function removeStudioScene(themeId: string): void {
  writeStudioScenes(readStudioScenes().filter((entry) => entry.themeId !== themeId));
  if (getCustomThemes().some((theme) => theme.id === themeId)) removeCustomTheme(themeId);
}

type UrlResults = ReadonlyArray<AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>>;
const NO_URLS = Atom.make<UrlResults>([]);

const parsedFiles = new Map<string, StudioSceneFile | null>();
function parsedFile(rawJson: string): StudioSceneFile | null {
  if (!parsedFiles.has(rawJson)) {
    const result = parseSceneFile(rawJson);
    parsedFiles.set(rawJson, result.ok ? result.file : null);
  }
  return parsedFiles.get(rawJson) ?? null;
}

// SceneHost re-applies CSS variables whenever the manifest changes identity, so keep it stable.
let lastManifest: { readonly key: string; readonly manifest: SceneManifest } | null = null;
function stableManifest(key: string, build: () => SceneManifest): SceneManifest {
  if (lastManifest?.key !== key) lastManifest = { key, manifest: build() };
  return lastManifest.manifest;
}

function artFileNames(file: StudioSceneFile): string[] {
  const names = new Set<string>();
  if (typeof file.map.traveler === "object") names.add(file.map.traveler.image);
  for (const key of STUDIO_ART_KEYS) {
    const name = file.art?.[key];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/** The manifest for an applied studio scene, or null. Art appears once its URLs resolve. */
export function useStudioSceneManifest(themeId: string | null): SceneManifest | null {
  const entries = useStudioSceneEntries();
  const entry = themeId === null ? undefined : entries.find((item) => item.themeId === themeId);
  const file = entry === undefined ? null : parsedFile(entry.rawJson);
  const environmentId = usePrimaryEnvironmentId();
  const connection = usePreparedConnection(environmentId);
  const names = file === null ? [] : artFileNames(file);
  const resources: AssetResource[] =
    entry === undefined
      ? []
      : names.map((name) => ({
          _tag: "draft-workspace-file",
          cwd: entry.cwd,
          path: `scenes/${entry.slug}/${name}`,
        }));
  const results = useAtomValue(
    environmentId === null || resources.length === 0
      ? NO_URLS
      : assetEnvironment.createUrls({ environmentId, resources }),
  );
  useRefreshBeforeExpiry(environmentId, resources, results);

  if (entry === undefined || file === null) return null;
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const settled =
    httpBaseUrl !== null &&
    results.length === resources.length &&
    results.every((result) => result._tag !== "Initial");
  const urls = new Map<string, string>();
  if (settled) {
    names.forEach((name, index) => {
      const result = results[index];
      const url =
        result?._tag === "Success" ? resolveAssetUrl(httpBaseUrl, result.value.relativeUrl) : null;
      if (url !== null) {
        const versioned = new URL(url);
        if (entry.revision !== undefined)
          versioned.searchParams.set("studioRevision", String(entry.revision));
        urls.set(name, versioned.toString());
      }
    });
  }

  return stableManifest(JSON.stringify([entry, [...urls]]), () =>
    studioSceneToManifest(file, entry.slug, (name) => urls.get(name)),
  );
}

function useRefreshBeforeExpiry(
  environmentId: EnvironmentId | null,
  resources: ReadonlyArray<AssetResource>,
  results: UrlResults,
) {
  const refreshUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const firedFor = useRef<number | null>(null);
  let expiresAt: number | null = null;
  for (const result of results) {
    if (result._tag !== "Success") continue;
    expiresAt = Math.min(expiresAt ?? Infinity, result.value.expiresAt);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the timer that re-mints signed art URLs before they expire.
  useEffect(() => {
    if (environmentId === null || expiresAt === null) return;
    const refreshAt = expiresAt - URL_REFRESH_LEAD_MS;
    if (firedFor.current === refreshAt) return;
    const timer = setTimeout(
      () => {
        firedFor.current = refreshAt;
        for (const resource of resources) void refreshUrl({ environmentId, input: { resource } });
      },
      Math.max(0, refreshAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [environmentId, expiresAt, resources, refreshUrl]);
}
