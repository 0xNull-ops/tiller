import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { WorkflowDefinition, WorkflowListing, WorkflowRun } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { Input } from "../components/ui/input";
import { STEP_STATUS_LABEL } from "./WorkflowNestedChildSteps";
import { buildOutlineRows, type OutlineFilter, type OutlineRow } from "./outlineRows";

/** One row's height. Every row is this tall, so the visible range is arithmetic, not measurement. */
const OUTLINE_ROW_HEIGHT = 36;
const OVERSCAN_ROWS = 8;
const INDENT_PX = 16;

const FILTER_LABEL: Record<OutlineFilter, string> = {
  all: "All steps",
  running: "Running",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  "not-run": "Not run yet",
  "missing-skill": "Skill missing",
};

/**
 * The steps of a workflow as a tree list, for workflows too big for the canvas to read. Only the
 * rows in view are rendered, and the arrow keys move through every visible row.
 */
export function WorkflowOutline(props: {
  readonly workflow: string;
  readonly definition: WorkflowDefinition;
  readonly workflows: ReadonlyArray<WorkflowListing>;
  readonly runFor: (workflow: string) => WorkflowRun | null;
  readonly missingSkills: ReadonlyArray<string>;
  readonly selectedStepId: string | null;
  /** Opens a step's inspector. Steps in a nested workflow open that workflow along the way. */
  readonly onSelectRow: (row: OutlineRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OutlineFilter>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [focusIndex, setFocusIndex] = useState(0);
  const [focusRequest, setFocusRequest] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = buildOutlineRows({
    workflow: props.workflow,
    definition: props.definition,
    workflows: props.workflows,
    runFor: props.runFor,
    expanded,
    query,
    filter,
    missingSkills: props.missingSkills,
  });
  const clampedFocus = Math.min(focusIndex, Math.max(rows.length - 1, 0));
  const first = Math.max(0, Math.floor(scrollTop / OUTLINE_ROW_HEIGHT) - OVERSCAN_ROWS);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / OUTLINE_ROW_HEIGHT) + OVERSCAN_ROWS,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Tracks the scroll viewport's size, which only the DOM knows.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    return observeResize(element, () => setViewportHeight(element.clientHeight));
  }, []);

  const moveFocus = (index: number) => {
    const next = Math.min(Math.max(index, 0), Math.max(rows.length - 1, 0));
    setFocusIndex(next);
    const element = scrollRef.current;
    if (element) {
      const top = next * OUTLINE_ROW_HEIGHT;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + OUTLINE_ROW_HEIGHT > element.scrollTop + element.clientHeight)
        element.scrollTop = top + OUTLINE_ROW_HEIGHT - element.clientHeight;
      // The window follows the scroll now, so the target row is rendered before the focus effect runs.
      setScrollTop(element.scrollTop);
      // A row already on screen takes focus now, so a key pressed right after sees it.
      const rendered = element.querySelector<HTMLElement>(`[data-outline-index="${next}"]`);
      if (rendered) {
        rendered.focus({ preventScroll: true });
        return;
      }
    }
    setFocusRequest(next);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Moves DOM focus to the row the keyboard chose once it has rendered.
  useEffect(() => {
    if (focusRequest === null) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-outline-index="${focusRequest}"]`)
      ?.focus({ preventScroll: true });
  }, [focusRequest]);

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The focused row is the source of truth: a key pressed before the last render still acts on it.
    const focused =
      event.target instanceof HTMLElement ? event.target.closest("[data-outline-index]") : null;
    const current = focused ? Number(focused.getAttribute("data-outline-index")) : clampedFocus;
    const row = rows[current];
    if (!row) return;
    if (event.key === "ArrowDown") moveFocus(current + 1);
    else if (event.key === "ArrowUp") moveFocus(current - 1);
    else if (event.key === "Home") moveFocus(0);
    else if (event.key === "End") moveFocus(rows.length - 1);
    else if (event.key === "ArrowRight") {
      if (row.canExpand && !row.expanded) toggle(row.key);
      else if (row.expanded) moveFocus(current + 1);
    } else if (event.key === "ArrowLeft") {
      if (row.expanded) toggle(row.key);
      else {
        const parent = findParent(rows, current);
        if (parent !== -1) moveFocus(parent);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      props.onSelectRow(row);
    } else return;
    event.preventDefault();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Input
          type="search"
          size="sm"
          aria-label="Search steps"
          placeholder="Search steps or skills"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFocusIndex(0);
          }}
          className="min-w-40 flex-1"
        />
        <select
          aria-label="Filter steps by status"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as OutlineFilter);
            setFocusIndex(0);
          }}
          className="h-7 rounded-md border bg-background px-2 text-xs"
        >
          {(Object.keys(FILTER_LABEL) as OutlineFilter[]).map((value) => (
            <option key={value} value={value}>
              {FILTER_LABEL[value]}
            </option>
          ))}
        </select>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {rows.length} {rows.length === 1 ? "step" : "steps"}
        </span>
      </div>
      <div
        ref={scrollRef}
        role="tree"
        aria-label="Workflow steps"
        className="relative min-h-0 flex-1 overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        {rows.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">No steps match.</p>
        ) : (
          <div className="relative" style={{ height: rows.length * OUTLINE_ROW_HEIGHT }}>
            {rows.slice(first, last).map((row, offset) => {
              const index = first + offset;
              return (
                <OutlineItem
                  key={row.key}
                  row={row}
                  index={index}
                  focused={index === clampedFocus}
                  selected={row.workflow === props.workflow && row.stepId === props.selectedStepId}
                  onFocusRow={() => setFocusIndex(index)}
                  onToggle={() => toggle(row.key)}
                  onSelect={() => props.onSelectRow(row)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function findParent(rows: ReadonlyArray<OutlineRow>, index: number): number {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index - 1; i >= 0; i -= 1) if (rows[i]!.depth < depth) return i;
  return -1;
}

function OutlineItem(props: {
  readonly row: OutlineRow;
  readonly index: number;
  readonly focused: boolean;
  readonly selected: boolean;
  readonly onFocusRow: () => void;
  readonly onToggle: () => void;
  readonly onSelect: () => void;
}) {
  const { row } = props;
  const status = row.status ? STEP_STATUS_LABEL[row.status] : null;
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={props.selected}
      {...(row.nested !== null && row.canExpand ? { "aria-expanded": row.expanded } : {})}
      aria-label={row.title}
      tabIndex={props.focused ? 0 : -1}
      data-outline-index={props.index}
      data-outline-key={row.key}
      onFocus={props.onFocusRow}
      onClick={props.onSelect}
      style={{ top: props.index * OUTLINE_ROW_HEIGHT, height: OUTLINE_ROW_HEIGHT }}
      className={cn(
        "absolute inset-x-0 flex min-w-0 cursor-pointer items-center gap-2 border-b pr-3 text-xs outline-none focus-visible:bg-accent",
        props.selected && "bg-accent",
        "hover:bg-accent/60",
      )}
    >
      <span
        className="flex shrink-0 items-center"
        style={{ paddingLeft: row.depth * INDENT_PX + 8 }}
      >
        {row.nested !== null && row.canExpand ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.title}`}
            className="flex size-4 items-center justify-center rounded hover:bg-muted"
            onClick={(event) => {
              event.stopPropagation();
              props.onToggle();
            }}
          >
            {row.expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
          </button>
        ) : (
          <span className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
      {row.skill !== null ? (
        <span className="max-w-40 shrink truncate font-mono text-2xs text-muted-foreground">
          {row.skill}
        </span>
      ) : row.nested !== null ? (
        <span className="shrink-0 text-2xs text-muted-foreground">Workflow {row.nested}</span>
      ) : null}
      {row.loop ? (
        <span className="shrink-0 rounded bg-muted px-1 text-3xs text-muted-foreground">
          {row.loop === "start" ? "Loop start" : row.loop === "end" ? "Loop end" : "In loop"}
        </span>
      ) : null}
      {row.branch ? (
        <span className="shrink-0 rounded bg-muted px-1 text-3xs text-muted-foreground">
          Branch
        </span>
      ) : null}
      {row.missingSkill ? (
        <span className="shrink-0 rounded bg-destructive/10 px-1 text-3xs text-destructive">
          Skill missing
        </span>
      ) : null}
      {status ? (
        <span className="w-16 shrink-0 text-right text-2xs text-muted-foreground">{status}</span>
      ) : null}
    </div>
  );
}
