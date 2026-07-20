import type { CameraState, CameraZoom, CameraKeyframe, EasingKind } from '../types'
import { IDENTITY_CAMERA } from '../types'
import { ease, lerp } from './easing'
import { KF_EPS, seedLeadIn, seedEasing } from './keyframes'

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
 *
 * The ease-in ramps fromPose → the zoom's FIRST pose; during the hold the camera follows the
 * keyframed pose path (`zoomPoseAt`, hold-relative); the ease-out ramps the LAST pose → full frame.
 * A zoom with no keyframes has a constant path (= its base pose), so this is identical to the old
 * static-hold behavior.
 */
function poseInWindow(zoom: CameraZoom, fromPose: CameraState, local: number): CameraState {
  if (local < 0) return fromPose
  const inEnd = zoom.transitionIn
  const holdEnd = inEnd + zoom.hold
  const outEnd = holdEnd + zoom.transitionOut

  if (zoom.transitionIn > 0 && local < inEnd) {
    return lerpCamera(fromPose, zoomPoseAt(zoom, 0), ease(zoom.easing, local / zoom.transitionIn))
  }
  if (local < holdEnd) return zoomPoseAt(zoom, local - inEnd)
  if (zoom.transitionOut > 0 && local < outEnd) {
    return lerpCamera(zoomPoseAt(zoom, zoom.hold), IDENTITY_CAMERA, ease(zoom.easing, (local - holdEnd) / zoom.transitionOut))
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

// === Zoom keyframes (pan/scale path within one zoom) ===
// A thin mirror of the object keyframe engine (keyframes.ts), specialised to the 3-component
// camera pose {x, y, scale}. Times are relative to the HOLD-segment start (startTime + transitionIn).

/** The zoom's home/base pose (its own x/y/scale) — the t=0 waypoint. */
function basePose(zoom: CameraZoom): CameraState {
  return { x: zoom.x, y: zoom.y, scale: zoom.scale }
}

/** Hold-relative time (seconds past the ease-in) for a global time. Negative during ease-in. */
export function zoomHoldTime(zoom: CameraZoom, globalTime: number): number {
  return globalTime - (zoom.startTime + zoom.transitionIn)
}

/**
 * The zoom's target pose at hold-relative time `t`, from its base pose + keyframe waypoints.
 * Un-keyframed → always the base pose (constant). Mirrors keyframes.ts `poseAt`.
 */
export function zoomPoseAt(zoom: CameraZoom, t: number): CameraState {
  const kfs = zoom.keyframes
  const base = basePose(zoom)
  if (!kfs || kfs.length === 0) return base

  const wps: { time: number; pose: CameraState; easing: EasingKind; leadIn?: number }[] =
    kfs[0].time <= KF_EPS
      ? kfs.map((k) => ({ time: k.time, pose: k.pose, easing: k.easing, leadIn: k.leadIn }))
      : [{ time: 0, pose: base, easing: 'linear' as EasingKind }, ...kfs.map((k) => ({ time: k.time, pose: k.pose, easing: k.easing, leadIn: k.leadIn }))]

  if (t <= wps[0].time) return wps[0].pose
  const last = wps[wps.length - 1]
  if (t >= last.time) return last.pose
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i]
    const b = wps[i + 1]
    if (t >= a.time && t <= b.time) {
      // Lead-in (spec 21): move into b occupies only [animStart, b.time]; hold a before it.
      const animStart = b.leadIn == null ? a.time : Math.max(a.time, b.time - b.leadIn)
      if (t < animStart) return a.pose
      const span = b.time - animStart
      const u = span > 1e-9 ? (t - animStart) / span : 1
      return lerpCamera(a.pose, b.pose, ease(b.easing, u)) // easing of the arriving keyframe
    }
  }
  return last.pose
}

/**
 * The AUTHORABLE target pose at a global time: `zoomPoseAt` with the hold time clamped to
 * [0, hold]. This is what the framing rect shows for a selected zoom and what the panel inputs
 * edit — during the ease-in it reads the home pose, during the ease-out the last pose (not the
 * blended ramp pose), so what you see is what you edit.
 */
export function zoomTargetPoseAt(zoom: CameraZoom, globalTime: number): CameraState {
  const t = Math.max(0, Math.min(zoom.hold, zoomHoldTime(zoom, globalTime)))
  return zoomPoseAt(zoom, t)
}

/** Index of the keyframe the playhead is parked on (within KF_EPS), or -1. */
export function activeZoomKeyframeIndex(zoom: CameraZoom, globalTime: number): number {
  const kfs = zoom.keyframes
  if (!kfs || kfs.length === 0) return -1
  const t = zoomHoldTime(zoom, globalTime)
  return kfs.findIndex((k) => Math.abs(k.time - t) < KF_EPS)
}

type ZoomPoseUpdates = Partial<Pick<CameraZoom, 'x' | 'y' | 'scale' | 'keyframes'>>

/**
 * Edit pose components at hold-relative `t` so the edit is always concrete (mirrors keyframes.ts
 * `editPose`): on an existing keyframe → update it; keyframed and past the start → CREATE a
 * keyframe capturing the current pose + edits; otherwise (un-keyframed, or at the very start) →
 * move the base/home pose. Un-keyframed zooms never spawn keyframes from a plain edit — press
 * "+ Keyframe" to start a path, exactly like objects.
 */
export function editZoomPose(zoom: CameraZoom, overrides: Partial<CameraState>, t: number): ZoomPoseUpdates {
  const kfs = zoom.keyframes
  if (kfs && kfs.length) {
    const idx = kfs.findIndex((k) => Math.abs(k.time - t) < KF_EPS)
    if (idx >= 0) {
      const pose = { ...kfs[idx].pose, ...overrides }
      return { keyframes: kfs.map((k, j) => (j === idx ? { ...k, pose } : k)) }
    }
    if (t > KF_EPS) {
      const time = Math.max(0, t)
      const pose = { ...zoomPoseAt(zoom, t), ...overrides }
      const next = [...kfs, { time, pose, easing: seedEasing(kfs, time), leadIn: seedLeadIn(kfs, time) }]
      next.sort((a, b) => a.time - b.time)
      return { keyframes: next }
    }
    // else: at the start with no keyframe there → fall through and edit the base pose.
  }
  const updates: ZoomPoseUpdates = {}
  if (overrides.x !== undefined) updates.x = overrides.x
  if (overrides.y !== undefined) updates.y = overrides.y
  if (overrides.scale !== undefined) updates.scale = overrides.scale
  return updates
}

/** Insert/update a keyframe at hold-relative `t` capturing the current target pose (the "+ Keyframe" button). */
export function addZoomKeyframeAt(zoom: CameraZoom, t: number): CameraKeyframe[] {
  const time = Math.max(0, t)
  const pose = zoomPoseAt(zoom, time)
  const kfs = zoom.keyframes ? [...zoom.keyframes] : []
  const idx = kfs.findIndex((k) => Math.abs(k.time - time) < KF_EPS)
  if (idx >= 0) kfs[idx] = { ...kfs[idx], pose } // update in place → leave leadIn untouched
  else kfs.push({ time, pose, easing: seedEasing(kfs, time), leadIn: seedLeadIn(kfs, time) })
  kfs.sort((a, b) => a.time - b.time)
  return kfs
}
