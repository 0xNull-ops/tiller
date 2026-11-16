import type { AuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";

// Only the authenticated WebSocket connection supplies this, never an MCP argument.
export class CredentialPolicySession extends Context.Reference<AuthSessionId | undefined>(
  "t3/credentials/CredentialPolicySession",
  { defaultValue: (): AuthSessionId | undefined => undefined },
) {}
