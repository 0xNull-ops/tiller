import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, WorkflowTemplateUseResult } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { createWorkflowTemplateCommands } from "@t3tools/client-runtime/state/workflowTemplates";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useQuietThreadShells } from "../../state/entities";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../../components/ui/select";
import { GalleryView } from "../../workflows/GalleryView";
import { GalleryCard } from "../../workflows/GalleryCard";
import { SCRATCH_PROJECT_TITLE } from "../../components/settings/ProjectSettingsPanel.logic";
import { useWorkflowEdit, useWorkflowRuns, workflowRead } from "../../workflows/workflowState";
import { useWorkflowLiveRefresh } from "../../workflows/useWorkflowLiveRefresh";
import type { LocalGalleryItem } from "../../workflows/localGalleryItems";
import { readLastChatPath } from "../../workflows/workflowUiStore";
import { TemplateSkillsInstaller } from "./TemplateSkillsInstaller";
import { templateGalleryItems, type BuiltinTemplate } from "./templateGallery";

const SampleCanvas = lazy(() =>
  import("../tour/SampleCanvas").then((module) => ({ default: module.SampleCanvas })),
);
const WorkflowSchedulePanel = lazy(() =>
  import("../../workflows/WorkflowSchedulePanel").then((module) => ({
    default: module.WorkflowSchedulePanel,
  })),
);
const commands = createWorkflowTemplateCommands(connectionAtomRuntime);
type Project = {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
};
type Props = {
  readonly items: ReadonlyArray<LocalGalleryItem>;
  readonly projects: ReadonlyArray<Project>;
  readonly templatesOnly: boolean;
  readonly renderItem: (
    item: LocalGalleryItem,
    view: "grid" | "list",
    onTag: (tag: string) => void,
  ) => ReactNode;
};
export function BuiltinGallery(props: Props) {
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const currentThread = useQuietThreadShells().find(
    (thread) => readLastChatPath() === `/${thread.environmentId}/${thread.id}`,
  );
  const currentProject = props.projects.find(
    (project) =>
      project.environmentId === currentThread?.environmentId &&
      project.id === currentThread.projectId,
  );
  const project =
    props.projects.find((p) => `${p.environmentId}/${p.id}` === projectKey) ??
    currentProject ??
    props.projects[0];
  if (!project) return <UnconnectedGallery {...props} />;
  return (
    <ConnectedGallery
      key={`${project.environmentId}/${project.id}`}
      {...props}
      project={project}
      onProject={setProjectKey}
    />
  );
}
function ConnectedGallery(
  props: Props & { readonly project: Project; readonly onProject: (key: string) => void },
) {
  const { project } = props;
  const navigate = useNavigate();
  const [selected, setSelected] = useState<BuiltinTemplate | null>(null);
  const [copy, setCopy] = useState<WorkflowTemplateUseResult | null>(null);
  const [installing, setInstalling] = useState<BuiltinTemplate | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preferencesQuery = useEnvironmentQuery(
    workflowRead({ environmentId: project.environmentId, input: { _tag: "preferences" } }),
  );
  const skillsQuery = useEnvironmentQuery(
    workflowRead({
      environmentId: project.environmentId,
      input: { _tag: "skills", projectId: project.id },
    }),
  );
  const preferences =
    preferencesQuery.data?._tag === "preferences" ? preferencesQuery.data.preferences : null;
  const installed = new Set(
    skillsQuery.data?._tag === "skills" ? skillsQuery.data.skills.map((skill) => skill.name) : [],
  );
  const edit = useWorkflowEdit(project.environmentId);
  useWorkflowLiveRefresh(project.environmentId, preferencesQuery.refresh);
  const useTemplate = useAtomCommand(commands.use, {
    label: "Use workflow template",
    reportFailure: false,
  });
  const canUse = useAtomValue(commands.use.permissionAtom(project.environmentId));
  const templates =
    preferences?.showBuiltinWorkflows === false
      ? []
      : templateGalleryItems(installed, preferences?.hiddenBuiltins ?? [], showHidden);
  const openCopy = (slug: string) =>
    void navigate({
      to: "/workflows/$environmentId/$projectId/$slug" as never,
      params: { environmentId: project.environmentId, projectId: project.id, slug } as never,
      search: {} as never,
    });
  const use = async (template: BuiltinTemplate) => {
    if (!canUse || busy) return;
    setBusy(true);
    setError(null);
    const result = await useTemplate({
      environmentId: project.environmentId,
      input: { templateId: template.id, projectId: project.id },
    });
    setBusy(false);
    if (result._tag === "Success") {
      setSelected(null);
      if (result.value.suggestedSchedule) setCopy(result.value);
      else openCopy(result.value.slug);
    } else setError(String(squashAtomCommandFailure(result)));
  };
  const hide = async (id: string) => {
    const hidden = preferences?.hiddenBuiltins ?? [];
    await edit.run({
      _tag: "preferencesSet",
      hiddenBuiltins: hidden.includes(id)
        ? hidden.filter((entry) => entry !== id)
        : [...hidden, id],
    });
    preferencesQuery.refresh();
  };
  return (
    <>
      <div className="flex items-center gap-3 border-b px-5 py-2">
        <span className="text-xs text-muted-foreground">Template destination</span>
        <Select
          value={`${project.environmentId}/${project.id}`}
          onValueChange={(key) => {
            if (key) props.onProject(key);
          }}
        >
          <SelectTrigger aria-label="Template project">
            <SelectValue>{project.title}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {props.projects.map((entry) => (
              <SelectItem
                key={`${entry.environmentId}/${entry.id}`}
                value={`${entry.environmentId}/${entry.id}`}
              >
                {entry.title} · {entry.environmentId}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {preferences?.hiddenBuiltins.length ? (
          <Button variant="ghost" size="xs" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? "Hide hidden" : "Show hidden"}
          </Button>
        ) : null}
      </div>
      {error || edit.error ? (
        <p role="alert" className="px-5 text-sm text-destructive">
          {error ?? edit.error}
        </p>
      ) : null}
      <GalleryView
        initialSource={props.templatesOnly ? "builtin" : undefined}
        items={[...props.items, ...templates]}
        renderItem={(item, view, onTag) =>
          "template" in item ? (
            <GalleryCard
              item={item}
              view={view}
              onTag={onTag}
              onOpen={() => setSelected(item.template)}
              onRun={() => void use(item.template)}
              canRun={canUse && !busy}
              canEdit={false}
              onPin={() => {}}
              onInstall={() => setInstalling(item.template)}
              actions={
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!edit.canEdit || edit.busy || preferences === null}
                  onClick={() => void hide(item.template.id)}
                >
                  {preferences?.hiddenBuiltins.includes(item.template.id) ? "Unhide" : "Hide"}
                </Button>
              }
            />
          ) : (
            props.renderItem(item, view, onTag)
          )
        }
      />
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogPopup className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{selected?.definition.name} · Built-in</DialogTitle>
            <DialogDescription>
              {selected?.definition.brief} · Copies to {destinationLabel(project)}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <>
              <TemplatePreview definition={selected.definition} />
              <div className="flex justify-end gap-2 p-4">
                <Button variant="outline" onClick={() => setInstalling(selected)}>
                  Needs {Object.keys(selected.skills).filter((name) => !installed.has(name)).length}{" "}
                  skills · Install all
                </Button>
                <Button disabled={!canUse || busy} onClick={() => void use(selected)}>
                  Use template
                </Button>
              </div>
            </>
          ) : null}
        </DialogPopup>
      </Dialog>
      <Dialog
        open={installing !== null}
        onOpenChange={(open) => {
          if (!open) setInstalling(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Install template skills</DialogTitle>
            <DialogDescription>
              Install missing skills to All projects. Existing skills with the same name are kept.
            </DialogDescription>
          </DialogHeader>
          {installing ? (
            <TemplateSkillsInstaller
              environmentId={project.environmentId}
              template={installing}
              installed={installed}
              onInstalled={() => skillsQuery.refresh()}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
      {copy?.suggestedSchedule ? (
        <CopiedSchedule
          project={project}
          copy={copy}
          onClose={() => {
            setCopy(null);
            openCopy(copy.slug);
          }}
        />
      ) : null}
    </>
  );
}
function CopiedSchedule(props: {
  readonly project: Project;
  readonly copy: WorkflowTemplateUseResult;
  readonly onClose: () => void;
}) {
  const query = useWorkflowRuns(props.project.environmentId, props.project.id);
  const threads = useQuietThreadShells().filter(
    (thread) =>
      thread.environmentId === props.project.environmentId &&
      thread.projectId === props.project.id &&
      !thread.archivedAt &&
      !thread.deletedAt,
  );
  const listing = query.workflows.find((item) => item.workflow === props.copy.slug);
  return listing ? (
    <Suspense fallback={<p className="p-6">Loading schedule…</p>}>
      <WorkflowSchedulePanel
        environmentId={props.project.environmentId}
        projectId={props.project.id}
        workflow={listing}
        driverThreadId={null}
        driverThreads={threads.map(({ id, title }) => ({ id, title }))}
        suggestedSchedule={props.copy.suggestedSchedule}
        onClose={props.onClose}
      />
    </Suspense>
  ) : (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Set up schedule</DialogTitle>
          <DialogDescription>Loading the copied workflow…</DialogDescription>
        </DialogHeader>
        <Button variant="ghost" onClick={props.onClose}>
          Skip schedule
        </Button>
      </DialogPopup>
    </Dialog>
  );
}

/** The preview's box is a flex column so the canvas root can take the height. */
function TemplatePreview(props: { readonly definition: BuiltinTemplate["definition"] }) {
  return (
    <div className="flex h-[60vh] min-h-0 flex-col">
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading canvas…</p>}>
        <SampleCanvas run={null} editPreview={false} definition={props.definition} />
      </Suspense>
    </div>
  );
}

function destinationLabel(project: Project) {
  return project.title === SCRATCH_PROJECT_TITLE ? `${project.title} (no folder)` : project.title;
}

function UnconnectedGallery(props: Props) {
  const [selected, setSelected] = useState<BuiltinTemplate | null>(null);
  return (
    <>
      <GalleryView
        initialSource={props.templatesOnly ? "builtin" : undefined}
        items={[...props.items, ...templateGalleryItems(new Set(), [], false)]}
        renderItem={(item, view, onTag) =>
          "template" in item ? (
            <GalleryCard
              item={item}
              view={view}
              onTag={onTag}
              onOpen={() => setSelected(item.template)}
              onRun={() => {}}
              canRun={false}
              canEdit={false}
              onPin={() => {}}
              actions={null}
            />
          ) : (
            props.renderItem(item, view, onTag)
          )
        }
      />
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogPopup className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{selected?.definition.name} · Built-in</DialogTitle>
            <DialogDescription>
              {selected?.definition.brief} · Add a project to copy this template. In the sidebar,
              choose Add project, then open the template again.
            </DialogDescription>
          </DialogHeader>
          {selected ? <TemplatePreview definition={selected.definition} /> : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}
