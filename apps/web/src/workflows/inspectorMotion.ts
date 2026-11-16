import { createContext, useContext } from "react";

/** True while the inspector's height is animating, so the canvas fits once when it settles. */
const InspectorMotionContext = createContext(false);

export const InspectorMotionProvider = InspectorMotionContext.Provider;

export function useInspectorAnimating() {
  return useContext(InspectorMotionContext);
}
