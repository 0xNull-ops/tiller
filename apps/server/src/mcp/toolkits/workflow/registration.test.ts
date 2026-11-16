import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  RunId,
  ThreadId,
  ProviderInstanceId,
  ProviderDriverKind,
  type WorkflowMcpInventorySnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer, Tool } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import {
  inventoryProjectId,
  inventoryRunnerLayer,
  inventoryThreadId,
  oversized,
  oversizedInventoryLayer,
} from "../../../workflows/WorkflowMcpInventory.test-fixtures.ts";
import * as WorkflowRunner from "../../../workflows/WorkflowRunner.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Handlers from "./handlers.ts";
import { WorkflowToolkit } from "./tools.ts";

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("workflow-test"),
  requestNamespace: "workflow-test",
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  thread: undefined,
  client: { sessionId: "workflow-test", label: "test", access: "full-access" },
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "workflow-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "workflow-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const registered = McpHttpServer.toolkitRegistration(WorkflowToolkit, Handlers.layer).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(Layer.mock(ThreadManagementService.ThreadManagementService)({})),
);

/** A thread the MCP caller is running in, so `loadCaller` resolves its project like production. */
const inThread = (projectId: ProjectId) =>
  Layer.mock(ThreadManagementService.ThreadManagementService)({
    getThreadShell: (threadId) =>
      Effect.succeed({
        id: threadId,
        projectId,
        deletedAt: null,
        archivedAt: null,
        runtimeMode: "default",
        interactionMode: "default",
        // The calling provider still owns the live run, as an agent mid-turn is.
        providerInstanceId: ProviderInstanceId.make("codex"),
        activeRunId: RunId.make("active-run"),
      } as never),
  });

it.effect("registers every workflow tool with the MCP server", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    expect(server.tools.map(({ tool }) => tool.name).toSorted()).toEqual(
      Object.keys(WorkflowToolkit.tools).toSorted(),
    );
  }).pipe(
    Effect.provide(registered.pipe(Layer.provide(Layer.mock(WorkflowRunner.WorkflowRunner)({})))),
  ),
);

it("advertises all saved workflow tools with object-root inputs and a driving guide", () => {
  expect(Object.keys(WorkflowToolkit.tools).toSorted()).toEqual(
    [
      "workflow_list",
      "workflow_tags_set",
      "workflow_pin_set",
      "workflow_keep",
      "workflow_draft_from_thread",
      "workflow_first_read",
      "workflow_first_set",
      "workflow_import",
      "workflow_save",
      "workflow_step_put",
      "workflow_update",
      "workflow_layout_set",
      "workflow_step_remove",
      "workflow_skill_save",
      "workflow_skill_pin",
      "workflow_skill_list",
      "workflow_skill_read",
      "workflow_skill_copy",
      "workflow_preflight",
      "workflow_mcp_list",
      "workflow_probe",
      "workflow_run",
      "workflow_status",
      "workflow_step_start",
      "workflow_step_done",
      "workflow_step_rerun",
      "workflow_step_checks_run",
      "workflow_step_skip",
      "workflow_step_move",
      "workflow_delete",
      "workflow_templates_list", // fork(builtins)
      "workflow_template_use", // fork(builtins)
      "workflow_schedule_list",
      "workflow_schedule_add",
      "workflow_schedule_put",
      "workflow_trigger_put",
      "workflow_trigger_delete",
      "workflow_loop_put",
      "workflow_loop_delete",
      "workflow_schedule_remove",
      "workflow_schedule_set_enabled",
      "workflow_stop",
      "workflow_approve",
      "workflow_resume",
    ].toSorted(),
  );
  for (const [name, tool] of Object.entries(WorkflowToolkit.tools)) {
    expect(Tool.getJsonSchema(tool)).toMatchObject({ type: "object" });
    if (!name.startsWith("workflow_first_")) {
      expect(Tool.getDescription(tool)).toContain(".t3/workflows");
    }
  }
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_run)).toContain("You drive the run");
  for (const tool of [WorkflowToolkit.tools.workflow_run, WorkflowToolkit.tools.workflow_status]) {
    expect(Tool.getDescription(tool)).toContain("runAs");
    expect(Tool.getDescription(tool)).toContain("prefer-subagent");
    expect(Tool.getDescription(tool)).toContain("workflow_step_start on the parent run");
    expect(Tool.getDescription(tool)).toContain("parent.runId");
  }
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_approve)).toContain(
    "Only call this after the user has approved it in this conversation",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_skill_save)).toContain(
    "only do that when the user asked",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_step_rerun)).toContain(
    "Start a NEW run",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_step_put)).toContain("Check card");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_step_put)).toContain("Approval card");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_step_put)).toContain(
    'kind: "credential"',
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_step_put)).toContain("credential_list");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_preflight)).toContain(
    "Credential observations",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_save)).toContain("notes");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_update)).toContain("notePut");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_update)).toContain("never execute");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_status)).toContain("needsUser");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_status)).toContain(
    "definition version",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_run)).toContain(
    "a passing check never approves",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_preflight)).toContain(
    "does not run command or login probes",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_probe)).toContain(
    "not a side-effect-free read",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_probe)).toContain("never signs in");
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_mcp_list)).toContain(
    "lists server names only",
  );
  expect(Tool.getDescription(WorkflowToolkit.tools.workflow_mcp_list)).toContain(
    "without invoking a tool",
  );
});

