import type { CoachPlacement } from "./placeCoachMark";

export interface TourStep {
  readonly id: string;
  /** Matches `[data-tour="<anchor>"]`. A step with no anchor, or none on screen, shows centred. */
  readonly anchor: string | null;
  readonly placement: CoachPlacement;
  readonly title: string;
  readonly body: string;
  /** The sample canvas shows its "+" controls while this step is current. */
  readonly editPreview?: boolean;
  /** Offers the recorded demo run on this step. */
  readonly demo?: boolean;
  /** Shows the read-only preview of the scheduler sheet under the card. */
  readonly schedulerPreview?: boolean;
  /** The last step offers Save a copy. */
  readonly final?: boolean;
}

export const TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: "sidebar",
    anchor: "workflows-sidebar",
    placement: "right",
    title: "Your workflows live here",
    body: "Running, Scheduled and Saved, always one click away.",
  },
  {
    id: "step-card",
    anchor: "step-card",
    placement: "bottom",
    title: "Each card is a step",
    body: "Click one to edit its skill, note and model.",
  },
  {
    id: "add-step",
    anchor: "add-step",
    placement: "bottom",
    title: "Add a step anywhere",
    body: "The + between cards inserts a step into the flow.",
    editPreview: true,
  },
  {
    id: "reads-from",
    anchor: "reads-arc",
    placement: "bottom",
    title: "Steps can read from any earlier step",
    body: "The dashed arc shows a step reading work from further back, not only the card before it.",
  },
  {
    id: "loop",
    anchor: "loop-arc",
    placement: "top",
    title: "Loops send work back until it's good",
    body: "Review sends work back to Build, up to the number of rounds you set.",
  },
  {
    id: "triggers",
    anchor: "start-triggers",
    placement: "top",
    title: "Start it your way",
    body: "Run by hand, on a schedule, from a webhook, or after another workflow. Here is the schedule sheet.",
    schedulerPreview: true,
  },
  {
    id: "run",
    anchor: "run-button",
    placement: "bottom",
    title: "Runs use your own agents",
    body: "A real run uses the agents you already have. Want to watch a recorded demo? It costs nothing.",
    demo: true,
  },
  {
    id: "credentials",
    anchor: "credential-card",
    placement: "bottom",
    title: "Keys and logins stay in your vault",
    body: "Steps ask before using them. Manage them in Settings → Tiller → Credentials.",
  },
  {
    id: "finish",
    anchor: null,
    placement: "bottom",
    title: "That's the tour",
    body: "Everything here is unlocked. Save a copy of this sample to try it in a project.",
    final: true,
  },
];
