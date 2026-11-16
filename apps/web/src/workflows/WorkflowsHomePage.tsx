import { workflowScratchThreadId } from "@t3tools/shared/workflowScratch";
import { buildThreadRouteParams } from "../threadRoutes";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type WorkflowListing } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, EllipsisIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { isEditableFocused } from "../lib/editableFocus";
import { useProjects } from "../state/entities";
import { SkillsBrowser } from "../fork/skillsSh/SkillsBrowser";
import { useAllEnvironmentsWorkflows } from "./useAllEnvironmentsWorkflows";
import { WorkflowDeleteDialog, type WorkflowDeleteTarget } from "./WorkflowDeleteDialog";
import { WorkflowKeepButton } from "./WorkflowKeepButton";
import { WorkflowNewDialog } from "./WorkflowNewDialog";
import { WorkflowTagsField } from "./WorkflowTagsField";
import { readLastChatPath, requestWorkflowRun } from "./workflowUiStore";
import { BuiltinGallery } from "../fork/builtins/BuiltinGallery";
import { GalleryCard } from "./GalleryCard";
import { localGalleryItems, type LocalGalleryItem } from "./localGalleryItems";
import { useWorkflowEdit } from "./workflowState";
import { uniqueWorkflowSlug } from "./workflowEditing";

