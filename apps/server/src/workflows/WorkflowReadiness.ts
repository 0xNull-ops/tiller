import {
  type Credential,
  type ModelSelection,
  type ProjectId,
  type ThreadId,
  type WorkflowMcpInventorySnapshot,
  type WorkflowAttachment,
  type WorkflowDefinition,
  type WorkflowSubagentsSnapshot,
  type ServerProvider,
  type WorkflowReadinessEntry,
  type WorkflowReadinessSnapshot,
  type WorkflowReadinessStatus,
  type WorkflowServiceLoginAttachment,
  type WorkflowStep,
  type WorkflowSlug,
  workflowReadinessSpecification,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { CommandAvailability } from "@t3tools/shared/shell";
import * as Clock from "effect/Clock";
import { workflowExecutor } from "./workflowDelegation.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as CredentialStore from "../credentials/CredentialStore.ts";
import * as WorkflowMcpInventory from "./WorkflowMcpInventory.ts";
import * as CredentialAttachments from "./credentialAttachments.ts";
import * as ProcessRunner from "../processRunner.ts";

const decodeJsonUnknown = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** Login and version observations go stale together; Run always refreshes before it starts. */
const READINESS_FRESHNESS_MINUTES = 5;
const PROBE_TIMEOUT = "5 seconds";
const PROBE_OUTPUT_BYTES = 4 * 1024;
const MESSAGE_MAX_LENGTH = 240;
const CACHE_MAX_ENTRIES = 500;
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const PROBE_CONCURRENCY = 2;

/** An OS name a skill or requirement may use. Shared with the runner's `requires:` checks. */
const OS_REQUIREMENTS: Record<string, { platform: NodeJS.Platform; label: string }> = {
  macos: { platform: "darwin", label: "macOS" },
  mac: { platform: "darwin", label: "macOS" },
  darwin: { platform: "darwin", label: "macOS" },
  linux: { platform: "linux", label: "Linux" },
  windows: { platform: "win32", label: "Windows" },
  win32: { platform: "win32", label: "Windows" },
};

export const osRequirement = (requirement: string) =>
  OS_REQUIREMENTS[requirement.trim().toLowerCase()];

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

/**
 * Curated, non-interactive login checks. Each command only reads the CLI's stored session; none of
 * them signs in, writes configuration or opens a browser. Sign-in instructions are shown to the
 * user and are never executed by T3.
 */
type ServiceLoginTemplate = {
  readonly label: string;
  readonly command?: string;
  readonly signIn: string;
  readonly evidence?: "vercel-whoami" | "cloudflare-whoami-json";
};

// Only these status commands have a narrow, documented positive result that we can recognize
// without trusting a generic exit code. Other services keep their sign-in hint but remain Unknown.
const SERVICE_LOGIN_TEMPLATES: Record<string, ServiceLoginTemplate> = {
  vercel: {
    label: "Vercel",
    command: "vercel whoami",
    signIn: "vercel login",
    evidence: "vercel-whoami",
  },
  supabase: { label: "Supabase", signIn: "supabase login" },
  stripe: { label: "Stripe", signIn: "stripe login" },
  expo: { label: "Expo", signIn: "eas login" },
  eas: { label: "Expo EAS", signIn: "eas login" },
  netlify: { label: "Netlify", signIn: "netlify login" },
  cloudflare: {
    label: "Cloudflare",
    command: "wrangler whoami --json",
    signIn: "wrangler login",
    evidence: "cloudflare-whoami-json",
  },
  railway: { label: "Railway", signIn: "railway login" },
  fly: { label: "Fly.io", signIn: "fly auth login" },
  github: { label: "GitHub", signIn: "gh auth login" },
};

export interface ReadinessInput {
  readonly projectId: ProjectId;
  readonly definition: WorkflowDefinition;
  /** The directory the checks run in and the cache is scoped to. */
  readonly workspaceRoot: string;
  readonly contextThreadId?: ThreadId | undefined;
  /** Shared only by the child and owner checks of one dispatch in the same workspace/thread. */
  readonly mcpSnapshots?: Map<string | undefined, WorkflowMcpInventorySnapshot | undefined>;
  /** The run's pinned choices; absent means preflight resolves the live provider snapshots. */
  readonly subagents?: WorkflowSubagentsSnapshot | undefined;
  /** The driving thread's model; a workflow or step model wins over it. */
  readonly driver?: Pick<ModelSelection, "instanceId" | "model"> | undefined;
  /** Restricts which steps are examined; absent means every step. */
  readonly stepIds?: ReadonlySet<string> | undefined;
}

type Executor = Pick<ModelSelection, "instanceId" | "model"> | undefined;

interface CacheEntry {
  readonly status: Exclude<WorkflowReadinessStatus, "checking">;
  readonly message: string;
  readonly checkedAt: DateTime.DateTime;
  readonly expiresAt: DateTime.DateTime;
  readonly expiresAtMs: number;
}

const shorten = (message: string) =>
  message.length <= MESSAGE_MAX_LENGTH ? message : `${message.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Only the parsed version leaves the probe; raw stdout/stderr never reaches a card or the agent. */
const parseVersion = (text: string): string | undefined => {
  const match = /(?:^|[^\d])v?(\d+(?:\.\d+){0,3})(?=$|[^\d])/.exec(text);
  return match?.[1];
};

const reportsSignedOut = (output: { readonly stdout: string; readonly stderr: string }) =>
  /(?:not logged in|not authenticated|you are not logged in|login required|no valid credentials)/i.test(
    `${output.stdout}\n${output.stderr}`,
  );

const parseComparableVersion = (value: string): number[] | undefined => {
  if (!/^\d+(?:\.\d+){0,3}$/.test(value)) return undefined;
  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
};

const compareVersions = (found: string, minimum: string): number | undefined => {
  const parse = parseComparableVersion;
  const a = parse(found);
  const b = parse(minimum);
  if (a === undefined || b === undefined) return undefined;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const labelFor = (step: WorkflowStep) => step.title ?? step.id;

/**
 * An MCP attachment can keep the provider it was chosen for. That binding wins over a later step
 * model change, so the card names the provider whose connection it expects instead of silently
 * re-pointing the saved resource at another provider.
 */
const executorForAttachment = (
  input: ReadinessInput,
  step: WorkflowStep,
  attachment: WorkflowAttachment,
  providers: ReadonlyArray<ServerProvider> | undefined,
): Executor =>
  attachment.kind === "mcp-connection" && attachment.providerInstanceId !== undefined
    ? { instanceId: attachment.providerInstanceId, model: "" }
    : workflowExecutor({
        definition: input.definition,
        step,
        driver: input.driver,
        subagents: input.subagents,
        providers,
      });

const staticRequirement = (
  step: WorkflowStep,
  attachment: Extract<WorkflowAttachment, { kind: "requirement" }>,
  platform: NodeJS.Platform,
  present: boolean,
) => {
  const label = labelFor(step);
  const os = osRequirement(attachment.requirement);
  if (os !== undefined) {
    return os.platform === platform
      ? { status: "available" as const, message: `This server runs ${os.label}.` }
      : {
          status: "missing" as const,
          message: `"${label}" needs ${os.label}; this server runs ${PLATFORM_LABELS[platform] ?? platform}.`,
        };
  }
  if (!present)
    return {
      status: "missing" as const,
      message: `"${label}" needs \`${attachment.requirement}\` on this server's PATH.`,
    };
  if (attachment.minVersion === undefined)
    return {
      status: "available" as const,
      message: `\`${attachment.requirement}\` is on this server's PATH.`,
    };
  return {
    status: "unknown" as const,
    message: `\`${attachment.requirement}\` is installed; its version hasn't been checked against ${attachment.minVersion} yet.`,
  };
};

