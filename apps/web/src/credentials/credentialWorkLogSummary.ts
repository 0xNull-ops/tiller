import type { CredentialHistoryEvent, OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type ToolItem = Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>;
const stringField = (input: unknown, field: string): string | undefined => {
  if (typeof input !== "object" || input === null || !(field in input)) return undefined;
  const value: unknown = Reflect.get(input, field);
  return typeof value === "string" ? value : undefined;
};
const exitCode = (output: unknown): number | null => {
  if (typeof output !== "object" || output === null || !("exitCode" in output)) return null;
  return typeof output.exitCode === "number" && Number.isInteger(output.exitCode)
    ? output.exitCode
    : null;
};

/** Tool inputs and output bodies can contain arbitrary text; only these fields may be rendered. */
export function credentialWorkLogSummary(
  item: Pick<ToolItem, "toolName" | "input" | "output" | "threadId" | "startedAt" | "completedAt">,
  history: ReadonlyArray<CredentialHistoryEvent>,
) {
  const name =
    stringField(item.input, "credential") ??
    stringField(item.input, "name") ??
    stringField(item.input, "templateId") ??
    "credentials";
  const start = item.startedAt ? DateTime.toEpochMillis(item.startedAt) : null;
  const end = item.completedAt ? DateTime.toEpochMillis(item.completedAt) : null;
  const event = history.find(
    (candidate) =>
      candidate.type === "used" &&
      candidate.use?.threadId === item.threadId &&
      (candidate.credentialId === name || candidate.credentialName === name) &&
      start !== null &&
      end !== null &&
      Date.parse(candidate.use.startedAt ?? candidate.at) >= start &&
      Date.parse(candidate.at) <= end,
  );
  return {
    name: event?.credentialName ?? name,
    action: item.toolName?.endsWith("credential_list")
      ? "Listed credentials"
      : item.toolName?.endsWith("credential_request")
        ? "Asked for"
        : // An unfinished exec is usually waiting on the user's approval, not running.
          item.completedAt === undefined || item.completedAt === null
          ? "Waiting to use"
          : "Used",
    commandPreview: event?.use?.commandPreview,
    exitCode: event?.use?.exitCode ?? exitCode(item.output),
  };
}
