import * as SkillsShRpc from "./skillsSh/rpc.ts";
import * as Layer from "effect/Layer";
import type { AuthSessionId } from "@t3tools/contracts";
import * as CredentialPolicySession from "../credentials/CredentialPolicySession.ts";
import * as CredentialRpc from "../credentials/credentialRpc.ts";
import * as WorkflowRpc from "../workflows/workflowRpc.ts";

export const baseGroup = WorkflowRpc.baseGroup;

export const mergeInto = <A, E, R>(rpcLayer: Layer.Layer<A, E, R>, sessionId: AuthSessionId) =>
  SkillsShRpc.mergeInto(CredentialRpc.mergeInto(WorkflowRpc.mergeInto(rpcLayer), sessionId)).pipe(
    Layer.provide(Layer.succeed(CredentialPolicySession.CredentialPolicySession, sessionId)),
  );
