import { skillsShAuditDetails, skillsShAuditLabel } from "@t3tools/contracts";
import { Badge } from "../../components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";

export function AuditBadge({
  audit,
  loaded,
  onLoad,
}: {
  readonly audit: unknown;
  readonly loaded: boolean;
  readonly onLoad?: (() => void) | undefined;
}) {
  const label = loaded ? skillsShAuditLabel(audit) : "Preview for audit";
  return (
    <Tooltip>
      <TooltipTrigger
        onMouseEnter={onLoad}
        onFocus={onLoad}
        render={<button type="button" aria-label={label} />}
      >
        <Badge variant={label === "Warnings" ? "warning" : "outline"}>{label}</Badge>
      </TooltipTrigger>
      <TooltipPopup>
        {loaded ? (
          <div className="max-h-64 space-y-2 overflow-auto">
            {skillsShAuditDetails(audit).map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>
        ) : (
          "Hover or focus to load this skill's audit. Preview shows its instructions, files and install options."
        )}
      </TooltipPopup>
    </Tooltip>
  );
}
