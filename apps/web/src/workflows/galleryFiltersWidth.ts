const DEFAULT_WIDTH = 208;
const MIN_WIDTH = 168;
const MAX_WIDTH = 360;
const MAX_SHARE = 0.4;

export function galleryFiltersWidth(available: number, preferred: number | null) {
  // The container reports no size on the first render, so the constants bound the width there.
  const limit = available > 0 ? Math.floor(available * MAX_SHARE) : MAX_WIDTH;
  const min = Math.min(MIN_WIDTH, limit);
  const max = Math.max(min, Math.min(MAX_WIDTH, limit));
  const requested = preferred !== null && Number.isFinite(preferred) ? preferred : DEFAULT_WIDTH;
  return { width: Math.min(max, Math.max(min, Math.round(requested))), min, max };
}
