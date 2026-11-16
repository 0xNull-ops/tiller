import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandAvailability } from "@t3tools/shared/shell";
import {
  CredentialId,
  ProviderDriverKind,
  type ServerProvider,
  type WorkflowSubagentsSnapshot,
  ProjectId,
  ProviderInstanceId,
  type Credential,
  type WorkflowDefinition,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as CredentialStore from "../credentials/CredentialStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as WorkflowMcpInventory from "./WorkflowMcpInventory.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as WorkflowReadiness from "./WorkflowReadiness.ts";

const projectId = ProjectId.make("project-1");
const workspaceRoot = "/tmp/workflow-readiness";

type Call = { command: string; args: ReadonlyArray<string>; cwd: string | null };

const processes = (
  calls: Array<Call>,
  output: { stdout?: string; stderr?: string; code?: number },
) =>
  Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) =>
      Effect.sync(() => {
        calls.push({ command: input.command, args: input.args, cwd: input.cwd ?? null });
        return {
          stdout: output.stdout ?? "",
          stderr: output.stderr ?? "",
          code: output.code ?? 0,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }) as never,
  });

const commands = (present: ReadonlyArray<string>) =>
  Layer.succeed(CommandAvailability, (command: string) =>
    Effect.succeed(present.includes(command)),
  );

const providers = (driverKind: string) =>
  Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
    getInstance: (instanceId: never) =>
      Effect.succeed({
        instanceId,
        driverKind,
        displayName: "Work Codex",
      }),
    listInstances: Effect.succeed([]),
    listUnavailable: Effect.succeed([]),
    streamChanges: Effect.never,
    subscribeChanges: Effect.die("unused"),
  } as never);

type LayerOptions = {
  output?: { stdout?: string; stderr?: string; code?: number };
  present?: ReadonlyArray<string>;
  driverKind?: string;
};

const layer = (
  calls: Array<Call>,
  options: LayerOptions = {},
): Layer.Layer<WorkflowReadiness.WorkflowReadiness> => {
  const withProviders =
    options.driverKind === undefined ? Layer.empty : providers(options.driverKind);
  return WorkflowReadiness.layer.pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(processes(calls, options.output ?? {})),
    Layer.provide(commands(options.present ?? [])),
    Layer.provide(withProviders),
  );
};

const credentials = (list: ReadonlyArray<Credential>) =>
  Layer.succeed(CredentialStore.CredentialStore, {
    list: () => Effect.succeed(list),
  } as never);

const credential = (input: {
  readonly id: string;
  readonly templateId?: string;
  readonly status?: Credential["status"];
  readonly expiresAt?: string;
}): Credential => ({
  id: CredentialId.make(input.id),
  name: `Credential ${input.id}`,
  templateId: input.templateId ?? "github",
  fields: [
    {
      id: "token",
      label: "Token",
      kind: "secret",
      envVar: "GITHUB_TOKEN",
      required: true,
      highRisk: false,
      secret: { set: true },
    },
  ],
  policy: { projects: "all", alwaysAsk: false, revealAllowed: false },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  useCount: 0,
  ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  status: input.status ?? "ready",
});

const definition = (steps: WorkflowDefinition["steps"]): WorkflowDefinition => ({
  version: 3,
  name: "Launch",
  steps,
});

const deploy = (
  attachments: NonNullable<WorkflowDefinition["steps"][number]["attachments"]>,
): WorkflowDefinition =>
  definition([
    {
      id: "deploy",
      kind: "skill",
      skill: "deploy",
      attachments,
    },
  ]);

