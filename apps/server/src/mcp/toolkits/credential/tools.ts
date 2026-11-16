import {
  CredentialAgentListing,
  CredentialExecInput,
  CredentialExecResult,
  CredentialFileInput,
  CredentialFileResult,
  CredentialRequestInput,
  CredentialRequestResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as CredentialUse from "../../../credentials/CredentialUse.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    ThreadManagementService.ThreadManagementService,
    CredentialUse.CredentialUse,
    McpInvocationContext.McpInvocationContext,
  ],
};
const workflowStepHint =
  "Inside a workflow step, pass that step's runId and stepId so the approval and the recorded use belong to the step on the canvas; the server ignores a hint it cannot verify.";
const safety =
  "Credential values are never returned to the agent. Command output is redacted. User approval may be needed; wait for the tool to finish. Use env-var references, never paste a value into a command.";
export const CredentialToolkit = Toolkit.make(
  Tool.make("credential_list", {
    ...shared,
    description: `List credential metadata and env-var names usable from this thread's project. No values. Each entry carries the id, name and templateId, which is what a workflow step's credential attachment needs: { kind: "credential", templateId, credentialId }. ${safety}`,
    parameters: Tool.EmptyParams,
    success: CredentialAgentListing,
  }).annotate(Tool.Readonly, true),
  Tool.make("credential_exec", {
    ...shared,
    description: `Run a command with one credential selected by id or exact name. Fields enter the command's environment; secretFile fields become private temporary files with their paths in env vars. Files are removed when the command finishes. ${workflowStepHint} ${safety}`,
    parameters: CredentialExecInput,
    success: CredentialExecResult,
  }),
  Tool.make("credential_file", {
    ...shared,
    description: `Materialize secretFile fields for the current workflow run. Returns file paths and plain fields, never secret values. Files expire when the run ends or after one hour. Secret text fields are only usable through credential_exec. ${workflowStepHint} ${safety}`,
    parameters: CredentialFileInput,
    success: CredentialFileResult,
  }),
  Tool.make("credential_request", {
    ...shared,
    description: `Ask the user to add a credential privately. Returns its id after they save it, or declined/timed-out. Never ask for a value in chat. ${safety}`,
    parameters: CredentialRequestInput,
    success: CredentialRequestResult,
  }),
);
