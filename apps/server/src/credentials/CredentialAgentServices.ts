import * as Layer from "effect/Layer";
import * as ProcessRunner from "../processRunner.ts";
import * as WorkflowServices from "../workflows/WorkflowServices.ts";
import * as CredentialCaller from "./CredentialCaller.ts";
import * as CredentialServices from "./CredentialServices.ts";
import * as CredentialUse from "./CredentialUse.ts";

export const layer = CredentialUse.layer.pipe(
  Layer.provide(CredentialCaller.layer.pipe(Layer.provideMerge(WorkflowServices.layer))),
  Layer.provide(ProcessRunner.layer),
  Layer.provide(CredentialServices.layer),
);
