import { ArrowLeftIcon } from "lucide-react";
import { Button } from "../components/ui/button";

/**
 * The path from the workflow the panel started on to the nested workflow on screen. Each part is
 * a button, so any ancestor is keyboard reachable.
 */
export function WorkflowNestTrail(props: {
  /** Ancestor slugs, outermost first. */
  readonly trail: ReadonlyArray<string>;
  readonly current: string;
  readonly nameOf: (workflow: string) => string;
  readonly onBackTo: (index: number) => void;
}) {
  if (props.trail.length === 0) return null;
  const parent = props.trail[props.trail.length - 1]!;
  return (
    <nav
      aria-label="Workflow path"
      className="flex min-w-0 items-center gap-2 border-b px-3 py-1.5 text-2xs text-muted-foreground"
    >
      <Button
        variant="ghost"
        size="xs"
        aria-label={`Back to ${props.nameOf(parent)}`}
        onClick={() => props.onBackTo(props.trail.length - 1)}
      >
        <ArrowLeftIcon />
        Back
      </Button>
      <ol className="flex min-w-0 items-center gap-1 overflow-hidden">
        {props.trail.map((slug, index) => (
          <li key={slug} className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              className="max-w-40 truncate rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => props.onBackTo(index)}
            >
              {props.nameOf(slug)}
            </button>
            <span aria-hidden>/</span>
          </li>
        ))}
        <li aria-current="page" className="max-w-48 truncate font-medium text-foreground">
          {props.nameOf(props.current)}
        </li>
      </ol>
    </nav>
  );
}
