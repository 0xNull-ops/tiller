import { useSkillInstaller } from "../skillsSh/useSkillInstaller";
import type { EnvironmentId, SkillsShPreview } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "../../components/ui/button";
import { AuditBadge } from "../skillsSh/AuditBadge";
import type { BuiltinTemplate } from "./templateGallery";
export function TemplateSkillsInstaller(props: {
  readonly environmentId: EnvironmentId;
  readonly template: BuiltinTemplate;
  readonly installed: ReadonlySet<string>;
  readonly onInstalled: () => void;
}) {
  const installer = useSkillInstaller(props.environmentId);
  const canInstall = installer.canInstall;
  const [previews, setPreviews] = useState<ReadonlyArray<typeof SkillsShPreview.Type>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReadonlyArray<string>>([]);
  const missing = Object.entries(props.template.skills).filter(
    ([name]) => !props.installed.has(name) && !done.includes(name),
  );
  const load = useEffectEvent(async () => {
    const values: (typeof SkillsShPreview.Type)[] = [];
    for (const [, id] of missing) {
      values.push(await installer.preview(id));
    }
    return values;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Resolve installer previews from skills.sh when the template dialog mounts; ignore responses after dismissal.
  useEffect(() => {
    let active = true;
    void load().then(
      (values) => {
        if (active) {
          setPreviews(values);
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (active) {
          setError(String(cause));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const installAll = async () => {
    if (!canInstall || busy || loading) return;
    setBusy(true);
    setError(null);
    for (const [name, id] of missing) {
      const resolved = previews.find((entry) => entry.id === id);
      if (!resolved) {
        setError("A skill preview is unavailable. Close and reopen this dialog to retry.");
        break;
      }
      try {
        await installer.install(resolved, name);
      } catch (cause) {
        setError(String(cause));
        break;
      }
      setDone((current) => [...current, name]);
      props.onInstalled();
    }
    setBusy(false);
  };
  return (
    <div className="space-y-3 p-6">
      {loading ? <p className="text-sm text-muted-foreground">Loading skill previews…</p> : null}
      {previews.map((entry) => (
        <div key={entry.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{entry.name}</span>
          <AuditBadge audit={entry.audit} loaded />
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        disabled={loading || busy || !canInstall || missing.length === 0 || previews.length === 0}
        onClick={() => void installAll()}
      >
        {missing.length
          ? `Install all to All projects (${missing.length})`
          : "All skills installed"}
      </Button>
    </div>
  );
}
