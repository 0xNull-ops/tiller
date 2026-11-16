import {
  type Credential,
  type CredentialGrant,
  type CredentialPendingRequest,
  type EnvironmentId,
  type CredentialCreateInput,
  type CredentialFieldId,
  type CredentialHistoryPage,
  type CredentialId,
  type CredentialRemoveSecretInput,
  type CredentialSetSecretInput,
  type CredentialUpdateInput,
  type CredentialsStatus,
  type DesktopCredentialOsUnlockStatus,
} from "@t3tools/contracts";
import { credentialTemplate } from "@t3tools/shared/credentialTemplates";
import { KeyRoundIcon, LockIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "../timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { CredentialAddPanel } from "./CredentialAddPanel";
import { CredentialBrandIcon } from "./CredentialBrandIcon";
import { CredentialDetailPanel, type CredentialHistoryView } from "./CredentialDetailPanel";
import {
  CredentialOsUnlockEnableDialog,
  CredentialPinChangeDialog,
  CredentialPinSetupDialog,
  CredentialUnlockDialog,
} from "./CredentialPinDialogs";
import type { CredentialProjectOption } from "./CredentialProjectScope";
import { credentialStatusPresentation } from "@t3tools/shared/credentialPresentation";
import {
  credentialOsUnlockMethodLabel,
  enableOsUnlock,
  refreshStoredPinAfterChange,
  unlockWithStoredPin,
  type CredentialOsUnlockClient,
} from "./credentialOsUnlock";
import { credentialFailureMessage, type CredentialActionResult } from "./credentialWriteGate";

export interface CredentialsManagerActions {
  readonly create: (input: CredentialCreateInput) => Promise<CredentialActionResult<Credential>>;
  readonly update: (input: CredentialUpdateInput) => Promise<CredentialActionResult<Credential>>;
  readonly setSecret: (
    input: CredentialSetSecretInput,
  ) => Promise<CredentialActionResult<Credential>>;
  readonly removeSecret: (
    input: CredentialRemoveSecretInput,
  ) => Promise<CredentialActionResult<Credential>>;
  readonly deleteCredential: (id: CredentialId) => Promise<CredentialActionResult<void>>;
  readonly setPin: (input: {
    readonly newPin: string;
    readonly currentPin?: string;
  }) => Promise<CredentialActionResult<CredentialsStatus>>;
  readonly unlock: (pin: string) => Promise<CredentialActionResult<CredentialsStatus>>;
  readonly lock: () => Promise<CredentialActionResult<CredentialsStatus>>;

  readonly loadHistory: (
    id: CredentialId,
    cursor?: string,
  ) => Promise<CredentialActionResult<CredentialHistoryPage>>;
}

type View =
  | { readonly kind: "list" }
  | { readonly kind: "add" }
  | {
      readonly kind: "detail";
      readonly id: CredentialId;
    };

const EMPTY_GRANTS: ReadonlyArray<CredentialGrant> = [];

const EMPTY_HISTORY: CredentialHistoryView = {
  events: [],
  loading: false,
  loadingMore: false,
  error: null,
};

const templateName = (credential: Credential): string =>
  credentialTemplate(credential.templateId)?.name ?? credential.templateId;

const matchesQuery = (credential: Credential, query: string): boolean => {
  if (query === "") return true;
  const haystack = [
    credential.name,
    templateName(credential),
    ...credential.fields.map((field) => field.envVar),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
};

function CredentialCard({
  credential,
  onOpen,
}: {
  readonly credential: Credential;
  readonly onOpen: (credential: Credential) => void;
}) {
  const template = credentialTemplate(credential.templateId);
  const status = credentialStatusPresentation(credential.status);
  return (
    <button
      type="button"
      className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-border p-3 text-left hover:bg-accent"
      onClick={() => onOpen(credential)}
    >
      <span className="flex min-w-0 items-start gap-2.5">
        <CredentialBrandIcon
          name={credential.name}
          templateIcon={template?.icon ?? null}
          iconOverride={credential.icon ?? null}
          envVars={credential.fields.map((field) => field.envVar)}
          size="sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{credential.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {templateName(credential)}
          </span>
        </span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>Updated {formatRelativeTimeLabel(credential.updatedAt)}</span>
        {credential.lastUsedAt === undefined ? (
          <span>· Never used</span>
        ) : (
          <span>· Last used {formatRelativeTimeLabel(credential.lastUsedAt)}</span>
        )}
        {credential.useCount === 0 ? null : <span>· Used {credential.useCount}×</span>}
      </span>
    </button>
  );
}

export function CredentialsManager({
  credentials,
  environmentId,
  addRequest,
  presetTemplateId = null,
  focusCredentialId = null,
  onCreated,
  historyRevision = 0,
  grants = EMPTY_GRANTS,
  grantsError = null,
  onRevokeGrant,
  status,
  projects,
  loading,
  error,
  readOnly,
  osUnlock,
  osUnlockStatus,
  onOsUnlockStatus,
  onRetry,
  actions,
}: {
  readonly environmentId?: EnvironmentId;
  readonly addRequest?: Extract<CredentialPendingRequest, { kind: "add" }> | undefined;
  /** Opens the add form on this template, such as a workflow step's missing credential. */
  readonly presetTemplateId?: string | null;
  /** Opens an existing credential's detail; used by a card's "Fix" action. */
  readonly focusCredentialId?: CredentialId | null;
  /** Called once a credential exists, so a workflow step can attach it in the same gesture. */
  readonly onCreated?: (credential: Credential) => void;
  readonly historyRevision?: number;
  readonly grants?: ReadonlyArray<CredentialGrant>;
  readonly grantsError?: string | null;
  readonly onRevokeGrant?: (grant: CredentialGrant) => Promise<CredentialActionResult<void>>;
  readonly credentials: ReadonlyArray<Credential>;
  readonly status: CredentialsStatus | null;
  readonly projects: ReadonlyArray<CredentialProjectOption>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly readOnly: boolean;
  /** Null in a browser or on mobile, where the shell has no prompt to offer. */
  readonly osUnlock: CredentialOsUnlockClient | null;
  readonly osUnlockStatus: DesktopCredentialOsUnlockStatus | null;
  readonly onOsUnlockStatus: (status: DesktopCredentialOsUnlockStatus | null) => void;
  readonly onRetry: () => void;
  readonly actions: CredentialsManagerActions;
}) {
  const osUnlockSwitchId = useId();
  const [view, setView] = useState<View>(() =>
    addRequest || presetTemplateId !== null
      ? { kind: "add" }
      : focusCredentialId !== null
        ? { kind: "detail", id: focusCredentialId }
        : { kind: "list" },
  );
  const [query, setQuery] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    readonly run: () => Promise<CredentialActionResult<unknown>>;
  } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [changePinBusy, setChangePinBusy] = useState(false);
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [osEnableOpen, setOsEnableOpen] = useState(false);
  const [osEnableBusy, setOsEnableBusy] = useState(false);
  const [osEnableError, setOsEnableError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [osUnlockBusy, setOsUnlockBusy] = useState(false);
  const [osUnlockBlocked, setOsUnlockBlocked] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null);
  // A created credential opens before the refreshed list arrives, so hold it until that list catches up.
  const [created, setCreated] = useState<Credential | null>(null);
  const [history, setHistory] = useState<CredentialHistoryView>(EMPTY_HISTORY);
  const historyIdRef = useRef<CredentialId | null>(null);

  const osUnlockMethod =
    osUnlockStatus?.available === true ? (osUnlockStatus.method ?? null) : null;
  const osUnlockLabel =
    osUnlockMethod === null ? null : credentialOsUnlockMethodLabel(osUnlockMethod);

  const openPinSetup = (run: () => Promise<CredentialActionResult<unknown>>) => {
    setPending({ run });
    setPinError(null);
    setPinOpen(true);
  };

  const openUnlock = (
    run: () => Promise<CredentialActionResult<unknown>>,
    message: string | null,
  ) => {
    setPending({ run });
    setUnlockError(message);
    setOsUnlockBlocked(false);
    setUnlockOpen(true);
  };

  const runWithGate = async <A,>(
    action: () => Promise<CredentialActionResult<A>>,
    recover = true,
  ): Promise<A | null> => {
    const result = await action();
    if (result.ok) return result.value;
    if (recover) {
      switch (result.failure.kind) {
        case "pin-required":
          setBanner(null);
          openPinSetup(action);
          return null;
        case "unlock-required":
          setBanner(null);
          openUnlock(action, null);
          return null;
        case "locked-out":
          setBanner(null);
          openUnlock(action, credentialFailureMessage(result.failure));
          return null;
        default:
          break;
      }
    }
    setBanner(credentialFailureMessage(result.failure));
    return null;
  };

  const loadHistory = async (id: CredentialId, cursor?: string) => {
    historyIdRef.current = id;
    setHistory((current) =>
      cursor === undefined
        ? { events: [], loading: true, loadingMore: false, error: null }
        : { ...current, loadingMore: true },
    );
    const result = await actions.loadHistory(id, cursor);
    if (historyIdRef.current !== id) return;
    if (!result.ok) {
      setHistory((current) => ({
        ...current,
        loading: false,
        loadingMore: false,
        error: credentialFailureMessage(result.failure),
      }));
      return;
    }
    const page = result.value;
    setHistory((current) => ({
      events: cursor === undefined ? page.events : [...current.events, ...page.events],
      loading: false,
      loadingMore: false,
      error: null,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }));
  };

  const loadOpenHistory = useEffectEvent((_revision: number) =>
    view.kind === "detail" ? { id: view.id, read: actions.loadHistory(view.id) } : null,
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- Keep the credential panel synchronized with external vault state after React commits.
  useEffect(() => {
    const task = loadOpenHistory(historyRevision);
    if (!task) return;
    let cancelled = false;
    void task.read.then((result) => {
      if (cancelled || historyIdRef.current !== task.id) return;
      if (result.ok)
        setHistory({ ...result.value, loading: false, loadingMore: false, error: null });
      else
        setHistory((current) => ({ ...current, error: credentialFailureMessage(result.failure) }));
    });
    return () => {
      cancelled = true;
    };
  }, [historyRevision]);

  const retryPending = async () => {
    const next = pending;
    setPending(null);
    if (next !== null) await runWithGate(next.run, false);
  };

  const submitPin = async (pin: string): Promise<boolean> => {
    setPinBusy(true);
    setPinError(null);
    const result = await actions.setPin({ newPin: pin });
    setPinBusy(false);
    if (!result.ok) {
      setPinError(credentialFailureMessage(result.failure));
      return false;
    }
    setPinOpen(false);
    await retryPending();
    return true;
  };

  const submitChangePin = async (input: {
    readonly currentPin: string;
    readonly newPin: string;
  }): Promise<boolean> => {
    setChangePinBusy(true);
    setChangePinError(null);
    const result = await actions.setPin(input);
    setChangePinBusy(false);
    if (!result.ok) {
      setChangePinError(credentialFailureMessage(result.failure));
      return false;
    }
    setChangePinOpen(false);
    if (osUnlock !== null && osUnlockStatus?.enabled === true) {
      // Keep the shell's copy in step; if it cannot be rewritten, it is dropped rather than left
      // holding a PIN the server has just stopped accepting.
      const outcome = await refreshStoredPinAfterChange({
        enabled: true,
        pin: input.newPin,
        shell: osUnlock,
      });
      onOsUnlockStatus(await osUnlock.status());
      if (outcome === "cleared") {
        setBanner(
          `The saved ${osUnlockLabel ?? "system"} PIN could not be updated. Turn system unlock on again.`,
        );
      }
    }
    return true;
  };

  const submitOsEnable = async (pin: string): Promise<boolean> => {
    if (osUnlock === null) return false;
    setOsEnableBusy(true);
    setOsEnableError(null);
    const outcome = await enableOsUnlock({ pin, shell: osUnlock, verify: actions.unlock });
    setOsEnableBusy(false);
    if (!outcome.ok) {
      setOsEnableError(outcome.message);
      return false;
    }
    onOsUnlockStatus(outcome.status);
    setOsEnableOpen(false);
    return true;
  };

  const toggleOsUnlock = (enabled: boolean) => {
    if (osUnlock === null) return;
    setBanner(null);
    if (enabled) {
      setOsEnableError(null);
      setOsEnableOpen(true);
      return;
    }
    void osUnlock.disable().then(
      (next) => onOsUnlockStatus(next),
      () => setBanner("Could not remove the saved PIN from the keychain."),
    );
  };

  const submitOsUnlock = () => {
    if (osUnlock === null) return;
    setOsUnlockBusy(true);
    setUnlockError(null);
    void unlockWithStoredPin({ shell: osUnlock, unlock: actions.unlock }).then(async (outcome) => {
      setOsUnlockBusy(false);
      switch (outcome.kind) {
        case "unlocked":
          setUnlockOpen(false);
          await retryPending();
          return;
        case "no-pin":
          return;
        case "pin-rejected":
          // The stored PIN is gone now, so the button disappears once the status refreshes.
          setOsUnlockBlocked(true);
          onOsUnlockStatus(await osUnlock.status());
          setUnlockError(
            `The PIN saved for ${osUnlockLabel ?? "system unlock"} no longer works. Enter your PIN to unlock, then turn system unlock on again.`,
          );
          return;
        case "locked-out":
          setOsUnlockBlocked(true);
          setUnlockError(outcome.message);
          return;
        case "failed":
          setUnlockError(outcome.message);
          return;
      }
    });
  };

  const submitUnlock = async (pin: string): Promise<boolean> => {
    setUnlockBusy(true);
    setUnlockError(null);
    const result = await actions.unlock(pin);
    setUnlockBusy(false);
    if (!result.ok) {
      setUnlockError(credentialFailureMessage(result.failure));
      return false;
    }
    setUnlockOpen(false);
    await retryPending();
    return true;
  };

  const create = async (input: CredentialCreateInput): Promise<boolean> => {
    const created = await runWithGate(async () => {
      const result = await actions.create(input);
      if (result.ok) {
        setBanner(null);
        setCreated(result.value);
        setView({ kind: "detail", id: result.value.id });
        void loadHistory(result.value.id);
        onCreated?.(result.value);
      }
      return result;
    });
    return created !== null;
  };

  const update = async (input: CredentialUpdateInput): Promise<boolean> => {
    const updated = await runWithGate(async () => {
      const result = await actions.update(input);
      if (result.ok) void loadHistory(result.value.id);
      return result;
    });
    return updated !== null;
  };

  const setSecret = async (input: CredentialSetSecretInput): Promise<boolean> => {
    const updated = await runWithGate(async () => {
      const result = await actions.setSecret(input);
      if (result.ok) void loadHistory(result.value.id);
      return result;
    });
    return updated !== null;
  };

  const removeSecret = async (fieldId: CredentialFieldId): Promise<boolean> => {
    const selected = view.kind === "detail" ? view.id : null;
    if (selected === null) return false;
    const updated = await runWithGate(async () => {
      const result = await actions.removeSecret({ id: selected, fieldId });
      if (result.ok) void loadHistory(result.value.id);
      return result;
    });
    return updated !== null;
  };

  const openDetail = (credential: Credential) => {
    setBanner(null);
    setView({ kind: "detail", id: credential.id });
    void loadHistory(credential.id);
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target === null) return;
    void runWithGate(async () => {
      const result = await actions.deleteCredential(target.id);
      if (result.ok) {
        historyIdRef.current = null;
        setHistory(EMPTY_HISTORY);
        setCreated(null);
        setView({ kind: "list" });
        setBanner(null);
      }
      return result;
    });
  };

  const lock = () => {
    setBanner(null);
    void actions.lock().then((result) => {
      if (!result.ok) setBanner(credentialFailureMessage(result.failure));
    });
  };

  const pinDialogs = (
    <>
      <CredentialPinSetupDialog
        open={pinOpen}
        busy={pinBusy}
        error={pinError}
        onOpenChange={(open) => {
          setPinOpen(open);
          if (!open) {
            setPending(null);
            setPinError(null);
          }
        }}
        onSubmit={submitPin}
      />
      <CredentialPinChangeDialog
        open={changePinOpen}
        busy={changePinBusy}
        error={changePinError}
        onOpenChange={(open) => {
          setChangePinOpen(open);
          if (!open) setChangePinError(null);
        }}
        onSubmit={submitChangePin}
      />
      <CredentialOsUnlockEnableDialog
        open={osEnableOpen}
        busy={osEnableBusy}
        error={osEnableError}
        label={osUnlockLabel ?? "system unlock"}
        onOpenChange={(open) => {
          setOsEnableOpen(open);
          if (!open) setOsEnableError(null);
        }}
        onSubmit={submitOsEnable}
      />
      <CredentialUnlockDialog
        open={unlockOpen}
        busy={unlockBusy}
        error={unlockError}
        onOpenChange={(open) => {
          setUnlockOpen(open);
          if (!open) {
            setPending(null);
            setUnlockError(null);
            setOsUnlockBlocked(false);
          }
        }}
        onSubmit={submitUnlock}
        osUnlockLabel={osUnlockStatus?.enabled === true ? osUnlockLabel : null}
        osUnlockBusy={osUnlockBusy}
        osUnlockDisabled={osUnlockBlocked}
        onOsUnlock={osUnlock === null ? null : submitOsUnlock}
      />
    </>
  );

  if (readOnly) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>Credentials are not available here</EmptyTitle>
          <EmptyDescription>
            This connection wasn't granted credential access. Manage access in Settings →
            Connections → Authorized clients.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const selected =
    view.kind === "detail"
      ? (credentials.find((credential) => credential.id === view.id) ??
        (created?.id === view.id ? created : null))
      : null;

  if (view.kind === "add") {
    return (
      <div className="space-y-4">
        <CredentialAddPanel
          initialRequest={addRequest}
          presetTemplateId={presetTemplateId}
          projects={projects}
          error={banner}
          onCreate={create}
          onCancel={() => {
            setBanner(null);
            setView({ kind: "list" });
          }}
        />
        {pinDialogs}
      </div>
    );
  }

  if (view.kind === "detail" && selected !== null) {
    return (
      <div className="space-y-4">
        {banner === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            {banner}
          </p>
        )}
        <CredentialDetailPanel
          credential={selected}
          environmentId={environmentId}
          grants={grants.filter((grant) => grant.credentialId === selected.id)}
          grantsError={grantsError}
          onRevokeGrant={
            onRevokeGrant ? (grant) => runWithGate(() => onRevokeGrant(grant)) : undefined
          }
          projects={projects}
          history={history}
          onBack={() => {
            setBanner(null);
            setView({ kind: "list" });
          }}
          onUpdate={update}
          onSetSecret={setSecret}
          onRemoveSecret={removeSecret}
          onDelete={() => setDeleteTarget(selected)}
          onLoadMoreHistory={() => {
            if (history.nextCursor !== undefined) {
              void loadHistory(selected.id, history.nextCursor);
            }
          }}
        />
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteTarget?.name ?? "credential"}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the credential and its stored secrets. Its history stays.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
              <Button variant="destructive" onClick={confirmDelete}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
        {pinDialogs}
      </div>
    );
  }

  const visible = credentials.filter((credential) => matchesQuery(credential, query.trim()));
  const groups = new Map<string, Credential[]>();
  for (const credential of visible) {
    const key = templateName(credential);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [credential]);
    else group.push(credential);
  }
  const groupEntries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const unlocked = status?.unlockedUntil !== undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <KeyRoundIcon className="size-4" />
            Credentials
          </h2>
          <p className="text-xs text-muted-foreground">
            Stored encrypted on this environment. Agents use them through T3 and never see values
            unless you allow reveal.
          </p>
          {status === null ? null : (
            <p className="text-xs text-muted-foreground">
              Vault key: {status.keyStorage === "os-keychain" ? "OS keychain" : "file on disk"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status?.pinSet === true ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setBanner(null);
                setChangePinError(null);
                setChangePinOpen(true);
              }}
            >
              Change PIN
            </Button>
          ) : null}
          {unlocked ? (
            <Button type="button" variant="ghost" size="sm" onClick={lock}>
              <LockIcon />
              Lock now
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setBanner(null);
              setView({ kind: "add" });
            }}
          >
            <PlusIcon />
            Add credential
          </Button>
        </div>
      </div>

      {osUnlockLabel === null || status?.pinSet !== true ? null : (
        <label
          htmlFor={osUnlockSwitchId}
          className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground"
        >
          <Switch
            id={osUnlockSwitchId}
            size="sm"
            aria-label={`Use ${osUnlockLabel} to unlock`}
            checked={osUnlockStatus?.enabled === true}
            onCheckedChange={toggleOsUnlock}
          />
          Use {osUnlockLabel} to unlock
        </label>
      )}

      {status?.keyStorage === "file" ? (
        <Alert variant="warning">
          <AlertTitle>Vault key stored on disk</AlertTitle>
          <AlertDescription>
            This machine has no OS keychain, so the vault key sits in a file only its owner can
            read. The PIN still gates writes and unlocks.
          </AlertDescription>
        </Alert>
      ) : null}

      {status?.unlockedUntil === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          Unlocked · {formatRelativeTimeUntilLabel(status.unlockedUntil)}
        </p>
      )}

      {banner === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {banner}
        </p>
      )}
      {error === null ? null : (
        <Alert variant="error">
          <AlertTitle>Could not load credentials</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </Alert>
      )}

      <Input
        type="search"
        aria-label="Search credentials"
        placeholder="Search credentials…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {loading && credentials.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading credentials…</p>
      ) : error !== null && credentials.length === 0 ? null : credentials.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>No credentials yet</EmptyTitle>
            <EmptyDescription>
              Add a token, a key file or a whole .env bundle. Workflows and agents can use it
              without the value entering a chat or a file in git.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={() => setView({ kind: "add" })}>
              <PlusIcon />
              Add credential
            </Button>
          </EmptyContent>
        </Empty>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No credentials match "{query.trim()}".
        </p>
      ) : (
        <div className="space-y-5">
          {groupEntries.map(([name, group]) => (
            <section key={name} className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{name}</h3>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {group.map((credential) => (
                  <CredentialCard key={credential.id} credential={credential} onOpen={openDetail} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {pinDialogs}
    </div>
  );
}
