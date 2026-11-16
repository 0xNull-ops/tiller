import { useEffect, useRef, useState } from "react";
import type {
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  ThreadId,
  WorkflowListing,
  WorkflowMcpInventorySnapshot,
  WorkflowMcpServerInventory,
} from "@t3tools/contracts";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useEnvironmentQuery } from "../state/query";
import { useWorkflowEdit, workflowRead } from "./workflowState";
import { isWorkflowSkillStep } from "./workflowStep";

type McpChoice = {
  readonly server: string;
  readonly providerInstanceId?: ProviderInstanceId;
};

type WorkflowMcpPickerProps = {
  readonly environmentId: EnvironmentId;
  readonly listing: WorkflowListing;
  readonly stepId: string;
  readonly contextThreadId?: ThreadId;
  readonly workspaceRoot?: string | null | undefined;
  readonly modelRevision?: string | undefined;
  readonly disabled?: boolean;
  readonly value?: McpChoice;
  readonly onSelect: (choice: McpChoice | null) => void;
};

export function WorkflowMcpPicker(props: WorkflowMcpPickerProps) {
  const definition = props.listing.definition;
  const step = definition?.steps.find((candidate) => candidate.id === props.stepId);
  const stepModel = step && isWorkflowSkillStep(step) ? step.model : undefined;
  const expectedModel = stepModel ?? definition?.model ?? parseModelRevision(props.modelRevision);
  const contextKey = JSON.stringify([
    props.environmentId,
    props.listing.projectId,
    props.listing.workflow,
    props.stepId,
    props.contextThreadId ?? null,
    props.workspaceRoot ?? null,
    props.modelRevision ?? "",
    expectedModel?.instanceId ?? null,
    expectedModel?.model ?? null,
  ]);
  return (
    <WorkflowMcpPickerContent
      key={contextKey}
      contextKey={contextKey}
      expectedModel={expectedModel}
      {...props}
    />
  );
}

