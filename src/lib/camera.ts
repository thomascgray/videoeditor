import type { CameraState, CameraZoom } from '../types'
import { IDENTITY_CAMERA } from '../types'
import { ease, lerp } from './easing'

/**
 * Camera resolver (spec 13).
 *
 * Compiles the authored list of discrete "zooms" into an effective camera pose
 * ({x, y, scale}) at any global time. This is a thin layer over the spec-12 easing
 * engine (`ease`/`lerp`) — it does NOT reuse the whole-pose Keyframe machinery.
 *
 * Governing-window model (supports A->B chaining):
 *   Zooms are sorted by startTime. Each zoom i governs the half-open window
 *   [startTime_i, startTime_{i+1}) (the last governs to +infinity). Within its window a
 *   zoom plays ease-in -> hold -> ease-out, but the ease-in starts from `fromPose_i` =
 *   the resolved camera pose at startTime_i (full frame if the camera was idle, or the
 *   previous zoom's current pose if it was still active -> the camera moves straight A->B
 *   without pulling back to full frame). Because fromPose_i only depends on EARLIER zooms,
 *   a single left-to-right pass computes each window's fromPose from the previous one.
 */

/** Interpolate the three camera components with a single eased progress u. */
function lerpCamera(a: CameraState, b: CameraState, u: number): CameraState {
  return {
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u),
    scale: lerp(a.scale, b.scale, u),
  }
}

/** Sort a copy of the zooms by startTime ascending (stable, non-mutating). */
export function sortZooms(zooms: CameraZoom[]): CameraZoom[] {
  return [...zooms].sort((a, b) => a.startTime - b.startTime)
}

/**
 * The pose a single zoom's window produces at `local` seconds past its startTime,
 * given the pose the camera arrives with (`fromPose`, the chain origin for the ease-in).
 */
function poseInWindow(zoom: CameraZoom, fromPose: CameraState, local: number): CameraState {
  if (local < 0) return fromPose
  const target: CameraState = { x: zoom.x, y: zoom.y, scale: zoom.scale }
  const inEnd = zoom.transitionIn
  const holdEnd = inEnd + zoom.hold
  const outEnd = holdEnd + zoom.transitionOut

  if (zoom.transitionIn > 0 && local < inEnd) {
    return lerpCamera(fromPose, target, ease(zoom.easing, local / zoom.transitionIn))
  }
  if (local < holdEnd) return target
  if (zoom.transitionOut > 0 && local < outEnd) {
    return lerpCamera(target, IDENTITY_CAMERA, ease(zoom.easing, (local - holdEnd) / zoom.transitionOut))
  }
  // ease-out complete (or an out-of-window later time): camera has returned to full frame.
  return IDENTITY_CAMERA
}

/**
 * Resolve the effective camera pose at `globalTime`.
 * Returns IDENTITY_CAMERA when there are no zooms or the camera is idle.
 */
export function resolveCamera(zooms: CameraZoom[] | undefined, globalTime: number): CameraState {
  if (!zooms || zooms.length === 0) return IDENTITY_CAMERA

  // Hidden zooms (spec 14 R11.3) are filtered out BEFORE the governing-window sort so an
  // "invisible" zoom has no chained-from/-to effect on its neighbors.
  const sorted = sortZooms(zooms.filter((z) => !z.hidden))
  if (sorted.length === 0) return IDENTITY_CAMERA

  // Before the first zoom the camera is at full frame.
  if (globalTime < sorted[0].startTime) return IDENTITY_CAMERA

  // Walk left-to-right, carrying each window's `fromPose` (the pose the camera reaches at
  // the window's start). fromPose_{i+1} = the pose window i produces at startTime_{i+1}.
  let fromPose: CameraState = IDENTITY_CAMERA
  for (let i = 0; i < sorted.length; i++) {
    const zoom = sorted[i]
    const next = sorted[i + 1]
    const windowEnd = next ? next.startTime : Infinity

    if (globalTime < windowEnd) {
      // globalTime is governed by this window.
      return poseInWindow(zoom, fromPose, globalTime - zoom.startTime)
    }

    // Hand off to the next window: its fromPose is this window's pose at its boundary.
    fromPose = poseInWindow(zoom, fromPose, windowEnd - zoom.startTime)
  }

  return fromPose // unreachable (last window has windowEnd = Infinity), but keeps TS happy
}

/**
 * The framed region (normalized 0–1) that maps onto the full canvas under a camera pose.
 * At scale=1 this is the whole canvas {0,0,1,1}. Multiply by canvas width/height for pixels.
 */
export function cameraFrameRect(cam: CameraState): { x: number; y: number; w: number; h: number } {
  const w = 1 / cam.scale
  const h = 1 / cam.scale
  return {
    x: cam.x - w / 2,
    y: cam.y - h / 2,
    w,
    h,
  }
}

/**
 * Given a framed region (normalized), the camera pose that frames it. Inverse of
 * cameraFrameRect: the focal point is the rect's center and scale = 1/rectWidth
 * (width and height share the scale since the frame keeps the canvas aspect ratio).
 */
export function cameraFromFrameRect(rect: { x: number; y: number; w: number; h: number }): CameraState {
  const scale = rect.w > 1e-6 ? 1 / rect.w : 1
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    scale: Math.max(1, scale),
  }
}

/** True when the camera is at full frame (renderFrame can skip the transform). */
export function isIdentityCamera(cam: CameraState): boolean {
  return cam.scale === 1 && cam.x === 0.5 && cam.y === 0.5
}

/** Total envelope length of a zoom (ease-in + hold + ease-out), in seconds. */
export function zoomEnvelope(zoom: CameraZoom): number {
  return zoom.transitionIn + zoom.hold + zoom.transitionOut
}

/**
 * The zoom whose envelope is active at `globalTime` (the one currently framing the camera),
 * or null if the camera is idle. Used for click-to-select on the canvas.
 */
export function governingZoomAt(zooms: CameraZoom[] | undefined, globalTime: number): CameraZoom | null {
  if (!zooms || zooms.length === 0) return null
  const sorted = sortZooms(zooms.filter((z) => !z.hidden))
  let gov: CameraZoom | null = null
  for (const z of sorted) {
    if (z.startTime <= globalTime) gov = z
    else break
  }
  if (!gov) return null
  return globalTime <= gov.startTime + zoomEnvelope(gov) ? gov : null
}