const serviceLoginCommand = (attachment: WorkflowServiceLoginAttachment) => {
  const template = SERVICE_LOGIN_TEMPLATES[attachment.service.trim().toLowerCase()];
  return {
    label: template?.label ?? oneLine(attachment.service),
    command: attachment.command ?? template?.command,
    signIn: oneLine(attachment.signInCommand ?? template?.signIn ?? ""),
  };
};

const attachmentSpec = (attachment: WorkflowAttachment): ReadonlyArray<string> => {
  switch (attachment.kind) {
    case "requirement":
      return [attachment.requirement, attachment.minVersion ?? ""];
    case "service-login":
      return [attachment.service, attachment.command ?? "", attachment.signInCommand ?? ""];
    case "mcp-connection":
      return [attachment.server];
    case "credential":
      return [attachment.templateId, attachment.credentialId ?? ""];
  }
};

const cacheKey = (
  input: ReadinessInput,
  stepId: string,
  attachment: WorkflowAttachment,
  executor: Executor,
): string =>
  [
    input.projectId,
    input.workspaceRoot,
    stepId,
    attachment.kind,
    attachment.id,
    ...attachmentSpec(attachment),
    executor?.instanceId ?? "",
    executor?.model ?? "",
  ].join("\u0000");

const mcpReadiness = (
  serverName: string,
  snapshot: WorkflowMcpInventorySnapshot | undefined,
): { status: CacheEntry["status"]; message: string } => {
  if (snapshot === undefined)
    return {
      status: "unknown",
      message: "MCP inventory is unavailable in this readiness context.",
    };
  if (snapshot.status !== "available" || snapshot.scope.source === undefined)
    return { status: "unknown", message: snapshot.message };
  const label = snapshot.scope.providerLabel ?? snapshot.scope.providerInstanceId ?? "the provider";
  const server = snapshot.servers.find((candidate) => candidate.name === serverName);
  const source = snapshot.scope.source;
  const at = snapshot.checkedAt === undefined ? "" : ` at ${snapshot.checkedAt}`;
  if (
    server === undefined &&
    snapshot.limitations.includes(WorkflowMcpInventory.MCP_INCOMPLETE_LISTING)
  )
    return { status: "unknown", message: WorkflowMcpInventory.MCP_INCOMPLETE_LISTING };
  if (server === undefined)
    return {
      status: "missing",
      message: `\`${serverName}\` is absent from ${label}'s ${source} MCP listing${at}.`,
    };
  if (source === "configured")
    return {
      status: "unknown",
      message: `Configured in ${label}, not verified (no live session)${at}.`,
    };
  const evidence = `per live ${label} session${at}`;
  switch (server.status) {
    case "connected":
      return {
        status: "available",
        message: `Connected ${evidence}; T3 doesn't verify what the server can access (files, sign-ins).`,
      };
    case "needs-auth":
      return { status: "missing", message: `Needs sign-in ${evidence}.` };
    case "failed":
    case "disabled":
      return { status: "error", message: `Not available: ${server.status} ${evidence}.` };
    case "connecting":
    case "not-started":
    case "unknown":
      return {
        status: "unknown",
        message: `${server.status} ${evidence}; availability is unverified.`,
      };
  }
};

