import { useId, useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { pinValidationError } from "./credentialDraft";

function DialogError({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <p role="alert" className="text-sm text-destructive-foreground">
      {message}
    </p>
  );
}

export function CredentialPinSetupDialog({
  open,
  busy,
  error,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (pin: string) => Promise<boolean>;
}) {
  const formId = useId();
  const pinId = useId();
  const confirmId = useId();
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setPin("");
    setConfirmation("");
    setLocalError(null);
  };

  const changeOpen = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = () => {
    const invalid = pinValidationError(pin, confirmation);
    if (invalid !== null) {
      setLocalError(invalid);
      return;
    }
    setLocalError(null);
    void onSubmit(pin).then((ok) => {
      if (ok) reset();
      else {
        setPin("");
        setConfirmation("");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Set a credential PIN</DialogTitle>
          <DialogDescription>
            The PIN unlocks the vault for five minutes on this device. Use at least four digits or a
            passphrase of six or more characters.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={pinId}>PIN</Label>
              <Input
                id={pinId}
                type="password"
                autoComplete="new-password"
                autoFocus
                value={pin}
                onChange={(event) => setPin(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={confirmId}>Confirm PIN</Label>
              <Input
                id={confirmId}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <DialogError message={localError ?? error} />
          </form>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Setting PIN…" : "Set PIN"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function CredentialPinChangeDialog({
  open,
  busy,
  error,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: { currentPin: string; newPin: string }) => Promise<boolean>;
}) {
  const formId = useId();
  const currentId = useId();
  const pinId = useId();
  const confirmId = useId();
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setCurrentPin("");
    setPin("");
    setConfirmation("");
    setLocalError(null);
  };

  const changeOpen = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = () => {
    if (currentPin === "") {
      setLocalError("Enter your current PIN.");
      return;
    }
    const invalid = pinValidationError(pin, confirmation);
    if (invalid !== null) {
      setLocalError(invalid);
      return;
    }
    setLocalError(null);
    void onSubmit({ currentPin, newPin: pin }).then((ok) => {
      if (ok) reset();
      else {
        setCurrentPin("");
        setPin("");
        setConfirmation("");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Change credential PIN</DialogTitle>
          <DialogDescription>
            Every device using the old PIN will need the new one. Devices that unlock with the
            system prompt keep working on this machine.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={currentId}>Current PIN</Label>
              <Input
                id={currentId}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={currentPin}
                onChange={(event) => setCurrentPin(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={pinId}>New PIN</Label>
              <Input
                id={pinId}
                type="password"
                autoComplete="new-password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={confirmId}>Confirm new PIN</Label>
              <Input
                id={confirmId}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <DialogError message={localError ?? error} />
          </form>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Saving…" : "Save new PIN"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Turning system unlock on asks for the PIN once; the server verifies it before it is stored. */
export function CredentialOsUnlockEnableDialog({
  open,
  busy,
  error,
  label,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly label: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (pin: string) => Promise<boolean>;
}) {
  const formId = useId();
  const pinId = useId();
  const [pin, setPin] = useState("");

  const changeOpen = (next: boolean) => {
    if (!next) setPin("");
    onOpenChange(next);
  };

  const submit = () => {
    if (pin === "") return;
    void onSubmit(pin).then(() => setPin(""));
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Turn on {label} unlock</DialogTitle>
          <DialogDescription>
            Enter your credential PIN once. T3 checks it with the server, then keeps it in this
            computer's keychain so {label} can unlock the vault for you next time.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={pinId}>PIN</Label>
              <Input
                id={pinId}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={pin}
                onChange={(event) => setPin(event.target.value)}
              />
            </div>
            <DialogError message={error} />
          </form>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy || pin === ""}>
            {busy ? "Saving…" : `Turn on ${label}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function CredentialUnlockDialog({
  open,
  busy,
  error,
  onOpenChange,
  onSubmit,
  osUnlockLabel = null,
  osUnlockBusy = false,
  osUnlockDisabled = false,
  onOsUnlock = null,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (pin: string) => Promise<boolean>;
  /** Absent in a browser, on mobile, or when the OS has no prompt to offer. */
  readonly osUnlockLabel?: string | null;
  readonly osUnlockBusy?: boolean;
  /** A lockout means the OS path would only fail again, so it stays off until the dialog reopens. */
  readonly osUnlockDisabled?: boolean;
  readonly onOsUnlock?: (() => void) | null;
}) {
  const formId = useId();
  const pinId = useId();
  const [pin, setPin] = useState("");

  const changeOpen = (next: boolean) => {
    if (!next) setPin("");
    onOpenChange(next);
  };

  const submit = () => {
    if (pin === "") return;
    void onSubmit(pin).then(() => {
      setPin("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Unlock credentials</DialogTitle>
          <DialogDescription>
            {osUnlockLabel === null
              ? "Enter your credential PIN. The vault stays unlocked for five minutes on this device."
              : `Use ${osUnlockLabel}, or enter your PIN. The vault stays unlocked for five minutes on this device.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={pinId}>PIN</Label>
              <Input
                id={pinId}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={pin}
                onChange={(event) => setPin(event.target.value)}
              />
            </div>
            <DialogError message={error} />
          </form>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          {osUnlockLabel === null || onOsUnlock === null ? null : (
            <Button
              type="button"
              disabled={osUnlockBusy || osUnlockDisabled || busy}
              onClick={onOsUnlock}
            >
              {osUnlockBusy ? `Waiting for ${osUnlockLabel}…` : `Unlock with ${osUnlockLabel}`}
            </Button>
          )}
          <Button
            type="submit"
            form={formId}
            variant={osUnlockLabel === null ? "default" : "outline"}
            disabled={busy || pin === ""}
          >
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
