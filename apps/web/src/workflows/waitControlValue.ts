import type { WorkflowWaitBefore } from "@t3tools/contracts";

export type WaitMode = "none" | "delay" | "until";
const delaySteps = [1, 5, 15, 30, 60, 120, 240, 480, 720, 1440] as const;
export const waitMode = (value: WorkflowWaitBefore | undefined): WaitMode => value?.kind ?? "none";
export function waitForMode(
  mode: WaitMode,
  value?: WorkflowWaitBefore,
): WorkflowWaitBefore | undefined {
  if (mode === "none") return undefined;
  if (value?.kind === mode) return value;
  return mode === "delay" ? { kind: "delay", minutes: 15 } : { kind: "until", timeOfDay: "09:00" };
}
export function stepDelay(minutes: number, direction: -1 | 1): number {
  return direction === 1
    ? (delaySteps.find((step) => step > minutes) ?? Math.max(minutes, 1440))
    : (delaySteps.findLast((step) => step < minutes) ?? 1);
}
