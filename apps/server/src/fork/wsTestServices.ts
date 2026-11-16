import { SkillInstallRequests } from "./skillsSh/pending.ts";
import { SkillsShService } from "./skillsSh/SkillsShService.ts";
import * as Layer from "effect/Layer";

import * as CredentialApprovals from "../credentials/CredentialApprovals.ts";
import * as CredentialHistory from "../credentials/CredentialHistory.ts";
import * as CredentialStore from "../credentials/CredentialStore.ts";
import * as CredentialUnlock from "../credentials/CredentialUnlock.ts";
import * as WorkflowRunner from "../workflows/WorkflowRunner.ts";

export const layer = Layer.mergeAll(
  Layer.mock(SkillInstallRequests)({}),
  Layer.mock(SkillsShService)({}),
  Layer.mock(WorkflowRunner.WorkflowRunner)({}),
  Layer.mock(CredentialApprovals.CredentialApprovals)({}),
  Layer.mock(CredentialHistory.CredentialHistory)({}),
  Layer.mock(CredentialStore.CredentialStore)({}),
  Layer.mock(CredentialUnlock.CredentialUnlock)({}),
);