it.effect("workflow_skill_pin stores a server wide pin", () => {
  const calls: Array<readonly [string, boolean]> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_skill_pin",
        arguments: { name: "frontend-design", pinned: true },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual([["frontend-design", true]]);
  }).pipe(
    Effect.provide(
      McpHttpServer.toolkitRegistration(WorkflowToolkit, Handlers.layer).pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(Layer.mock(ThreadManagementService.ThreadManagementService)({})),
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            setSkillPinned: (name, pinned) =>
              Effect.sync(() => {
                calls.push([name, pinned]);
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect(
  "defaults workflow_draft_from_thread to the calling thread and returns a plain error",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const result = yield* server
        .callTool({ name: "workflow_draft_from_thread", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, {
            ...scope,
            thread: {
              threadId: ThreadId.make("driver"),
              providerSessionId: "session",
              providerInstanceId: ProviderInstanceId.make("codex"),
            },
          }),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).toBe(true);
      const content = result.content[0];
      if (content?.type !== "text") throw new Error("Expected a text error");
      expect(JSON.parse(content.text)).toMatchObject({
        code: "invalid_request",
        message: "This thread hasn't handed any work to subagents yet.",
      });
    }).pipe(
      Effect.provide(
        McpHttpServer.toolkitRegistration(WorkflowToolkit, Handlers.layer).pipe(
          Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
          Layer.provide(
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              getThreadShell: () =>
                Effect.succeed({
                  projectId: ProjectId.make("project-1"),
                  deletedAt: null,
                } as never),
              getThreadRecords: (threadId) => {
                expect(threadId).toBe("driver");
                return Effect.succeed({
                  thread: {
                    id: threadId,
                    projectId: ProjectId.make("project-1"),
                    title: "Empty",
                    deletedAt: null,
                  },
                  subagents: [],
                  nodes: [],
                  runs: [],
                  messages: [],
                } as never);
              },
            }),
          ),
          Layer.provide(
            Layer.mock(WorkflowRunner.WorkflowRunner)({
              workflowSlugs: () => Effect.succeed([]),
              skillList: () => Effect.succeed([]),
            }),
          ),
        ),
      ),
    ),
);

it.effect("refuses workflow_run outside a thread before starting a run", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "workflow_run", arguments: { projectId: "project-1", workflow: "launch" } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    const content = result.content[0];
    expect(content?.type).toBe("text");
    if (content?.type === "text")
      expect(JSON.parse(content.text)).toMatchObject({
        code: "thread_credential_required",
        message: expect.stringContaining("workflow_run"),
      });
  }).pipe(
    Effect.provide(registered.pipe(Layer.provide(Layer.mock(WorkflowRunner.WorkflowRunner)({})))),
  ),
);

