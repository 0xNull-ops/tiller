import { useEffect } from "react";
import { useClientSettings } from "../hooks/useSettings";
import { applyWorkflowCanvasColors } from "./workflowCanvasColors";

/**
 * Mounted once at the app root. The canvas reads the kind colours from CSS variables, so a change
 * here repaints the canvas without re-rendering its cards.
 */
export function WorkflowCanvasColorSync() {
  const colors = useClientSettings((settings) => settings.workflowCanvasColors);

  // oxlint-disable-next-line t3code/react-effect-budget -- Write user-selected canvas colors to document CSS variables after commit.
  useEffect(() => {
    applyWorkflowCanvasColors(document.documentElement.style, colors);
  }, [colors]);

  return null;
}