function WorkflowMcpPickerContent(
  props: WorkflowMcpPickerProps & {
    readonly contextKey: string;
    readonly expectedModel?: ModelSelection | undefined;
  },
) {
  const queryInput = {
    _tag: "mcpInventory" as const,
    projectId: props.listing.projectId,
    workflow: props.listing.workflow,
    stepId: props.stepId,
    ...(props.contextThreadId ? { contextThreadId: props.contextThreadId } : {}),
  };
  const query = useEnvironmentQuery(
    workflowRead({ environmentId: props.environmentId, input: queryInput }),
  );
  const edit = useWorkflowEdit(
    props.environmentId,
    props.listing,
    props.contextThreadId,
    props.workspaceRoot,
    props.modelRevision,
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [refreshed, setRefreshed] = useState<{
    readonly key: string;
    readonly snapshot: WorkflowMcpInventorySnapshot;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize the picker with loaded MCP inventory and its external selection state.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  const mounted = useRef(false);
  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize the picker with loaded MCP inventory and its external selection state.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const querySnapshot = query.data?._tag === "mcpInventory" ? query.data.inventory : null;
  const receivedSnapshot = refreshed?.key === props.contextKey ? refreshed.snapshot : querySnapshot;
  const scopeMatches =
    receivedSnapshot === null ||
    ((props.expectedModel === undefined ||
      (receivedSnapshot.scope.model?.instanceId === props.expectedModel.instanceId &&
        receivedSnapshot.scope.model?.model === props.expectedModel.model)) &&
      (props.contextThreadId === undefined ||
        receivedSnapshot.scope.threadId === props.contextThreadId) &&
      (props.workspaceRoot == null ||
        receivedSnapshot.scope.workspaceRoot === props.workspaceRoot));
  const snapshot = scopeMatches ? receivedSnapshot : null;
  const servers = snapshot?.servers ?? [];
  const normalized = search.trim().toLocaleLowerCase();
  const visibleServers = servers.flatMap((server) => {
    const matchingTools = normalized
      ? server.tools.filter((tool) =>
          `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`
            .toLocaleLowerCase()
            .includes(normalized),
        )
      : server.tools;
    const matchesServer =
      !normalized ||
      `${server.name} ${server.title ?? ""} ${server.description ?? ""} ${server.status} ${server.statusDetail ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized);
    return matchesServer || matchingTools.length > 0
      ? [{ server, matchingTools, matchesServer }]
      : [];
  });

  const refresh = async () => {
    if (refreshing || props.disabled || !edit.canEdit) return;
    setRefreshing(true);
    const result = await edit.run({
      _tag: "mcpInventoryRefresh",
      projectId: props.listing.projectId,
      workflow: props.listing.workflow,
      stepId: props.stepId,
      ...(props.contextThreadId ? { contextThreadId: props.contextThreadId } : {}),
    });
    if (!mounted.current) return;
    setRefreshing(false);
    if (result?.mcpInventory) {
      setRefreshed({ key: props.contextKey, snapshot: result.mcpInventory });
      // Configuration can name only some servers (plugins and other scopes stay hidden), so it
      // must not clear a saved choice. A live list is the provider's complete answer.
      if (
        props.value &&
        result.mcpInventory.scope.source !== "configured" &&
        !result.mcpInventory.servers.some((server) => server.name === props.value?.server)
      ) {
        props.onSelect(null);
      }
    }
  };

  const choose = (server: WorkflowMcpServerInventory) => {
    setOpen(false);
    props.onSelect({
      server: server.name,
      ...(snapshot?.scope.providerInstanceId
        ? { providerInstanceId: snapshot.scope.providerInstanceId }
        : {}),
    });
  };

  const providerLabel = snapshot?.scope.providerLabel ?? "selected provider";
  const selectedName = props.value?.server || undefined;
  const lastChecked = snapshot?.checkedAt ? new Date(snapshot.checkedAt).toLocaleString() : null;
  const stateMessage = (() => {
    if (query.error) return "Couldn’t read the saved MCP inventory. Try opening this picker again.";
    if (!scopeMatches)
      return "Inventory belongs to a different model selection. Read it again before choosing a server.";
    if (!snapshot)
      return query.isPending
        ? "Loading saved inventory…"
        : "No saved inventory yet. Refresh asks the provider for its configured MCP servers.";
    switch (snapshot.status) {
      case "not-checked":
        return "No saved inventory yet. Refresh asks the provider for its configured MCP servers.";
      case "unsupported":
        return `${providerLabel} does not expose MCP inventory here. Enter a known server name below.`;
      case "unavailable":
        return snapshot.message || `No matching active session for ${providerLabel}.`;
      case "error":
        return snapshot.message || `Couldn’t refresh inventory from ${providerLabel}.`;
      case "available":
        return snapshot.servers.length === 0 && snapshot.scope.source !== "configured"
          ? `${providerLabel} reported no MCP connections.`
          : snapshot.message;
    }
  })();
  const currentProviderInstanceId =
    snapshot?.scope.providerInstanceId ?? props.expectedModel?.instanceId;
  const attachedProviderMismatch =
    props.value?.providerInstanceId !== undefined &&
    currentProviderInstanceId !== undefined &&
    props.value.providerInstanceId !== currentProviderInstanceId;
  const configuredMissingSelection =
    snapshot?.scope.source === "configured" &&
    selectedName !== undefined &&
    !snapshot.servers.some((server) => server.name === selectedName);

  return (
    <div className="space-y-2" data-workflow-mcp-picker>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
        }}
      >
        <PopoverTrigger render={<Button variant="outline" size="sm" disabled={props.disabled} />}>
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedName ?? "Choose a configured MCP server"}
          </span>
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverPopup align="start" width="lg" className="max-h-[min(34rem,80vh)] overflow-hidden">
          <div className="flex max-h-[min(34rem,80vh)] flex-col gap-2 p-2">
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">MCP connections from provider</p>
                <p className="truncate text-2xs text-muted-foreground">
                  {providerLabel}
                  {snapshot?.scope.model ? ` · ${snapshot.scope.model.model}` : ""}
                  {snapshot?.scope.modelScoped === false ? " · shared across models" : ""}
                </p>
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={refreshing || !edit.canEdit || props.disabled}
                onClick={() => void refresh()}
              >
                <RefreshCwIcon />
                {refreshing ? "Refreshing" : "Refresh"}
              </Button>
            </div>
            <div className="relative block">
              <Input
                ref={searchRef}
                size="sm"
                aria-label="Search MCP servers and tools"
                placeholder="Search servers or tools…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  if (visibleServers.length === 0) return;
                  event.preventDefault();
                  rowRefs.current[
                    event.key === "ArrowDown" ? 0 : visibleServers.length - 1
                  ]?.focus();
                }}
              />
            </div>
            {snapshot ? (
              <div className="flex items-center justify-between gap-2 px-1 text-2xs text-muted-foreground">
                <span className="truncate">
                  {snapshot.scope.source === "configured"
                    ? "Configured servers · not connected"
                    : snapshot.scope.source === "live"
                      ? snapshot.stale
                        ? "Live session inventory is stale"
                        : snapshot.cached
                          ? "Saved live inventory"
                          : "Live session inventory"
                      : snapshot.stale
                        ? "Saved inventory is stale"
                        : snapshot.cached
                          ? "Saved inventory"
                          : "Provider inventory"}
                  {lastChecked ? ` · checked ${lastChecked}` : ""}
                </span>
                {snapshot.status === "available" ? (
                  <span>{snapshot.servers.length} servers</span>
                ) : null}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background">
              {visibleServers.map(({ server, matchingTools, matchesServer }, index) => {
                const isExpanded =
                  expanded.has(server.name) || (!matchesServer && normalized.length > 0);
                const detailsId = `mcp-tools-${props.stepId}-${index}`;
                return (
                  <div key={server.name} className="border-b last:border-b-0">
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <button
                        ref={(node) => {
                          rowRefs.current[index] = node;
                        }}
                        type="button"
                        aria-pressed={selectedName === server.name}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => choose(server)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                          event.preventDefault();
                          const next = Math.max(
                            0,
                            Math.min(
                              visibleServers.length - 1,
                              index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                          rowRefs.current[next]?.focus();
                        }}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-muted/50 text-2xs font-semibold text-muted-foreground">
                          {server.name.slice(0, 1).toLocaleUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs font-medium">
                              {server.title ?? server.name}
                            </span>
                            <StatusBadge status={server.status} />
                            <AuthBadge auth={server.auth} />
                          </span>
                          <span className="block truncate text-2xs text-muted-foreground">
                            {server.description ?? server.statusDetail ?? server.name}
                          </span>
                        </span>
                        <span className="shrink-0 text-2xs text-muted-foreground">
                          {server.toolsStatus === "available"
                            ? `${server.tools.length}${server.toolsTruncated ? "+" : ""} tools`
                            : server.toolsStatus === "empty"
                              ? "0 tools"
                              : server.toolsStatus === "error"
                                ? "Tools unavailable"
                                : "Tools unknown"}
                        </span>
                        {selectedName === server.name ? (
                          <CheckIcon className="size-3.5 text-primary" />
                        ) : null}
                      </button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`${isExpanded ? "Hide" : "Show"} tools for ${server.name}`}
                        aria-expanded={isExpanded}
                        aria-controls={detailsId}
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(server.name)) next.delete(server.name);
                            else next.add(server.name);
                            return next;
                          })
                        }
                      >
                        <ChevronRightIcon className={isExpanded ? "rotate-90" : undefined} />
                      </Button>
                    </div>
                    {isExpanded ? (
                      <div id={detailsId} className="space-y-1.5 px-4 pb-3 pl-12">
                        {server.toolsStatus === "available" && matchingTools.length > 0 ? (
                          matchingTools.map((tool) => (
                            <div key={tool.name} className="rounded-md bg-muted/50 px-2 py-1.5">
                              <p className="break-all text-2xs font-medium">
                                {tool.title ?? tool.name}
                              </p>
                              {tool.description ? (
                                <p className="mt-0.5 text-2xs text-muted-foreground">
                                  {tool.description}
                                </p>
                              ) : null}
                            </div>
                          ))
                        ) : server.toolsStatus === "empty" ? (
                          <p className="text-2xs text-muted-foreground">
                            The provider reported no tools for this server.
                          </p>
                        ) : (
                          <p className="text-2xs text-muted-foreground">
                            {server.toolsDetail ??
                              "Tool details were not reported by this provider."}
                          </p>
                        )}
                        {server.toolsTruncated ? (
                          <p className="text-2xs text-muted-foreground">
                            Showing the first reported tools.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {snapshot?.status === "available" && visibleServers.length === 0 && normalized ? (
                <p className="px-3 py-4 text-xs text-muted-foreground">
                  No servers or tools match “{search.trim()}”.
                </p>
              ) : null}
              <p className="px-3 py-2 text-2xs text-muted-foreground">{stateMessage}</p>
              {snapshot?.limitations.map((limitation) => (
                <p key={limitation} className="px-3 pb-2 text-2xs text-muted-foreground">
                  {limitation}
                </p>
              ))}
            </div>
            {snapshot?.scope.modelScoped === false && snapshot.scope.model ? (
              <p className="px-1 text-2xs text-muted-foreground">
                Inventory is tied to the provider instance or workspace, so changing models may not
                change this list.
              </p>
            ) : null}
            {configuredMissingSelection ? (
              <p className="px-1 text-2xs text-muted-foreground">
                The saved server isn’t in the readable configuration. It may come from a plugin or
                another configuration scope.
              </p>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
      {attachedProviderMismatch ? (
        <p className="text-2xs text-warning-foreground">
          This connection was saved for another provider. Choose a server here to reselect it for
          the current step.
        </p>
      ) : null}
      {snapshot?.status === "unsupported" ? (
        <p className="text-2xs text-muted-foreground">
          Manual name only: inventory is unsupported for this provider. This does not configure or
          authenticate the server.
        </p>
      ) : null}
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
    </div>
  );
}

function parseModelRevision(revision?: string): ModelSelection | undefined {
  if (!revision || revision === "null") return undefined;
  try {
    const value: unknown = JSON.parse(revision);
    if (
      typeof value === "object" &&
      value !== null &&
      "instanceId" in value &&
      typeof value.instanceId === "string" &&
      "model" in value &&
      typeof value.model === "string"
    ) {
      return value as ModelSelection;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function StatusBadge(props: { readonly status: WorkflowMcpServerInventory["status"] }) {
  const [label, className] = (() => {
    switch (props.status) {
      case "connected":
        return ["Online", "bg-success/12 text-success"] as const;
      case "connecting":
        return ["Connecting", "bg-warning/15 text-warning-foreground"] as const;
      case "needs-auth":
        return ["Needs sign-in", "bg-warning/15 text-warning-foreground"] as const;
      case "failed":
        return ["Failed", "bg-destructive/10 text-destructive"] as const;
      case "disabled":
        return ["Disabled", "bg-muted text-muted-foreground"] as const;
      case "not-started":
        return ["Offline", "bg-muted text-muted-foreground"] as const;
      case "unknown":
        return ["Unknown", "bg-muted text-muted-foreground"] as const;
    }
  })();
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-3xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function AuthBadge(props: { readonly auth: WorkflowMcpServerInventory["auth"] }) {
  if (props.auth === undefined || props.auth === "unknown") return null;
  const label = {
    "signed-in": "Signed in",
    "needs-auth": "Needs sign-in",
    "not-required": "No sign-in needed",
    unsupported: "Auth not reported",
  }[props.auth];
  return (
    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">
      {label}
    </span>
  );
}
