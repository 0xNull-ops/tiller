import { TERRAIN } from "./terrain";
import type { SceneManifest, SceneTravelerImage } from "../manifest";
import { useNavigate, useParams } from "@tanstack/react-router";
import { CrosshairIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { memo, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";

import { observeResize } from "../../../lib/observeResize";
import { useQuietThreadVisibleTurnItems, useThreadShells } from "../../../state/entities";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../../threadRoutes";
import {
  BLOCK_MS,
  carBlock,
  deriveJourneyStops,
  journeyBlocks,
  journeyStatus,
  type JourneyStatus,
  type JourneyStop,
} from "../journey";
import { requestTimelineJump } from "../timelineJump";
import "./map.css";
import { buildCity, CITY_SIZE, placeOnCity, routeOnCity, type CityPoint } from "./cityLayout";
import { imageMarkerFrame } from "./marker";
import { JourneyStopMarker } from "./JourneyStopMarker";

const CITY = buildCity();
const MAX_PARKED = 14;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const DEFAULT_ZOOM = 1.3;

const STATUS_TEXT: Record<JourneyStatus, string> = {
  driving: "Driving",
  waiting: "Stopped · needs you",
  failed: "Broke down",
  parked: "Parked",
};

type Parked = CityPoint & {
  key: string;
  title: string;
  status: JourneyStatus;
  route: ReturnType<typeof buildThreadRouteParams>;
};

function angle(from: CityPoint, to: CityPoint): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Re-renders on each block boundary while the car drives, so it glides corner to corner with a
 * CSS transition instead of repainting every frame. Idle threads never tick.
 */
function useDrivingClock(driving: boolean, anchor: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the timer that advances the driving car.
  useEffect(() => {
    if (!driving) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const base = anchor ?? current;
      const next = BLOCK_MS - ((((current - base) % BLOCK_MS) + BLOCK_MS) % BLOCK_MS);
      timer = setTimeout(tick, Math.max(50, next));
    };
    tick();
    return () => clearTimeout(timer);
  }, [driving, anchor]);
  return now;
}

function Paw() {
  return (
    <>
      <ellipse cy={4} rx={7} ry={5} />
      <ellipse cx={-8} cy={-3} rx={3} ry={4} />
      <ellipse cx={-3} cy={-8} rx={3} ry={4} />
      <ellipse cx={4} cy={-8} rx={3} ry={4} />
      <ellipse cx={9} cy={-2} rx={3} ry={4} />
    </>
  );
}

function stamps(route: ReadonlyArray<CityPoint>) {
  const result: Array<CityPoint & { heading: number }> = [];
  let remaining = 7;
  let count = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    for (; remaining < length; remaining += 14) {
      const offset = count++ % 2 ? 3 : -3;
      result.push({
        x: a.x + (dx * remaining) / length - (dy / length) * offset,
        y: a.y + (dy * remaining) / length + (dx / length) * offset,
        heading: angle(a, b) + 90,
      });
      if (result.length > 120) result.shift();
    }
    remaining -= length;
  }
  return result;
}

type Vehicle = SceneManifest["map"]["traveler"];

function CarBody() {
  return (
    <>
      <rect data-car-part="body" x={-11} y={-6} width={22} height={12} rx={4} />
      <rect data-car-part="glass" x={-3} y={-4.5} width={7} height={9} rx={2} />
      <rect data-car-part="light" x={9} y={-5} width={2.5} height={3} rx={1} />
      <rect data-car-part="light" x={9} y={2} width={2.5} height={3} rx={1} />
    </>
  );
}

/** A theme's own sprite. It keeps its aspect ratio and falls back instead of showing a broken image. */
function ImageTraveler({ traveler }: { traveler: SceneTravelerImage }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (traveler.image.length === 0 || failedImage === traveler.image) return <CarBody />;
  return (
    <image
      data-car-part="sprite"
      href={traveler.image}
      {...imageMarkerFrame(traveler)}
      onError={() => setFailedImage(traveler.image)}
    />
  );
}

function Sleigh() {
  return (
    <>
      <path data-car-part="runner" d="M-13 8 H6.5 C10.5 8 12.5 6 12.5 2.5" />
      <path data-car-part="body" d="M-9 5 H5.5 C8 5 9.5 3 9.5 0.5 V-1.5 H-9 Z" />
      <path data-car-part="trim" d="M-9 -1.5 C-11.5 -1.5 -11.5 -6.5 -8.5 -7" />
      <path data-car-part="trim" d="M5.5 5 C9.5 5 11.5 2 10.5 -1.5 C9.5 -4.5 6.5 -4.5 6 -1.5" />
      <circle data-car-part="light" cx={8.6} cy={-3.2} r={1.45} />
    </>
  );
}

