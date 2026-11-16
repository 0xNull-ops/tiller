import { useProjects } from "../state/entities";
import { SkillsBrowser } from "../fork/skillsSh/SkillsBrowser";
import { useRef, useState, type ReactElement } from "react";
import type {
  Credential,
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkflowAttachment,
  WorkflowAttachmentKind,
  WorkflowListing,
  WorkflowStep,
} from "@t3tools/contracts";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { nestableWorkflows } from "./workflowNesting";
import type { WorkflowStepChoice } from "./workflowStep";
import { WorkflowSkillPickerContents } from "./WorkflowSkillPicker";
import { WorkflowAttachmentAddForm } from "./WorkflowAttachmentAddForm";
import { WorkflowCredentialsTabConnected } from "./WorkflowCredentialsTab";

export type WorkflowResourcePickerContext = {
  readonly listing: WorkflowListing;
  readonly owners: ReadonlyArray<WorkflowStep>;
  readonly defaultOwnerId?: string | null;
  readonly disabled: boolean;
  readonly contextThreadId?: ThreadId | null;
  readonly workspaceRoot?: string | null;
  readonly modelRevision?: string;
  readonly onAdd: (
    owner: WorkflowStep,
    attachment: WorkflowAttachment,
  ) => void | boolean | Promise<void | boolean>;
  /** Credentials attach in one write, so a multi-select lands together. */
  readonly onAttachCredentials: (
    owner: WorkflowStep,
    credentials: ReadonlyArray<Credential>,
  ) => void | boolean | Promise<void | boolean>;
  /** Opens the manager's add form on this type; the new credential attaches on save. */
  readonly onNewCredential: (owner: WorkflowStep, templateId: string | null) => void;
  /** Opens an existing credential in the manager, for "Fix" and a row's open action. */
  readonly onOpenCredential: (owner: WorkflowStep, credentialId: string) => void;
  readonly onManageCredentials: () => void;
};

