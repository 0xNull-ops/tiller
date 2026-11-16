import * as NodeServices from "@effect/platform-node/NodeServices";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings as ServerSettingsConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import * as WorkflowMcpConfigDiscovery from "./WorkflowMcpConfigDiscovery.ts";

const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claudeAgent");
const cursor = ProviderDriverKind.make("cursor");
const opencode = ProviderDriverKind.make("opencode");

const layerWith = (input: {
  readonly settings?: Partial<ServerSettingsConfig>;
  readonly runCommand?: WorkflowMcpConfigDiscovery.McpInventoryCommandRunner;
}) =>
  WorkflowMcpConfigDiscovery.layerWith(
    input.runCommand === undefined ? {} : { runCommand: input.runCommand },
  ).pipe(
    Layer.provideMerge(ServerSettings.ServerSettingsService.layerTest(input.settings ?? {})),
    Layer.provideMerge(NodeServices.layer),
  );

const discover = (input: WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscoveryInput) =>
  Effect.gen(function* () {
    const service = yield* WorkflowMcpConfigDiscovery.WorkflowMcpConfigDiscovery;
    return yield* service.discover(input);
  });

const output = (entries: ReadonlyArray<unknown>) => JSON.stringify(entries);

describe("workflow MCP configuration parsing", () => {
  it("keeps Codex names, transport and origin while dropping commands, env and headers", () => {
    const servers = WorkflowMcpConfigDiscovery.parseCodexConfigList(
      output([
        {
          name: "linear",
          enabled: true,
          transport: {
            type: "streamable_http",
            url: "https://user:pass@example.test/mcp?token=SUPER_SECRET",
            bearer_token_env_var: "LINEAR_TOKEN",
            http_headers: { Authorization: "Bearer SUPER_SECRET" },
          },
        },
        {
          name: "local",
          enabled: false,
          disabled_reason: "off",
          transport: {
            type: "stdio",
            command: "secret-binary",
            args: ["--token", "SUPER_SECRET"],
            env: { TOKEN: "SUPER_SECRET" },
          },
        },
      ]),
    );
    expect(servers).toMatchObject([
      {
        name: "linear",
        transport: "http",
        origin: "https://example.test",
        status: "unknown",
        toolsStatus: "unavailable",
        tools: [],
      },
      {
        name: "local",
        transport: "stdio",
        status: "disabled",
        toolsStatus: "unavailable",
        statusDetail: "Disabled in Codex configuration.",
      },
    ]);
    expect(JSON.stringify(servers)).not.toContain("SUPER_SECRET");
    expect(JSON.stringify(servers)).not.toContain("secret-binary");
    expect(JSON.stringify(servers)).not.toContain("user:pass");
  });

  it("merges Claude scopes in priority order without leaking configuration", () => {
    const servers = WorkflowMcpConfigDiscovery.claudeServersFromConfigs({
      account: {
        mcpServers: {
          blender: { type: "stdio", command: "secret-binary", env: { TOKEN: "SUPER_SECRET" } },
          remote: { type: "http", url: "https://user:pass@host.test/mcp?x=1" },
        },
        projects: {},
      },
      project: {
        mcpServers: {
          local: { type: "stdio", command: "secret-binary" },
        },
        disabledMcpjsonServers: ["project-off"],
      },
      projectFile: {
        mcpServers: {
          project: { type: "sse", url: "https://project.test/sse" },
          "project-off": { command: "secret-binary" },
        },
      },
      managed: {
        mcpServers: { managed: { type: "stdio", command: "secret-binary" } },
      },
    });
    expect(servers.map((server) => server.name)).toEqual([
      "blender",
      "remote",
      "managed",
      "project",
      "project-off",
      "local",
    ]);
    expect(servers.find((server) => server.name === "remote")).toMatchObject({
      transport: "http",
      origin: "https://host.test",
      status: "unknown",
      toolsStatus: "unavailable",
    });
    expect(servers.find((server) => server.name === "project-off")).toMatchObject({
      status: "disabled",
      statusDetail: "Disabled in Claude Code project configuration.",
    });
    expect(JSON.stringify(servers)).not.toContain("SUPER_SECRET");
    expect(JSON.stringify(servers)).not.toContain("secret-binary");
    expect(JSON.stringify(servers)).not.toContain("user:pass");
  });

  it("reads OpenCode V1 and V2 server shapes and marks disabled entries", () => {
    const servers = WorkflowMcpConfigDiscovery.openCodeServersFromConfigs([
      {
        mcp: {
          legacy: { type: "local", command: ["secret-binary"], enabled: true },
          remote: { type: "remote", url: "https://user:pass@opencode.test/mcp?x=1" },
          off: { type: "local", command: ["secret-binary"], enabled: false },
        },
      },
      {
        mcp: {
          servers: {
            project: { type: "remote", url: "https://project.test/mcp" },
          },
        },
      },
    ]);
    expect(servers.map((server) => server.name)).toEqual(["legacy", "remote", "off", "project"]);
    expect(servers.find((server) => server.name === "legacy")).toMatchObject({
      transport: "stdio",
      status: "unknown",
      toolsStatus: "unavailable",
    });
    expect(servers.find((server) => server.name === "remote")).toMatchObject({
      transport: "http",
      origin: "https://opencode.test",
    });
    expect(servers.find((server) => server.name === "off")).toMatchObject({
      status: "disabled",
      statusDetail: "Disabled in OpenCode configuration.",
    });
    expect(JSON.stringify(servers)).not.toContain("SUPER_SECRET");
    expect(JSON.stringify(servers)).not.toContain("secret-binary");
    expect(JSON.stringify(servers)).not.toContain("user:pass");
  });
});