/** The marker a thread travels as. Drawn in SVG so it stays crisp at map scale; faces right. */
function Car({ kind, vehicle }: { kind: "hero" | "parked"; vehicle: Vehicle }) {
  if (typeof vehicle === "object")
    return (
      <g data-car={kind}>
        <ImageTraveler traveler={vehicle} />
      </g>
    );
  if (vehicle === "paw")
    return (
      <g data-car={kind}>
        <g data-car-part="body">
          <Paw />
        </g>
      </g>
    );
  if (vehicle === "boat")
    return (
      <g data-car={kind}>
        <path data-car-part="body" d="M-12 3 L12 3 L7 10 L-7 10 Z" />
        <path data-car-part="light" d="M0 2 L0 -13 L10 0 Z" />
      </g>
    );
  if (vehicle === "rider") {
    return (
      <g data-car={kind}>
        <circle data-car-part="body" r={6.5} />
        <path data-car-part="light" d="M-1 -12 L-1 -3 M-1 -12 L8 -9.5 L-1 -7" />
        <circle data-car-part="glass" r={2.5} />
      </g>
    );
  }
  if (vehicle === "sleigh")
    return (
      <g data-car={kind}>
        <Sleigh />
      </g>
    );
  return (
    <g data-car={kind}>
      <CarBody />
    </g>
  );
}

/** A small checkered flag planted at a point; drawn wherever a turn reached its reply. */
function Flag() {
  return (
    <g data-flag="">
      <line x1={0} y1={0} x2={0} y2={-16} />
      <rect data-flag-cloth="" x={0} y={-16} width={11} height={7} />
      <rect data-flag-check="" x={0} y={-16} width={3.7} height={3.5} />
      <rect data-flag-check="" x={7.3} y={-16} width={3.7} height={3.5} />
      <rect data-flag-check="" x={3.7} y={-12.5} width={3.6} height={3.5} />
    </g>
  );
}

/**
 * The thread journey map. The open thread is a trip through the city: its car drives while the
 * agent works, every action is pinned where it happened, and each reply is a checkered-flag
 * checkpoint. Other threads are parked cars you can click to open.
 */
export type MapStyle = "streets" | "parchment";

