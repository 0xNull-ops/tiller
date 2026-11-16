import { useRef, useState } from "react";
import type {
  EnvironmentId,
  SkillsShPreview,
  WorkflowListing,
  WorkflowSkillInfo,
} from "@t3tools/contracts";
import { workflowTemplates } from "@t3tools/shared/workflowTemplates";
import { Button } from "../components/ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { AuditBadge } from "../fork/skillsSh/AuditBadge";
import { useSkillInstaller } from "../fork/skillsSh/useSkillInstaller";
import { useEnvironmentQuery } from "../state/query";
import { useWorkflowEdit, workflowRead } from "./workflowState";
import { isWorkflowSkillStep } from "./workflowStep";
import { chooseSkillMatch, hasExactLocalSkill, resolveSkillSource } from "./missingSkills";

type Row = {
  name: string;
  status: string;
  history: string[];
  selected: boolean;
  local?: WorkflowSkillInfo;
  preview?: typeof SkillsShPreview.Type;
  installs?: number;
  done?: boolean;
};
export function MissingSkillActions(props: {
  environmentId: EnvironmentId;
  listing: WorkflowListing;
  stepId?: string;
  onChanged?: (() => void) | undefined;
}) {
  const installer = useSkillInstaller(props.environmentId);
  const edit = useWorkflowEdit(props.environmentId);
  const inventory = useEnvironmentQuery(
    workflowRead({
      environmentId: props.environmentId,
      input: { _tag: "skills", projectId: props.listing.projectId },
    }),
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const names = [
    ...new Set(
      props.listing.definition?.steps
        .filter(isWorkflowSkillStep)
        .filter(
          (step) =>
            (!props.stepId || step.id === props.stepId) &&
            props.listing.missingSkills.includes(step.skill),
        )
        .map((step) => step.skill) ?? [],
    ),
  ];
  const update = (name: string, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) =>
        row.name === name
          ? {
              ...row,
              ...patch,
              ...(patch.status ? { history: [...row.history, patch.status] } : {}),
            }
          : row,
      ),
    );
  const template = workflowTemplates.find((entry) =>
    props.listing.definition?.builtinTemplate
      ? entry.id === props.listing.definition.builtinTemplate
      : entry.definition.name === props.listing.definition?.name &&
        entry.definition.steps.every(
          (step) =>
            !isWorkflowSkillStep(step) ||
            props.listing.definition?.steps.some(
              (other) =>
                isWorkflowSkillStep(other) && other.id === step.id && other.skill === step.skill,
            ),
        ),
  );
  const find = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setOpen(true);
    setRows(
      names.map((name) => ({
        name,
        status: "Looking on this computer…",
        history: ["Looking on this computer…"],
        selected: true,
      })),
    );
    if (inventory.error || !inventory.data || inventory.data._tag !== "skills") {
      for (const name of names)
        update(name, {
          status: "Failed: Local skill inventory is unavailable. Close and retry once it loads.",
          selected: false,
        });
      running.current = false;
      setBusy(false);
      return;
    }
    try {
      const skills = inventory.data.skills;
      for (const name of names) {
        try {
          if (hasExactLocalSkill(name, skills)) {
            const local = chooseSkillMatch(name, skills, [])!;
            if (local.kind === "local")
              update(name, {
                local: local.skill,
                status: `Found ${local.skill.name} in ${local.skill.path.replace(/\/SKILL\.md$/, "")}`,
              });
            continue;
          }
          update(name, { status: "No exact match on this computer" });
          update(name, { status: "Searching skills.sh…" });
          const hits = (await installer.search(name)).filter((hit) => !hit.id.startsWith("site/"));
          const match = chooseSkillMatch(name, skills, hits);
          if (!match) {
            update(name, { status: "No match", selected: false });
            continue;
          }
          if (match.kind === "local") {
            update(name, {
              local: match.skill,
              status: `Closest match on this computer: ${match.skill.name} in ${match.skill.path.replace(/\/SKILL\.md$/, "")}`,
            });
            continue;
          }
          const hit = match.hit;
          const preview = await installer.preview(hit.id);
          update(name, { preview, installs: hit.installs, status: `Best match: ${hit.id}` });
        } catch (cause) {
          update(name, { status: `Failed: ${String(cause)}`, selected: false });
        }
      }
    } catch (cause) {
      for (const name of names)
        update(name, { status: `Failed: ${String(cause)}`, selected: false });
    }
    running.current = false;
    setBusy(false);
  };
  const installAll = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const unresolved: string[] = [];
    try {
      for (const name of names) {
        try {
          const id = resolveSkillSource(
            name,
            template?.skills ?? {},
            template?.skills[name] ? [] : await installer.search(name),
          );
          if (!id) {
            unresolved.push(`${name}: no exact source; use Find skills`);
            continue;
          }
          await installer.install(await installer.preview(id), name);
          await edit.run({
            _tag: "refresh",
            projectId: props.listing.projectId,
            workflow: props.listing.workflow,
          });
          props.onChanged?.();
          inventory.refresh();
        } catch (cause) {
          unresolved.push(`${name}: ${String(cause)}`);
        }
      }
      setMessage(unresolved.join(" · "));
    } catch (cause) {
      setMessage(String(cause));
    }
    running.current = false;
    setBusy(false);
  };
  const proposals = rows.filter((row) => row.selected && !row.done && (row.local || row.preview));
  const apply = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      for (const row of proposals) {
        try {
          update(row.name, { status: row.preview ? "Installing…" : "Linking…" });
          const name =
            row.local?.name ?? (await installer.install(row.preview!, row.preview!.name));
          for (const step of props.listing.definition?.steps ?? []) {
            if (
              !isWorkflowSkillStep(step) ||
              step.skill !== row.name ||
              (props.stepId && step.id !== props.stepId) ||
              step.skill === name
            )
              continue;
            if (
              !(await edit.run({
                _tag: "stepPut",
                projectId: props.listing.projectId,
                workflow: props.listing.workflow,
                step: { ...step, skill: name },
              }))
            )
              await Promise.reject(new Error("Could not link skill"));
          }
          update(row.name, { status: row.preview ? "Installed & linked" : "Linked", done: true });
          await edit.run({
            _tag: "refresh",
            projectId: props.listing.projectId,
            workflow: props.listing.workflow,
          });
          props.onChanged?.();
          inventory.refresh();
        } catch (cause) {
          update(row.name, { status: `Failed: ${String(cause)}` });
        }
      }
    } catch (cause) {
      setMessage(String(cause));
    }
    running.current = false;
    setBusy(false);
  };
  if (!names.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={busy || !installer.canInstall || !edit.canEdit}
          onClick={() => void installAll()}
        >
          {busy ? "Working…" : props.stepId ? "Install" : "Install all"}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busy || !edit.canEdit || inventory.isPending}
          onClick={() => void find()}
        >
          {props.stepId ? "Find" : "Find skills"}
        </Button>
      </div>
      {message ? (
        <p role="status" className="text-xs">
          {message}
        </p>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogPopup>
          <DialogTitle>Find skills</DialogTitle>
          <DialogDescription>
            Review proposals before installing to All projects and linking steps.
          </DialogDescription>
          <div className="max-h-96 space-y-3 overflow-auto py-3">
            {rows.map((row) => (
              <div key={row.name} className="space-y-1 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={row.name}
                    checked={row.selected}
                    disabled={busy || row.done || (!row.local && !row.preview)}
                    onChange={(event) => update(row.name, { selected: event.target.checked })}
                  />
                  {row.name}
                </label>
                <div role="status">
                  {[...new Set(row.history)].map((status) => (
                    <p key={status}>{status}</p>
                  ))}
                </div>
                {row.preview ? (
                  <p>
                    {row.installs?.toLocaleString()} installs ·{" "}
                    <AuditBadge audit={row.preview.audit} loaded />
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <Button
            disabled={
              busy ||
              !proposals.length ||
              !edit.canEdit ||
              (proposals.some((row) => row.preview) && !installer.canInstall)
            }
            onClick={() => void apply()}
          >
            Install &amp; link {proposals.length}
          </Button>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
