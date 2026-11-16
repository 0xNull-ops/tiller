import { SkillsBrowser } from "../fork/skillsSh/SkillsBrowser";
import { useState } from "react";
import { Pin, PinOff } from "lucide-react";
import type { EnvironmentId, ProjectId, WorkflowSkillInfo } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useEnvironmentQuery } from "../state/query";
import { useWorkflowEdit, workflowRead } from "./workflowState";
import { skillTemplate, slugify } from "./workflowEditing";
import { useWorkflowLiveRefresh } from "./useWorkflowLiveRefresh";

export function WorkflowSkillPickerContents(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  onPick: (name: string) => void;
  missingSkill?: string | undefined;
}) {
  const query = useEnvironmentQuery(
    workflowRead({
      environmentId: props.environmentId,
      input: { _tag: "skills", projectId: props.projectId },
    }),
  );
  useWorkflowLiveRefresh(props.environmentId, query.refresh);
  const edit = useWorkflowEdit(props.environmentId);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const skills = query.data?._tag === "skills" ? query.data.skills : [];
  const normalized = search.trim().toLocaleLowerCase();
  const filtered = skills.filter((skill) =>
    `${skill.name} ${skill.description ?? ""}`.toLocaleLowerCase().includes(normalized),
  );
  const uniqueByName = new Map<string, WorkflowSkillInfo>();
  for (const skill of filtered) {
    const key = skill.name.toLocaleLowerCase();
    if (!uniqueByName.has(key)) uniqueByName.set(key, skill);
  }
  const uniqueSkills = [...uniqueByName.values()];
  const pinnedSkills = uniqueSkills.filter((skill) => skill.pinned);
  const projectSkills = uniqueSkills.filter((skill) => !skill.pinned && skill.scope === "project");
  const globalSkills = uniqueSkills.filter((skill) => !skill.pinned && skill.scope === "global");
  const createName = slugify(search);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name || !edit.canEdit || edit.busy) return;
    const result = await edit.run({
      _tag: "skillWrite",
      projectId: props.projectId,
      name,
      content: skillTemplate(name, description.trim()),
      target: "project",
    });
    if (result) props.onPick(name);
  };

  return (
    <div className="w-80 p-2">
      <Input
        aria-label="Search skills"
        placeholder="Search skills…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setCreating(false);
        }}
        autoFocus
      />
      <div className="mt-2 max-h-64 overflow-auto">
        {query.isPending && !query.data ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading skills…</p>
        ) : null}
        {query.error ? (
          <p role="alert" className="px-2 py-3 text-xs text-destructive">
            Couldn’t load skills.
          </p>
        ) : null}
        {pinnedSkills.length > 0 ? (
          <SkillGroup
            title="Pinned"
            skills={pinnedSkills}
            onPick={props.onPick}
            onPin={edit.run}
            canEdit={edit.canEdit && !edit.busy}
          />
        ) : null}
        {!query.isPending && !query.error && filtered.length === 0 && !createName ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No matching skills.</p>
        ) : null}
        {projectSkills.length > 0 ? (
          <SkillGroup
            title="This project"
            skills={projectSkills}
            onPick={props.onPick}
            onPin={edit.run}
            canEdit={edit.canEdit && !edit.busy}
          />
        ) : null}
        {globalSkills.length > 0 ? (
          <SkillGroup
            title="Global"
            skills={globalSkills}
            onPick={props.onPick}
            onPin={edit.run}
            canEdit={edit.canEdit && !edit.busy}
          />
        ) : null}
        <section aria-label="skills.sh">
          <p className="px-2 py-1 text-xs text-muted-foreground">skills.sh</p>
          <SkillsBrowser
            environmentId={props.environmentId}
            compact
            installOnPick
            searchQuery={search.trim() || props.missingSkill || ""}
            onInstalled={props.onPick}
          />
        </section>
        {search.trim() && !skills.some((skill) => skill.name.toLocaleLowerCase() === createName) ? (
          creating ? (
            <form className="mt-2 space-y-2 border-t px-1 pt-2" onSubmit={create}>
              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">Skill name</span>
                <Input
                  aria-label="New skill name"
                  size="sm"
                  value={name}
                  onChange={(event) => setName(slugify(event.target.value))}
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">Description</span>
                <Input
                  aria-label="Skill description"
                  size="sm"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="One-line description"
                />
              </label>
              {edit.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {edit.error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="xs" onClick={() => setCreating(false)}>
                  Back
                </Button>
                <Button type="submit" size="xs" disabled={!edit.canEdit || edit.busy || !name}>
                  {edit.busy ? "Creating…" : "Create skill"}
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="mt-1 w-full rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
              onClick={() => {
                setName(createName);
                setCreating(true);
              }}
            >
              New skill “{search.trim()}”
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

function SkillGroup(props: {
  title: string;
  skills: ReadonlyArray<WorkflowSkillInfo>;
  onPick: (name: string) => void;
  onPin: (input: import("@t3tools/contracts").WorkflowEdit) => Promise<unknown>;
  canEdit: boolean;
}) {
  return (
    <section className="py-1">
      <h3 className="px-2 py-1 text-2xs font-medium text-muted-foreground">{props.title}</h3>
      {props.skills.map((skill) => (
        <div
          key={`${skill.scope}:${skill.name}`}
          className="group flex items-center rounded-md pr-1 hover:bg-muted focus-within:bg-muted"
        >
          <button
            type="button"
            className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => props.onPick(skill.name)}
          >
            <span className="block truncate text-xs font-medium">{skill.name}</span>
            {skill.description ? (
              <span className="block truncate text-2xs text-muted-foreground">
                {skill.description}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label={`${skill.pinned ? "Unpin" : "Pin"} ${skill.name}`}
            disabled={!props.canEdit}
            className={`rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${skill.pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
            onClick={(event) => {
              event.stopPropagation();
              void props.onPin({ _tag: "skillPinSet", name: skill.name, pinned: !skill.pinned });
            }}
          >
            {skill.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          </button>
        </div>
      ))}
    </section>
  );
}

export function WorkflowSkillPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onPick: (skillName: string) => void;
  readonly missingSkill?: string | undefined;
  readonly children: React.ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = props.open ?? internalOpen;
  const setOpen = (next: boolean) => {
    props.onOpenChange?.(next);
    if (props.open === undefined) setInternalOpen(next);
  };
  const pick = (name: string) => {
    props.onPick(name);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={props.children} />
      {open ? (
        <PopoverPopup
          align="start"
          width="auto"
          padding="none"
          onWheel={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <WorkflowSkillPickerContents
            environmentId={props.environmentId}
            projectId={props.projectId}
            onPick={pick}
            missingSkill={props.missingSkill}
          />
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}
