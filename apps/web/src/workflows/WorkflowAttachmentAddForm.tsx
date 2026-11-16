import { useEffect, useRef, useState, type RefObject } from "react";
import {
  type EnvironmentId,
  MAX_WORKFLOW_STEP_ATTACHMENTS,
  type ProviderInstanceId,
  type WorkflowAttachment,
  type WorkflowAttachmentKind,
  type ThreadId,
  type WorkflowListing,
} from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { randomUUID } from "../lib/utils";
import { WorkflowMcpPicker } from "./WorkflowMcpPicker";

export function WorkflowAttachmentAddForm({
  count,
  disabled,
  typePickerRef,
  onAdd,
  environmentId,
  listing,
  stepId,
  contextThreadId,
  workspaceRoot,
  modelRevision,
  selectedKind,
  onKindChange,
  hideTypePicker = false,
}: {
  readonly count: number;
  readonly disabled: boolean;
  readonly typePickerRef: RefObject<HTMLDivElement | null>;
  readonly onAdd: (attachment: WorkflowAttachment) => void | boolean | Promise<void | boolean>;
  readonly environmentId: EnvironmentId;
  readonly listing: WorkflowListing;
  readonly stepId: string;
  readonly contextThreadId?: ThreadId;
  readonly workspaceRoot?: string | null | undefined;
  readonly modelRevision?: string | undefined;
  readonly selectedKind?: WorkflowAttachmentKind | null;
  readonly onKindChange?: (kind: WorkflowAttachmentKind) => void;
  readonly hideTypePicker?: boolean;
}) {
  const [internalKind, setInternalKind] = useState<WorkflowAttachmentKind | null>(null);
  const kind = selectedKind === undefined ? internalKind : selectedKind;
  const setKind = (next: WorkflowAttachmentKind) => {
    if (selectedKind === undefined) setInternalKind(next);
    onKindChange?.(next);
    setLabel("");
    setPrimary("");
    setVersion("");
    setCommand("");
    setSignInCommand("");
    setMcpProviderInstanceId(undefined);
  };
  const [label, setLabel] = useState("");
  const [primary, setPrimary] = useState("");
  const [version, setVersion] = useState("");
  const [command, setCommand] = useState("");
  const [signInCommand, setSignInCommand] = useState("");
  const [mcpProviderInstanceId, setMcpProviderInstanceId] = useState<
    ProviderInstanceId | undefined
  >();
  const [saving, setSaving] = useState(false);
  const primaryRef = useRef<HTMLInputElement>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize form state with the loaded workflow attachment after query updates.
  useEffect(() => {
    if (kind) primaryRef.current?.focus();
  }, [kind]);
  const submit = async () => {
    if (!kind || saving) return;
    // Credential attachments come from the credentials picker, not this free-text form.
    if (kind === "credential") return;
    const id = `resource-${randomUUID()}`;
    const shared = { id, ...(label.trim() ? { label: label.trim() } : {}) };
    const attachment: WorkflowAttachment =
      kind === "requirement"
        ? {
            ...shared,
            kind,
            requirement: primary.trim(),
            ...(version.trim() ? { minVersion: version.trim() } : {}),
          }
        : kind === "service-login"
          ? {
              ...shared,
              kind,
              service: primary.trim(),
              ...(command.trim() ? { command: command.trim() } : {}),
              ...(signInCommand.trim() ? { signInCommand: signInCommand.trim() } : {}),
            }
          : {
              ...shared,
              kind,
              server: primary.trim(),
              ...(mcpProviderInstanceId ? { providerInstanceId: mcpProviderInstanceId } : {}),
            };
    if (!primary.trim()) return;
    setSaving(true);
    // The React Compiler can't analyze `finally`, so the reset rides the promise instead.
    const result = await Promise.resolve(onAdd(attachment)).then(
      (value) => {
        setSaving(false);
        return value;
      },
      (error: unknown) => {
        setSaving(false);
        throw error;
      },
    );
    if (result === false) return;
    setLabel("");
    setPrimary("");
    setVersion("");
    setCommand("");
    setSignInCommand("");
    setMcpProviderInstanceId(undefined);
  };
  return (
    <section className="space-y-2" aria-label="Add a resource">
      <div
        ref={typePickerRef}
        tabIndex={-1}
        aria-label="Resource type"
        className="flex flex-wrap gap-1.5"
      >
        {!hideTypePicker ? (
          <>
            {(
              [
                ["requirement", "Requirement"],
                ["service-login", "Service login"],
                ["mcp-connection", "MCP connection"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={kind === value ? "secondary" : "outline"}
                size="xs"
                aria-pressed={kind === value}
                disabled={disabled || count >= MAX_WORKFLOW_STEP_ATTACHMENTS}
                onClick={() => setKind(value)}
              >
                {label}
              </Button>
            ))}
          </>
        ) : null}
      </div>
      {kind === "mcp-connection" ? (
        <div className="min-w-0 space-y-2">
          <WorkflowMcpPicker
            environmentId={environmentId}
            listing={listing}
            stepId={stepId}
            {...(contextThreadId ? { contextThreadId } : {})}
            workspaceRoot={workspaceRoot}
            modelRevision={modelRevision}
            disabled={disabled || saving}
            value={{
              server: primary,
              ...(mcpProviderInstanceId ? { providerInstanceId: mcpProviderInstanceId } : {}),
            }}
            onSelect={(choice) => {
              setPrimary(choice?.server ?? "");
              setMcpProviderInstanceId(choice?.providerInstanceId);
            }}
          />
          <details className="text-2xs text-muted-foreground">
            <summary className="w-fit cursor-pointer">Enter a server name manually</summary>
            <div className="mt-2 space-y-1.5">
              <Input
                size="sm"
                aria-label="MCP server name"
                placeholder="Configured server name"
                value={primary}
                disabled={disabled}
                onChange={(event) => {
                  setPrimary(event.target.value);
                  setMcpProviderInstanceId(undefined);
                }}
              />
              <p>URL, command, and authentication setup are not available here.</p>
            </div>
          </details>
        </div>
      ) : null}
      {kind ? (
        kind !== "mcp-connection" ? (
          <div className="flex min-w-0 items-center gap-2">
            <Input
              size="sm"
              ref={primaryRef}
              aria-label={
                kind === "requirement"
                  ? "Requirement"
                  : kind === "service-login"
                    ? "Service"
                    : "MCP server"
              }
              placeholder={
                kind === "requirement"
                  ? "Node 22"
                  : kind === "service-login"
                    ? "Vercel"
                    : "RevenueCat MCP"
              }
              value={primary}
              disabled={disabled}
              onChange={(event) => setPrimary(event.target.value)}
            />
          </div>
        ) : null
      ) : null}
      {kind === "requirement" ? (
        <Input
          size="sm"
          aria-label="Minimum version"
          placeholder="Minimum version (optional)"
          value={version}
          disabled={disabled || saving}
          onChange={(event) => setVersion(event.target.value)}
        />
      ) : null}
      {kind === "service-login" ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
          <Input
            size="sm"
            aria-label="Service status command"
            placeholder="Status command (optional)"
            value={command}
            disabled={disabled || saving}
            onChange={(event) => setCommand(event.target.value)}
          />
          <Input
            size="sm"
            aria-label="Sign-in command"
            placeholder="Sign-in instructions (optional)"
            value={signInCommand}
            disabled={disabled || saving}
            onChange={(event) => setSignInCommand(event.target.value)}
          />
        </div>
      ) : null}
      {kind ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Input
            size="sm"
            aria-label="Resource label"
            placeholder="Label (optional)"
            value={label}
            disabled={disabled || saving}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button
            variant="outline"
            size="xs"
            disabled={
              disabled || saving || count >= MAX_WORKFLOW_STEP_ATTACHMENTS || !primary.trim()
            }
            onClick={submit}
          >
            <PlusIcon /> Add{" "}
            {kind === "requirement"
              ? "requirement"
              : kind === "service-login"
                ? "service login"
                : "MCP connection"}
          </Button>
        </div>
      ) : null}
      {count >= MAX_WORKFLOW_STEP_ATTACHMENTS ? (
        <p className="text-2xs text-muted-foreground">
          This step already has the maximum of {MAX_WORKFLOW_STEP_ATTACHMENTS} resources.
        </p>
      ) : null}
    </section>
  );
}
