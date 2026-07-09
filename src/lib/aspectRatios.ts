// Canvas aspect-ratio / dimension presets.
//
// Because every object coordinate is normalized 0–1 (see types.ts), the canvas "shape" is fully
// described by project.width × project.height. Switching aspect ratio is just swapping those two
// numbers — the shared renderFrame (preview + export) and all normalized object/zoom positions
// follow for free, with no per-object migration. H.264 needs even dimensions, so every preset
// (and any custom value) keeps width/height even.

export type AspectGroup = 'standard' | 'social'

export type AspectPreset = {
  id: string
  label: string          // human name, e.g. "Widescreen"
  ratio: string          // reduced ratio, e.g. "16:9"
  width: number
  height: number
  group: AspectGroup
  hint?: string          // where it's used, e.g. "YouTube, TV"
}

// Dimensions follow the platforms' recommended upload resolutions; all even numbers.
export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'widescreen', label: 'Widescreen', ratio: '16:9', width: 1920, height: 1080, group: 'standard', hint: 'YouTube, TV' },
  { id: 'classic',    label: 'Classic',    ratio: '4:3',  width: 1440, height: 1080, group: 'standard', hint: 'Old TV' },
  { id: 'cinematic',  label: 'Cinematic',  ratio: '21:9', width: 2560, height: 1080, group: 'standard', hint: 'Ultrawide' },
  { id: 'vertical',   label: 'Vertical',   ratio: '9:16', width: 1080, height: 1920, group: 'social',   hint: 'TikTok, Reels, Shorts' },
  { id: 'square',     label: 'Square',      ratio: '1:1',  width: 1080, height: 1080, group: 'social',   hint: 'Instagram post' },
  { id: 'portrait',   label: 'Portrait',   ratio: '4:5',  width: 1080, height: 1350, group: 'social',   hint: 'Instagram portrait' },
]

export const GROUP_LABELS: Record<AspectGroup, string> = {
  standard: 'Aspect ratios',
  social: 'Social media',
}

// Sensible bounds for custom entry. Min avoids degenerate canvases; max keeps within typical
// WebCodecs H.264 encoder limits (4096 is a common Level cap).
export const MIN_DIMENSION = 16
export const MAX_DIMENSION = 4096

/** The preset whose exact dimensions match, if any (so the UI can tick the active one). */
export function matchPreset(width: number, height: number): AspectPreset | undefined {
  return ASPECT_PRESETS.find((p) => p.width === width && p.height === height)
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Reduce dimensions to a "w:h" ratio label (e.g. 1920×1080 → "16:9"). */
export function formatRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '—'
  const g = gcd(width, height) || 1
  return `${width / g}:${height / g}`
}

/** Clamp a raw dimension to the allowed range and force it even (H.264 requirement). */
export function sanitizeDimension(value: number): number {
  const clamped = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value || 0)))
  return clamped % 2 === 0 ? clamped : clamped - 1
}
