// Timeline snapping (spec 22). Pure helpers shared by every drag handler in Timeline.tsx.
//
// Nothing snapped before spec 22 — the move handler only quantized to 0.1s. These helpers let a
// dragged edge/playhead/marker "click" onto nearby reference times (marker times, the playhead,
// t=0, other clips' edges). The threshold is expressed in PIXELS so the feel is identical at every
// time-zoom level, then converted to seconds via pixelsPerSecond.

export const SNAP_THRESHOLD_PX = 8

export type SnapResult = {
  time: number            // the (possibly snapped) time
  snappedTo: number | null // the candidate locked onto, or null if nothing was within threshold
}

/**
 * Snap a single moving time to the nearest candidate within `thresholdPx`.
 * Returns the raw time (snappedTo: null) when snapping is disabled, there are no candidates, or
 * nothing is close enough.
 */
export function snapTime(
  rawTime: number,
  candidates: number[],
  pixelsPerSecond: number,
  thresholdPx: number = SNAP_THRESHOLD_PX,
  disabled: boolean = false,
): SnapResult {
  if (disabled || candidates.length === 0 || pixelsPerSecond <= 0) {
    return { time: rawTime, snappedTo: null }
  }
  const thresholdSec = thresholdPx / pixelsPerSecond
  let best: number | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    const d = Math.abs(c - rawTime)
    if (d <= thresholdSec && d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best === null ? { time: rawTime, snappedTo: null } : { time: best, snappedTo: best }
}

/**
 * Snap a clip MOVE: probe BOTH the start edge and the end edge (start + duration) against the
 * candidates and pick the nearest snap across the two, then back out the resulting startTime.
 * `time` is the snapped startTime; `snappedTo` is the candidate time the snap line should draw at.
 * End-edge snaps that would push startTime below 0 are skipped (a clip can't have its end on a
 * candidate closer to 0 than its own length).
 */
export function snapClipMove(
  rawStart: number,
  duration: number,
  candidates: number[],
  pixelsPerSecond: number,
  thresholdPx: number = SNAP_THRESHOLD_PX,
  disabled: boolean = false,
): SnapResult {
  if (disabled || candidates.length === 0 || pixelsPerSecond <= 0) {
    return { time: rawStart, snappedTo: null }
  }
  const thresholdSec = thresholdPx / pixelsPerSecond
  let bestStart = rawStart
  let bestLine: number | null = null
  let bestDist = Infinity
  const rawEnd = rawStart + duration
  for (const c of candidates) {
    // Start edge lands on c.
    const dStart = Math.abs(c - rawStart)
    if (dStart <= thresholdSec && dStart < bestDist) {
      bestDist = dStart
      bestStart = c
      bestLine = c
    }
    // End edge lands on c → start = c - duration (skip if that goes negative).
    const dEnd = Math.abs(c - rawEnd)
    if (dEnd <= thresholdSec && dEnd < bestDist && c - duration >= -1e-6) {
      bestDist = dEnd
      bestStart = c - duration
      bestLine = c
    }
  }
  return { time: bestStart, snappedTo: bestLine }
}