describe("workflow MCP configuration discovery", () => {
  it.effect(
    "uses the selected Codex instance's binary, launch args, environment and workspace",
    () => {
      const commands: Array<WorkflowMcpConfigDiscovery.McpInventoryCommand> = [];
      return Effect.gen(function* () {
        const result = yield* discover({
          instanceId: ProviderInstanceId.make("codex-work"),
          driverKind: codex,
          label: "Work Codex",
          workspaceRoot: "/workspace/codex-work",
        });
        expect(result.kind).toBe("configured");
        if (result.kind !== "configured") return;
        expect(result.servers.map((server) => server.name)).toEqual(["linear", "off", "secret"]);
        expect(result.servers[0]).toMatchObject({
          name: "linear",
          origin: "https://linear.test",
          status: "unknown",
          toolsStatus: "unavailable",
        });
        expect(commands).toHaveLength(1);
        const command = commands[0];
        expect(command?.binary).toBe("/custom/codex");
        expect(command?.cwd).toBe("/workspace/codex-work");
        expect(command?.args).toEqual([
          "-c",
          "model_reasoning_effort=low",
          "mcp",
          "list",
          "--json",
        ]);
        expect(command?.env.CUSTOM_INSTANCE_ENV).toBe("instance-value");
        expect(command?.env.CODEX_HOME?.endsWith(".codex-work")).toBe(true);
        expect(command?.env.CODEX_HOME?.startsWith("~")).toBe(false);
        expect(JSON.stringify(result)).not.toContain("SUPER_SECRET");
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("codex-work")]: {
                  driver: codex,
                  config: {
                    setupMode: "existing",
                    binaryPath: "/custom/codex",
                    homePath: "~/.codex-work",
                    launchArgs: '-c model_reasoning_effort="low" --strict-config',
                  },
                  environment: [
                    { name: "CUSTOM_INSTANCE_ENV", value: "instance-value", sensitive: false },
                  ],
                },
              },
            },
            runCommand: (command) =>
              Effect.sync(() => {
                commands.push(command);
                return {
                  kind: "output" as const,
                  stdout: output([
                    {
                      name: "linear",
                      enabled: true,
                      transport: { type: "streamable_http", url: "https://linear.test/mcp" },
                    },
                    { name: "off", enabled: false, transport: { type: "stdio" } },
                    {
                      name: "secret",
                      enabled: true,
                      transport: {
                        type: "stdio",
                        command: "secret-binary",
                        env: { TOKEN: "SUPER_SECRET" },
                      },
                    },
                  ]),
                };
              }),
          }),
        ),
      );
    },
  );

  it.effect("does not guess a global Codex home for a managed instance", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-managed"),
        driverKind: codex,
        label: "Managed Codex",
        workspaceRoot: "/workspace/managed",
      });
      expect(result).toMatchObject({ kind: "unavailable" });
      expect(result.kind === "unavailable" ? result.reason : "").toContain("T3 manages");
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layerWith({
          settings: {
            providerInstances: {
              [ProviderInstanceId.make("codex-managed")]: {
                driver: codex,
                config: { setupMode: "managed" },
              },
            },
          },
          runCommand: () =>
            Effect.sync(() => {
              calls += 1;
              return { kind: "output" as const, stdout: "[]" };
            }),
        }),
      ),
    );
  });

  it.effect("uses default settings only for the driver's default instance", () => {
    const commands: Array<WorkflowMcpConfigDiscovery.McpInventoryCommand> = [];
    const defaultId = ProviderInstanceId.make("codex");
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: defaultId,
        driverKind: codex,
        label: "Codex",
        workspaceRoot: "/workspace/default",
      });
      expect(result.kind).toBe("configured");
      expect(commands[0]?.binary).toBe("codex");
    }).pipe(
      Effect.provide(
        layerWith({
          runCommand: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { kind: "output" as const, stdout: "[]" };
            }),
        }),
      ),
    );
  });

  it.effect("resolves the driver from the saved instance when the caller cannot name it", () => {
    const commands: Array<WorkflowMcpConfigDiscovery.McpInventoryCommand> = [];
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-work"),
        label: "Work Codex",
        workspaceRoot: "/workspace/unnamed",
      });
      expect(result.kind).toBe("configured");
      expect(commands).toHaveLength(1);
      expect(commands[0]?.args).toEqual(["mcp", "list", "--json"]);
    }).pipe(
      Effect.provide(
        layerWith({
          settings: {
            providerInstances: {
              [ProviderInstanceId.make("codex-work")]: {
                driver: codex,
                config: { setupMode: "existing" },
              },
            },
          },
          runCommand: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { kind: "output" as const, stdout: "[]" };
            }),
        }),
      ),
    );
  });

  it.effect("refuses Codex profile overrides instead of listing the default profile", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-work"),
        driverKind: codex,
        label: "Work Codex",
        workspaceRoot: "/workspace/profile",
      });
      expect(result).toMatchObject({ kind: "unavailable" });
      expect(result.kind === "unavailable" ? result.reason : "").toContain("profile");
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layerWith({
          settings: {
            providerInstances: {
              [ProviderInstanceId.make("codex-work")]: {
                driver: codex,
                config: { setupMode: "existing", launchArgs: "--profile work" },
              },
            },
          },
          runCommand: () =>
            Effect.sync(() => {
              calls += 1;
              return { kind: "output" as const, stdout: "[]" };
            }),
        }),
      ),
    );
  });

  it.effect("refuses an unnamed instance that is not a driver's default id", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-unknown"),
        label: "Unknown Codex",
        workspaceRoot: "/workspace/unknown",
      });
      expect(result).toMatchObject({ kind: "unavailable" });
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layerWith({
          runCommand: () =>
            Effect.sync(() => {
              calls += 1;
              return { kind: "output" as const, stdout: "[]" };
            }),
        }),
      ),
    );
  });

  it.effect("refuses an unknown custom instance instead of falling back to defaults", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-unknown"),
        driverKind: codex,
        label: "Unknown Codex",
        workspaceRoot: "/workspace/unknown",
      });
      expect(result).toMatchObject({ kind: "unavailable" });
      expect(result.kind === "unavailable" ? result.reason : "").toContain(
        "No saved configuration",
      );
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layerWith({
          runCommand: () =>
            Effect.sync(() => {
              calls += 1;
              return { kind: "output" as const, stdout: "[]" };
            }),
        }),
      ),
    );
  });

  it.effect("refuses a stored instance whose driver differs from the selection", () => {
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-work"),
        driverKind: codex,
        label: "Work Codex",
        workspaceRoot: "/workspace/mismatch",
      });
      expect(result).toMatchObject({ kind: "unavailable" });
      expect(result.kind === "unavailable" ? result.reason : "").toContain(
        "belongs to another provider",
      );
    }).pipe(
      Effect.provide(
        layerWith({
          settings: {
            providerInstances: {
              [ProviderInstanceId.make("codex-work")]: {
                driver: claude,
                config: { homePath: "/tmp/claude-config" },
              },
            },
          },
        }),
      ),
    );
  });

  it.effect("reports unsupported drivers without running a command", () => {
    let calls = 0;
    return Effect.gen(function* () {
      const result = yield* discover({
        instanceId: ProviderInstanceId.make("cursor-work"),
        driverKind: cursor,
        label: "Cursor Work",
        workspaceRoot: "/workspace/cursor",
      });
      expect(result).toMatchObject({ kind: "unsupported" });
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(
        layerWith({
          settings: {
            providerInstances: {
              [ProviderInstanceId.make("cursor-work")]: { driver: cursor },
            },
          },
          runCommand: () =>
            Effect.sync(() => {
              calls += 1;
              return { kind: "output" as const, stdout: "[]" };
            }),
        }),
      ),
    );
  });

  it.effect("reads Claude configuration files without a live session", () => {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-workflow-mcp-claude-",
      });
      const configDir = path.join(root, "claude-config");
      const workspace = path.join(root, "work");
      yield* fileSystem.makeDirectory(configDir, { recursive: true });
      yield* fileSystem.makeDirectory(workspace, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(configDir, ".claude.json"),
        JSON.stringify({
          mcpServers: {
            user: {
              type: "stdio",
              command: "secret-binary",
              env: { TOKEN: "SUPER_SECRET" },
            },
            remote: { type: "http", url: "https://user:pass@claude.test/mcp?x=1" },
          },
          projects: {
            [workspace]: {
              mcpServers: { local: { type: "stdio", command: "secret-binary" } },
              disabledMcpjsonServers: ["off"],
            },
          },
        }),
      );
      yield* fileSystem.writeFileString(
        path.join(workspace, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            project: { type: "sse", url: "https://project.test/sse" },
            off: { command: "secret-binary" },
          },
        }),
      );

      const result = yield* discover({
        instanceId: ProviderInstanceId.make("claude-work"),
        driverKind: claude,
        label: "Claude Work",
        workspaceRoot: workspace,
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("claude-work")]: {
                  driver: claude,
                  config: { homePath: configDir, binaryPath: "/custom/claude" },
                },
              },
            },
          }),
        ),
      );
      expect(result.kind).toBe("configured");
      if (result.kind !== "configured") return;
      expect(result.servers.map((server) => server.name)).toEqual([
        "user",
        "remote",
        "project",
        "off",
        "local",
      ]);
      expect(result.servers.find((server) => server.name === "remote")).toMatchObject({
        origin: "https://claude.test",
        transport: "http",
      });
      expect(result.servers.find((server) => server.name === "off")).toMatchObject({
        statusDetail: "Disabled in Claude Code project configuration.",
      });
      expect(JSON.stringify(result)).not.toContain("SUPER_SECRET");
      expect(JSON.stringify(result)).not.toContain("secret-binary");
      expect(JSON.stringify(result)).not.toContain("user:pass");
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("reads OpenCode JSON and JSONC configuration in the instance environment", () => {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-workflow-mcp-opencode-",
      });
      const configHome = path.join(root, "config");
      const workspace = path.join(root, "work");
      yield* fileSystem.makeDirectory(path.join(configHome, "opencode"), { recursive: true });
      yield* fileSystem.makeDirectory(workspace, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(configHome, "opencode", "opencode.json"),
        JSON.stringify({
          mcp: {
            global: {
              type: "local",
              command: ["secret-binary"],
              environment: { TOKEN: "SUPER_SECRET" },
            },
            remote: {
              type: "remote",
              url: "https://user:pass@opencode.test/mcp?x=1",
            },
          },
        }),
      );
      yield* fileSystem.writeFileString(
        path.join(workspace, "opencode.jsonc"),
        [
          "{",
          "  // project servers",
          '  "mcp": {',
          '    "servers": {',
          '      "project": { "type": "remote", "url": "https://project.test/mcp", },',
          "    },",
          "  },",
          "}",
        ].join("\n"),
      );

      const result = yield* discover({
        instanceId: ProviderInstanceId.make("opencode-work"),
        driverKind: opencode,
        label: "OpenCode Work",
        workspaceRoot: workspace,
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("opencode-work")]: {
                  driver: opencode,
                  environment: [{ name: "XDG_CONFIG_HOME", value: configHome, sensitive: false }],
                },
              },
            },
          }),
        ),
      );
      expect(result.kind).toBe("configured");
      if (result.kind !== "configured") return;
      expect(result.servers.map((server) => server.name)).toEqual(["global", "remote", "project"]);
      expect(result.servers.find((server) => server.name === "remote")).toMatchObject({
        origin: "https://opencode.test",
      });
      expect(result.servers.find((server) => server.name === "project")).toMatchObject({
        origin: "https://project.test",
      });
      expect(JSON.stringify(result)).not.toContain("SUPER_SECRET");
      expect(JSON.stringify(result)).not.toContain("secret-binary");
      expect(JSON.stringify(result)).not.toContain("user:pass");
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("runs the instance's own Codex binary with its CODEX_HOME", () => {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-workflow-mcp-codex-bin-",
      });
      const home = path.join(root, "codex-home");
      const workspace = path.join(root, "work");
      yield* fileSystem.makeDirectory(home, { recursive: true });
      yield* fileSystem.makeDirectory(workspace, { recursive: true });
      const binary = writeFakeCli({
        directory: path.join(root, "bin"),
        name: "codex",
        source: [
          "const args = process.argv.slice(2);",
          'if (args.join(" ") !== "mcp list --json") { process.stderr.write("unexpected args"); process.exit(9); }',
          `if (process.env.CODEX_HOME !== ${JSON.stringify(home)}) { process.stderr.write("unexpected home"); process.exit(9); }`,
          'if (process.env.CUSTOM_INSTANCE_ENV !== "instance-value") { process.stderr.write("missing env"); process.exit(9); }',
          'process.stdout.write(JSON.stringify([{ name: "linear", enabled: true, transport: { type: "streamable_http", url: "https://linear.test/mcp" } }]));',
        ].join("\n"),
      });

      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-work"),
        driverKind: codex,
        label: "Work Codex",
        workspaceRoot: workspace,
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("codex-work")]: {
                  driver: codex,
                  config: { setupMode: "existing", binaryPath: binary, homePath: home },
                  environment: [
                    { name: "CUSTOM_INSTANCE_ENV", value: "instance-value", sensitive: false },
                  ],
                },
              },
            },
          }),
        ),
      );
      expect(result.kind).toBe("configured");
      if (result.kind !== "configured") return;
      expect(result.servers).toMatchObject([
        { name: "linear", transport: "http", origin: "https://linear.test", status: "unknown" },
      ]);
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("reports a failing inventory command without its output", () => {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-workflow-mcp-codex-fail-",
      });
      const binary = writeFakeCli({
        directory: path.join(root, "bin"),
        name: "codex",
        source: ['process.stderr.write("SUPER_SECRET failure text");', "process.exit(7);"].join(
          "\n",
        ),
      });

      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-work"),
        driverKind: codex,
        label: "Work Codex",
        workspaceRoot: root,
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("codex-work")]: {
                  driver: codex,
                  config: { setupMode: "existing", binaryPath: binary },
                },
              },
            },
          }),
        ),
      );
      expect(result).toEqual({
        kind: "error",
        reason: "The provider's inventory command exited with code 7.",
      });
      expect(JSON.stringify(result)).not.toContain("SUPER_SECRET");
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("stops reading an oversized inventory result instead of buffering it", () => {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-workflow-mcp-codex-big-",
      });
      const binary = writeFakeCli({
        directory: path.join(root, "bin"),
        name: "codex",
        source: [
          'process.stdout.write("[" + "x".repeat(3 * 1024 * 1024));',
          'process.stdout.write("]");',
        ].join("\n"),
      });

      const result = yield* discover({
        instanceId: ProviderInstanceId.make("codex-work"),
        driverKind: codex,
        label: "Work Codex",
        workspaceRoot: root,
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("codex-work")]: {
                  driver: codex,
                  config: { setupMode: "existing", binaryPath: binary },
                },
              },
            },
          }),
        ),
      );
      // Truncated output cannot decode, so the oversized answer never reaches the picker.
      expect(result).toEqual({
        kind: "error",
        reason: "Codex returned an unreadable MCP configuration list.",
      });
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("honours an explicit OpenCode config path in the instance environment", () => {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-workflow-mcp-opencode-env-",
      });
      const workspace = path.join(root, "work");
      const explicit = path.join(root, "explicit.json");
      yield* fileSystem.makeDirectory(workspace, { recursive: true });
      yield* fileSystem.writeFileString(
        explicit,
        JSON.stringify({ mcp: { explicit: { type: "remote", url: "https://explicit.test/mcp" } } }),
      );

      const result = yield* discover({
        instanceId: ProviderInstanceId.make("opencode-work"),
        driverKind: opencode,
        label: "OpenCode Work",
        workspaceRoot: workspace,
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("opencode-work")]: {
                  driver: opencode,
                  environment: [{ name: "OPENCODE_CONFIG", value: explicit, sensitive: false }],
                },
              },
            },
          }),
        ),
      );
      expect(result.kind).toBe("configured");
      if (result.kind !== "configured") return;
      expect(result.servers.map((server) => server.name)).toContain("explicit");
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("does not read the machine-wide OpenCode config for a custom instance", () => {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-workflow-mcp-opencode-custom-",
      });
      const workspace = path.join(root, "work");
      const globalConfig = path.join(root, ".config", "opencode", "opencode.json");
      yield* fileSystem.makeDirectory(workspace, { recursive: true });
      yield* fileSystem.makeDirectory(path.dirname(globalConfig), { recursive: true });
      yield* fileSystem.writeFileString(
        globalConfig,
        JSON.stringify({ mcp: { global: { type: "remote", url: "https://global.test/mcp" } } }),
      );

      const result = yield* discover({
        instanceId: ProviderInstanceId.make("opencode-work"),
        driverKind: opencode,
        label: "OpenCode Work",
        workspaceRoot: workspace,
      }).pipe(
        Effect.provide(
          layerWith({
            settings: {
              providerInstances: {
                [ProviderInstanceId.make("opencode-work")]: { driver: opencode },
              },
            },
          }),
        ),
        Effect.provideService(HostProcess.HomeDirectory, root),
        Effect.provideService(HostProcess.Environment, {}),
      );
      expect(result).toMatchObject({ kind: "configured", servers: [] });
    }).pipe(Effect.provide(NodeServices.layer));
  });
});
