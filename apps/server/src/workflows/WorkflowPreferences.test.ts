import { ProjectId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as WorkflowPreferences from "./WorkflowPreferences.ts";
import { assertSubagentModelCap } from "./workflowSubagentModelCap.ts";

const serviceLayer = (stateDir: string) =>
  WorkflowPreferences.layer.pipe(
    Layer.provide(
      Layer.succeed(ServerConfig.ServerConfig, {
        stateDir,
      } as ServerConfig.ServerConfig["Service"]),
    ),
  );

it.effect("defaults when the preferences file is missing or invalid", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped();
    const preferences = yield* WorkflowPreferences.WorkflowPreferences.pipe(
      Effect.provide(serviceLayer(stateDir)),
    );
    expect(yield* preferences.read).toEqual({
      pinnedSkills: [],
      maxSubagentModels: 4,
      pinnedWorkflows: [],
      showBuiltinWorkflows: true,
      hiddenBuiltins: [],
      workflowFirstForNewThreads: false,
    });

    const filePath = path.join(stateDir, "workflows", "preferences.json");
    yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fileSystem.writeFileString(
      filePath,
      JSON.stringify({ pinnedSkills: ["review"], maxSubagentModels: 8 }),
    );
    expect(yield* preferences.read).toMatchObject({
      pinnedSkills: ["review"],
      maxSubagentModels: 8,
      pinnedWorkflows: [],
      showBuiltinWorkflows: true,
      hiddenBuiltins: [],
    });
    yield* fileSystem.writeFileString(filePath, "{ broken json");
    expect(yield* preferences.read).toEqual({
      pinnedSkills: [],
      maxSubagentModels: 4,
      pinnedWorkflows: [],
      showBuiltinWorkflows: true,
      hiddenBuiltins: [],
      workflowFirstForNewThreads: false,
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("persists the new-thread default without losing existing workflow preferences", () =>
  Effect.gen(function* () {
    const stateDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
    const preferences = yield* WorkflowPreferences.WorkflowPreferences.pipe(
      Effect.provide(serviceLayer(stateDir)),
    );
    yield* preferences.setPinned("review", true);
    yield* preferences.setWorkflowFirstForNewThreads(true);
    expect(yield* preferences.read).toEqual({
      pinnedSkills: ["review"],
      maxSubagentModels: 4,
      pinnedWorkflows: [],
      showBuiltinWorkflows: true,
      hiddenBuiltins: [],
      workflowFirstForNewThreads: true,
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("pins and unpins names case-insensitively without duplicates", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped();
    const preferences = yield* WorkflowPreferences.WorkflowPreferences.pipe(
      Effect.provide(serviceLayer(stateDir)),
    );
    yield* preferences.setPinned("Frontend-Design", true);
    yield* preferences.setPinned("frontend-design", true);
    expect((yield* preferences.read).pinnedSkills).toEqual(["frontend-design"]);
    yield* preferences.setPinned("FRONTEND-DESIGN", false);
    expect((yield* preferences.read).pinnedSkills).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("preserves concurrent pin changes", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped();
    const preferences = yield* WorkflowPreferences.WorkflowPreferences.pipe(
      Effect.provide(serviceLayer(stateDir)),
    );
    yield* Effect.all(
      [preferences.setPinned("frontend-design", true), preferences.setPinned("review", true)],
      { concurrency: "unbounded" },
    );
    expect((yield* preferences.read).pinnedSkills).toEqual(["frontend-design", "review"]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it("marks a project or global skill pinned by a case-insensitive server pin", () => {
  const skills = [
    {
      name: "project-skill",
      description: "",
      path: "/project",
      scope: "project" as const,
      requires: [],
    },
    {
      name: "Global-Skill",
      description: "",
      path: "/global",
      scope: "global" as const,
      requires: [],
    },
  ];
  expect(WorkflowPreferences.markPinnedSkills(skills, ["GLOBAL-SKILL"])).toMatchObject([
    { name: "project-skill" },
    { name: "Global-Skill", pinned: true },
  ]);
});

it.effect("rejects subagent model lists over the configured cap with the settings path", () =>
  Effect.gen(function* () {
    yield* assertSubagentModelCap(4, 4);
    const error = yield* Effect.flip(assertSubagentModelCap(5, 4));
    expect(error.message).toBe(
      "This workflow can have up to 4 subagent models (Settings → General).",
    );
  }),
);

it.effect("persists workflow pins per project and unpins without losing gallery preferences", () =>
  Effect.gen(function* () {
    const stateDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
    const preferences = yield* WorkflowPreferences.WorkflowPreferences.pipe(
      Effect.provide(serviceLayer(stateDir)),
    );
    const first = { projectId: ProjectId.make("first"), workflow: "launch" };
    const second = { projectId: ProjectId.make("second"), workflow: "launch" };
    yield* preferences.setGallery({ showBuiltinWorkflows: false, hiddenBuiltins: ["example"] });
    yield* Effect.all(
      [preferences.setWorkflowPinned(first, true), preferences.setWorkflowPinned(second, true)],
      { concurrency: "unbounded" },
    );
    yield* preferences.setWorkflowPinned(first, true);
    const reloaded = yield* WorkflowPreferences.WorkflowPreferences.pipe(
      Effect.provide(serviceLayer(stateDir)),
    );
    expect((yield* reloaded.read).pinnedWorkflows).toEqual([second, first]);
    yield* reloaded.setWorkflowPinned(first, false);
    expect(yield* preferences.read).toMatchObject({
      pinnedWorkflows: [second],
      showBuiltinWorkflows: false,
      hiddenBuiltins: ["example"],
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);
