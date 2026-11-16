import {
  ClaudeSettings,
  CodexSettings,
  defaultInstanceIdForDriver,
  MAX_WORKFLOW_MCP_DETAIL_LENGTH,
  type ProviderDriverKind,
  type ProviderInstanceEnvironment,
  type ProviderInstanceId,
  type WorkflowMcpServerInventory,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Stream from "effect/Stream";

import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { codexExecLaunchArgs, resolveCodexLaunchArgs } from "../provider/codexLaunchArgs.ts";
import * as ServerSettings from "../serverSettings.ts";

/** Bounded so a hung provider CLI cannot hold the picker's Refresh forever. */
const CONFIG_DISCOVERY_TIMEOUT = "10 seconds";
const MAX_COMMAND_OUTPUT_CHARS = 2 * 1024 * 1024;

const codexTransport = Schema.Struct({
  type: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
});
const CodexMcpListEntry = Schema.Struct({
  name: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  disabled_reason: Schema.optional(Schema.NullOr(Schema.String)),
  transport: Schema.optional(Schema.NullOr(codexTransport)),
});
const CodexMcpList = Schema.Array(CodexMcpListEntry);
const decodeCodexMcpList = Schema.decodeUnknownExit(Schema.fromJsonString(CodexMcpList));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeLenientJson = Schema.decodeUnknownEffect(fromLenientJson(Schema.Unknown));
const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);
const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);

const clip = (value: string, max = MAX_WORKFLOW_MCP_DETAIL_LENGTH) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordAt = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return isRecord(candidate) ? candidate : undefined;
};

const valueAt = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const stringsAt = (value: unknown, key: string): ReadonlyArray<string> => {
  const candidate = valueAt(value, key);
  return Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === "string")
    : [];
};

/** HTTP origins only. Paths, credentials, queries and fragments never cross this boundary. */
const safeMcpOrigin = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const transportOf = (value: unknown): "http" | "stdio" | "unknown" | undefined => {
  const type = valueAt(value, "type");
  if (typeof type !== "string") {
    if (valueAt(value, "url") !== undefined) return "http";
    if (valueAt(value, "command") !== undefined) return "stdio";
    return undefined;
  }
  switch (type) {
    case "stdio":
    case "local":
      return "stdio";
    case "http":
    case "sse":
    case "streamable_http":
    case "streamable-http":
    case "remote":
      return "http";
    default:
      return "unknown";
  }
};

/**
 * A server whose only evidence is configuration. `unknown` is deliberate: configuration cannot
 * prove a connection is online, offline or signed in, and no tool catalogue was listed. The one
 * exception is an entry its own configuration disables, which is a fact rather than a guess.
 */
const unverifiedServer = (input: {
  readonly name: string;
  readonly status?: "unknown" | "disabled" | undefined;
  readonly transport?: "http" | "stdio" | "unknown" | undefined;
  readonly origin?: string | undefined;
  readonly statusDetail?: string | undefined;
  readonly toolsDetail: string;
}): WorkflowMcpServerInventory | undefined => {
  const name = input.name.trim();
  if (name.length === 0) return undefined;
  return {
    name,
    status: input.status ?? "unknown",
    toolsStatus: "unavailable",
    tools: [],
    ...(input.transport === undefined ? {} : { transport: input.transport }),
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    ...(input.statusDetail === undefined ? {} : { statusDetail: clip(input.statusDetail) }),
    toolsDetail: clip(input.toolsDetail),
  };
};

/** Codex's own `mcp list --json`; the only server fields retained are name, transport and origin. */
export const parseCodexConfigList = (
  stdout: string,
): ReadonlyArray<WorkflowMcpServerInventory> | undefined => {
  const decoded = decodeCodexMcpList(stdout);
  if (Exit.isFailure(decoded)) return undefined;
  const servers: Array<WorkflowMcpServerInventory> = [];
  for (const entry of decoded.value) {
    const disabled = entry.enabled === false || entry.disabled_reason != null;
    const server = unverifiedServer({
      name: entry.name,
      ...(disabled
        ? { status: "disabled" as const, statusDetail: "Disabled in Codex configuration." }
        : {}),
      transport: entry.transport == null ? undefined : transportOf(entry.transport),
      origin: safeMcpOrigin(entry.transport?.url),
      toolsDetail: "Tools are only listed while Codex is running for this instance.",
    });
    if (server !== undefined) servers.push(server);
  }
  return servers;
};

const mcpServersFromConfig = (value: unknown): Record<string, unknown> | undefined =>
  recordAt(value, "mcpServers");

