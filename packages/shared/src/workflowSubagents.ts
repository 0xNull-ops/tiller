/**
 * Resolves a workflow's subagent model hints against one environment's providers. The server
 * pins the result when a run starts and the clients preview it live, so both read this file
 * instead of growing their own copy of the rule.
 */
import type {
  ServerProvider,
  ServerProviderModel,
  WorkflowSubagentMissingReason,
  WorkflowSubagentModel,
  WorkflowSubagentsSnapshot,
  WorkflowUsableSubagentModel,
} from "@t3tools/contracts";

export function workflowSubagentMissingReason(reason: string, providerName?: string): string {
  switch (reason) {
    case "signed-out":
      return "not signed in";
    case "not-installed":
      return "not installed";
    case "disabled":
      return "disabled";
    case "unavailable":
      return "unavailable";
    case "model-not-offered":
      return providerName ? `not offered by ${providerName}` : "not offered";
    default:
      return "no such provider";
  }
}

type HintCheck =
  | { readonly entry: WorkflowUsableSubagentModel }
  | { readonly reason: WorkflowSubagentMissingReason };

const offeredModel = (provider: ServerProvider, model: string): ServerProviderModel | undefined =>
  provider.models.find(
    (candidate) => candidate.slug === model || candidate.aliases?.includes(model) === true,
  );

/**
 * The reason names the first thing the user has to fix, so `unavailable` comes first: the contract
 * makes such a snapshot report itself as neither installed nor enabled, and that would otherwise
 * hide the real cause behind `not-installed`.
 */
const checkProvider = (provider: ServerProvider, model: string): HintCheck => {
  if (provider.availability === "unavailable") return { reason: "unavailable" };
  if (!provider.installed) return { reason: "not-installed" };
  if (!provider.enabled) return { reason: "disabled" };
  // `unknown` is not signed out: only an explicit unauthenticated snapshot proves it.
  if (provider.auth.status === "unauthenticated") return { reason: "signed-out" };
  const offered = offeredModel(provider, model);
  if (offered === undefined) return { reason: "model-not-offered" };
  return {
    entry: {
      driver: provider.driver,
      instanceId: provider.instanceId,
      // The canonical slug, even when the hint named an alias: that is what a subagent target takes.
      model: offered.slug,
      label: offered.shortName ?? offered.name,
    },
  };
};

/**
 * The instance the file named wins. Failing that, the first instance running the same driver does:
 * an entry folded from the legacy `model` field has no driver, and a default instance id is its
 * driver kind, so `hint.driver ?? hint.instanceId` covers both shapes.
 */
const candidatesFor = (
  hint: WorkflowSubagentModel,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> => {
  const exact = providers.filter((provider) => provider.instanceId === hint.instanceId);
  const driver = hint.driver ?? hint.instanceId;
  return [
    ...exact,
    ...providers.filter(
      (provider) => provider.instanceId !== hint.instanceId && provider.driver === driver,
    ),
  ];
};

const resolveHint = (
  hint: WorkflowSubagentModel,
  providers: ReadonlyArray<ServerProvider>,
): HintCheck => {
  let firstReason: WorkflowSubagentMissingReason | undefined;
  for (const provider of candidatesFor(hint, providers)) {
    const check = checkProvider(provider, hint.model);
    if ("entry" in check) return check;
    // The exact instance's reason is the most specific one; later siblings only fill a gap.
    firstReason ??= check.reason;
  }
  return { reason: firstReason ?? "no-instance" };
};

export function resolveSubagentModels(
  hints: ReadonlyArray<WorkflowSubagentModel>,
  providers: ReadonlyArray<ServerProvider>,
): WorkflowSubagentsSnapshot {
  const usable: Array<WorkflowUsableSubagentModel> = [];
  const missing: Array<{
    hint: WorkflowSubagentModel;
    reason: WorkflowSubagentMissingReason;
  }> = [];
  const seen = new Set<string>();
  for (const hint of hints) {
    const check = resolveHint(hint, providers);
    if (!("entry" in check)) {
      missing.push({ hint, reason: check.reason });
      continue;
    }
    // Two hints may name the same model, through an alias or two instances; the driver gets one.
    const key = `${check.entry.instanceId}\u0000${check.entry.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    usable.push(check.entry);
  }
  return { usable, missing, fallback: hints.length > 0 && usable.length === 0 };
}
