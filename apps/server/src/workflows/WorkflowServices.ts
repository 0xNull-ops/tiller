import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as CredentialServices from "../credentials/CredentialServices.ts";
import * as SkillCatalog from "./SkillCatalog.ts";
import * as WorkflowRunner from "./WorkflowRunner.ts";
import * as WorkflowSchedules from "./WorkflowSchedules.ts";
import * as WorkflowStore from "./WorkflowStore.ts";
import * as WorkflowOutputPreviews from "./WorkflowOutputPreviews.ts";
import * as WorkflowUrlCapture from "./WorkflowUrlCapture.ts";
import * as WorkflowFirst from "./WorkflowFirst.ts"; // fork(workflow-first)
import * as WorkflowPreferences from "./WorkflowPreferences.ts"; // fork(workflow-first)

// Every consumer must share this one layer value: the runner owns the environment snapshot and change stream.
// The schedules service shares the same file-backed WorkflowStore as the runner (one instance via the
// shared layer value), but keeps its own requirement for the upstream scheduled-task and thread services.
export const layer = WorkflowRunner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(WorkflowStore.layer, SkillCatalog.layer)),
  Layer.provide(CredentialServices.layer),
  Layer.provide(
    Layer.mergeAll(
      WorkflowSchedules.layer.pipe(Layer.provideMerge(WorkflowStore.layer)),
      ProcessRunner.layer,
      WorkflowOutputPreviews.layer.pipe(Layer.provide(WorkflowUrlCapture.layer)),
    ),
  ),
  Layer.provideMerge(Layer.merge(WorkflowFirst.layer, WorkflowPreferences.layer)),
);