const addConfigServers = (
  target: Map<string, WorkflowMcpServerInventory>,
  config: unknown,
  options: {
    readonly disabled?: ReadonlySet<string>;
    readonly toolsDetail: string;
    readonly sourceLabel: string;
  },
) => {
  const servers = mcpServersFromConfig(config);
  if (servers === undefined) return;
  for (const [name, server] of Object.entries(servers)) {
    const stored = unverifiedServer({
      name,
      transport: transportOf(server),
      origin: safeMcpOrigin(valueAt(server, "url")),
      ...(options.disabled?.has(name) === true
        ? {
            status: "disabled" as const,
            statusDetail: `Disabled in ${options.sourceLabel} configuration.`,
          }
        : {}),
      toolsDetail: options.toolsDetail,
    });
    if (stored !== undefined) target.set(stored.name, stored);
  }
};

/** Claude Code user, project, local and managed configuration, in increasing priority. */
export const claudeServersFromConfigs = (input: {
  readonly account: unknown;
  readonly project: unknown;
  readonly projectFile: unknown;
  readonly managed: unknown;
}): ReadonlyArray<WorkflowMcpServerInventory> => {
  const servers = new Map<string, WorkflowMcpServerInventory>();
  const toolsDetail = "Tools are only listed while Claude Code is running for this instance.";
  addConfigServers(servers, input.account, { toolsDetail, sourceLabel: "Claude Code user" });
  addConfigServers(servers, input.managed, { toolsDetail, sourceLabel: "Claude Code managed" });
  addConfigServers(servers, input.projectFile, {
    toolsDetail,
    sourceLabel: "Claude Code project",
    disabled: new Set(stringsAt(input.project, "disabledMcpjsonServers")),
  });
  addConfigServers(servers, input.project, { toolsDetail, sourceLabel: "Claude Code project" });
  return [...servers.values()];
};

/** OpenCode V2 (`mcp.servers`) and V1 (`mcp`) configuration files, in increasing priority. */
export const openCodeServersFromConfigs = (
  configs: ReadonlyArray<unknown>,
): ReadonlyArray<WorkflowMcpServerInventory> => {
  const servers = new Map<string, WorkflowMcpServerInventory>();
  const toolsDetail = "Tools are only listed while OpenCode is running for this instance.";
  for (const config of configs) {
    const mcp = recordAt(config, "mcp");
    if (mcp === undefined) continue;
    const entries = recordAt(mcp, "servers") ?? mcp;
    for (const [name, server] of Object.entries(entries)) {
      if (name === "servers" || !isRecord(server)) continue;
      const stored = unverifiedServer({
        name,
        transport: transportOf(server),
        origin: safeMcpOrigin(valueAt(server, "url")),
        ...(valueAt(server, "enabled") === false
          ? { status: "disabled" as const, statusDetail: "Disabled in OpenCode configuration." }
          : {}),
        toolsDetail,
      });
      if (stored !== undefined) servers.set(stored.name, stored);
    }
  }
  return [...servers.values()];
};

export interface WorkflowMcpConfigDiscoveryInput {
  readonly instanceId: ProviderInstanceId;
  /** The caller's idea of the driver. Saved settings remain authoritative when they disagree. */
  readonly driverKind?: ProviderDriverKind;
  readonly label: string;
  readonly workspaceRoot: string;
}

export type WorkflowMcpConfigDiscoveryResult =
  | {
      readonly kind: "configured";
      readonly servers: ReadonlyArray<WorkflowMcpServerInventory>;
      readonly limitations: ReadonlyArray<string>;
    }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "error"; readonly reason: string };

