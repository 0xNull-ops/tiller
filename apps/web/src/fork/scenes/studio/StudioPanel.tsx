import "./studio.css";
// fork(scenes): lists the Theme Studio's scenes beside its chat and lets the user preview or apply them.
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, RefreshCwIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { stackedThreadToast, toastManager } from "../../../components/ui/toast";
import { useComposerDraftStore, type ComposerThreadTarget } from "../../../composerDraftStore";
import { readThemeHalvesRaw, useTheme } from "../../../hooks/useTheme";
import { useThreadRouteTarget } from "../../../hooks/useThreadRouteTarget";
import { appAtomRegistry } from "../../../rpc/atomRegistry";
import { assetEnvironment } from "../../../state/assets";
import { useProject, useQuietThreadShell } from "../../../state/entities";
import { useEnvironmentProviders } from "../../../state/environments";
import { projectEnvironment } from "../../../state/projects";
import {
  existingBanner,
  fileNamesIn,
  inspectStudioScene,
  SCENE_FILE_NAME,
  sceneFixPrompt,
  sceneSlugs,
  SCENES_DIRECTORY,
  type StudioSceneReport,
} from "./sceneDiscovery";
import { useOpenThemeStudio } from "./useOpenThemeStudio";
import { StudioSessionList } from "./StudioSessions";
import { isStudioProject } from "./studioProject";
import { applyStudioScene, removeStudioScene, useStudioSceneEntries } from "./studioScenes";

const EXAMPLE_PROMPTS = [
  "Rainy cyberpunk alley at night, teal and amber",
  "Cozy autumn library with a sleepy cat",
  "Deep-sea research station, bioluminescent blues",
];
const QUERY_OPTIONS = { refresh: true, reportFailure: false, reportDefect: false } as const;

async function scanSlug(
  environmentId: EnvironmentId,
  cwd: string,
  slug: string,
): Promise<StudioSceneReport | null> {
  const folder = `${SCENES_DIRECTORY}/${slug}`;
  const listing = await executeAtomQuery(
    appAtomRegistry,
    projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath: folder } }),
    QUERY_OPTIONS,
  );
  if (listing._tag === "Failure") return null;
  const fileNames = fileNamesIn(listing.value.entries, folder);
  if (!fileNames.has(SCENE_FILE_NAME)) return null;
  const read = await executeAtomQuery(
    appAtomRegistry,
    projectEnvironment.readFile({
      environmentId,
      input: { cwd, relativePath: `${folder}/${SCENE_FILE_NAME}` },
    }),
    QUERY_OPTIONS,
  );
  if (read._tag === "Failure") return null;
  const rawJson = read.value.contents;
  const first = inspectStudioScene({ slug, rawJson, fileNames });
  const banner = existingBanner(first.file, fileNames);
  const traveler = first.file?.map.traveler;
  const marker =
    typeof traveler === "object" && fileNames.has(traveler.image) ? traveler.image : null;
  const dimensions = await Promise.all(
    [banner, marker].map(async (name) => {
      if (name === null) return undefined;
      const url = await executeAtomQuery(
        appAtomRegistry,
        assetEnvironment.createUrl({
          environmentId,
          input: { resource: { _tag: "draft-workspace-file", cwd, path: `${folder}/${name}` } },
        }),
        QUERY_OPTIONS,
      );
      return url._tag === "Success" ? url.value.imageDimensions : undefined;
    }),
  );
  return inspectStudioScene({
    slug,
    rawJson,
    fileNames,
    ...(dimensions[0] === undefined ? {} : { bannerSize: dimensions[0] }),
    ...(dimensions[1] === undefined ? {} : { travelerSize: dimensions[1] }),
  });
}

/** Every `scenes/<slug>/scene.json` in the studio, checked. A missing `scenes` folder is no scenes. */
async function scanStudioScenes(
  environmentId: EnvironmentId,
  cwd: string,
): Promise<StudioSceneReport[]> {
  const root = await executeAtomQuery(
    appAtomRegistry,
    projectEnvironment.listEntries({
      environmentId,
      input: { cwd, directoryPath: SCENES_DIRECTORY },
    }),
    QUERY_OPTIONS,
  );
  if (root._tag === "Failure") return [];
  const reports = await Promise.all(
    sceneSlugs(root.value.entries).map((slug) => scanSlug(environmentId, cwd, slug)),
  );
  return reports.filter((report) => report !== null);
}

