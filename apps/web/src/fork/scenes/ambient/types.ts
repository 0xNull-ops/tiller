export const AMBIENT_KINDS = [
  "snow",
  "fire",
  "rain",
  "embers",
  "fireflies",
  "dust",
  "neon-flicker",
  "meteors",
  "bubbles",
  "petals",
] as const;
export type AmbientKind = (typeof AMBIENT_KINDS)[number];
export type AmbientChoice = AmbientKind | "theme";
export const AMBIENT_LABELS: Readonly<Record<AmbientKind, string>> = {
  snow: "Snow",
  fire: "Fire",
  rain: "Rain",
  embers: "Embers",
  fireflies: "Fireflies",
  dust: "Dust",
  "neon-flicker": "Neon flicker",
  meteors: "Meteors",
  bubbles: "Bubbles",
  petals: "Petals",
};
export type AmbientDefinition = {
  kind: AmbientKind;
  intensity?: "low" | "medium";
  area?: "frame" | "chat";
};