export interface McpInventoryCommand {
  readonly binary: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export type McpInventoryCommandResult =
  | { readonly kind: "output"; readonly stdout: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

export type McpInventoryCommandRunner = (
  command: McpInventoryCommand,
) => Effect.Effect<McpInventoryCommandResult>;

export interface WorkflowMcpConfigDiscoveryDeps {
  /** Overridden only by tests; production uses the bounded child-process runner below. */
  readonly runCommand?: McpInventoryCommandRunner;
}

const defaultRunCommand: McpInventoryCommandRunner = Effect.fn(
  "WorkflowMcpConfigDiscovery.runCommand",
)(
  function* (command: McpInventoryCommand) {
    const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
    if (Option.isNone(spawner)) {
      return {
        kind: "unavailable",
        reason: "T3 can't start provider commands in this process.",
      } satisfies McpInventoryCommandResult;
    }
    const spawnCommand = yield* resolveSpawnCommand(command.binary, command.args, {
      env: command.env,
    });
    const spawned = yield* spawner.value
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: command.env,
          cwd: command.cwd,
          shell: spawnCommand.shell,
          forceKillAfter: "1 second",
        }),
      )
      .pipe(Effect.option);
    if (Option.isNone(spawned)) {
      return {
        kind: "failed",
        reason: "T3 couldn't start the provider's inventory command.",
      } satisfies McpInventoryCommandResult;
    }
    const child = spawned.value;
    const read = yield* Effect.all(
      [
        child.stdout.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (output, chunk) =>
              output.length >= MAX_COMMAND_OUTPUT_CHARS ? output : output + chunk,
          ),
        ),
        child.stderr.pipe(Stream.runDrain),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.option);
    if (Option.isNone(read)) {
      return {
        kind: "failed",
        reason: "T3 couldn't read the provider's inventory result.",
      } satisfies McpInventoryCommandResult;
    }
    const [stdout, , exitCode] = read.value;
    return exitCode === 0
      ? ({ kind: "output", stdout } satisfies McpInventoryCommandResult)
      : ({
          kind: "failed",
          reason: `The provider's inventory command exited with code ${exitCode}.`,
        } satisfies McpInventoryCommandResult);
  },
  Effect.scoped,
  Effect.timeoutOption(CONFIG_DISCOVERY_TIMEOUT),
  Effect.map((result) =>
    Option.isNone(result)
      ? ({
          kind: "failed",
          reason: "The provider didn't answer its configuration query in time.",
        } satisfies McpInventoryCommandResult)
      : result.value,
  ),
);

const readJsonFile = Effect.fn("WorkflowMcpConfigDiscovery.readJsonFile")(function* (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
) {
  const text = yield* fileSystem.readFileString(filePath).pipe(Effect.option);
  if (Option.isNone(text)) return { kind: "missing" } as const;
  const value = yield* decodeJson(text.value).pipe(Effect.option);
  return Option.isNone(value)
    ? ({ kind: "invalid" } as const)
    : ({ kind: "read", value: value.value } as const);
});

const readLenientJsonFile = Effect.fn("WorkflowMcpConfigDiscovery.readLenientJsonFile")(function* (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
) {
  const text = yield* fileSystem.readFileString(filePath).pipe(Effect.option);
  if (Option.isNone(text)) return { kind: "missing" } as const;
  const value = yield* decodeLenientJson(text.value).pipe(Effect.option);
  return Option.isNone(value)
    ? ({ kind: "invalid" } as const)
    : ({ kind: "read", value: value.value } as const);
});