const modelHints = [{ instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" }];
const modelSnapshot = {
  usable: [{ ...modelHints[0]!, driver: ProviderDriverKind.make("codex"), label: "Luna" }],
  missing: [],
  fallback: false,
};

it.effect("returns ready prompts and step results through the production run schema", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "workflow_status", arguments: { runId: "wf-test" } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      runId: "wf-test",
      driverThreadId: "driver",
      subagentModels: modelHints,
      subagents: modelSnapshot,
      parent: { runId: "wf-parent", stepId: "nested" },
      ready: [
        {
          runId: "wf-test",
          stepId: "build",
          prompt: "PINNED STEP PROMPT",
          runAs: "agent-decides",
          attempts: 0,
        },
      ],
      context: {
        subagents: modelSnapshot,
        definitionVersion: 1,
        definitionRevision: "sha256:test",
        driverThreadId: "driver",
        ready: [{ stepId: "build", runAs: "agent-decides" }],
        needsUser: [],
        actions: [],
        steps: [{ stepId: "build", status: "ready", gate: false }],
      },
      steps: [{ status: "ready", attempts: 0 }],
    });
    expect(result.structuredContent).not.toHaveProperty("definition");
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            status: () =>
              Effect.succeed({
                id: "wf-test",
                parent: { runId: "wf-parent", stepId: "nested" },
                projectId: ProjectId.make("project-1"),
                workflow: "launch",
                driverThreadId: ThreadId.make("driver"),
                status: "running",
                startedAt: "2026-01-01T00:00:00.000Z",
                subagents: modelSnapshot,
                definition: {
                  subagentModels: modelHints,
                  version: 1,
                  name: "Launch",
                  steps: [{ id: "build", skill: "build" }],
                },
                skills: [],
                steps: [{ stepId: "build", status: "ready", attempts: 0, threadId: null }],
                context: {
                  subagents: modelSnapshot,
                  definitionVersion: 1,
                  definitionRevision: "sha256:test",
                  driverThreadId: ThreadId.make("driver"),
                  status: "running",
                  ready: [
                    {
                      stepId: "build",
                      title: "build",
                      skill: "build",
                      runAs: "agent-decides",
                    },
                  ],
                  needsUser: [],
                  actions: [],
                  next: ['Start "build"'],
                  notes: [],
                  steps: [
                    {
                      stepId: "build",
                      title: "build",
                      kind: "skill",
                      status: "ready",
                      attempts: 0,
                      gate: false,
                      checks: [],
                      resources: [],
                    },
                  ],
                },
                ready: [
                  {
                    runId: "wf-test",
                    stepId: "build",
                    title: "build",
                    skill: "build",
                    prompt: "PINNED STEP PROMPT",
                    runAs: "agent-decides",
                    attempts: 0,
                  },
                ],
              }),
          }),
        ),
      ),
    ),
  ),
);

it.effect("lists workflows and schedules across all projects when allProjects is true", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const listResult = yield* server
      .callTool({ name: "workflow_list", arguments: { allProjects: true } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(listResult.isError).not.toBe(true);
    expect(listResult.structuredContent).toEqual({ workflows: [], runs: [] });

    const scheduleResult = yield* server
      .callTool({ name: "workflow_schedule_list", arguments: { allProjects: true } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(scheduleResult.isError).not.toBe(true);
    expect(scheduleResult.structuredContent).toEqual({ tasks: [] });
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            preferencesRead: Effect.succeed({
              pinnedSkills: [],
              pinnedWorkflows: [{ projectId: ProjectId.make("project-1"), workflow: "kept" }],
              showBuiltinWorkflows: true,
              hiddenBuiltins: [],
              maxSubagentModels: 4,
              workflowFirstForNewThreads: false,
            }),
            list: (input) => {
              expect(input).toEqual({ projectId: undefined });
              return Effect.succeed({ workflows: [], runs: [] });
            },
            scheduleList: (input) => {
              expect(input).toEqual({ projectId: undefined, workflow: undefined });
              return Effect.succeed({ tasks: [] });
            },
          }),
        ),
      ),
    ),
  ),
);

