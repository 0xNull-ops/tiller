import { Link } from "@tanstack/react-router";
import type { Credential, CredentialId, EnvironmentId } from "@t3tools/contracts";
import type { RefObject } from "react";

import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../components/ui/sheet";
import { CredentialsEnvironmentPanel } from "../credentials/CredentialsEnvironmentPanel";

export function WorkflowCredentialsSheet({
  environmentId,
  open,
  onOpenChange,
  returnFocus,
  presetTemplateId,
  focusCredentialId,
  onCredentialCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly returnFocus?: RefObject<HTMLButtonElement | null> | undefined;
  /** Opens the add form on this type, then hands the saved credential to `onCredentialCreated`. */
  readonly presetTemplateId?: string | null;
  /** Opens an existing credential, for a card's "Fix" action. */
  readonly focusCredentialId?: CredentialId | null;
  readonly onCredentialCreated?: (credential: Credential) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right" {...(returnFocus ? { finalFocus: returnFocus } : {})}>
        <SheetHeader>
          <SheetTitle>Workflow credentials</SheetTitle>
          <SheetDescription>Manage credentials on this workflow's environment.</SheetDescription>
          <Link
            to="/settings/credentials"
            className="text-sm text-primary underline underline-offset-2"
          >
            Open in Settings
          </Link>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {open ? (
            <CredentialsEnvironmentPanel
              key={`${environmentId}:${presetTemplateId ?? ""}:${focusCredentialId ?? ""}`}
              environmentId={environmentId}
              presetTemplateId={presetTemplateId ?? null}
              focusCredentialId={focusCredentialId ?? null}
              {...(onCredentialCreated ? { onCredentialCreated } : {})}
            />
          ) : null}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