const make = Effect.fn("WorkflowMcpConfigDiscovery.make")(function* (
  deps: WorkflowMcpConfigDiscoveryDeps,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;
  const hostEnvironment = yield* HostProcess.Environment;
  const runCommand = deps.runCommand ?? defaultRunCommand;

  const discoverCodex = Effect.fnUntraced(function* (input: {
    readonly config: unknown;
    readonly environment: ProviderInstanceEnvironment | undefined;
    readonly workspaceRoot: string;
  }) {
    const config = yield* decodeCodexSettings(input.config ?? {}).pipe(Effect.option);
    if (Option.isNone(config)) {
      return {
        kind: "unavailable",
        reason: "This provider instance's Codex configuration couldn't be read.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    if (config.value.setupMode === "managed") {
      // T3 owns the managed Codex home. Resolving it here would acquire credentials and
      // installation state, so configuration-only discovery must not guess a global ~/.codex.
      return {
        kind: "unavailable",
        reason:
          "T3 manages this Codex installation, so its MCP configuration is only available while Codex runs.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const environment = yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment);
    const effectiveEnvironment = {
      ...environment,
      ...(config.value.homePath.trim().length === 0
        ? {}
        : { CODEX_HOME: expandHomePath(config.value.homePath, home) }),
    };
    const resolvedLaunchArgs = resolveCodexLaunchArgs(
      config.value.launchArgs,
      effectiveEnvironment,
    );
    if (
      tokenizeCliArgs(resolvedLaunchArgs).some((argument) =>
        /^(--profile(?:=|$)|--config-root(?:=|$))/.test(argument),
      )
    ) {
      return {
        kind: "unavailable",
        reason:
          "This Codex instance uses a profile or configuration root override that the read-only MCP query can't preserve.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const args = [
      ...codexExecLaunchArgs(resolvedLaunchArgs).filter(
        (argument) => argument !== "--strict-config",
      ),
      "mcp",
      "list",
      "--json",
    ];
    const result = yield* runCommand({
      binary: config.value.binaryPath.trim() || "codex",
      args,
      cwd: input.workspaceRoot,
      env: effectiveEnvironment,
    });
    if (result.kind !== "output") {
      return {
        kind: result.kind === "unavailable" ? "unavailable" : "error",
        reason: result.reason,
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const servers = parseCodexConfigList(result.stdout);
    if (servers === undefined) {
      return {
        kind: "error",
        reason: "Codex returned an unreadable MCP configuration list.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    return {
      kind: "configured",
      servers,
      limitations: [
        "These servers come from Codex's configuration; status and tools stay unknown until Codex runs for this instance.",
      ],
    } satisfies WorkflowMcpConfigDiscoveryResult;
  });

  const discoverClaude = Effect.fnUntraced(function* (input: {
    readonly config: unknown;
    readonly environment: ProviderInstanceEnvironment | undefined;
    readonly workspaceRoot: string;
  }) {
    const config = yield* decodeClaudeSettings(input.config ?? {}).pipe(Effect.option);
    if (Option.isNone(config)) {
      return {
        kind: "unavailable",
        reason: "This provider instance's Claude Code configuration couldn't be read.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const environment = yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment);
    const configDir =
      config.value.homePath.trim().length > 0 ||
      (environment.CLAUDE_CONFIG_DIR?.trim() ?? "") !== ""
        ? yield* resolveClaudeHomePath(config.value, environment).pipe(
            Effect.provideService(Path.Path, path),
          )
        : undefined;
    // `CLAUDE_CONFIG_DIR` relocates `.claude.json`; the default home keeps it beside `~/.claude`.
    const accountPath =
      configDir === undefined
        ? path.join(home, ".claude.json")
        : path.join(configDir, ".claude.json");
    const projectPath = path.resolve(input.workspaceRoot);
    // Same paths as `hasClaudeManagedMcpConfig`, which cannot be reused without editing upstream.
    const managedPath =
      platform === "darwin"
        ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
        : platform === "win32"
          ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json"
          : "/etc/claude-code/managed-mcp.json";
    const [account, projectFile, managed] = yield* Effect.all(
      [
        readJsonFile(fileSystem, accountPath),
        readJsonFile(fileSystem, path.join(projectPath, ".mcp.json")),
        readJsonFile(fileSystem, managedPath),
      ],
      { concurrency: "unbounded" },
    );
    if (
      account.kind === "invalid" &&
      projectFile.kind === "missing" &&
      managed.kind === "missing"
    ) {
      return {
        kind: "error",
        reason: "Claude Code's configuration file couldn't be read as JSON.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const project =
      account.kind === "read"
        ? recordAt(recordAt(account.value, "projects"), projectPath)
        : undefined;
    const servers = claudeServersFromConfigs({
      account: account.kind === "read" ? account.value : undefined,
      project,
      projectFile: projectFile.kind === "read" ? projectFile.value : undefined,
      managed: managed.kind === "read" ? managed.value : undefined,
    });
    return {
      kind: "configured",
      servers,
      limitations: [
        "These servers come from Claude Code's configuration files; status and tools stay unknown until Claude Code runs for this instance.",
        "Servers contributed by Claude Code plugins or MCP tool search only appear while Claude Code runs.",
      ],
    } satisfies WorkflowMcpConfigDiscoveryResult;
  });

  const discoverOpenCode = Effect.fnUntraced(function* (input: {
    readonly allowImplicitGlobalConfig: boolean;
    readonly environment: ProviderInstanceEnvironment | undefined;
    readonly workspaceRoot: string;
  }) {
    const environment = yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment);
    const explicitXdg = input.environment?.find(({ name }) => name === "XDG_CONFIG_HOME")?.value;
    const explicitXdgValue = typeof explicitXdg === "string" ? explicitXdg : undefined;
    const globalBase = input.allowImplicitGlobalConfig
      ? environment.XDG_CONFIG_HOME?.trim() || path.join(home, ".config")
      : explicitXdgValue?.trim();
    const globalFiles =
      globalBase === undefined || globalBase.length === 0
        ? []
        : [
            path.join(globalBase, "opencode", "opencode.json"),
            path.join(globalBase, "opencode", "opencode.jsonc"),
          ];
    const workspace = path.resolve(input.workspaceRoot);
    const projectPaths: Array<string> = [];
    let current = workspace;
    for (let depth = 0; depth < 64; depth += 1) {
      projectPaths.push(path.join(current, "opencode.json"), path.join(current, "opencode.jsonc"));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    const candidates = [
      ...globalFiles,
      // Farthest ancestor first, then the closer project overrides.
      ...projectPaths.toReversed(),
      // An explicit config file is the instance's strongest override.
      ...(environment.OPENCODE_CONFIG?.trim()
        ? [expandHomePath(environment.OPENCODE_CONFIG.trim(), home)]
        : []),
    ];
    const reads = yield* Effect.forEach(
      candidates,
      (candidate) => readLenientJsonFile(fileSystem, candidate),
      { concurrency: "unbounded" },
    );
    const configs: Array<unknown> = [];
    for (const read of reads) if (read.kind === "read") configs.push(read.value);
    const inline = environment.OPENCODE_CONFIG_CONTENT?.trim();
    if (inline !== undefined && inline.length > 0) {
      const parsed = yield* decodeLenientJson(inline).pipe(Effect.option);
      if (Option.isSome(parsed)) configs.push(parsed.value);
    }
    if (configs.length === 0 && reads.some((read) => read.kind === "invalid")) {
      return {
        kind: "error",
        reason: "OpenCode's configuration files couldn't be read as JSON.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    return {
      kind: "configured",
      servers: openCodeServersFromConfigs(configs),
      limitations: [
        "These servers come from OpenCode's configuration files; status and tools stay unknown until OpenCode runs for this instance.",
        "Servers contributed by OpenCode plugins only appear while its service runs.",
      ],
    } satisfies WorkflowMcpConfigDiscoveryResult;
  });

  const discover = Effect.fn("WorkflowMcpConfigDiscovery.discover")(function* (
    input: WorkflowMcpConfigDiscoveryInput,
  ) {
    if (Option.isNone(settings)) {
      return {
        kind: "unavailable",
        reason: "T3 can't read provider settings in this process.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const current = yield* settings.value.getSettings.pipe(Effect.option);
    if (Option.isNone(current)) {
      return {
        kind: "unavailable",
        reason: "T3 couldn't read the saved provider settings.",
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const entry = current.value.providerInstances[input.instanceId];
    if (
      entry !== undefined &&
      input.driverKind !== undefined &&
      entry.driver !== input.driverKind
    ) {
      return {
        kind: "unavailable",
        reason: `The saved configuration for ${input.label} belongs to another provider.`,
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    // The saved entry pins the identity. Without one, only the driver's default instance id may
    // assume a driver, so a renamed, deleted or other-provider instance never reads global config.
    const driverKind = entry?.driver ?? input.driverKind;
    if (
      driverKind === undefined ||
      (entry === undefined && defaultInstanceIdForDriver(driverKind) !== input.instanceId)
    ) {
      return {
        kind: "unavailable",
        reason: `No saved configuration exists for ${input.label}.`,
      } satisfies WorkflowMcpConfigDiscoveryResult;
    }
    const label = input.label;
    if (driverKind === "codex") {
      return yield* discoverCodex({
        config: entry?.config,
        environment: entry?.environment,
        workspaceRoot: input.workspaceRoot,
      });
    }
    if (driverKind === "claudeAgent") {
      return yield* discoverClaude({
        config: entry?.config,
        environment: entry?.environment,
        workspaceRoot: input.workspaceRoot,
      });
    }
    if (driverKind === "opencode") {
      return yield* discoverOpenCode({
        allowImplicitGlobalConfig: defaultInstanceIdForDriver(driverKind) === input.instanceId,
        environment: entry?.environment,
        workspaceRoot: input.workspaceRoot,
      });
    }
    return {
      kind: "unsupported",
      reason: `${label} has no read-only MCP configuration source in T3, so its servers can't be listed without a running session.`,
    } satisfies WorkflowMcpConfigDiscoveryResult;
  });

  return { discover };
});

export class WorkflowMcpConfigDiscovery extends Context.Service<
  WorkflowMcpConfigDiscovery,
  {
    /** Lists configured MCP servers without starting a session, calling a tool or authenticating. */
    readonly discover: (
      input: WorkflowMcpConfigDiscoveryInput,
    ) => Effect.Effect<WorkflowMcpConfigDiscoveryResult>;
  }
>()("t3/workflows/WorkflowMcpConfigDiscovery") {}

export const layerWith = (deps: WorkflowMcpConfigDiscoveryDeps = {}) =>
  Layer.effect(WorkflowMcpConfigDiscovery, make(deps));

export const layer = layerWith();