export function WorkflowStepPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly workflow: string;
  readonly onPick: (choice: WorkflowStepChoice) => void;
  readonly children: ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly resources?: WorkflowResourcePickerContext;
}) {
  const project = useProjects().find(
    (project) => project.environmentId === props.environmentId && project.id === props.projectId,
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const [tab, setTab] = useState("skills");
  const [search, setSearch] = useState("");
  const [resourceKind, setResourceKind] = useState<WorkflowAttachmentKind>("mcp-connection");
  const [ownerId, setOwnerId] = useState(props.resources?.defaultOwnerId ?? "");
  const typePickerRef = useRef<HTMLDivElement>(null);
  const [previousDefaultOwner, setPreviousDefaultOwner] = useState(props.resources?.defaultOwnerId);
  if (props.resources?.defaultOwnerId !== previousDefaultOwner) {
    setPreviousDefaultOwner(props.resources?.defaultOwnerId);
    setOwnerId(props.resources?.defaultOwnerId ?? "");
  }
  const selectedOwnerId = props.resources?.owners.some((owner) => owner.id === ownerId)
    ? ownerId
    : props.resources?.owners.length === 1
      ? props.resources.owners[0]!.id
      : "";
  const open = props.open ?? internalOpen;
  const setOpen = (next: boolean) => {
    props.onOpenChange?.(next);
    if (props.open === undefined) setInternalOpen(next);
    if (!next) {
      setTab("skills");
      setSearch("");
    }
  };
  const pick = (choice: WorkflowStepChoice) => {
    props.onPick(choice);
    setOpen(false);
  };
  const workflows =
    open && tab === "workflows"
      ? nestableWorkflows(props.workflows, props.workflow).filter((item) =>
          `${item.workflow} ${item.definition?.name ?? ""}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
        )
      : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={props.children} />
      {open ? (
        <PopoverPopup
          align="start"
          width="lg"
          padding="none"
          onWheel={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="p-2 pb-0">
            <ToggleGroup
              aria-label="Step type"
              value={[tab]}
              onValueChange={(values) => {
                if (values[0]) setTab(values[0]);
              }}
            >
              <Toggle value="skills">Skills</Toggle>
              <Toggle value="skills-sh">Browse skills.sh</Toggle>
              <Toggle value="workflows">Workflows</Toggle>
              {props.resources ? <Toggle value="resources">Resources</Toggle> : null}
            </ToggleGroup>
          </div>
          {tab === "skills-sh" ? (
            <SkillsBrowser
              compact
              environmentId={props.environmentId}
              project={props.resources?.workspaceRoot ?? project?.workspaceRoot}
              onInstalled={(name) => pick({ kind: "skill", skill: name })}
            />
          ) : null}
          {tab === "skills" ? (
            <WorkflowSkillPickerContents
              environmentId={props.environmentId}
              projectId={props.projectId}
              onPick={(skill) => pick({ kind: "skill", skill })}
            />
          ) : tab === "workflows" ? (
            <div className="w-80 space-y-2 p-2">
              <Input
                autoFocus
                aria-label="Search workflows"
                placeholder="Search workflows…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="max-h-64 overflow-auto">
                {workflows.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">No matching workflows.</p>
                ) : (
                  workflows.map((item) => (
                    <button
                      key={item.workflow}
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() =>
                        pick({
                          kind: "workflow",
                          workflow: item.workflow,
                          name: item.definition!.name,
                        })
                      }
                    >
                      <span className="block truncate text-xs font-medium">
                        {item.definition!.name}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {item.workflow}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : tab === "resources" && props.resources ? (
            <div className="w-full min-w-0 space-y-2 p-2">
              {props.resources.owners.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  Add a skill or workflow step first.
                </p>
              ) : (
                <>
                  <label className="block space-y-1 text-xs">
                    <span>Attach to step</span>
                    <select
                      aria-label="Attach resource to step"
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      value={selectedOwnerId}
                      onChange={(event) => setOwnerId(event.target.value)}
                    >
                      <option value="">Choose a step…</option>
                      {props.resources.owners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.title || owner.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedOwnerId ? (
                    (() => {
                      const owner = props.resources!.owners.find(
                        (entry) => entry.id === selectedOwnerId,
                      );
                      return owner ? (
                        <>
                          <ToggleGroup
                            aria-label="Resource type"
                            className="w-full flex-wrap"
                            value={[resourceKind]}
                            onValueChange={(values) => {
                              if (values[0]) setResourceKind(values[0] as WorkflowAttachmentKind);
                            }}
                          >
                            <Toggle value="mcp-connection">MCP</Toggle>
                            <Toggle value="requirement">Requirements</Toggle>
                            <Toggle value="service-login">Service logins</Toggle>
                            <Toggle value="credential">Credentials</Toggle>
                          </ToggleGroup>
                          {resourceKind === "credential" ? (
                            <WorkflowCredentialsTabConnected
                              key={JSON.stringify([
                                props.environmentId,
                                props.resources!.listing.projectId,
                                props.resources!.listing.workflow,
                                props.resources!.listing.definition?.credentialApprovals ?? null,
                                owner.id,
                                owner.attachments ?? [],
                              ])}
                              environmentId={props.environmentId}
                              projectId={props.projectId}
                              step={owner}
                              listing={props.resources!.listing}
                              disabled={props.resources!.disabled}
                              onAttach={async (credentials) => {
                                const saved = await props.resources!.onAttachCredentials(
                                  owner,
                                  credentials,
                                );
                                if (saved !== false) setOpen(false);
                                return saved;
                              }}
                              onNewCredential={(templateId) =>
                                props.resources!.onNewCredential(owner, templateId)
                              }
                              onManage={props.resources!.onManageCredentials}
                              onOpenCredential={(credentialId) =>
                                props.resources!.onOpenCredential(owner, credentialId)
                              }
                            />
                          ) : (
                            <WorkflowAttachmentAddForm
                              key={JSON.stringify([
                                props.environmentId,
                                props.resources!.listing.projectId,
                                props.resources!.listing.workflow,
                                owner.id,
                                resourceKind,
                                props.resources!.contextThreadId ?? null,
                                props.resources!.workspaceRoot ?? null,
                                props.resources!.modelRevision ?? null,
                              ])}
                              count={owner.attachments?.length ?? 0}
                              disabled={props.resources!.disabled}
                              typePickerRef={typePickerRef}
                              hideTypePicker
                              selectedKind={resourceKind}
                              environmentId={props.environmentId}
                              listing={props.resources!.listing}
                              stepId={owner.id}
                              {...(props.resources!.contextThreadId
                                ? { contextThreadId: props.resources!.contextThreadId }
                                : {})}
                              workspaceRoot={props.resources!.workspaceRoot}
                              modelRevision={props.resources!.modelRevision}
                              onAdd={async (attachment) => {
                                const saved = await props.resources!.onAdd(owner, attachment);
                                if (saved !== false) setOpen(false);
                                return saved;
                              }}
                            />
                          )}
                        </>
                      ) : null;
                    })()
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Choose a step to add a resource.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : null}
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}