it.effect("routes every workflow_update tag to the shared draft service methods", () => {
  const calls: string[] = [];
  const listing = (workflow: string) =>
    ({
      projectId: ProjectId.make("project-1"),
      workflow,
      definition: { version: 3 as const, name: "Launch", steps: [] },
      problem: null,
      missingSkills: [],
      skills: [],
      blockers: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      scratch: false,
      editedByThreadId: null,
    }) as never;
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const updates = [
      {
        _tag: "meta",
        workflow: "launch",
        name: "Renamed",
        brief: null,
        execution: "auto",
      },
      {
        _tag: "inputsSet",
        workflow: "launch",
        inputs: [{ id: "appName", label: "App name", kind: "text", required: true }],
      },
      { _tag: "notePut", workflow: "launch", note: { id: "remember", text: "Keep it short." } },
      { _tag: "noteRemove", workflow: "launch", noteId: "remember" },
    ];
    for (const update of updates) {
      const result = yield* server
        .callTool({
          name: "workflow_update",
          arguments: { projectId: "project-1", update },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).not.toBe(true);
    }
    expect(calls).toEqual([
      "meta:Renamed:null:auto:project-1",
      "inputsSet:1:project-1",
      "notePut:remember:Keep it short.:project-1",
      "noteRemove:remember:project-1",
    ]);
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            meta: (input) =>
              Effect.sync(() => {
                calls.push(
                  `meta:${input.name}:${input.brief}:${input.execution}:${input.projectId}`,
                );
              }).pipe(Effect.as(listing(input.slug))),
            inputsSet: (input) =>
              Effect.sync(() => {
                calls.push(`inputsSet:${input.inputs.length}:${input.projectId}`);
              }).pipe(Effect.as(listing(input.slug))),
            notePut: (input) =>
              Effect.sync(() => {
                calls.push(`notePut:${input.note.id}:${input.note.text}:${input.projectId}`);
              }).pipe(Effect.as(listing(input.slug))),
            noteRemove: (input) =>
              Effect.sync(() => {
                calls.push(`noteRemove:${input.noteId}:${input.projectId}`);
              }).pipe(Effect.as(listing(input.slug))),
          }),
        ),
      ),
    ),
  );
});

it.effect("runs workflow_probe through the same runner operation and returns readiness", () => {
  const calls: Array<unknown> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_probe",
        arguments: { projectId: "project-1", workflow: "launch", stepIds: ["build"] },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual([{ projectId: "project-1", slug: "launch", stepIds: ["build"] }]);
    expect(result.structuredContent).toMatchObject({
      blocksRun: true,
      entries: [
        {
          stepId: "build",
          attachmentId: "vercel",
          status: "missing",
          message: expect.stringContaining("The Vercel status check failed"),
        },
      ],
    });
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            probe: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return {
                  entries: [
                    {
                      stepId: "build",
                      attachmentId: "vercel",
                      kind: "service-login" as const,
                      status: "missing" as const,
                      message: "The Vercel status check failed, so it may not be signed in.",
                    },
                  ],
                  blocksRun: true,
                };
              }),
          }),
        ),
      ),
    ),
  );
});

const threadScope: McpInvocationContext.McpInvocationScope = {
  ...scope,
  thread: {
    threadId: inventoryThreadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex-work"),
  },
};

