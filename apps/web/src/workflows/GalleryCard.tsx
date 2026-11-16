import { memo, useId, type ReactNode } from "react";
import { ClockIcon, PinIcon, PlayIcon, ZapIcon } from "lucide-react";
import { galleryFlowArt } from "./galleryFlowArt";
import type { GalleryItem } from "./workflowGallery";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";

const FlowArt = memo(function FlowArt({ item }: { readonly item: GalleryItem }) {
  const id = useId();
  const art = galleryFlowArt(item);
  return (
    <svg viewBox="0 0 400 225" aria-hidden="true" className="h-full w-full">
      <defs>
        <linearGradient id={`${id}-bg`} gradientTransform={`rotate(${art.angle} .5 .5)`}>
          <stop stopColor={`hsl(${art.hue} 34% 13%)`} />
          <stop offset="1" stopColor={`hsl(${art.hue} 24% 5%)`} />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop stopColor={`hsl(${art.hue} 86% 70%)`} stopOpacity=".23" />
          <stop offset="1" stopColor={`hsl(${art.hue} 86% 70%)`} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="225" fill={`url(#${id}-bg)`} />
      <ellipse cx="110" cy="35" rx="290" ry="220" fill={`url(#${id}-glow)`} />
      <g fill="none" stroke={`hsl(${art.hue} 86% 74%)`} strokeWidth="1">
        <path d={art.spine} opacity=".35" />
        {art.edges.map((path) => (
          <path key={path} d={path} opacity=".45" />
        ))}
        {art.loops.map((path) => (
          <path key={path} d={path} opacity=".75" />
        ))}
      </g>
      {art.dots.map((dot) => (
        <g key={dot.id} fill={`hsl(${art.hue} 90% 82%)`}>
          <circle cx={dot.x} cy={dot.y} r="8" opacity=".07" />
          <circle cx={dot.x} cy={dot.y} r="4.5" opacity=".15" />
          <circle cx={dot.x} cy={dot.y} r={art.wave ? 1.7 : 2.5} />
        </g>
      ))}
    </svg>
  );
});

export function GalleryCard(props: {
  readonly item: GalleryItem;
  readonly view: "grid" | "list";
  readonly onOpen: () => void;
  readonly onRun: () => void;
  readonly canRun: boolean;
  readonly onTag: (tag: string) => void;
  readonly onPin: () => void;
  readonly canEdit: boolean;
  readonly actions: ReactNode;
  readonly extra?: ReactNode;
  readonly onInstall?: (() => void) | undefined;
}) {
  const { item } = props;
  return (
    <article
      data-gallery-card
      aria-label={item.title}
      style={props.view === "grid" ? { height: "var(--gallery-card-height, 356px)" } : undefined}
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-xl border bg-card",
        props.view === "list" && "flex h-[112px] items-center",
        item.status.running && "ring-1 ring-primary",
        item.status.problem && "opacity-65",
      )}
    >
      {props.view === "grid" ? (
        <div
          data-gallery-cover
          className="relative overflow-hidden"
          style={{ height: "var(--gallery-cover-height, 174px)" }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Open ${item.title} cover`}
            onClick={props.onOpen}
            className="h-full w-full cursor-pointer"
          >
            <FlowArt item={item} />
          </button>
          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between text-3xs font-semibold tracking-wide text-white/80">
            <span className="rounded border border-white/15 bg-black/25 px-1.5 py-0.5">
              {item.workSteps > 5 ? "PRO" : "FREE"}
            </span>
            <span className="flex gap-2">
              {item.triggers.map((trigger) => (
                <span key={trigger} aria-label={trigger}>
                  {trigger === "schedule" ? (
                    <ClockIcon className="size-3.5" />
                  ) : (
                    <ZapIcon className="size-3.5" />
                  )}
                </span>
              ))}
            </span>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "min-w-0 flex-1 px-4",
          props.view === "list" ? "space-y-1 py-2" : "space-y-2 py-3",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={props.onOpen}
            className="truncate text-left text-sm font-semibold hover:underline"
          >
            {item.title}
          </button>
          {item.source === "builtin" ? (
            <Badge variant="outline">Built-in</Badge>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.title}`}
              aria-pressed={item.pinned}
              disabled={!props.canEdit}
              onClick={props.onPin}
            >
              <PinIcon fill={item.pinned ? "currentColor" : "none"} />
            </Button>
          )}
        </div>
        {props.view === "grid" ? (
          <p className="line-clamp-2 h-8 text-xs leading-4 text-muted-foreground">
            {item.brief ?? "No brief yet."}
          </p>
        ) : null}
        <div className="flex h-4 flex-wrap gap-x-2 overflow-hidden text-2xs text-muted-foreground">
          {item.tags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => props.onTag(tag)}
              className="cursor-pointer hover:text-primary"
            >
              #{tag}
            </button>
          ))}
        </div>
        <div className="truncate text-2xs text-muted-foreground">
          {item.status.running
            ? `Running · step ${item.status.running.step}/${item.status.running.total}`
            : `${item.workSteps} steps`}
          {item.status.lastRunAt
            ? ` · Ran ${new Date(item.status.lastRunAt).toLocaleDateString()}`
            : ""}
          {item.status.nextRunAt
            ? ` · Next ${new Date(item.status.nextRunAt).toLocaleString()}`
            : ""}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {item.status.problem ? (
            <p className="truncate text-2xs text-destructive">{item.status.problem}</p>
          ) : item.status.missingSkills.length ? (
            <button
              type="button"
              onClick={props.onInstall}
              disabled={!props.onInstall}
              className="text-2xs text-warning-foreground"
            >
              Needs {item.status.missingSkills.length} skills ·{" "}
              {item.source === "builtin" ? "Install all" : "Install"}
            </button>
          ) : null}
          {props.extra}
        </div>
      </div>
      <div
        data-gallery-quick
        style={
          props.view === "grid"
            ? { top: "calc(var(--gallery-cover-height, 174px) - 38px)" }
            : undefined
        }
        className={cn(
          "flex items-center gap-1",
          props.view === "grid" ? "absolute right-2 rounded-md bg-background/95 p-1" : "pr-3",
        )}
      >
        <Button
          variant="outline"
          size="xs"
          aria-label={`${item.source === "builtin" ? "Use template" : "Run"} ${item.title}`}
          disabled={!props.canRun}
          onClick={props.onRun}
        >
          <PlayIcon /> {item.source === "builtin" ? "Use template" : "Run"}
        </Button>
        <Button variant="ghost" size="xs" onClick={props.onOpen}>
          Open
        </Button>
        {props.actions}
      </div>
    </article>
  );
}
