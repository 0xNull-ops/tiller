export type WorkflowCanvasKind = "credential" | "mcp" | "check" | "login";

export const WORKFLOW_CANVAS_KINDS: ReadonlyArray<{
  readonly kind: WorkflowCanvasKind;
  readonly label: string;
  readonly defaultColor: string;
}> = [
  { kind: "credential", label: "Credential", defaultColor: "#e3b341" },
  { kind: "mcp", label: "MCP connection", defaultColor: "#a78bfa" },
  { kind: "check", label: "Check", defaultColor: "#3fb950" },
  { kind: "login", label: "Login and requirements", defaultColor: "#8b949e" },
];

/** The choices offered per kind. Every default is among them, so the current colour is always a swatch. */
export const WORKFLOW_CANVAS_COLOR_PRESETS: ReadonlyArray<{
  readonly name: string;
  readonly color: string;
}> = [
  { name: "Amber", color: "#e3b341" },
  { name: "Orange", color: "#f0883e" },
  { name: "Pink", color: "#f778ba" },
  { name: "Violet", color: "#a78bfa" },
  { name: "Blue", color: "#58a6ff" },
  { name: "Teal", color: "#39c5cf" },
  { name: "Green", color: "#3fb950" },
  { name: "Grey", color: "#8b949e" },
];

const workflowCanvasKindVariable = (kind: WorkflowCanvasKind) => `--wf-kind-${kind}`;

/**
 * The colour a kind falls back to. Cards read the variable with this as its fallback, so a card
 * drawn before the settings sync has run (or outside the app shell) still gets its accent.
 */
function workflowCanvasKindDefault(kind: WorkflowCanvasKind): string {
  return WORKFLOW_CANVAS_KINDS.find((entry) => entry.kind === kind)!.defaultColor;
}

/** The root variable a card reads for its kind, defaulted so it is never an invalid colour. */
export function workflowCanvasKindColor(kind: WorkflowCanvasKind): string {
  return `var(${workflowCanvasKindVariable(kind)}, ${workflowCanvasKindDefault(kind)})`;
}

/**
 * Writes every kind's colour as a root variable, so the canvas picks it up without a re-render.
 * A kind the user has not picked gets its default, so the variables are never left unset.
 */
export function applyWorkflowCanvasColors(
  style: Pick<CSSStyleDeclaration, "setProperty">,
  colors: Partial<Record<WorkflowCanvasKind, string>>,
): void {
  for (const { kind, defaultColor } of WORKFLOW_CANVAS_KINDS) {
    style.setProperty(workflowCanvasKindVariable(kind), colors[kind] ?? defaultColor);
  }
}