describe("workflow readiness", () => {
  it.effect("serves static checks and never runs a command", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.cached({
        projectId,
        workspaceRoot,
        definition: deploy([
          { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
          { id: "go", kind: "requirement", requirement: "go" },
          { id: "linear", kind: "mcp-connection", server: "linear" },
        ]),
      });
      expect(calls).toEqual([]);
      const byId = new Map(snapshot.entries.map((entry) => [entry.attachmentId, entry]));
      expect(byId.get("node")).toMatchObject({
        status: "unknown",
        workspaceRoot,
      });
      expect(byId.get("node")?.message).toContain("hasn't been checked");
      expect(byId.get("go")).toMatchObject({
        status: "missing",
        message: '"deploy" needs `go` on this server\'s PATH.',
      });
      expect(byId.get("linear")).toMatchObject({ status: "unknown" });
      // `go` is genuinely missing, so the static snapshot already knows Run must stop. An
      // unchecked version or MCP connection alone does not block a cheap listing.
      expect(snapshot.blocksRun).toBe(true);
    }).pipe(Effect.provide(layer(calls, { present: ["node"] })));
  });

  it.effect("reports an OS requirement honestly", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.cached({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "os", kind: "requirement", requirement: "windows" }]),
      });
      expect(calls).toEqual([]);
      expect(snapshot.entries[0]).toMatchObject({ status: "missing" });
      expect(snapshot.entries[0]?.message).toContain("needs Windows");
      expect(snapshot.blocksRun).toBe(true);
    }).pipe(Effect.provide(layer(calls)));
  });

  it.effect("probes a real minimum version and caches the observation for five minutes", () => {
    const calls: Array<Call> = [];
    const definitionWithNode = deploy([
      { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
    ]);
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const probed = yield* readiness.probe({
        projectId,
        definition: definitionWithNode,
        workspaceRoot,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args.at(-1)).toBe("node --version");
      expect(calls[0]?.cwd).toBe(workspaceRoot);
      expect(probed.entries[0]).toMatchObject({
        status: "available",
        message: "`node` 22.11.0 is 22 or newer.",
      });
      expect(probed.entries[0]?.checkedAt).toBeDefined();
      expect(probed.entries[0]?.expiresAt).toBeDefined();
      expect(probed.blocksRun).toBe(false);

      const cached = yield* readiness.cached({
        projectId,
        definition: definitionWithNode,
        workspaceRoot,
      });
      expect(cached.entries[0]).toMatchObject({ status: "available" });
      expect(calls).toHaveLength(1);

      // Run preparation and an explicit Recheck always re-check, even inside the window.
      yield* readiness.probe({ projectId, definition: definitionWithNode, workspaceRoot });
      expect(calls).toHaveLength(2);

      yield* TestClock.adjust("6 minutes");
      const stale = yield* readiness.cached({
        projectId,
        definition: definitionWithNode,
        workspaceRoot,
      });
      expect(stale.entries[0]?.stale).toBe(true);
      expect(calls).toHaveLength(2);

      yield* readiness.probe({ projectId, definition: definitionWithNode, workspaceRoot });
      expect(calls).toHaveLength(3);
    }).pipe(Effect.provide(layer(calls, { output: { stdout: "v22.11.0\n" }, present: ["node"] })));
  });

  it.effect("blocks Run on an older version but never returns raw output", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([
          { id: "node", kind: "requirement", requirement: "node", minVersion: "22" },
        ]),
      });
      expect(snapshot.entries[0]).toMatchObject({ status: "missing" });
      expect(snapshot.entries[0]?.message).toContain("18.19.0 is older than 22");
      expect(snapshot.entries[0]?.message).not.toContain("SECRET_TOKEN_FROM_CLI");
      expect(snapshot.blocksRun).toBe(true);
      expect(calls).toHaveLength(1);
    }).pipe(
      Effect.provide(
        layer(calls, {
          output: { stdout: "SECRET_TOKEN_FROM_CLI v18.19.0\n" },
          present: ["node"],
        }),
      ),
    );
  });

  it.effect("classifies a signed-out login, keeps the sign-in hint, and blocks Run", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "vercel", kind: "service-login", service: "vercel" }]),
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args.at(-1)).toBe("vercel whoami");
      expect(snapshot.entries[0]).toMatchObject({ status: "missing" });
      expect(snapshot.entries[0]?.message).toContain("sign in with `vercel login`");
      expect(snapshot.entries[0]?.message).not.toContain("token=SUPER_SECRET");
      expect(snapshot.blocksRun).toBe(true);
    }).pipe(
      Effect.provide(
        layer(calls, {
          output: { stderr: "Error: token=SUPER_SECRET is not logged in", code: 1 },
          present: ["vercel"],
        }),
      ),
    );
  });

  it.effect("reports a missing service CLI without spawning it", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "vercel", kind: "service-login", service: "vercel" }]),
      });
      expect(calls).toEqual([]);
      expect(snapshot.entries[0]).toMatchObject({
        status: "missing",
        message: "The Vercel CLI (`vercel`) isn't on this server's PATH.",
      });
      expect(snapshot.blocksRun).toBe(true);
    }).pipe(Effect.provide(layer(calls)));
  });

  it.effect("reports a timeout as an error, not a sign-in failure", () => {
    const calls: Array<Call> = [];
    const timeoutLayer = WorkflowReadiness.layer.pipe(
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(
        Layer.succeed(ProcessRunner.ProcessRunner, {
          run: (input) =>
            Effect.sync(() => {
              calls.push({ command: input.command, args: input.args, cwd: input.cwd ?? null });
              return { timedOut: true, stdout: "", stderr: "", code: null } as never;
            }),
        }),
      ),
      Layer.provide(commands(["stripe"])),
    );
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([
          { id: "stripe", kind: "service-login", service: "stripe", command: "stripe status" },
        ]),
      });
      expect(snapshot.entries[0]).toMatchObject({
        status: "error",
        message: "The Stripe status check timed out.",
      });
      expect(snapshot.blocksRun).toBe(true);
    }).pipe(Effect.provide(timeoutLayer));
  });

  it.effect("does not treat Stripe configuration output as proof of login", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "stripe", kind: "service-login", service: "stripe" }]),
      });
      expect(calls).toEqual([]);
      expect(snapshot.entries[0]).toMatchObject({ status: "unknown" });
      expect(snapshot.entries[0]?.message).not.toContain("configured");
      expect(snapshot.blocksRun).toBe(true);
    }).pipe(Effect.provide(layer(calls)));
  });

  it.effect("keeps successful but unrecognized whoami output unknown", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "vercel", kind: "service-login", service: "vercel" }]),
      });
      expect(snapshot.entries[0]).toMatchObject({ status: "unknown" });
      expect(snapshot.blocksRun).toBe(true);
    }).pipe(Effect.provide(layer(calls, { present: ["vercel"] })));
  });

  it.effect("does not report a signed-out exit-zero whoami as available", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "vercel", kind: "service-login", service: "vercel" }]),
      });
      expect(snapshot.entries[0]).toMatchObject({ status: "missing" });
      expect(snapshot.entries[0]?.message).toContain("signed-out session");
      expect(snapshot.entries[0]?.message).not.toContain("token=");
    }).pipe(
      Effect.provide(
        layer(calls, {
          output: { stdout: "Error: not logged in, token=hidden", code: 0 },
          present: ["vercel"],
        }),
      ),
    );
  });

  it.effect("requires account evidence from Cloudflare's JSON whoami output", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "cloudflare", kind: "service-login", service: "cloudflare" }]),
      });
      expect(calls[0]?.args.at(-1)).toBe("wrangler whoami --json");
      expect(snapshot.entries[0]).toMatchObject({ status: "available" });
    }).pipe(
      Effect.provide(
        layer(calls, {
          output: { stdout: '{"user":{"id":"user-id"},"accounts":[]}' },
          present: ["wrangler"],
        }),
      ),
    );
  });

  it.effect("keeps Cloudflare whoami signed out when it exits successfully", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "cloudflare", kind: "service-login", service: "cloudflare" }]),
      });
      expect(snapshot.entries[0]).toMatchObject({ status: "missing" });
      expect(snapshot.entries[0]?.message).toContain("signed-out session");
    }).pipe(
      Effect.provide(
        layer(calls, {
          output: { stdout: "Not authenticated. Please run wrangler login.", code: 0 },
          present: ["wrangler"],
        }),
      ),
    );
  });

  it.effect("requires a successful version command and valid minimum", () => {
    const calls: Array<Call> = [];
    const run = (minimum: string, output: NonNullable<LayerOptions["output"]>) =>
      Effect.gen(function* () {
        const readiness = yield* WorkflowReadiness.WorkflowReadiness;
        return yield* readiness.probe({
          projectId,
          workspaceRoot,
          definition: deploy([
            { id: "node", kind: "requirement", requirement: "node", minVersion: minimum },
          ]),
        });
      }).pipe(Effect.provide(layer(calls, { output, present: ["node"] })));
    return Effect.gen(function* () {
      expect((yield* run("22", { stdout: "v22.11.0", code: 1 })).entries[0]?.status).toBe(
        "unknown",
      );
      const invalid = yield* run("22bad", { stdout: "v22.11.0", code: 0 });
      expect(invalid.entries[0]?.status).toBe("unknown");
      expect(invalid.entries[0]?.message).toContain("invalid minimum version");
      expect(calls).toHaveLength(2);
    });
  });

  it.effect("scopes cache entries to the workspace and the effective executor", () => {
    const calls: Array<Call> = [];
    const direct = deploy([{ id: "vercel", kind: "service-login", service: "vercel" }]);
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      yield* readiness.probe({ projectId, definition: direct, workspaceRoot });
      expect(calls).toHaveLength(1);

      const elsewhere = yield* readiness.cached({
        projectId,
        definition: direct,
        workspaceRoot: `${workspaceRoot}-other`,
      });
      expect(elsewhere.entries[0]).toMatchObject({ status: "unknown" });

      const differentExecutor = yield* readiness.cached({
        projectId,
        definition: direct,
        workspaceRoot,
        driver: { instanceId: ProviderInstanceId.make("claude"), model: "claude-sonnet" },
      });
      expect(differentExecutor.entries[0]).toMatchObject({ status: "unknown" });
      expect(calls).toHaveLength(1);
      expect(
        yield* readiness.cached({ projectId, definition: direct, workspaceRoot }),
      ).toMatchObject({ entries: [{ status: "available" }] });
    }).pipe(Effect.provide(layer(calls, { output: { stdout: "t3-user\n" }, present: ["vercel"] })));
  });

  it.effect("keeps MCP availability unknown and advisory for a resolved provider", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        driver: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5-codex" },
        definition: deploy([{ id: "linear", kind: "mcp-connection", server: "linear" }]),
      });
      expect(calls).toEqual([]);
      expect(snapshot.entries[0]).toMatchObject({
        status: "unknown",
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        message: "MCP inventory is unavailable in this readiness context.",
      });
      expect(snapshot.blocksRun).toBe(false);
    }).pipe(Effect.provide(layer(calls, { driverKind: "codex" })));
  });

  it.effect("does not borrow the driving provider when a step names its own model", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.cached({
        projectId,
        workspaceRoot,
        driver: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5-codex" },
        definition: definition([
          {
            id: "deploy",
            kind: "skill",
            skill: "deploy",
            model: { instanceId: ProviderInstanceId.make("claude-work"), model: "claude-sonnet" },
            attachments: [{ id: "linear", kind: "mcp-connection", server: "linear" }],
          },
        ]),
      });
      expect(snapshot.entries[0]).toMatchObject({
        providerInstanceId: ProviderInstanceId.make("claude-work"),
      });
    }).pipe(Effect.provide(layer(calls)));
  });

  it.effect("honours a connection's saved provider instead of the step's current model", () => {
    const calls: Array<Call> = [];
    const providersByInstance = Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: (instanceId: string) =>
        Effect.succeed(
          instanceId === "claude-work"
            ? {
                instanceId,
                driverKind: "claudeAgent",
                displayName: "Claude Work",
              }
            : { instanceId, driverKind: "codex", displayName: "Work Codex" },
        ),
      listInstances: Effect.succeed([]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Effect.never,
      subscribeChanges: Effect.die("unused"),
    } as never);
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.cached({
        projectId,
        workspaceRoot,
        definition: definition([
          {
            id: "deploy",
            kind: "skill",
            skill: "deploy",
            model: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5-codex" },
            attachments: [
              {
                id: "linear",
                kind: "mcp-connection",
                server: "linear",
                providerInstanceId: ProviderInstanceId.make("claude-work"),
              },
            ],
          },
        ]),
      });
      expect(snapshot.entries[0]).toMatchObject({
        status: "unknown",
        providerInstanceId: ProviderInstanceId.make("claude-work"),
      });
      expect(snapshot.entries[0]?.message).toContain("MCP inventory is unavailable");
    }).pipe(
      Effect.provide(
        WorkflowReadiness.layer.pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provide(processes(calls, {})),
          Layer.provide(commands([])),
          Layer.provide(providersByInstance),
        ),
      ),
    );
  });

  it.effect("checks every resource in a valid definition with bounded concurrency", () => {
    const calls: Array<Call> = [];
    const steps = Array.from({ length: 4 }, (_, stepIndex) => ({
      id: `step-${stepIndex}`,
      kind: "skill" as const,
      skill: "deploy",
      attachments: Array.from({ length: 11 }, (_, index) => ({
        id: `login-${index}`,
        kind: "service-login" as const,
        service: "vercel",
      })),
    }));
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.probe({
        projectId,
        workspaceRoot,
        definition: definition(steps),
      });
      expect(calls).toHaveLength(44);
      expect(snapshot.entries).toHaveLength(44);
      expect(snapshot.entries.every((entry) => entry.status === "unknown")).toBe(true);
    }).pipe(Effect.provide(layer(calls, { present: ["vercel"] })));
  });

  it.effect("resolves attached credentials from the vault without spawning or blocking", () => {
    const calls: Array<Call> = [];
    const ready = credential({ id: "cred-ready" });
    const expiring = credential({
      id: "cred-expiring",
      templateId: "vercel",
      status: "expiring",
      expiresAt: "2026-11-03T00:00:00.000Z",
    });
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-10-22T00:00:00.000Z"));
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.cached({
        projectId,
        workspaceRoot,
        definition: deploy([
          {
            id: "bound",
            kind: "credential",
            templateId: "github",
            credentialId: CredentialId.make("cred-ready"),
          },
          {
            id: "expiring",
            kind: "credential",
            templateId: "vercel",
            credentialId: CredentialId.make("cred-expiring"),
          },
          { id: "matched", kind: "credential", templateId: "vercel" },
          { id: "absent", kind: "credential", templateId: "stripe" },
        ]),
      });
      expect(calls).toEqual([]);
      const byId = new Map(snapshot.entries.map((entry) => [entry.attachmentId, entry]));
      expect(byId.get("bound")).toMatchObject({
        kind: "credential",
        status: "available",
        credential: {
          state: "ready",
          credentialId: "cred-ready",
          envVars: [{ name: "GITHUB_TOKEN", file: false }],
          statusLabel: "Ready",
        },
      });
      expect(byId.get("expiring")?.credential).toMatchObject({
        state: "expiring",
        statusLabel: "Expires in 12 days",
      });
      // One usable match resolves automatically; the template stays portable.
      expect(byId.get("matched")?.credential).toMatchObject({
        state: "matched",
        credentialId: "cred-expiring",
      });
      expect(byId.get("absent")).toMatchObject({
        status: "missing",
        credential: { state: "missing", templateId: "stripe", candidates: [] },
      });
      expect(byId.get("absent")?.message).toContain("No Stripe credential exists");
      // Credentials are advisory for a manual run.
      expect(snapshot.blocksRun).toBe(false);
      expect(JSON.stringify(snapshot)).not.toContain("GITHUB_TOKEN_VALUE");
    }).pipe(
      Effect.provide(
        WorkflowReadiness.layer.pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provide(processes(calls, {})),
          Layer.provide(commands([])),
          Layer.provide(credentials([ready, expiring])),
        ),
      ),
    );
  });

  it.effect("reports no-access when no credential vault is available", () => {
    const calls: Array<Call> = [];
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const snapshot = yield* readiness.cached({
        projectId,
        workspaceRoot,
        definition: deploy([{ id: "gh", kind: "credential", templateId: "github" }]),
      });
      expect(snapshot.entries[0]).toMatchObject({
        status: "unknown",
        credential: { state: "no-access", candidates: [] },
      });
      expect(snapshot.blocksRun).toBe(false);
    }).pipe(Effect.provide(layer(calls)));
  });
});

