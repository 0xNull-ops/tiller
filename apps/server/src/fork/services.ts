import * as PendingSkills from "./skillsSh/pending.ts";
import * as SkillsSh from "./skillsSh/SkillsShService.ts";
import * as Layer from "effect/Layer";

import * as CredentialServices from "../credentials/CredentialServices.ts";
import * as WorkflowServices from "../workflows/WorkflowServices.ts";

export const runtimeLayer = SkillsSh.layer.pipe(Layer.provideMerge(PendingSkills.layer));

export const routesLayer = Layer.mergeAll(WorkflowServices.layer, CredentialServices.layer);