function useChatColumn(): HTMLElement | null {
  const [column, setColumn] = useState<HTMLElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the chat column DOM node the panel portals into.
  useEffect(() => {
    const find = () => {
      const next = document.querySelector<HTMLElement>("[data-chat-column]");
      setColumn((current) => (current === next ? current : next));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return column;
}

type StudioContext = {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly composerTarget: ComposerThreadTarget;
  readonly runActive: boolean;
  readonly canMakeArt: boolean | null;
};

/** The open thread's studio context, or null when the open thread is not a studio thread. */
function useStudioContext(): StudioContext | null {
  const target = useThreadRouteTarget();
  const threadRef = target?.kind === "server" ? target.threadRef : null;
  const shell = useQuietThreadShell(threadRef);
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? (store.draftThreadsByThreadKey[target.draftId] ?? null) : null,
  );
  const composerTarget: ComposerThreadTarget | null =
    target === null ? null : target.kind === "server" ? target.threadRef : target.draftId;
  const activeProvider = useComposerDraftStore((store) =>
    composerTarget === null
      ? null
      : (store.getComposerDraft(composerTarget)?.activeProvider ?? null),
  );
  const environmentId = shell?.environmentId ?? draft?.environmentId ?? null;
  const projectId = shell?.projectId ?? draft?.projectId ?? null;
  const project = useProject(
    environmentId === null || projectId === null ? null : scopeProjectRef(environmentId, projectId),
  );
  const providers = useEnvironmentProviders();
  if (environmentId === null || composerTarget === null || project === null) return null;
  if (!isStudioProject(project)) return null;
  const instanceId = activeProvider ?? shell?.providerInstanceId ?? null;
  const provider =
    instanceId === null
      ? undefined
      : providers.get(environmentId)?.find((candidate) => candidate.instanceId === instanceId);
  return {
    environmentId,
    cwd: project.workspaceRoot,
    composerTarget,
    runActive: threadRuntimeIsActive(shell?.runtime),
    canMakeArt: provider === undefined ? null : provider.driver === "codex",
  };
}

export function StudioPanelHost() {
  const context = useStudioContext();
  if (context === null) return null;
  return <StudioPanelPortal context={context} />;
}

function StudioPanelPortal({ context }: { context: StudioContext }) {
  const column = useChatColumn();
  return column === null ? null : createPortal(<StudioPanel context={context} />, column);
}

type PreviewUndo = {
  readonly themeId: string;
  readonly previousTheme: string;
  readonly previousHalves: { light?: string; dark?: string };
  readonly wasApplied: boolean;
};

function StudioPanel({ context }: { context: StudioContext }) {
  const { environmentId, cwd, composerTarget, runActive, canMakeArt } = context;
  const { theme, setTheme, setThemeHalf, appearanceMode } = useTheme();
  const applied = useStudioSceneEntries();
  const openStudio = useOpenThemeStudio();
  const [opening, setOpening] = useState(false);
  const newSession = async () => {
    if (!openStudio) return;
    setOpening(true);
    await openStudio();
    setOpening(false);
  };
  const [collapsed, setCollapsed] = useState(true);
  const lastScenes = useRef<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [scan, setScan] = useState<{
    readonly key: string;
    readonly reports: ReadonlyArray<StudioSceneReport>;
  } | null>(null);
  const [undo, setUndo] = useState<PreviewUndo | null>(null);
  const scanKey = JSON.stringify([environmentId, cwd, runActive, refreshCount]);
  const scanning = scan?.key !== scanKey;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the studio's scene files from the server when a run starts or ends, or on refresh.
  useEffect(() => {
    let cancelled = false;
    void scanStudioScenes(environmentId, cwd).then((reports) => {
      if (!cancelled) {
        const signature = JSON.stringify(reports.map(({ slug, rawJson }) => [slug, rawJson]));
        if (!runActive && lastScenes.current !== null && lastScenes.current !== signature)
          setCollapsed(false);
        if (!runActive) lastScenes.current = signature;
        setScan({ key: scanKey, reports });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, cwd, scanKey, runActive]);

  const reports = scan?.reports ?? [];
  const isApplied = (themeId: string) => applied.some((entry) => entry.themeId === themeId);

  const install = (report: StudioSceneReport): boolean => {
    try {
      applyStudioScene({ cwd, slug: report.slug, rawJson: report.rawJson });
      return true;
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t use this theme",
          description: error instanceof Error ? error.message : "Try again.",
        }),
      );
      return false;
    }
  };

  const preview = (report: StudioSceneReport) => {
    const wasApplied =
      undo?.themeId === report.themeId ? undo.wasApplied : isApplied(report.themeId);
    if (!install(report)) return;
    setUndo({
      themeId: report.themeId,
      previousTheme: undo?.previousTheme ?? theme,
      previousHalves: undo?.previousHalves ?? readThemeHalvesRaw(),
      wasApplied,
    });
    setTheme(report.themeId);
  };

  const undoPreview = () => {
    if (undo === null) return;
    setTheme(undo.previousTheme);
    for (const appearance of ["light", "dark"] as const) {
      const half = undo.previousHalves[appearance];
      if (half !== undefined) setThemeHalf(appearance, half);
    }
    if (!undo.wasApplied) removeStudioScene(undo.themeId);
    setUndo(null);
  };

  const apply = (report: StudioSceneReport) => {
    if (!install(report)) return;
    setTheme(report.themeId);
    setUndo(null);
    setCollapsed(true);
  };

  const remove = (report: StudioSceneReport) => {
    if (theme === report.themeId) setTheme(appearanceMode === "system" ? "system" : appearanceMode);
    removeStudioScene(report.themeId);
    setCollapsed(true);
    if (undo?.themeId === report.themeId) setUndo(null);
  };

  const fix = (report: StudioSceneReport) => {
    const store = useComposerDraftStore.getState();
    const current = store.getComposerDraft(composerTarget)?.prompt ?? "";
    const message = sceneFixPrompt(report);
    store.setPrompt(composerTarget, current.trim() ? `${current}\n\n${message}` : message);
  };

  return (
    <section
      data-studio-panel=""
      data-collapsed={collapsed ? "" : undefined}
      aria-label="Theme Studio"
    >
      <header data-studio-panel-header="">
        <h2>Theme Studio · {reports.length} themes</h2>
        <div data-studio-panel-actions="">
          <Button
            size="xs"
            variant="outline"
            aria-label="New Studio session"
            title="New Studio session"
            disabled={!openStudio || opening}
            onClick={() => void newSession()}
          >
            <PlusIcon /> New
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Rescan themes"
            disabled={scanning}
            onClick={() => setRefreshCount((count) => count + 1)}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={collapsed ? "Expand Theme Studio" : "Collapse Theme Studio"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </Button>
        </div>
      </header>
      {runActive ? (
        <p data-studio-panel-note="">
          You can leave this chat. Generation continues in the background while the server stays
          running.
        </p>
      ) : null}
      {collapsed ? null : (
        <>
          <details>
            <summary>Recent sessions</summary>
            <StudioSessionList />
          </details>
          {canMakeArt === false ? (
            <p data-studio-panel-note="">
              This model can't generate images, so you'll get colors and gradients only. Switch to a
              Codex model in the picker for art.
            </p>
          ) : null}
          {undo !== null ? (
            <div data-studio-panel-undo="">
              <span>Previewing a theme.</span>
              <Button size="xs" variant="outline" onClick={undoPreview}>
                Undo preview
              </Button>
            </div>
          ) : null}
          {reports.length === 0 ? (
            scanning && scan === null ? (
              <p data-studio-panel-muted="">Looking for themes…</p>
            ) : (
              <div data-studio-panel-empty="">
                <p>Describe a theme in the chat to make one. For example:</p>
                <ul>
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <li key={prompt}>{prompt}</li>
                  ))}
                </ul>
              </div>
            )
          ) : (
            <ul data-studio-panel-list="">
              {reports.map((report) => {
                const hasError = report.issues.some((issue) => issue.level === "error");
                const active = theme === report.themeId;
                const current = applied.some(
                  (entry) => entry.themeId === report.themeId && entry.rawJson === report.rawJson,
                );
                return (
                  <li key={report.slug} data-studio-scene="">
                    <div data-studio-scene-title="">
                      <strong>{report.file?.name ?? report.slug}</strong>
                      {active ? (
                        <Badge variant={current ? "success" : "warning"}>
                          {current ? "Active" : "Update available"}
                        </Badge>
                      ) : null}
                      {hasError ? <Badge variant="error">Needs fixing</Badge> : null}
                      {!hasError && report.issues.length > 0 ? (
                        <Badge variant="warning">
                          {report.issues.length === 1 ? "1 note" : `${report.issues.length} notes`}
                        </Badge>
                      ) : null}
                    </div>
                    {report.file?.tagline ? (
                      <p data-studio-panel-muted="">{report.file.tagline}</p>
                    ) : null}
                    {report.issues.length > 0 ? (
                      <ul data-studio-scene-issues="">
                        {report.issues.map((issue) => (
                          <li key={issue.message} data-level={issue.level}>
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div data-studio-scene-actions="">
                      {active ? (
                        <span data-studio-in-use="">
                          {undo?.themeId === report.themeId
                            ? "Previewing"
                            : current
                              ? "In use"
                              : "Earlier version in use"}
                        </span>
                      ) : (
                        <Button
                          data-studio-preview=""
                          size="xs"
                          variant="outline"
                          disabled={report.file === null}
                          onClick={() => preview(report)}
                        >
                          Preview
                        </Button>
                      )}
                      <Button
                        data-studio-apply=""
                        size="xs"
                        disabled={hasError}
                        onClick={() => apply(report)}
                      >
                        {active && current && undo === null
                          ? "Reapply"
                          : active
                            ? "Apply update"
                            : "Apply"}
                      </Button>
                      {report.issues.length > 0 ? (
                        <Button size="xs" variant="outline" onClick={() => fix(report)}>
                          Fix
                        </Button>
                      ) : null}
                      {isApplied(report.themeId) && undo?.themeId !== report.themeId ? (
                        <Button size="xs" variant="ghost" onClick={() => remove(report)}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