it.effect("clips oversized live MCP inventory through the real tool schema", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    for (const refresh of [true, false]) {
      const result = yield* server
        .callTool({
          name: "workflow_mcp_list",
          arguments: { projectId: inventoryProjectId, workflow: "launch", refresh },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, threadScope),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      const snapshot = result.structuredContent as WorkflowMcpInventorySnapshot;
      expect(snapshot.cached).toBe(!refresh);
      const inventoryServer = snapshot.servers[0];
      expect(inventoryServer).toMatchObject({
        name: `${oversized.slice(0, 199)}…`,
        title: `${oversized.slice(0, 199)}…`,
        description: `${oversized.slice(0, 299)}…`,
        toolsTruncated: true,
      });
      expect(inventoryServer?.tools).toHaveLength(100);
      expect(inventoryServer?.tools[0]).toMatchObject({
        title: `${oversized.slice(0, 199)}…`,
        description: `${oversized.slice(0, 299)}…`,
      });
    }
  }).pipe(
    Effect.provide(
      McpHttpServer.toolkitRegistration(WorkflowToolkit, Handlers.layer).pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(inventoryRunnerLayer),
        Layer.provide(oversizedInventoryLayer),
      ),
    ),
  ),
);

it.effect("reports an inventory defect as a structured failure, not the generic MCP error", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_mcp_list",
        arguments: { projectId: inventoryProjectId, workflow: "launch" },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected a text error");
    expect(JSON.parse(content.text)).toMatchObject({
      code: "orchestration_error",
      message: expect.stringContaining("MCP connections"),
    });
    expect(content.text).not.toContain("internal server error");
  }).pipe(
    Effect.provide(
      McpHttpServer.toolkitRegistration(WorkflowToolkit, Handlers.layer).pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
            Layer.mock(WorkflowRunner.WorkflowRunner)({
              mcpInventory: () => Effect.die(new Error("inventory encoding exploded")),
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("rejects unknown input properties with an error that names the field", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const definition = {
      version: 3,
      name: "Launch",
      steps: [{ id: "build", skill: "build" }],
    };
    const cases = [
      {
        name: "workflow_save",
        arguments: {
          projectId: inventoryProjectId,
          workflow: "launch",
          definition: {
            ...definition,
            inputs: [{ id: "site", label: "Site", kind: "url", default: "https://example.test" }],
          },
        },
      },
      {
        name: "workflow_update",
        arguments: {
          projectId: inventoryProjectId,
          update: {
            _tag: "inputsSet",
            workflow: "launch",
            inputs: [{ id: "site", label: "Site", kind: "url", default: "https://example.test" }],
          },
        },
      },
      {
        name: "workflow_step_put",
        arguments: {
          projectId: inventoryProjectId,
          workflow: "launch",
          step: { id: "build", skill: "build", default: "x" },
        },
      },
    ];
    for (const { name, arguments: args } of cases) {
      const error = yield* Effect.flip(
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, client),
          ),
      );
      expect(error).toMatchObject({ _tag: "InvalidParams" });
      if (error.code !== -32602) throw error;
      expect(error.message).toContain("default");
    }
  }).pipe(
    Effect.provide(registered.pipe(Layer.provide(Layer.mock(WorkflowRunner.WorkflowRunner)({})))),
  ),
);