export const SceneMap = memo(function SceneMap({
  traveler: vehicle,
  trail = "line",
  mapStyle,
  terrain,
  path,
}: {
  traveler: Vehicle;
  trail?: "line" | "prints" | undefined;
  mapStyle: MapStyle;
  terrain: NonNullable<SceneManifest["map"]["terrain"]>;
  path: NonNullable<SceneManifest["map"]["path"]>;
}) {
  const shells = useThreadShells();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const currentRef = resolveThreadRouteRef(params);
  const items = useQuietThreadVisibleTurnItems(currentRef);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [requestedZoom, setZoom] = useState(DEFAULT_ZOOM);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the viewport dimensions for camera bounds.
  useEffect(() => {
    if (!viewport) return;
    return observeResize(viewport, ([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewportSize({ width, height });
    });
  }, [viewport]);
  const minimumZoom = Math.max(
    MIN_ZOOM,
    Math.max(viewportSize.width, viewportSize.height) / CITY_SIZE,
  );
  const zoom = Math.max(minimumZoom, requestedZoom);
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const currentShell =
    currentRef === null
      ? null
      : (shells.find(
          (shell) =>
            shell.id === currentRef.threadId && shell.environmentId === currentRef.environmentId,
        ) ?? null);
  const status = currentShell ? journeyStatus(currentShell) : "parked";
  const driving = status === "driving";
  const { stops, turns } = deriveJourneyStops(items);
  const blocks = journeyBlocks(stops);
  const resumedAt = parseTime(currentShell?.runtime?.activityStartedAt);
  const lastAt = stops.at(-1)?.at ?? null;
  const anchor = lastAt !== null && resumedAt !== null ? Math.max(lastAt, resumedAt) : lastAt;
  const now = useDrivingClock(driving, anchor);
  const position = carBlock(stops, blocks, status, now, resumedAt);

  // While driving, the car heads for the next corner and arrives on the next tick.
  const from = Math.floor(position);
  const target = driving ? from + 1 : from;
  const glideMs = driving ? Math.max(0, (target - position) * BLOCK_MS) : 0;
  const route = currentShell ? routeOnCity(CITY, currentShell.id, target + 2) : [];
  const fromPoint = route[from];
  const carPoint = route[target];
  const behind = route[Math.max(0, target - 1)];
  const heading = carPoint && behind && carPoint !== behind ? angle(behind, carPoint) : 0;
  // Top-down vehicles turn with the road; side-on sprites only flip so they stay upright.
  const facing =
    vehicle === "car" || vehicle === "boat"
      ? `rotate(${heading}deg)`
      : `scaleX(${Math.cos((heading * Math.PI) / 180) < 0 ? -1 : 1})`;

  const parked: ReadonlyArray<Parked> = shells
    .filter((shell) => shell.archivedAt === null && shell.id !== currentShell?.id)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_PARKED)
    .map((shell) => ({
      ...placeOnCity(CITY, shell.id),
      key: `${shell.environmentId}:${shell.id}`,
      title: shell.title,
      status: journeyStatus(shell),
      route: buildThreadRouteParams({ environmentId: shell.environmentId, threadId: shell.id }),
    }));
  const othersDriving = parked.filter((car) => car.status === "driving").length;
  const othersWaiting = parked.filter((car) => car.status === "waiting").length;

  const focus = carPoint ?? { x: CITY_SIZE / 2, y: CITY_SIZE / 2 };
  const following = pan.x === 0 && pan.y === 0;
  const clampAxis = (translate: number, size: number) => {
    const scaledSize = CITY_SIZE * zoom;
    return scaledSize < size
      ? -scaledSize / 2
      : Math.max(size / 2 - scaledSize, Math.min(-size / 2, translate));
  };
  const tx = clampAxis(pan.x - focus.x * zoom, viewportSize.width);
  const ty = clampAxis(pan.y - focus.y * zoom, viewportSize.height);
  const cameraTransition = dragging
    ? "none"
    : driving && following
      ? `transform ${glideMs}ms linear`
      : "transform 0.45s ease";
  const lastStop = stops.at(-1);
  // The small map shows only the current turn; the enlarged map shows the whole trip.
  const turnStartIndex = Math.max(
    0,
    stops.findLastIndex((stop) => stop.kind === "prompt"),
  );
  const firstShown = expanded ? 0 : turnStartIndex;
  const routeStart = expanded ? 0 : (blocks[turnStartIndex] ?? 0);
  const caption =
    status === "waiting"
      ? "Waiting for you"
      : status === "failed"
        ? "Stopped: something failed"
        : driving
          ? lastStop && lastStop.kind !== "prompt" && lastStop.kind !== "checkpoint"
            ? lastStop.label
            : "Thinking"
          : null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
    start.x = event.clientX;
    start.y = event.clientY;
    setPan({
      x: clampAxis(tx + dx, viewportSize.width) + focus.x * zoom,
      y: clampAxis(ty + dy, viewportSize.height) + focus.y * zoom,
    });
  };
  const onPointerUp = () => {
    setDragging(false);
    // Keep `moved` readable by the click that follows this pointerup.
    setTimeout(() => {
      drag.current = null;
    }, 0);
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const factor = event.deltaY > 0 ? 0.94 : 1.06;
    setZoom((z) => Math.max(minimumZoom, Math.min(MAX_ZOOM, Math.max(minimumZoom, z) * factor)));
  };
  const recenter = () => {
    setPan({ x: 0, y: 0 });
    setZoom(DEFAULT_ZOOM);
  };
  const openThread = (car: Parked) => {
    if (drag.current?.moved) return;
    void navigate({ to: "/$environmentId/$threadId", params: car.route });
  };
  const jumpTo = (stop: JourneyStop) => {
    if (drag.current?.moved || !stop.jumpRowId) return;
    requestTimelineJump(stop.jumpRowId);
  };

  return (
    <div
      data-scene-map=""
      data-map-style={mapStyle}
      data-terrain={terrain}
      data-path={path}
      data-expanded={expanded ? "" : undefined}
    >
      <div
        ref={setViewport}
        data-scene-map-viewport=""
        aria-label="Thread journey map. Drag to pan, scroll to zoom, double-click to recenter."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={recenter}
      >
        <svg
          // A new thread starts its own camera instead of sweeping across town from the last one.
          key={currentShell?.id ?? "none"}
          viewBox={`0 0 ${CITY_SIZE} ${CITY_SIZE}`}
          width={CITY_SIZE}
          height={CITY_SIZE}
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transition: cameraTransition,
          }}
        >
          <rect data-city="ground" width={CITY_SIZE} height={CITY_SIZE} />
          <path data-city="water" d={CITY.water} />
          {CITY.parks.map((park) => (
            <rect key={`${park.x}:${park.y}`} data-city="park" {...park} rx={4} />
          ))}
          {CITY.blocks.map((block) => (
            <rect key={`${block.x}:${block.y}`} data-city="block" {...block} rx={2} />
          ))}
          {TERRAIN[terrain].map((decoration) => (
            <path key={decoration.d} data-terrain-decoration={decoration.kind} d={decoration.d} />
          ))}
          <path data-city="road" d={CITY.lanes} />
          <path data-city="lanes" d={CITY.lanes} />
          <path data-city="highway" d={CITY.highways} />

          {parked.map((car) => (
            <g
              key={car.key}
              transform={`translate(${car.x} ${car.y})`}
              data-parked-car={car.status}
              onPointerEnter={() => setHover(`${car.title} · ${STATUS_TEXT[car.status]}`)}
              onPointerLeave={() => setHover(null)}
              onClick={() => openThread(car)}
            >
              <circle data-city="hit" r={13} />
              {car.status === "waiting" || car.status === "driving" ? (
                <circle data-halo="" r={11} />
              ) : null}
              <g transform="scale(0.8)">
                <Car kind="parked" vehicle={vehicle} />
              </g>
            </g>
          ))}

          {trail === "prints" ? (
            stamps(route.slice(routeStart, from + 1)).map((stamp) => (
              <g
                key={`${stamp.x}:${stamp.y}:${stamp.heading}`}
                data-route-print=""
                transform={`translate(${stamp.x} ${stamp.y}) rotate(${stamp.heading}) scale(0.35)`}
              >
                {vehicle === "rider" ? (
                  <>
                    <ellipse cx={-4} rx={3} ry={6} />
                    <ellipse cx={4} rx={3} ry={6} />
                  </>
                ) : (
                  <Paw />
                )}
              </g>
            ))
          ) : from > routeStart ? (
            <polyline
              data-route="done"
              points={route
                .slice(routeStart, from + 1)
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
            />
          ) : null}
          {driving && fromPoint && carPoint ? (
            <line
              data-route="next"
              x1={fromPoint.x}
              y1={fromPoint.y}
              x2={carPoint.x}
              y2={carPoint.y}
            />
          ) : null}
          {stops.map((stop, index) => {
            const point = route[blocks[index]!];
            if (!point || index < firstShown) return null;
            return (
              <JourneyStopMarker
                key={stop.id}
                stop={stop}
                items={items}
                threadRef={currentRef}
                disabled={dragging}
                transform={`translate(${point.x} ${point.y})`}
                onJump={() => jumpTo(stop)}
              >
                <circle data-city="hit" r={10} />
                {stop.kind === "checkpoint" ? (
                  <Flag />
                ) : (
                  <circle data-stop-dot="" r={stop.kind === "prompt" ? 6 : 4.5} />
                )}
                {stop.kind === "prompt" ? (
                  <text data-stop-label="" y={2.5}>
                    {stop.turn}
                  </text>
                ) : null}
              </JourneyStopMarker>
            );
          })}
          {carPoint ? (
            <g
              data-hero-car={status}
              style={{
                transform: `translate(${carPoint.x}px, ${carPoint.y}px)`,
                transition: `transform ${glideMs}ms linear`,
              }}
            >
              <g style={{ transform: facing, transition: "transform 0.3s ease" }}>
                <Car kind="hero" vehicle={vehicle} />
              </g>
              {status === "waiting" || status === "failed" ? (
                <g transform="translate(9 -11)">
                  <circle data-alert="" r={6} />
                  <text data-alert-label="" y={3}>
                    !
                  </text>
                </g>
              ) : null}
            </g>
          ) : null}
        </svg>
        {caption ? (
          <div data-scene-map-caption="" data-status={status}>
            {caption}
          </div>
        ) : null}
        {hover ? <div data-scene-map-tip="">{hover}</div> : null}
        <div
          data-scene-map-tools=""
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {following ? null : (
            <button type="button" aria-label="Follow this thread" onClick={recenter}>
              <CrosshairIcon />
            </button>
          )}
          <button
            type="button"
            aria-label={expanded ? "Shrink map" : "Enlarge map"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </button>
        </div>
      </div>
      <div data-scene-map-hud="" data-status={status}>
        <span data-hud-status="">{currentShell ? STATUS_TEXT[status] : "No thread open"}</span>
        <span data-hud-detail="">
          {currentShell
            ? `Turn ${Math.max(turns, 1)} · ${stops.length - firstShown} stops`
            : `${parked.length} threads in town`}
        </span>
        {othersDriving + othersWaiting > 0 ? (
          <span data-hud-others="">
            {othersDriving > 0 ? `${othersDriving} driving` : ""}
            {othersDriving > 0 && othersWaiting > 0 ? " · " : ""}
            {othersWaiting > 0 ? `${othersWaiting} waiting` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
});