it.effect(
  "probes with a step override, first usable workflow choice, pinned snapshot or driver",
  () => {
    const calls: Array<Call> = [];
    const selections: Array<unknown> = [];
    const own = { instanceId: ProviderInstanceId.make("codex"), model: "own" };
    const preferred = { instanceId: ProviderInstanceId.make("codex"), model: "preferred" };
    const driver = { instanceId: ProviderInstanceId.make("driver"), model: "driver-model" };
    const provider: ServerProvider = {
      instanceId: own.instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-10-23T00:00:00.000Z",
      models: ["own", "preferred"].map((slug) => ({
        slug,
        name: slug,
        isCustom: false,
        capabilities: null,
      })),
      slashCommands: [],
      skills: [],
    };
    const pinned: WorkflowSubagentsSnapshot = {
      usable: [
        {
          ...preferred,
          instanceId: ProviderInstanceId.make("pinned"),
          driver: provider.driver,
          label: "Pinned",
        },
      ],
      missing: [],
      fallback: false,
    };
    return Effect.gen(function* () {
      const readiness = yield* WorkflowReadiness.WorkflowReadiness;
      const step = {
        id: "build",
        skill: "build",
        attachments: [{ id: "linear", kind: "mcp-connection" as const, server: "linear" }],
      };
      for (const test of [
        { hints: [preferred], step: { ...step, model: own }, snapshot: undefined, expected: own },
        {
          hints: [{ ...preferred, model: "missing" }, preferred],
          step,
          snapshot: undefined,
          expected: preferred,
        },
        {
          hints: [preferred],
          step,
          snapshot: pinned,
          expected: { ...preferred, instanceId: "pinned" },
        },
        {
          hints: [preferred],
          step,
          snapshot: { usable: [], missing: [], fallback: true },
          expected: driver,
        },
        {
          hints: [{ ...preferred, model: "missing" }],
          step,
          snapshot: undefined,
          expected: driver,
        },
        { hints: undefined, step, snapshot: undefined, expected: driver },
      ]) {
        yield* readiness.probe({
          projectId,
          workspaceRoot,
          driver,
          subagents: test.snapshot,
          definition: {
            ...definition([test.step]),
            ...(test.hints === undefined ? {} : { subagentModels: test.hints }),
          },
        });
        expect(selections.at(-1)).toMatchObject(test.expected);
      }
    }).pipe(
      Effect.provide(
        layer(calls).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderRegistry.ProviderRegistry)({
                getProviders: Effect.succeed([provider]),
                streamChanges: Stream.empty,
              }),
              Layer.mock(WorkflowMcpInventory.WorkflowMcpInventory)({
                observe: (input) =>
                  Effect.sync(() => {
                    selections.push(input.selection);
                    return {
                      status: "unavailable",
                      message: "Not available",
                      scope: { workspaceRoot, modelScoped: false },
                      servers: [],
                      cached: false,
                      stale: false,
                      excludedInternal: 0,
                      limitations: [],
                    };
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);