it.effect("sets layout through the authorized edit path and returns the saved listing", () => {
  const positions = { build: { x: 100, y: -50 } };
  const calls: Array<unknown> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_layout_set",
        arguments: { projectId: "project-1", workflow: "launch", positions, reset: true },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      definition: { version: 3, layout: positions },
    });
    expect(calls).toEqual([
      { projectId: "project-1", slug: "launch", positions, reset: true, callerThreadId: undefined },
    ]);
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            layoutSet: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return {
                  projectId: ProjectId.make("project-1"),
                  workflow: "launch",
                  definition: {
                    version: 3 as const,
                    name: "Launch",
                    steps: [{ id: "build", skill: "build" }],
                    layout: positions,
                  },
                  problem: null,
                  missingSkills: [],
                  skills: [],
                  blockers: [],
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  scratch: false,
                  editedByThreadId: null,
                };
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect("round-trips a credential attachment through workflow_step_put", () => {
  const calls: Array<unknown> = [];
  const step = {
    id: "deploy",
    skill: "deploy",
    attachments: [
      {
        id: "gh",
        kind: "credential",
        templateId: "github",
        credentialId: "cred-1",
        optional: true,
      },
    ],
  };
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_step_put",
        arguments: { projectId: "project-1", workflow: "launch", step },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual([
      {
        projectId: "project-1",
        slug: "launch",
        step,
        after: undefined,
        callerThreadId: undefined,
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      definition: { steps: [{ id: "deploy", attachments: step.attachments }] },
      readiness: {
        entries: [
          {
            attachmentId: "gh",
            credential: { state: "matched", credentialId: "cred-1", envVars: [] },
          },
        ],
      },
    });
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            stepPut: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return {
                  projectId: ProjectId.make("project-1"),
                  workflow: "launch",
                  definition: { version: 3 as const, name: "Launch", steps: [input.step] },
                  problem: null,
                  missingSkills: [],
                  skills: [],
                  blockers: [],
                  readiness: {
                    entries: [
                      {
                        stepId: "deploy",
                        attachmentId: "gh",
                        kind: "credential" as const,
                        status: "available" as const,
                        message: "Matched automatically.",
                        credential: {
                          state: "matched" as const,
                          templateId: "github",
                          statusLabel: "Matched automatically",
                          credentialId: "cred-1" as never,
                          name: "GitHub token",
                          envVars: [],
                          candidates: [],
                          optional: true,
                        },
                      },
                    ],
                    blocksRun: false,
                  },
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  scratch: false,
                  editedByThreadId: null,
                };
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect("rejects a credential attachment that tries to carry a value", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const error = yield* Effect.flip(
      server
        .callTool({
          name: "workflow_step_put",
          arguments: {
            projectId: "project-1",
            workflow: "launch",
            step: {
              id: "deploy",
              skill: "deploy",
              attachments: [
                {
                  id: "gh",
                  kind: "credential",
                  templateId: "github",
                  credentialId: "cred-1",
                  token: "super-secret",
                },
              ],
            },
          },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          Effect.provideService(McpSchema.McpServerClient, client),
        ),
    );
    expect(error).toMatchObject({ _tag: "InvalidParams" });
    if (error.code !== -32602) throw error;
    expect(error.message).toContain("token");
  }).pipe(
    Effect.provide(registered.pipe(Layer.provide(Layer.mock(WorkflowRunner.WorkflowRunner)({})))),
  ),
);

it.effect("refuses layout writes from read-only MCP clients", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_layout_set",
        arguments: { projectId: "project-1", workflow: "launch", positions: {}, reset: true },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...scope,
          client: { sessionId: "workflow-test", label: "test", access: "read-only" },
        }),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected a text error");
    expect(JSON.parse(content.text)).toMatchObject({ code: "capability_denied" });
  }).pipe(
    Effect.provide(registered.pipe(Layer.provide(Layer.mock(WorkflowRunner.WorkflowRunner)({})))),
  ),
);

it.effect(
  "accepts workflow_update subagent models and null while rejecting unknown model fields",
  () => {
    const calls: Array<unknown> = [];
    return Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const models = [{ driver: "codex", instanceId: "codex", model: "gpt-6-luna" }];
      for (const subagentModels of [models, null]) {
        const result = yield* server
          .callTool({
            name: "workflow_update",
            arguments: {
              projectId: "project-1",
              update: { _tag: "meta", workflow: "launch", subagentModels },
            },
          })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
        expect(result.isError).not.toBe(true);
      }
      const invalid = yield* server
        .callTool({
          name: "workflow_update",
          arguments: {
            projectId: "project-1",
            update: {
              _tag: "meta",
              workflow: "launch",
              subagentModels: [{ ...models[0], effort: "high" }],
            },
          },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.flip,
        );
      expect(invalid).toMatchObject({ _tag: "InvalidParams" });
      expect(calls).toEqual([models, null]);
    }).pipe(
      Effect.provide(
        registered.pipe(
          Layer.provide(
            Layer.mock(WorkflowRunner.WorkflowRunner)({
              meta: (input) =>
                Effect.sync(() => {
                  calls.push(input.subagentModels);
                  return {
                    projectId: input.projectId,
                    workflow: input.slug,
                    definition: { version: 3, name: "Launch", steps: [] },
                    problem: null,
                    missingSkills: [],
                    skills: [],
                    blockers: [],
                    updatedAt: "2026-10-23T00:00:00.000Z",
                    scratch: false,
                    editedByThreadId: null,
                  };
                }),
            }),
          ),
        ),
      ),
    );
  },
);

