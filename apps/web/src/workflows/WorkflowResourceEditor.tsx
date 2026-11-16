import { useState } from "react";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  WorkflowAttachment,
  WorkflowListing,
  WorkflowReadinessSnapshot,
  WorkflowStep,
} from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useWorkflowEdit } from "./workflowState";
import { attachmentLabel, readinessDisplay } from "./WorkflowResourceCard";
import { WorkflowMcpPicker } from "./WorkflowMcpPicker";

export function WorkflowResourceEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly probeContextThreadId?: ThreadId;
  readonly probeContextWorkspaceRoot?: string | null;
  readonly probeContextModelRevision?: string;
  readonly listing: WorkflowListing;
  readonly owner: WorkflowStep;
  readonly attachment: WorkflowAttachment;
  readonly readinessSnapshot?: WorkflowReadinessSnapshot | null;
  readonly editMode: boolean;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const edit = useWorkflowEdit(
    props.environmentId,
    props.listing,
    props.probeContextThreadId,
    props.probeContextWorkspaceRoot,
    props.probeContextModelRevision,
  );
  const readiness = (
    props.readinessSnapshot === undefined ? props.listing.readiness : props.readinessSnapshot
  )?.entries.find(
    (entry) => entry.stepId === props.owner.id && entry.attachmentId === props.attachment.id,
  );
  const mcpAttachment = props.attachment.kind === "mcp-connection" ? props.attachment : null;
  const [label, setLabel] = useState(props.attachment.label ?? "");
  const [requirement, setRequirement] = useState(
    props.attachment.kind === "requirement" ? props.attachment.requirement : "",
  );
  const [minVersion, setMinVersion] = useState(
    props.attachment.kind === "requirement" ? (props.attachment.minVersion ?? "") : "",
  );
  const [service, setService] = useState(
    props.attachment.kind === "service-login" ? props.attachment.service : "",
  );
  const [command, setCommand] = useState(
    props.attachment.kind === "service-login" ? (props.attachment.command ?? "") : "",
  );
  const [signInCommand, setSignInCommand] = useState(
    props.attachment.kind === "service-login" ? (props.attachment.signInCommand ?? "") : "",
  );
  const [server, setServer] = useState(
    props.attachment.kind === "mcp-connection" ? props.attachment.server : "",
  );
  const [mcpProviderInstanceId, setMcpProviderInstanceId] = useState<
    ProviderInstanceId | undefined
  >(props.attachment.kind === "mcp-connection" ? props.attachment.providerInstanceId : undefined);

  const currentAttachment = (): WorkflowAttachment => {
    const shared = {
      ...props.attachment,
      ...(label.trim() ? { label: label.trim() } : { label: undefined }),
    };
    switch (props.attachment.kind) {
      case "requirement":
        return {
          ...shared,
          kind: "requirement",
          requirement: requirement.trim(),
          ...(minVersion.trim() ? { minVersion: minVersion.trim() } : { minVersion: undefined }),
        };
      case "service-login":
        return {
          ...shared,
          kind: "service-login",
          service: service.trim(),
          ...(command.trim() ? { command: command.trim() } : { command: undefined }),
          ...(signInCommand.trim()
            ? { signInCommand: signInCommand.trim() }
            : { signInCommand: undefined }),
        };
      case "mcp-connection":
        return {
          ...shared,
          kind: "mcp-connection",
          server: server.trim(),
          providerInstanceId: undefined,
          ...(mcpProviderInstanceId ? { providerInstanceId: mcpProviderInstanceId } : {}),
        };
      case "credential":
        // Credential binding is edited from the credentials picker, not this form.
        return props.attachment;
    }
  };
  const put = async (step: WorkflowStep) =>
    edit.run({
      _tag: "stepPut",
      projectId: props.listing.projectId,
      workflow: props.listing.workflow,
      step,
    });
  const save = () => {
    const next = currentAttachment();
    return put({
      ...props.owner,
      attachments: (props.owner.attachments ?? []).map((item) =>
        item.id === next.id ? next : item,
      ),
    } as WorkflowStep);
  };
  const detach = async () => {
    const result = await put({
      ...props.owner,
      attachments: (props.owner.attachments ?? []).filter(
        (item) => item.id !== props.attachment.id,
      ),
    } as WorkflowStep);
    if (result) props.onDeleted();
  };
  const recheck = () =>
    edit.run({
      _tag: "probe",
      projectId: props.listing.projectId,
      workflow: props.listing.workflow,
      stepIds: [props.owner.id],
      ...(props.probeContextThreadId ? { contextThreadId: props.probeContextThreadId } : {}),
    });

  return (
    <section
      data-workflow-resource-editor
      className="space-y-3"
      aria-label={`${attachmentLabel(props.attachment)} resource editor`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{attachmentLabel(props.attachment)}</h3>
          <p className="text-2xs text-muted-foreground">
            Attached to {props.owner.title ?? props.owner.id}
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={props.onClose}>
          Close
        </Button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" value={label} disabled={!props.editMode} onChange={setLabel} />
        {props.attachment.kind === "requirement" ? (
          <>
            <Field
              label="Requirement"
              value={requirement}
              disabled={!props.editMode}
              onChange={setRequirement}
            />
            <Field
              label="Minimum version"
              value={minVersion}
              disabled={!props.editMode}
              onChange={setMinVersion}
            />
          </>
        ) : null}
        {props.attachment.kind === "service-login" ? (
          <>
            <Field
              label="Service"
              value={service}
              disabled={!props.editMode}
              onChange={setService}
            />
            <Field
              label="Status command"
              value={command}
              disabled={!props.editMode}
              onChange={setCommand}
            />
            <Field
              label="Sign-in instructions"
              value={signInCommand}
              disabled={!props.editMode}
              onChange={setSignInCommand}
            />
          </>
        ) : null}
        {props.attachment.kind === "mcp-connection" ? (
          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs font-medium">MCP server</p>
            <WorkflowMcpPicker
              environmentId={props.environmentId}
              listing={props.listing}
              stepId={props.owner.id}
              {...(props.probeContextThreadId
                ? { contextThreadId: props.probeContextThreadId }
                : {})}
              workspaceRoot={props.probeContextWorkspaceRoot}
              modelRevision={props.probeContextModelRevision}
              disabled={!props.editMode || edit.busy || !edit.canEdit}
              value={{
                server: props.attachment.server,
                ...(props.attachment.providerInstanceId
                  ? { providerInstanceId: props.attachment.providerInstanceId }
                  : {}),
              }}
              onSelect={(choice) => {
                setServer(choice?.server ?? mcpAttachment?.server ?? "");
                setMcpProviderInstanceId(
                  choice?.providerInstanceId ?? mcpAttachment?.providerInstanceId,
                );
              }}
            />
            <details className="text-2xs text-muted-foreground">
              <summary className="w-fit cursor-pointer">Enter a server name manually</summary>
              <div className="mt-2 space-y-1.5">
                <Input
                  size="sm"
                  aria-label="MCP server name"
                  value={server}
                  disabled={!props.editMode || edit.busy || !edit.canEdit}
                  onChange={(event) => {
                    setServer(event.target.value);
                    setMcpProviderInstanceId(undefined);
                  }}
                />
                <p>
                  Manual names only identify an existing provider connection. URL, command, and
                  authentication setup are not available here.
                </p>
              </div>
            </details>
          </div>
        ) : null}
      </div>
      <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
        <p className="font-medium">
          Readiness ·{" "}
          {props.attachment.kind === "credential"
            ? (readiness?.credential?.statusLabel ?? "Not checked")
            : readinessDisplay(props.attachment, readiness?.status ?? "unknown")}
          {readiness?.stale ? " · stale" : ""}
        </p>
        <p className="mt-1 text-muted-foreground">{readiness?.message ?? "Not checked"}</p>
        {props.attachment.kind === "credential" && readiness?.credential ? (
          <p className="mt-1 font-mono text-2xs text-muted-foreground">
            {readiness.credential.envVars
              .map((envVar) => (envVar.file ? `${envVar.name} (file path)` : envVar.name))
              .join(" · ") || "No environment variables yet"}
          </p>
        ) : null}
        {readiness?.providerInstanceId ? (
          <p className="mt-1 text-2xs text-muted-foreground">
            Provider: {readiness.providerInstanceId}
          </p>
        ) : null}
        {readiness?.workspaceRoot ? (
          <p className="text-2xs text-muted-foreground">Workspace: {readiness.workspaceRoot}</p>
        ) : null}
        {readiness?.checkedAt ? (
          <p className="text-2xs text-muted-foreground">
            Checked: {readiness.checkedAt}
            {readiness.expiresAt ? ` · expires ${readiness.expiresAt}` : ""}
          </p>
        ) : null}
      </div>
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
      <footer className="flex flex-wrap justify-between gap-2">
        {props.editMode ? (
          <Button
            variant="destructive"
            size="xs"
            disabled={edit.busy || !edit.canEdit}
            onClick={() => void detach()}
          >
            Detach
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {props.editMode ? (
            <Button
              variant="outline"
              size="xs"
              disabled={edit.busy || !edit.canEdit}
              onClick={() => void recheck()}
            >
              Check readiness
            </Button>
          ) : null}
          {props.editMode ? (
            <Button size="xs" disabled={edit.busy || !edit.canEdit} onClick={() => void save()}>
              Save resource
            </Button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs font-medium">
      {props.label}
      <Input
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
