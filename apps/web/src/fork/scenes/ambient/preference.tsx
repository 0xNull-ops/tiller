import { useSyncExternalStore } from "react";
import { SettingsRow } from "../../../components/settings/settingsLayout";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import type { SceneManifest } from "../manifest";
import { AmbientControls } from "./AmbientControls";
import {
  normalizeAmbientControls,
  resolveAmbient,
  type AmbientControls as Controls,
} from "./controls";
import { AMBIENT_LABELS, AMBIENT_KINDS, type AmbientChoice } from "./types";
const key = "tiller:scene-ambient";
const effectKey = "tiller:scene-ambient-effect";
const controlsKey = "tiller:scene-ambient-controls:v1";
const event = "tiller:scene-ambient-change";
const effects = { theme: "Theme default", ...AMBIENT_LABELS };
function read() {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}
function readEffect(): AmbientChoice {
  try {
    const value = localStorage.getItem(effectKey);
    if (value !== null && Object.hasOwn(effects, value)) return value as AmbientChoice;
  } catch {
    /* Preferences may be unavailable. */
  }
  return "theme";
}
function readControls() {
  try {
    return localStorage.getItem(controlsKey);
  } catch {
    return null;
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener("storage", listener);
  };
}
export function useAmbientEnabled() {
  return useSyncExternalStore(subscribe, read, () => true);
}
export function useAmbientChoice() {
  return useSyncExternalStore(subscribe, readEffect, () => "theme" as const);
}
export function useAmbientControls() {
  const raw = useSyncExternalStore(subscribe, readControls, () => null);
  try {
    return normalizeAmbientControls(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeAmbientControls(null);
  }
}
function save(storageKey: string, value: string) {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Storage may be unavailable. */
  }
  window.dispatchEvent(new Event(event));
}
function saveControls(controls: Controls) {
  save(controlsKey, JSON.stringify(normalizeAmbientControls(controls)));
}
export function AmbientSettings({ scene }: { scene: SceneManifest | null }) {
  const enabled = useAmbientEnabled();
  const effect = useAmbientChoice();
  const controls = useAmbientControls();
  const selected = resolveAmbient(scene?.ambient, effect);
  const currentEffect = !enabled ? "Off" : selected ? AMBIENT_LABELS[selected.kind] : "None";
  return (
    <>
      <SettingsRow
        title="Ambient effects"
        description={`Current theme: ${scene?.theme.label ?? "Standard theme"} · Selected effect: ${currentEffect}`}
        status="Effects pause when this window is inactive, reduced motion is on, or battery is low."
        control={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="w-full sm:w-40">
              <Select
                value={effect}
                onValueChange={(value) => {
                  if (value !== null && Object.hasOwn(effects, value)) save(effectKey, value);
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Ambient effect">
                  <SelectValue>{effects[effect]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="theme">Theme default</SelectItem>
                  {AMBIENT_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {AMBIENT_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Switch
              aria-label="Ambient effects"
              checked={enabled}
              onCheckedChange={(checked) => save(key, checked ? "on" : "off")}
            />
          </div>
        }
      />
      <AmbientControls
        controls={controls}
        onChange={saveControls}
        particles={selected?.kind !== "neon-flicker"}
      />
    </>
  );
}