const scratchListing = (
  workflow: string,
  scratch: boolean,
  definition: Record<string, unknown> = { version: 3, name: workflow, steps: [] },
) => ({
  projectId: ProjectId.make("project-1"),
  workflow,
  definition,
  scratch,
  problem: null,
  missingSkills: [],
  skills: [],
  blockers: [],
  updatedAt: "2026-10-26T00:00:00.000Z",
  editedByThreadId: null,
});

it.effect("keeps a workflow through the shared runner, idempotently", () => {
  const calls: Array<unknown> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_keep",
        arguments: { projectId: "project-1", workflow: "launch" },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual([
      { projectId: ProjectId.make("project-1"), slug: "launch", callerThreadId: undefined },
    ]);
    expect(result.structuredContent).toMatchObject({ workflow: "launch", scratch: false });
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            keep: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return scratchListing(input.slug, false) as never;
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect("refuses workflow_keep from a read-only MCP client", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "workflow_keep",
        arguments: { projectId: "project-1", workflow: "launch" },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...scope,
          client: { sessionId: "workflow-test", label: "test", access: "read-only" },
        }),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected a text error");
    expect(JSON.parse(content.text)).toMatchObject({ code: "capability_denied" });
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            keep: () => Effect.die("a read-only client must never reach the runner"),
          }),
        ),
      ),
    ),
  ),
);

it.effect("forwards includeScratch and serializes the scratch flag", () => {
  const calls: Array<unknown> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "workflow_list", arguments: { allProjects: true, includeScratch: false } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      workflows: [{ workflow: "kept", scratch: false, tags: ["web"], pinned: true }],
    });
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            preferencesRead: Effect.succeed({
              pinnedSkills: [],
              pinnedWorkflows: [{ projectId: ProjectId.make("project-1"), workflow: "kept" }],
              showBuiltinWorkflows: true,
              hiddenBuiltins: [],
              maxSubagentModels: 4,
              workflowFirstForNewThreads: false,
            }),
            list: (input) => {
              calls.push(input);
              return Effect.succeed({
                workflows: [
                  scratchListing("kept", false, {
                    version: 3,
                    name: "Kept",
                    steps: [],
                    tags: ["web"],
                  }),
                ] as never,
                runs: [],
              });
            },
          }),
        ),
      ),
    ),
  );
});

it.effect("shows scratch workflows with their flag unless the caller excludes them", () => {
  const calls: Array<unknown> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "workflow_list", arguments: { allProjects: true } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.structuredContent).toMatchObject({
      workflows: [
        {
          workflow: "from-thread",
          scratch: true,
          definition: { origin: { kind: "workflow-first", threadId: "driver" } },
        },
      ],
    });
    expect(calls).toEqual([{ projectId: undefined, includeScratch: undefined }]);
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            preferencesRead: Effect.succeed({
              pinnedSkills: [],
              pinnedWorkflows: [{ projectId: ProjectId.make("project-1"), workflow: "kept" }],
              showBuiltinWorkflows: true,
              hiddenBuiltins: [],
              maxSubagentModels: 4,
              workflowFirstForNewThreads: false,
            }),
            list: (input) => {
              calls.push(input);
              return Effect.succeed({
                workflows: [
                  scratchListing("from-thread", true, {
                    version: 3,
                    name: "From thread",
                    steps: [],
                    origin: { kind: "workflow-first", threadId: "driver" },
                  }),
                ] as never,
                runs: [],
              });
            },
          }),
        ),
      ),
    ),
  );
});