export class WorkflowReadiness extends Context.Service<
  WorkflowReadiness,
  {
    /** Static checks and unexpired cached observations. Never spawns a process. */
    readonly cached: (input: ReadinessInput) => Effect.Effect<WorkflowReadinessSnapshot>;
    /** Runs bounded, non-interactive probes, then returns the full snapshot. */
    readonly probe: (input: ReadinessInput) => Effect.Effect<WorkflowReadinessSnapshot>;
    readonly forget: (projectId?: ProjectId) => Effect.Effect<void>;
  }
>()("t3/workflows/WorkflowReadiness") {}

const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const commandAvailable = yield* CommandAvailability;
  const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  // Card reads run under the runner's lock; explicit preflight reads the registry outside it.
  let cachedProviders = Option.isSome(registry) ? yield* registry.value.getProviders : undefined;
  if (Option.isSome(registry)) {
    yield* registry.value.streamChanges.pipe(
      Stream.runForEach((providers) =>
        Effect.sync(() => {
          cachedProviders = providers;
        }),
      ),
      Effect.forkScoped,
    );
  }
  const inventory = yield* Effect.serviceOption(WorkflowMcpInventory.WorkflowMcpInventory);
  // Optional so readiness keeps working (as no-access) where a vault isn't wired, such as tests.
  const credentialStore = yield* Effect.serviceOption(CredentialStore.CredentialStore);
  const cache = new Map<string, CacheEntry>();

  const present = (command: string) =>
    commandAvailable(command).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  /**
   * The vault's credentials, or undefined when it can't be read. An unread vault is reported as
   * no-access per card: it is never mistaken for "no credential of that type".
   */
  const credentialsForReadiness = Effect.fnUntraced(function* () {
    if (Option.isNone(credentialStore)) return undefined;
    const listed = yield* credentialStore.value.list().pipe(Effect.option);
    return Option.isSome(listed) ? listed.value : undefined;
  });

  const runProbeCommand = (command: string, cwd: string) =>
    processRunner.run({
      ...(platform === "win32"
        ? { command: "cmd.exe", args: ["/d", "/s", "/c", command] }
        : { command: "/bin/sh", args: ["-c", command] }),
      cwd,
      timeout: PROBE_TIMEOUT,
      timeoutBehavior: "timedOutResult",
      maxOutputBytes: PROBE_OUTPUT_BYTES,
      outputMode: "truncate",
      env: { ...environment, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    });

  /** A spawn failure is an observation ("couldn't run"), never a failed readiness read. */
  const probeCommand = (command: string, cwd: string) =>
    runProbeCommand(command, cwd).pipe(
      Effect.map((output) => ({ ran: true as const, output })),
      Effect.orElseSucceed(() => ({ ran: false as const })),
    );

  const prune = (nowMs: number) => {
    for (const [key, entry] of cache)
      if (nowMs - entry.expiresAtMs > CACHE_MAX_AGE_MS) cache.delete(key);
    while (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort(
        ([, a], [, b]) => DateTime.toEpochMillis(a.checkedAt) - DateTime.toEpochMillis(b.checkedAt),
      )[0];
      if (oldest === undefined) return;
      cache.delete(oldest[0]);
    }
  };

  const remember = Effect.fnUntraced(function* (
    key: string,
    status: CacheEntry["status"],
    message: string,
  ) {
    const checkedAt = yield* DateTime.now;
    const expiresAt = DateTime.add(checkedAt, { minutes: READINESS_FRESHNESS_MINUTES });
    const entry = {
      status,
      message,
      checkedAt,
      expiresAt,
      expiresAtMs: DateTime.toEpochMillis(expiresAt),
    } satisfies CacheEntry;
    cache.set(key, entry);
    prune(yield* Clock.currentTimeMillis);
    return entry;
  });

  const entry = (
    step: WorkflowStep,
    attachment: WorkflowAttachment,
    executor: Executor,
    workspaceRoot: string,
    result: { readonly status: CacheEntry["status"]; readonly message: string },
    timing?: { readonly entry: CacheEntry; readonly nowMs: number },
  ): WorkflowReadinessEntry => ({
    stepId: step.id as WorkflowSlug,
    attachmentId: attachment.id,
    kind: attachment.kind,
    status: result.status,
    message: shorten(result.message),
    ...(timing === undefined
      ? {}
      : {
          checkedAt: DateTime.formatIso(timing.entry.checkedAt),
          expiresAt: DateTime.formatIso(timing.entry.expiresAt),
          ...(timing.nowMs >= timing.entry.expiresAtMs ? { stale: true } : {}),
        }),
    ...(executor === undefined ? {} : { providerInstanceId: executor.instanceId }),
    workspaceRoot,
  });

  const requirementProbe = Effect.fnUntraced(function* (
    input: ReadinessInput,
    attachment: Extract<WorkflowAttachment, { kind: "requirement" }>,
  ) {
    const command = attachment.requirement.trim();
    const minimum = attachment.minVersion?.trim();
    if (!/^[A-Za-z0-9._+-]+$/.test(command))
      return {
        status: "unknown" as const,
        message: `T3 can't run a version check for "${oneLine(attachment.requirement)}"; use a single command name.`,
      };
    const output = yield* probeCommand(`${command} --version`, input.workspaceRoot);
    if (!output.ran)
      return {
        status: "error" as const,
        message: `The \`${command}\` version check couldn't run.`,
      };
    if (output.output.timedOut)
      return {
        status: "error" as const,
        message: `The \`${command}\` version check timed out.`,
      };
    if (output.output.code !== 0)
      return {
        status: "unknown" as const,
        message: `The \`${command}\` version check failed; T3 couldn't verify ${minimum ?? "its version"}.`,
      };
    if (minimum !== undefined && parseComparableVersion(minimum) === undefined)
      return {
        status: "unknown" as const,
        message: `T3 can't compare \`${command}\` against the invalid minimum version "${oneLine(minimum)}".`,
      };
    const version = parseVersion(`${output.output.stdout}\n${output.output.stderr}`);
    if (version === undefined)
      return {
        status: "unknown" as const,
        message: `T3 couldn't read \`${command}\`'s version; check it is ${minimum} or newer.`,
      };
    const comparison = compareVersions(version, minimum ?? "0");
    if (comparison === undefined)
      return {
        status: "unknown" as const,
        message: `T3 couldn't compare \`${command}\` ${version} with ${minimum}.`,
      };
    return comparison >= 0
      ? {
          status: "available" as const,
          message: `\`${command}\` ${version} is ${minimum} or newer.`,
        }
      : {
          status: "missing" as const,
          message: `\`${command}\` ${version} is older than ${minimum}.`,
        };
  });

  const serviceLoginProbe = Effect.fnUntraced(function* (
    input: ReadinessInput,
    attachment: WorkflowServiceLoginAttachment,
  ) {
    const { label, command, signIn } = serviceLoginCommand(attachment);
    const instructions = signIn.length > 0 ? `; sign in with \`${signIn}\`` : "";
    if (command === undefined)
      return {
        status: "unknown" as const,
        message: `${label} has no status check T3 can run${instructions}; add one to check it.`,
      };
    const executable = command.trim().split(/\s+/)[0] ?? "";
    if (executable.length > 0 && !(yield* present(executable)))
      return {
        status: "missing" as const,
        message: `The ${label} CLI (\`${executable}\`) isn't on this server's PATH.`,
      };
    const output = yield* probeCommand(command, input.workspaceRoot);
    if (!output.ran)
      return { status: "error" as const, message: `The ${label} status check couldn't run.` };
    if (output.output.timedOut)
      return { status: "error" as const, message: `The ${label} status check timed out.` };
    if (attachment.command !== undefined) {
      // Custom commands have an explicit user-configured contract: exit 0 means available.
      return output.output.code === 0
        ? { status: "available" as const, message: `${label} status check succeeded.` }
        : {
            status: "missing" as const,
            message: `The ${label} status check failed${instructions}.`,
          };
    }
    const template = SERVICE_LOGIN_TEMPLATES[attachment.service.trim().toLowerCase()];
    if (template?.evidence === "vercel-whoami") {
      const recognizedAccount = /^(?:[a-z0-9][a-z0-9_-]{0,63})\s*$/i.test(
        output.output.stdout.trim(),
      );
      if (output.output.code === 0 && recognizedAccount)
        return { status: "available" as const, message: `${label} is signed in on this server.` };
      if (reportsSignedOut(output.output))
        return {
          status: "missing" as const,
          message: `${label} CLI reports a signed-out session${instructions}.`,
        };
      return {
        status: "unknown" as const,
        message: `T3 couldn't verify whether ${label} is signed in${instructions}.`,
      };
    }
    if (template?.evidence === "cloudflare-whoami-json") {
      const parsed = decodeJsonUnknown(output.output.stdout);
      const accountEvidence =
        Option.isSome(parsed) &&
        typeof parsed.value === "object" &&
        parsed.value !== null &&
        (("user" in parsed.value &&
          typeof parsed.value.user === "object" &&
          parsed.value.user !== null &&
          Object.values(parsed.value.user).some(
            (value) => typeof value === "string" && value.trim().length > 0,
          )) ||
          ("accounts" in parsed.value &&
            Array.isArray(parsed.value.accounts) &&
            parsed.value.accounts.length > 0));
      if (output.output.code === 0 && accountEvidence)
        return { status: "available" as const, message: `${label} is signed in on this server.` };
      if (reportsSignedOut(output.output))
        return {
          status: "missing" as const,
          message: `${label} CLI reports a signed-out session${instructions}.`,
        };
      return {
        status: "unknown" as const,
        message: `T3 couldn't verify whether ${label} is signed in${instructions}.`,
      };
    }
    return {
      status: "unknown" as const,
      message: `T3 couldn't verify whether ${label} is signed in${instructions}.`,
    };
  });

  const entryFor = Effect.fnUntraced(function* (
    input: ReadinessInput,
    providers: ReadonlyArray<ServerProvider> | undefined,
    execute: boolean,
    step: WorkflowStep,
    attachment: WorkflowAttachment,
    mcpSnapshot: WorkflowMcpInventorySnapshot | undefined,
    credentials: ReadonlyArray<Credential> | undefined,
  ) {
    const executor = executorForAttachment(input, step, attachment, providers);
    const key = cacheKey(input, step.id, attachment, executor);
    const nowMs = yield* Clock.currentTimeMillis;
    const cached = cache.get(key);

    if (attachment.kind === "credential") {
      // Cheap in-memory metadata only: no spawn, so it is read fresh instead of cached.
      const resolution =
        credentials === undefined
          ? undefined
          : CredentialAttachments.resolveCredentialAttachment({
              attachment,
              projectId: input.projectId,
              credentials,
            });
      const readiness = CredentialAttachments.credentialReadiness({
        attachment,
        resolution,
        nowMs,
      });
      const described = CredentialAttachments.describeCredentialState({
        attachment,
        resolution,
        readiness,
        stepLabel: labelFor(step),
        nowMs,
      });
      return {
        ...entry(step, attachment, executor, input.workspaceRoot, described),
        credential: readiness,
      };
    }

    // An explicit probe (including Run preparation) always re-checks; only cheap reads serve
    // cached observations, and a passed freshness window marks them stale.
    if (cached !== undefined && !execute)
      return entry(step, attachment, executor, input.workspaceRoot, cached, {
        entry: cached,
        nowMs,
      });

    if (attachment.kind === "mcp-connection") {
      const snapshot = mcpSnapshot;
      const result = mcpReadiness(attachment.server, snapshot);
      return {
        ...entry(step, attachment, executor, input.workspaceRoot, result),
        ...(snapshot?.checkedAt === undefined ? {} : { checkedAt: snapshot.checkedAt }),
        ...(snapshot?.stale ? { stale: true } : {}),
      };
    }

    if (attachment.kind === "service-login") {
      if (!execute) {
        const { label, signIn } = serviceLoginCommand(attachment);
        return entry(step, attachment, executor, input.workspaceRoot, {
          status: "unknown",
          message: `${label} hasn't been checked yet${signIn.length > 0 ? `; sign in with \`${signIn}\`` : ""}.`,
        });
      }
      const result = yield* serviceLoginProbe(input, attachment);
      const remembered = yield* remember(key, result.status, result.message);
      return entry(step, attachment, executor, input.workspaceRoot, result, {
        entry: remembered,
        nowMs,
      });
    }

    const commandPresent = yield* present(attachment.requirement);
    const base = staticRequirement(step, attachment, platform, commandPresent);
    if (base.status !== "unknown")
      return entry(step, attachment, executor, input.workspaceRoot, base);
    if (!execute || attachment.minVersion === undefined)
      return entry(step, attachment, executor, input.workspaceRoot, base);
    const result = yield* requirementProbe(input, attachment);
    const remembered = yield* remember(key, result.status, result.message);
    return entry(step, attachment, executor, input.workspaceRoot, result, {
      entry: remembered,
      nowMs,
    });
  });

  const evaluate = Effect.fnUntraced(function* (input: ReadinessInput, execute: boolean) {
    const providers =
      execute && Option.isSome(registry) ? yield* registry.value.getProviders : cachedProviders;
    const evaluatedAt = DateTime.formatIso(yield* DateTime.now);
    const pairs = input.definition.steps
      .filter((step) => input.stepIds === undefined || input.stepIds.has(step.id))
      .flatMap((step) => (step.attachments ?? []).map((attachment) => ({ step, attachment })));
    // Sequentially memoize each instance once before evaluating cards: multiple cards never
    // turn an explicit probe into repeated provider queries, even after single-flight completes.
    const snapshots =
      input.mcpSnapshots ?? new Map<string | undefined, WorkflowMcpInventorySnapshot | undefined>();
    for (const { step, attachment } of pairs) {
      if (attachment.kind !== "mcp-connection") continue;
      const executor = executorForAttachment(input, step, attachment, providers);
      if (snapshots.has(executor?.instanceId)) continue;
      const snapshot = Option.isNone(inventory)
        ? undefined
        : yield* inventory.value
            .observe({
              projectId: input.projectId,
              workspaceRoot: input.workspaceRoot,
              selection: executor,
              contextThreadId: input.contextThreadId,
              refresh: execute,
            })
            .pipe(Effect.orElseSucceed(() => undefined));
      snapshots.set(executor?.instanceId, snapshot);
    }
    const credentials = yield* credentialsForReadiness();
    const entries = yield* Effect.forEach(
      pairs,
      ({ step, attachment }) =>
        entryFor(
          input,
          providers,
          execute,
          step,
          attachment,
          snapshots.get(executorForAttachment(input, step, attachment, providers)?.instanceId),
          credentials,
        ),
      { concurrency: PROBE_CONCURRENCY },
    );
    const all = entries;
    return {
      entries: all,
      // MCP evidence remains advisory even when the provider reports a failure. Requirements
      // and logins retain their existing Run policy; unchecked ones block only explicit probes.
      // Credentials are advisory too: a manual run proceeds and its step prompt says what is
      // missing. An unattended start blocks on them separately, where the user can't intervene.
      blocksRun: all.some(
        (item) =>
          item.kind !== "mcp-connection" &&
          item.kind !== "credential" &&
          (item.status === "missing" ||
            item.status === "error" ||
            (execute && item.status === "unknown")),
      ),
      evaluatedAt,
      context: {
        workspaceRoot: input.workspaceRoot,
        ...(input.contextThreadId === undefined ? {} : { threadId: input.contextThreadId }),
        ...(input.driver === undefined ? {} : { model: input.driver }),
        specification: workflowReadinessSpecification(input.definition),
      },
    } satisfies WorkflowReadinessSnapshot;
  });

  return WorkflowReadiness.of({
    cached: Effect.fn("WorkflowReadiness.cached")((input: ReadinessInput) =>
      evaluate(input, false),
    ),
    probe: Effect.fn("WorkflowReadiness.probe")((input: ReadinessInput) => evaluate(input, true)),
    forget: Effect.fn("WorkflowReadiness.forget")((projectId?: ProjectId) =>
      Effect.sync(() => {
        if (projectId === undefined) {
          cache.clear();
          return;
        }
        const prefix = `${projectId}\u0000`;
        for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
      }),
    ),
  });
});

export const layer = Layer.effect(WorkflowReadiness, make);
