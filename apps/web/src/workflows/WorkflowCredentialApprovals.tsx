import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, WorkflowDefinition } from "@t3tools/contracts";
import { RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { useAtomCommand } from "../state/use-atom-command";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../components/ui/select";
import { settleCredentialCommand, useCredentialGate } from "../credentials/useCredentialGate";
import { WORKFLOW_SELECT_POPUP_PROPS } from "./workflowSelect";
import { editWorkflow } from "./workflowState";

type ApprovalMode = NonNullable<WorkflowDefinition["credentialApprovals"]>;

const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  ask: "Ask every time",
  "once-per-run": "Once per run",
  "pre-approved": "Pre-approved",
};

/**
 * Writes the workflow's credential-approval knob. Pre-approved needs an unlocked vault, so the
 * same gate, dialog and refusal handling serve the editor, the credentials tab and schedules.
 */
function useCredentialApprovalsSetting(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
}) {
  const gate = useCredentialGate(input.environmentId);
  const canEdit = useAtomValue(editWorkflow.permissionAtom(input.environmentId));
  const edit = useAtomCommand(editWorkflow, { reportFailure: false });
  const set = (next: ApprovalMode) =>
    gate.run(async () => {
      const result = await settleCredentialCommand(() =>
        edit({
          environmentId: input.environmentId,
          input: {
            _tag: "meta",
            projectId: input.projectId,
            workflow: input.workflow,
            credentialApprovals: next,
          },
        }),
      );
      // Workflow edits expose the authoritative unlock refusal as a validation problem.
      return !result.ok &&
        result.failure.kind === "error" &&
        result.failure.message.includes(
          "Unlock the credential vault to pre-approve workflow credentials.",
        )
        ? { ok: false, failure: { kind: "unlock-required" } }
        : result;
    });
  return { set, canEdit, busy: gate.busy, error: gate.error, dialog: gate.dialog };
}

export function WorkflowCredentialApprovals({
  environmentId,
  projectId,
  workflow,
  value,
  disabled,
  appearance = "field",
  helpText = true,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
  readonly value: WorkflowDefinition["credentialApprovals"];
  readonly disabled: boolean;
  /** field: the editor's labeled row. inline: a quiet control for a footer. */
  readonly appearance?: "field" | "inline";
  readonly helpText?: boolean;
}) {
  const setting = useCredentialApprovalsSetting({ environmentId, projectId, workflow });
  const current: ApprovalMode = value ?? "once-per-run";
  return (
    <div className="space-y-1.5">
      <Select
        value={current}
        disabled={disabled || !setting.canEdit || setting.busy}
        onValueChange={(next) => {
          if (next !== "ask" && next !== "once-per-run" && next !== "pre-approved") return;
          void setting.set(next);
        }}
      >
        <SelectTrigger
          size="xs"
          {...(appearance === "inline" ? { variant: "ghost" as const } : {})}
          aria-label="Credential approvals"
        >
          <SelectValue>
            {appearance === "inline"
              ? `Approvals: ${APPROVAL_LABELS[current].toLowerCase()}`
              : current === "once-per-run"
                ? "Once per run (default)"
                : APPROVAL_LABELS[current]}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup {...WORKFLOW_SELECT_POPUP_PROPS}>
          <SelectItem value="ask">Ask every time</SelectItem>
          <SelectItem value="once-per-run">Once per run (default)</SelectItem>
          <SelectItem value="pre-approved">Pre-approved</SelectItem>
        </SelectPopup>
      </Select>
      {helpText ? (
        <p className="text-2xs text-muted-foreground">
          Pre-approved is needed for schedules. It covers the credentials attached now; changing it
          or re-approving asks you to unlock.
        </p>
      ) : null}
      {/* Approvals name the exact credentials, so a credential attached later needs this again. */}
      {current === "pre-approved" && !disabled ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={!setting.canEdit || setting.busy}
          onClick={() => void setting.set("pre-approved")}
        >
          <RefreshCwIcon /> Re-approve attached credentials
        </Button>
      ) : null}
      {setting.error ? (
        <p role="alert" className="text-xs text-destructive">
          {setting.error}
        </p>
      ) : null}
      {setting.dialog}
    </div>
  );
}

/** The one-click form a schedule warning offers, going through the same unlock gate. */
export function PreApproveCredentialsButton({
  environmentId,
  projectId,
  workflow,
  preApproved,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflow: string;
  /** Already pre-approved: the action re-approves the credentials attached since then. */
  readonly preApproved?: boolean;
}) {
  const setting = useCredentialApprovalsSetting({ environmentId, projectId, workflow });
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        disabled={!setting.canEdit || setting.busy}
        onClick={() => void setting.set("pre-approved")}
      >
        {preApproved ? <RefreshCwIcon /> : <ShieldCheckIcon />}{" "}
        {preApproved ? "Re-approve credentials" : "Switch to Pre-approved"}
      </Button>
      {setting.error ? (
        <p role="alert" className="text-xs text-destructive">
          {setting.error}
        </p>
      ) : null}
      {setting.dialog}
    </>
  );
}
