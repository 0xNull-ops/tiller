import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuditBadge } from "./AuditBadge";
import { mergeSkillResults } from "./browseResults";
import { skillsShAuditDetails } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  SkillsShEntry,
  SkillsShPreview,
  SkillsShResult,
} from "@t3tools/contracts";
import { createSkillsShCommands } from "@t3tools/client-runtime/state/skillsSh";
import ReactMarkdown from "react-markdown";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../../components/ui/sheet";

const commands = createSkillsShCommands(connectionAtomRuntime);
type Preview = typeof SkillsShPreview.Type;
type Entry = typeof SkillsShEntry.Type;
function SkillsBrowserContents({
  environmentId,
  project,
  onInstalled,
  compact = false,
  searchQuery,
  installOnPick = false,
}: {
  readonly compact?: boolean;
  readonly searchQuery?: string;
  readonly installOnPick?: boolean;
  readonly environmentId: EnvironmentId;
  readonly project?: string | undefined;
  readonly onInstalled?: ((name: string) => void) | undefined;
}) {
  const audit = useAtomCommand(commands.audit, { reportFailure: false });
  const dismiss = useAtomCommand(commands.dismiss);
  const search = useAtomCommand(commands.search);
  const preview = useAtomCommand(commands.preview);
  const install = useAtomCommand(commands.install);
  const list = useAtomCommand(commands.list);
  const uninstall = useAtomCommand(commands.uninstall);
  const updates = useAtomCommand(commands.updates);
  const pending = useAtomCommand(commands.pending);
  const canInstall = useAtomValue(commands.install.permissionAtom(environmentId));
  const [limit, setLimit] = useState(20);
  const [loadedLimit, setLoadedLimit] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [internalQuery, setQuery] = useState("");
  const query = searchQuery ?? internalQuery;
  const [results, setResults] = useState<readonly (typeof SkillsShResult.Type)[]>([]);
  const [audits, setAudits] = useState<Record<string, unknown>>({});
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<{ id: string; message: string } | null>(null);
  const [selected, setSelected] = useState<Preview | null>(null);
  const [updateChoices, setUpdateChoices] = useState<
    readonly { entry: Entry; preview: Preview; summary: string }[]
  >([]);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [requests, setRequests] = useState<readonly { requestId: string; preview: Preview }[]>([]);
  const [scope, setScope] = useState<"global" | "project">("global");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const location = { scope, ...(scope === "project" ? { project } : {}) };
  const auditLoading = useRef(new Set<string>());
  const fetchAudit = async (id: string) => {
    if (Object.hasOwn(audits, id) || auditLoading.current.has(id) || id.startsWith("site/")) return;
    auditLoading.current.add(id);
    try {
      const result = await audit({ environmentId, input: { id } });
      if (result._tag === "Success") setAudits((current) => ({ ...current, [id]: result.value }));
    } catch {
      setError("Could not load skill audit. Retry to load it.");
    }
    auditLoading.current.delete(id);
  };
  const open = (p: Preview) => {
    setSelected(p);
    setName(p.name);
    setError("");
  };
  const review = async (id: string) => {
    if (loadingPreview) return;
    setLoadingPreview(id);
    setPreviewError(null);
    try {
      const result = await preview({ environmentId, input: { id } });
      if (result._tag === "Success") {
        if (installOnPick) {
          if (!(await installSelected(false, result.value, result.value.name)))
            setPreviewError({ id, message: "Install failed. Click again to retry." });
        } else open(result.value);
      } else {
        const cause = squashAtomCommandFailure(result);
        setPreviewError({
          id,
          message:
            cause instanceof Error ? cause.message : "Could not load this preview. Please retry.",
        });
      }
    } catch {
      setPreviewError({
        id,
        message: "Could not load this preview. Check the connection and retry.",
      });
    }
    setLoadingPreview(null);
  };
  const runSearch = useEffectEvent(search);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Debounce requests to the remote skills catalogue and ignore responses after navigation.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (query.length === 1) return;
      const result = await runSearch({ environmentId, input: { query, limit } });
      if (active) {
        if (result._tag === "Success") {
          setResults((current) =>
            limit === 20
              ? [...result.value.skills]
              : mergeSkillResults(current, result.value.skills),
          );
          setLoadedLimit(limit);
          setHasMore(result.value.skills.length >= limit && limit < 500);
          setError("");
        } else {
          setLoadedLimit(limit);
          setError("skills.sh isn't reachable. Try searching again or load more to retry.");
        }
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, environmentId, limit]);
  const refresh = async () => {
    const result = await list({ environmentId, input: location });
    if (result._tag === "Success") setEntries(result.value);
    const waiting = await pending({ environmentId, input: {} });
    if (waiting._tag === "Success") setRequests(waiting.value);
  };
  const initialRefresh = useEffectEvent(
    async (id: EnvironmentId, targetScope: "global" | "project", targetProject?: string) => {
      const result = await list({
        environmentId: id,
        input: { scope: targetScope, ...(targetProject ? { project: targetProject } : {}) },
      });
      if (result._tag === "Success") setEntries(result.value);
      const waiting = await pending({ environmentId: id, input: {} });
      if (waiting._tag === "Success") setRequests(waiting.value);
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read installed skills and pending requests when the remote scope changes.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- State comes from awaited remote RPC responses, not synchronous derivation.
    if (!compact) void initialRefresh(environmentId, scope, project);
  }, [environmentId, scope, project, compact]);
  const installSelected = async (replace: boolean, chosen = selected, chosenName = name) => {
    if (!chosen || busy || !canInstall) return false;
    setBusy(true);
    let success = false;
    try {
      const result = await install({
        environmentId,
        input: { ...location, id: chosen.id, sha: chosen.sha, name: chosenName, replace },
      });
      if (result._tag === "Success") {
        setSelected(null);
        if (!compact) await refresh();
        onInstalled?.(result.value.name);
        success = true;
      } else
        setError(
          "Install failed. If the name is taken, choose another name or replace a tracked skill.",
        );
    } catch {
      setError("Install failed. Check the connection and retry.");
    }
    setBusy(false);
    return success;
  };
  const previewContent = selected ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b bg-popover p-3">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(null)}>
            ← Back to results
          </Button>
          <AuditBadge audit={selected.audit} loaded />
        </div>
        <p className="text-sm font-medium">{selected.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs">
            Install to{" "}
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as "global" | "project")}
            >
              <option value="global">All projects</option>
              {project ? <option value="project">This project only</option> : null}
            </select>
          </label>
          <Button disabled={!canInstall || busy} onClick={() => installSelected(false)}>
            {busy ? "Installing…" : onInstalled ? "Install and add to step" : "Install skill"}
          </Button>
        </div>
        {!canInstall ? (
          <p className="text-xs text-muted-foreground">
            This connection requires settings write permission to install.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs">
            {error}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
            GitHub · {selected.sha.slice(0, 12)}
          </a>
          <a href={`https://skills.sh/${selected.id}`} target="_blank" rel="noreferrer">
            View on skills.sh
          </a>
        </div>
        {selected.files.some((file) => /\.(sh|bash|py|js|ts|mjs|cjs|rb|ps1)$/i.test(file.path)) ? (
          <p role="alert" className="text-sm">
            This skill includes scripts your agents may run.
          </p>
        ) : null}
        <details>
          <summary className="text-sm">Audit details</summary>
          <div className="space-y-2 py-2 text-xs">
            {skillsShAuditDetails(selected.audit).map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>
        </details>
        <article className="space-y-2 text-sm">
          <ReactMarkdown skipHtml>
            {selected.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")}
          </ReactMarkdown>
        </article>
        <details>
          <summary>
            {selected.files.length} files ·{" "}
            {selected.files.reduce((n, f) => n + f.size, 0).toLocaleString()} bytes
          </summary>
          {selected.files.map((file) => (
            <p key={file.path} className="text-xs">
              {file.path} · {file.size} bytes
            </p>
          ))}
        </details>
        <details>
          <summary className="text-sm">Name clash options</summary>
          <div className="space-y-2 py-2">
            <label className="block text-xs">
              Install as
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setName(selected.name + "-2")}>
                Use {selected.name}-2
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canInstall || busy}
                onClick={() => {
                  if (window.confirm(`Replace tracked skill ${name}?`)) void installSelected(true);
                }}
              >
                Replace tracked skill
              </Button>
            </div>
          </div>
        </details>
      </div>
    </div>
  ) : null;
  if (compact && selected)
    return (
      <section className="flex h-112 max-h-[65dvh] min-h-0 flex-col">{previewContent}</section>
    );
  return (
    <section
      className={compact ? "flex h-112 max-h-[65dvh] min-h-0 flex-col gap-3 p-3" : "space-y-3 p-3"}
    >
      {!compact ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Skills</h2>
            <Button variant="outline" size="sm" onClick={refresh}>
              Refresh installed and requests
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const result = await updates({ environmentId, input: location });
                if (result._tag === "Success") {
                  const changed = result.value.find((item) => item.entry.sha !== item.preview.sha);
                  setUpdateChoices(
                    result.value.filter((item) => item.entry.sha !== item.preview.sha),
                  );
                  if (changed) {
                    open(changed.preview);
                    setName(changed.entry.name);
                  } else setError("All tracked skills are up to date.");
                }
              }}
            >
              Check for updates
            </Button>
            <label className="text-xs">
              Install scope{" "}
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "global" | "project")}
              >
                <option value="global">All projects</option>
                {project ? <option value="project">This project only</option> : null}
              </select>
            </label>
          </div>
          {requests.map((request) => (
            <Button key={request.requestId} variant="outline" onClick={() => open(request.preview)}>
              Review request: {request.preview.name}
            </Button>
          ))}
          {requests.map((request) => (
            <Button
              key={request.requestId + "-dismiss"}
              variant="outline"
              disabled={!canInstall}
              onClick={async () => {
                await dismiss({ environmentId, input: { requestId: request.requestId } });
                await refresh();
              }}
            >
              Dismiss request: {request.preview.name}
            </Button>
          ))}
          {updateChoices.map((item) => (
            <Button
              key={item.entry.name}
              variant="outline"
              onClick={() => {
                open(item.preview);
                setName(item.entry.name);
              }}
            >
              Update {item.entry.name}: {item.entry.sha.slice(0, 8)} →{" "}
              {item.preview.sha.slice(0, 8)} · {item.summary}
            </Button>
          ))}
          {entries.map((entry) => (
            <div
              key={entry.name}
              className="flex items-center justify-between gap-2 border-b py-2 text-sm"
            >
              <span>
                {entry.name} · {entry.source} · {entry.scope}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!canInstall}
                onClick={async () => {
                  if (!window.confirm(`Uninstall ${entry.name}?`)) return;
                  const result = await uninstall({
                    environmentId,
                    input: { ...location, name: entry.name },
                  });
                  if (result._tag === "Success") await refresh();
                }}
              >
                Uninstall
              </Button>
            </div>
          ))}
        </>
      ) : null}
      {searchQuery === undefined ? (
        <Input
          aria-label="Search skills.sh"
          value={query}
          placeholder="Search skills.sh… (e.g. design)"
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(20);
            setLoadedLimit(0);
            setHasMore(true);
            setResults([]);
          }}
        />
      ) : null}
      {!query ? <p className="text-xs text-muted-foreground">Popular design skills</p> : null}
      {error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {error}
        </p>
      ) : null}
      <div
        className={compact ? "min-h-0 flex-1 overflow-auto" : "max-h-96 overflow-auto"}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            hasMore &&
            loadedLimit === limit &&
            element.scrollHeight - element.scrollTop - element.clientHeight < 100
          )
            setLimit((current) => (current === loadedLimit ? current + 20 : current));
        }}
      >
        {results.map((skill) => (
          <div
            key={skill.id}
            onPointerEnter={() => {
              void fetchAudit(skill.id);
            }}
            className="flex items-center justify-between gap-3 border-b py-3"
          >
            <div>
              <p className="text-sm font-medium">{skill.name}</p>
              {previewError?.id === skill.id ? (
                <p role="alert" className="text-xs text-destructive">
                  {previewError.message} Click again to retry.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {skill.source} · {skill.installs.toLocaleString()} installs ·{" "}
                <AuditBadge
                  audit={audits[skill.id]}
                  loaded={Object.hasOwn(audits, skill.id)}
                  onLoad={() => {
                    void fetchAudit(skill.id);
                  }}
                />
              </p>
            </div>
            {skill.id.startsWith("site/") ? (
              <a href={`https://skills.sh/${skill.id}`} target="_blank" rel="noreferrer">
                Open on skills.sh
              </a>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={loadingPreview !== null || (installOnPick && !canInstall)}
                onClick={() => review(skill.id)}
              >
                {loadingPreview === skill.id
                  ? installOnPick
                    ? "Installing…"
                    : "Loading preview…"
                  : installOnPick
                    ? "Install & link"
                    : onInstalled
                      ? "Review & add"
                      : "Preview"}
              </Button>
            )}
          </div>
        ))}
        {query.length === 1 ? (
          <p className="py-2 text-xs text-muted-foreground">
            Type at least two characters to search.
          </p>
        ) : hasMore ? (
          <div className="py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={loadedLimit !== limit}
              onClick={() => setLimit((current) => current + 20)}
            >
              {loadedLimit !== limit ? "Loading skills…" : "Load more skills"}
            </Button>
          </div>
        ) : results.length ? (
          <p className="py-2 text-xs text-muted-foreground">
            End of results. Refine your search to find more skills.
          </p>
        ) : null}
      </div>
      <Sheet
        open={selected !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setSelected(null);
        }}
      >
        <SheetPopup>
          <SheetHeader>
            <SheetTitle>{selected?.name ?? "Skill preview"}</SheetTitle>
            <SheetDescription>Review the source and audit before installing.</SheetDescription>
          </SheetHeader>
          {previewContent}
        </SheetPopup>
      </Sheet>
    </section>
  );
}

export function SkillsBrowser(props: Parameters<typeof SkillsBrowserContents>[0]) {
  return (
    <SkillsBrowserContents
      key={props.environmentId + ":" + (props.project ?? "") + ":" + (props.searchQuery ?? "")}
      {...props}
    />
  );
}
