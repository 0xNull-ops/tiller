const MIN_INSPECTOR = 160;
const MIN_CANVAS = 160;
const HANDLE_HEIGHT = 8;

export function inspectorSize(available: number, preferred: number | null) {
  // On very short windows share the remaining space rather than overflow the panel.
  const min = Math.min(MIN_INSPECTOR + HANDLE_HEIGHT, Math.max(0, available / 2));
  const max = Math.max(min, available - MIN_CANVAS);
  const requested = preferred !== null && Number.isFinite(preferred) ? preferred : available * 0.4;
  return { height: Math.min(max, Math.max(min, Math.round(requested))), min, max };
}