export function WorkflowsHomePage(props: { readonly templatesOnly?: boolean }) {
  const navigate = useNavigate();
  const snapshots = useAllEnvironmentsWorkflows();
  const projects = useProjects();
  const items = localGalleryItems(snapshots, projects);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDeleteTarget | null>(null);
  const [tagsTarget, setTagsTarget] = useState<LocalGalleryItem | null>(null);
  const [installTarget, setInstallTarget] = useState<LocalGalleryItem | null>(null);
  const [newProjectKey, setNewProjectKey] = useState<string | null>(null);
  const firstProject =
    projects.find((project) => `${project.environmentId}/${project.id}` === newProjectKey) ??
    projects[0];
  const editingTags = items.find((item) => item.key === tagsTarget?.key) ?? tagsTarget;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Register the page's Escape shortcut with the browser while preserving dialogs and editable fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "Escape" ||
        isEditableFocused(event.target) ||
        document.querySelector('[data-slot="dialog-popup"]')
      )
        return;
      event.preventDefault();
      void navigate({ to: readLastChatPath() as never });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
  return (
    <div className="flex h-dvh min-h-0 flex-1 overflow-hidden overscroll-y-none">
      <SidebarInset>
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <header className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Back to chat"
              onClick={() => void navigate({ to: readLastChatPath() as never })}
            >
              <ArrowLeftIcon />
            </Button>
            <WorkflowIcon className="size-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold">Workflows</h1>
          </div>
          {firstProject ? (
            projects.length > 1 ? (
              <Menu>
                <MenuTrigger render={<Button variant="outline" size="xs" />}>
                  <PlusIcon /> New workflow
                </MenuTrigger>
                <MenuPopup>
                  {projects.map((project) => (
                    <MenuItem
                      key={`${project.environmentId}/${project.id}`}
                      onClick={() => {
                        setNewProjectKey(`${project.environmentId}/${project.id}`);
                        setNewOpen(true);
                      }}
                    >
                      {project.title} · {project.environmentId}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            ) : (
              <Button variant="outline" size="xs" onClick={() => setNewOpen(true)}>
                <PlusIcon /> New workflow
              </Button>
            )
          ) : null}
        </header>
        <BuiltinGallery
          key={String(props.templatesOnly)}
          templatesOnly={props.templatesOnly ?? false}
          projects={projects}
          items={items}
          renderItem={(item, view, onTag) => (
            <LocalCard
              item={item}
              view={view}
              onTag={onTag}
              siblings={items
                .filter(
                  (sibling) =>
                    sibling.environmentId === item.environmentId &&
                    sibling.projectId === item.projectId,
                )
                .map((sibling) => sibling.listing)}
              onDelete={() =>
                setDeleteTarget({
                  environmentId: item.environmentId,
                  projectId: item.projectId,
                  workflow: item.listing.workflow,
                  projectTitle: item.projectTitle,
                  name: item.title,
                  hasActiveRun: !!item.status.running,
                })
              }
              onEditTags={() => setTagsTarget(item)}
              onInstall={() => setInstallTarget(item)}
            />
          )}
        />
        {deleteTarget ? (
          <WorkflowDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
        ) : null}
        {firstProject && newOpen ? (
          <WorkflowNewDialog
            open
            onOpenChange={setNewOpen}
            environmentId={firstProject.environmentId}
            projectId={firstProject.id}
            workflows={
              snapshots
                .find((snapshot) => snapshot.environmentId === firstProject.environmentId)
                ?.workflows.filter((listing) => listing.projectId === firstProject.id) ?? []
            }
            onCreated={(slug) =>
              void navigate({
                to: "/workflows/$environmentId/$projectId/$slug" as never,
                params: {
                  environmentId: firstProject.environmentId,
                  projectId: firstProject.id,
                  slug,
                } as never,
                search: {} as never,
              })
            }
          />
        ) : null}
        <Dialog
          open={!!editingTags}
          onOpenChange={(open) => {
            if (!open) setTagsTarget(null);
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Edit tags</DialogTitle>
              <DialogDescription>{editingTags?.title}</DialogDescription>
            </DialogHeader>
            <div className="p-6">
              {editingTags ? (
                <WorkflowTagsField
                  environmentId={editingTags.environmentId}
                  listing={editingTags.listing}
                />
              ) : null}
            </div>
          </DialogPopup>
        </Dialog>
        <Dialog
          open={!!installTarget}
          onOpenChange={(open) => {
            if (!open) setInstallTarget(null);
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Install missing skills</DialogTitle>
              <DialogDescription>
                {installTarget?.status.missingSkills.join(", ")}
              </DialogDescription>
            </DialogHeader>
            {installTarget ? (
              <div className="max-h-[70vh] overflow-y-auto p-6">
                <GallerySkillsInstaller
                  target={installTarget}
                  project={
                    projects.find(
                      (project) =>
                        project.environmentId === installTarget.environmentId &&
                        project.id === installTarget.projectId,
                    )?.workspaceRoot ?? undefined
                  }
                />
              </div>
            ) : null}
          </DialogPopup>
        </Dialog>
      </SidebarInset>
    </div>
  );
}
function LocalCard(props: {
  readonly item: LocalGalleryItem;
  readonly view: "grid" | "list";
  readonly onTag: (tag: string) => void;
  readonly siblings: ReadonlyArray<WorkflowListing>;
  readonly onDelete: () => void;
  readonly onEditTags: () => void;
  readonly onInstall: () => void;
}) {
  const { item } = props;
  const navigate = useNavigate();
  const edit = useWorkflowEdit(item.environmentId);
  const open = () =>
    void navigate({
      to: "/workflows/$environmentId/$projectId/$slug" as never,
      params: {
        environmentId: item.environmentId,
        projectId: item.projectId,
        slug: item.listing.workflow,
      } as never,
      search: {} as never,
    });
  const originThreadId = workflowScratchThreadId(item.listing);
  const pin = () =>
    void edit.run({
      _tag: "workflowPinSet",
      projectId: item.projectId,
      workflow: item.listing.workflow,
      pinned: !item.pinned,
    });
  const duplicate = async () => {
    if (!item.listing.definition) return;
    const { origin: _origin, ...definition } = item.listing.definition;
    const slug = uniqueWorkflowSlug(props.siblings, `${item.title} copy`);
    const result = await edit.run({
      _tag: "import",
      projectId: item.projectId,
      workflow: slug,
      definition: { ...definition, name: `${item.title} copy` },
      skills: [],
    });
    if (result)
      void navigate({
        to: "/workflows/$environmentId/$projectId/$slug" as never,
        params: { environmentId: item.environmentId, projectId: item.projectId, slug } as never,
        search: {} as never,
      });
  };
  return (
    <div>
      <GalleryCard
        item={item}
        view={props.view}
        onTag={props.onTag}
        onOpen={open}
        onRun={() =>
          requestWorkflowRun({
            environmentId: item.environmentId,
            projectId: item.projectId,
            listing: item.listing,
          })
        }
        canRun={!!item.listing.definition && !item.listing.blockers.length}
        canEdit={edit.canEdit && !edit.busy}
        onPin={pin}
        onInstall={props.onInstall}
        extra={
          item.scratch ? (
            <div className="flex items-center gap-1 text-2xs text-muted-foreground">
              <span>From thread</span>
              {originThreadId ? (
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Open thread that created ${item.title}`}
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(
                        scopeThreadRef(item.environmentId, ThreadId.make(originThreadId)),
                      ),
                    })
                  }
                >
                  Thread
                </Button>
              ) : null}
              <WorkflowKeepButton
                environmentId={item.environmentId}
                projectId={item.projectId}
                workflow={item.listing.workflow}
                name={item.title}
              />
            </div>
          ) : item.usedIn.length ? (
            <p className="truncate text-2xs text-muted-foreground">
              Used in: {item.usedIn.join(", ")}
            </p>
          ) : null
        }
        actions={
          edit.canEdit ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${item.title}`} />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  disabled={edit.busy || !item.listing.definition}
                  onClick={() => void duplicate()}
                >
                  Duplicate
                </MenuItem>
                <MenuItem
                  disabled={edit.busy || !item.listing.definition}
                  onClick={props.onEditTags}
                >
                  Edit tags
                </MenuItem>
                <MenuItem disabled={edit.busy} onClick={pin}>
                  {item.pinned ? "Unpin" : "Pin"}
                </MenuItem>
                <MenuItem variant="destructive" onClick={props.onDelete}>
                  Delete workflow…
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null
        }
      />
      {edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {edit.error}
        </p>
      ) : null}
    </div>
  );
}

function GallerySkillsInstaller(props: {
  readonly target: LocalGalleryItem;
  readonly project?: string | undefined;
}) {
  const edit = useWorkflowEdit(props.target.environmentId);
  return (
    <>
      <SkillsBrowser
        environmentId={props.target.environmentId}
        project={props.project}
        onInstalled={() => {
          void edit.run({
            _tag: "refresh",
            projectId: props.target.projectId,
            workflow: props.target.listing.workflow,
          });
        }}
      />
      {edit.error ? <p role="alert">{edit.error}</p> : null}
    </>
  );
}
