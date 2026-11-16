import { WorkflowTags, type EnvironmentId, type WorkflowListing } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useWorkflowEdit, useWorkflowRuns } from "./workflowState";

const STARTER_TAGS = [
  "web",
  "design",
  "video",
  "marketing",
  "launch",
  "seo",
  "content",
  "brand",
  "growth",
  "dev",
  "research",
  "mobile",
];
const decodeTags = Schema.decodeUnknownExit(WorkflowTags);

export function WorkflowTagsField(props: {
  readonly environmentId: EnvironmentId;
  readonly listing: WorkflowListing;
}) {
  const edit = useWorkflowEdit(props.environmentId);
  const { workflows } = useWorkflowRuns(props.environmentId, props.listing.projectId);
  const suggestions = [
    ...new Set([
      ...STARTER_TAGS,
      ...workflows.flatMap((listing) => listing.definition?.tags ?? []),
    ]),
  ].toSorted();
  const id = useId();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const tags = props.listing.definition?.tags ?? [];
  const save = async (next: ReadonlyArray<string>) => {
    const result = decodeTags(next);
    if (result._tag === "Failure") {
      setProblem("Use up to 6 tags, each 1–24 letters, digits or hyphens.");
      return false;
    }
    setProblem(null);
    return (
      (await edit.run({
        _tag: "tagsSet",
        projectId: props.listing.projectId,
        workflow: props.listing.workflow,
        tags: result.value,
      })) !== null
    );
  };
  const add = async () => {
    if (!draft.trim()) return;
    if (await save([...tags, draft])) setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[120px_minmax(0,360px)] items-start gap-3 text-xs font-medium">
        <label htmlFor={`${id}-input`} className="pt-1 text-muted-foreground">
          Tags
        </label>
        <div className="flex gap-1">
          <Input
            id={`${id}-input`}
            size="sm"
            aria-label="Workflow tag"
            placeholder="Add a tag…"
            list={id}
            value={draft}
            disabled={!edit.canEdit || edit.busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                void add();
              }
            }}
          />
          <Button
            variant="outline"
            size="xs"
            disabled={!draft.trim() || !edit.canEdit || edit.busy}
            onClick={() => void add()}
          >
            Add
          </Button>
        </div>
      </div>
      <datalist id={id}>
        {suggestions
          .filter((tag) => !tags.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
      <div className="ml-[132px] flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Button
            key={tag}
            variant="outline"
            size="xs"
            aria-label={`Remove tag ${tag}`}
            disabled={!edit.canEdit || edit.busy}
            onClick={() => void save(tags.filter((item) => item !== tag))}
          >
            #{tag} ×
          </Button>
        ))}
      </div>
      {problem || edit.error ? (
        <p role="alert" className="text-xs text-destructive">
          {problem ?? edit.error}
        </p>
      ) : null}
    </div>
  );
}
