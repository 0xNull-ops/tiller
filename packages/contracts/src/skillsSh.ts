import * as Schema from "effect/Schema";

export const SkillsShScope = Schema.Literals(["global", "project"]);
export const SkillsShLocation = Schema.Struct({
  scope: Schema.optional(SkillsShScope),
  project: Schema.optional(Schema.String),
});
export const SkillsShEntry = Schema.Struct({
  name: Schema.String,
  id: Schema.String,
  source: Schema.String,
  sha: Schema.String,
  installedAt: Schema.String,
  scope: SkillsShScope,
});
export const SkillsShResult = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  skillId: Schema.String,
  name: Schema.String,
  installs: Schema.Number,
});
export const SkillsShSearch = Schema.Struct({
  skills: Schema.Array(SkillsShResult),
  count: Schema.Number,
  searchType: Schema.String,
});
export const SkillsShPreview = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  name: Schema.String,
  sha: Schema.String,
  folder: Schema.String,
  markdown: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, size: Schema.Number })),
  audit: Schema.Unknown,
  sourceUrl: Schema.String,
});
export const SkillsShInstall = Schema.Struct({
  ...SkillsShLocation.fields,
  id: Schema.String,
  sha: Schema.String,
  name: Schema.optional(Schema.String),
  replace: Schema.optional(Schema.Boolean),
});
export class SkillsShError extends Schema.TaggedError<SkillsShError>()("SkillsShError", {
  message: Schema.String,
}) {}

export function skillsShAuditLabel(audit: unknown): "Warnings" | "Audited" | "No audit" {
  const statuses: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "status" && typeof item === "string") statuses.push(item.toLowerCase());
      else visit(item, depth + 1);
    }
  };
  visit(audit, 0);
  if (statuses.some((status) => ["warn", "fail", "warning", "failed"].includes(status)))
    return "Warnings";
  return statuses.includes("pass") ? "Audited" : "No audit";
}

export function skillsShAuditDetails(audit: unknown): readonly string[] {
  const details: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.status === "string") {
      const parts = [
        "provider",
        "status",
        "riskLevel",
        "risk_level",
        "summary",
        "description",
        "analysis",
      ].flatMap((key) => (typeof record[key] === "string" ? [record[key] as string] : []));
      details.push(parts.join(": "));
    }
    for (const item of Object.values(record)) visit(item, depth + 1);
  };
  visit(audit, 0);
  return details.length
    ? [...new Set(details)]
    : [
        "No audit details are available. Review the skill instructions and source before installing.",
      ];
}