it.effect("never lets workflow_update edit scratch provenance", () => {
  const calls: Array<unknown> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const rejected = yield* server
      .callTool({
        name: "workflow_update",
        arguments: {
          projectId: "project-1",
          update: { _tag: "meta", workflow: "launch", origin: null },
        },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
        Effect.flip,
      );
    expect(rejected).toMatchObject({ _tag: "InvalidParams" });
    expect(calls).toEqual([]);
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            meta: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return scratchListing(input.slug, true) as never;
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect("resolves the thread project and preserves scratch provenance", () => {
  const saved: Array<Record<string, unknown>> = [];
  const threadScope: McpInvocationContext.McpInvocationScope = {
    ...scope,
    thread: {
      threadId: ThreadId.make("driver"),
      providerSessionId: "session",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
  };
  const definition = (origin?: { kind: "workflow-first"; threadId: string }) => ({
    version: 3,
    name: "Automatic",
    steps: [],
    ...(origin === undefined ? {} : { origin }),
  });
  const call = (body: Record<string, unknown>) =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      return yield* server
        .callTool({
          name: "workflow_save",
          arguments: { workflow: "auto", ...body },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, threadScope),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
    });
  return Effect.gen(function* () {
    expect(
      (yield* call({ definition: definition({ kind: "workflow-first", threadId: "driver" }) }))
        .isError,
    ).not.toBe(true);
    expect((yield* call({ definition: definition() })).isError).not.toBe(true);
    expect(saved.map((input) => input.projectId)).toEqual(["project-1", "project-1"]);
    expect(saved.map((input) => (input.definition as { origin?: unknown }).origin)).toEqual([
      { kind: "workflow-first", threadId: "driver" },
      undefined,
    ]);
  }).pipe(
    Effect.provide(
      McpHttpServer.toolkitRegistration(WorkflowToolkit, Handlers.layer).pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(inThread(ProjectId.make("project-1"))),
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            save: (input) =>
              Effect.sync(() => {
                saved.push(input as unknown as Record<string, unknown>);
                return { path: ".t3/workflows/auto.json", missingSkills: [] };
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect("reports a missing Workflow-first thread instead of answering off", () => {
  const calls: Array<unknown> = [];
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({ name: "workflow_first_read", arguments: {} }).pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        ...scope,
        thread: {
          threadId: ThreadId.make("driver"),
          providerSessionId: "session",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
      }),
      Effect.provideService(McpSchema.McpServerClient, client),
    );
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected a text error");
    expect(JSON.parse(content.text)).toMatchObject({ message: "Thread not found." });
    expect(calls).toEqual(["driver"]);
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            workflowFirstRead: ({ threadId }) =>
              Effect.sync(() => {
                calls.push(threadId);
                return Effect.fail(
                  new WorkflowRunner.WorkflowFirstThreadNotFoundError({ threadId }),
                );
              }).pipe(Effect.flatten),
          }),
        ),
      ),
    ),
  );
});

it.effect("returns the calling thread id with Workflow-first state, for a scratch origin", () => {
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({ name: "workflow_first_read", arguments: {} }).pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        ...scope,
        thread: {
          threadId: ThreadId.make("driver"),
          providerSessionId: "session",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
      }),
      Effect.provideService(McpSchema.McpServerClient, client),
    );
    expect(result.structuredContent).toEqual({ enabled: true, threadId: "driver" });
  }).pipe(
    Effect.provide(
      registered.pipe(
        Layer.provide(
          Layer.mock(WorkflowRunner.WorkflowRunner)({
            workflowFirstRead: () => Effect.succeed({ enabled: true } as never),
          }),
        ),
      ),
    ),
  );
});
