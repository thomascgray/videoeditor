import type {
  TimelineObject, AnimatableProperty, Keyframe, KeyframePose, EasingKind,
  Transition, SlideDirection,
} from '../types'
import { ease, clamp01 } from './easing'

/**
 * Shared pose resolution + keyframe editing. Used by the renderer, canvas, and panel so they
 * all agree on where an object is.
 *
 * Model (whole-pose waypoints): each keyframe captures a full pose (x/y/width/height/rotation/
 * opacity) and the object morphs between them. `keyframe.time` (clip-relative) is when the pose
 * is reached; the object animates from the previous keyframe (or its base/start pose) into it,
 * with the keyframe's easing shaping that segment.
 *
 * Editing a keyframed object (`editPose`) always lands on something concrete, so you never edit a
 * phantom mid-animation pose: on an existing keyframe it updates that keyframe; at the very start
 * (t ≈ 0) it moves the base/home pose; anywhere else it CREATES a keyframe at the playhead so the
 * object genuinely passes through where you put it. Un-keyframed objects just edit their base pose.
 *
 * Two layers, composed: base pose → keyframes (resolvePose) → enter/exit transitions (applyTransitions).
 */

export const ANIMATABLE: AnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation', 'opacity']
export const DEFAULT_EASING: EasingKind = 'easeInOutCubic'
export const KF_EPS = 0.03 // seconds — "on this keyframe" tolerance (~1 frame @30fps)
// Default lead-in seeded on newly-created keyframes (spec 21): a short hold-then-move so the
// out-of-box feel is snappy (screen-recorder style). Clamped to the gap to the previous waypoint.
export const DEFAULT_LEAD_IN = 0.8

/**
 * Per-keyframe accent colors (by index). The 1st keyframe is red, 2nd blue, 3rd green, …
 * Shared by the panel, canvas selection box, and timeline diamonds so a keyframe reads as the
 * *same* color everywhere — making it obvious which keyframe the playhead is parked on.
 */
export const KEYFRAME_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
]

export function keyframeColor(index: number): string {
  return KEYFRAME_COLORS[((index % KEYFRAME_COLORS.length) + KEYFRAME_COLORS.length) % KEYFRAME_COLORS.length]
}

/** Index of the keyframe the playhead is currently parked on (within KF_EPS), or -1. */
export function activeKeyframeIndex(obj: TimelineObject, globalTime: number): number {
  const kfs = obj.keyframes
  if (!kfs || kfs.length === 0) return -1
  const t = globalTime - obj.startTime
  return kfs.findIndex((k) => Math.abs(k.time - t) < KF_EPS)
}

export function basePose(obj: TimelineObject): KeyframePose {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height, rotation: obj.rotation, opacity: obj.style.opacity }
}

function lerpPose(a: KeyframePose, b: KeyframePose, u: number): KeyframePose {
  const m = (k: AnimatableProperty) => a[k] + (b[k] - a[k]) * u
  return { x: m('x'), y: m('y'), width: m('width'), height: m('height'), rotation: m('rotation'), opacity: clamp01(m('opacity')) }
}

/** The object's pose at clip-relative time `t`, from the base pose + keyframe waypoints. */
export function poseAt(obj: TimelineObject, t: number): KeyframePose {
  const kfs = obj.keyframes
  const base = basePose(obj)
  if (!kfs || kfs.length === 0) return base

  // Waypoints: the base pose at t=0, then each keyframe. If a keyframe already sits at ~0 it
  // replaces the base as the start. The synthetic base is only ever a start (its leadIn is unread).
  const wps: { time: number; pose: KeyframePose; easing: EasingKind; leadIn?: number }[] =
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
      // Lead-in (spec 21): the move into b occupies only [animStart, b.time]; before that, hold a.
      // leadIn == null ⇒ animStart = a.time ⇒ fills the whole gap (bit-identical to legacy).
      const animStart = b.leadIn == null ? a.time : Math.max(a.time, b.time - b.leadIn)
      if (t < animStart) return a.pose
      const span = b.time - animStart
      const u = span > 1e-9 ? (t - animStart) / span : 1 // span≈0 (leadIn≈0) ⇒ snap to b at b.time
      return lerpPose(a.pose, b.pose, ease(b.easing, u)) // easing of the arriving keyframe
    }
  }
  return last.pose
}

/** Effective value of a single property at clip-relative time `t`. */
export function effVal(obj: TimelineObject, p: AnimatableProperty, t: number): number {
  return poseAt(obj, t)[p]
}

export function isKeyframed(obj: TimelineObject): boolean {
  return (obj.keyframes?.length ?? 0) > 0
}

export function keyframeTimes(obj: TimelineObject): number[] {
  return (obj.keyframes ?? []).map((k) => Math.round(k.time * 1000) / 1000)
}

/** Resolve the keyframed pose at `globalTime` — returns the object unchanged when un-keyframed. */
export function resolvePose(obj: TimelineObject, globalTime: number): TimelineObject {
  if (!isKeyframed(obj)) return obj
  const pose = poseAt(obj, globalTime - obj.startTime)
  return {
    ...obj,
    x: pose.x, y: pose.y, width: pose.width, height: pose.height, rotation: pose.rotation,
    style: { ...obj.style, opacity: pose.opacity },
  }
}

// --- Enter / exit transitions (independent of keyframes) ---

export function defaultTransitionEasing(kind: Transition['kind'], phase: 'in' | 'out'): EasingKind {
  if (kind === 'fade') return phase === 'in' ? 'easeOutCubic' : 'easeInCubic'
  return phase === 'in' ? 'easeOutBack' : 'easeInCubic' // slide / pop
}

function slideAway(dir: SlideDirection, o: TimelineObject): { dx: number; dy: number } {
  switch (dir) {
    case 'left':   return { dx: -(o.x + o.width + 0.05), dy: 0 }
    case 'right':  return { dx: (1.05 - o.x), dy: 0 }
    case 'top':    return { dx: 0, dy: -(o.y + o.height + 0.05) }
    case 'bottom': return { dx: 0, dy: (1.05 - o.y) }
  }
}

function applyTransition(o: TimelineObject, tr: Transition, p: number): TimelineObject {
  switch (tr.kind) {
    case 'fade':
      return { ...o, style: { ...o.style, opacity: o.style.opacity * p } }
    case 'slide': {
      const { dx, dy } = slideAway(tr.direction ?? 'left', o)
      return { ...o, x: o.x + (1 - p) * dx, y: o.y + (1 - p) * dy }
    }
    case 'pop': {
      const w = o.width * p
      const h = o.height * p
      return { ...o, x: o.x + (o.width - w) / 2, y: o.y + (o.height - h) / 2, width: w, height: h }
    }
    default:
      return o
  }
}

/** Apply enter/exit transitions on top of a (already keyframe-resolved) pose, for rendering. */
export function applyTransitions(pose: TimelineObject, obj: TimelineObject, globalTime: number): TimelineObject {
  let out = pose
  const elapsed = globalTime - obj.startTime
  const remaining = obj.startTime + obj.duration - globalTime

  if (obj.enter && obj.enter.kind !== 'none' && elapsed >= 0 && elapsed < obj.enter.duration) {
    const p = ease(obj.enter.easing ?? defaultTransitionEasing(obj.enter.kind, 'in'), clamp01(elapsed / obj.enter.duration))
    out = applyTransition(out, obj.enter, p)
  }
  if (obj.exit && obj.exit.kind !== 'none' && remaining >= 0 && remaining < obj.exit.duration) {
    const q = ease(obj.exit.easing ?? defaultTransitionEasing(obj.exit.kind, 'out'), clamp01(remaining / obj.exit.duration))
    out = applyTransition(out, obj.exit, q)
  }
  return out
}

/** Full render pose: base → keyframes → enter/exit. Returns obj unchanged when nothing applies. */
export function resolveRenderPose(obj: TimelineObject, globalTime: number): TimelineObject {
  return applyTransitions(resolvePose(obj, globalTime), obj, globalTime)
}

// --- Keyframe editing ---

type PoseUpdates = Partial<Omit<TimelineObject, 'id' | 'type'>>

/**
 * Edit properties at clip-relative `t` for a keyframed object so the edit is always concrete:
 *  - on an existing keyframe (within KF_EPS) → update THAT keyframe's pose;
 *  - at the very start (t ≤ KF_EPS) → move the base/home pose, creating no keyframe;
 *  - anywhere else → CREATE a keyframe at the playhead capturing the current pose + edits, so the
 *    object passes through where you put it instead of you editing a phantom mid-animation frame.
 * Un-keyframed objects always edit their base pose (no keyframes are ever spawned for them).
 */
export function editPose(obj: TimelineObject, overrides: Partial<Record<AnimatableProperty, number>>, t: number): PoseUpdates {
  const kfs = obj.keyframes
  if (kfs && kfs.length) {
    // On an existing keyframe → update it in place.
    const idx = kfs.findIndex((k) => Math.abs(k.time - t) < KF_EPS)
    if (idx >= 0) {
      const pose = { ...kfs[idx].pose }
      for (const p of Object.keys(overrides) as AnimatableProperty[]) pose[p] = overrides[p]!
      return { keyframes: kfs.map((k, j) => (j === idx ? { ...k, pose } : k)) }
    }
    // Keyframed and past the start → make the edit concrete by inserting a keyframe here.
    if (t > KF_EPS) {
      const time = Math.max(0, t)
      const pose = { ...poseAt(obj, t) }
      for (const p of Object.keys(overrides) as AnimatableProperty[]) pose[p] = overrides[p]!
      const next = [...kfs, { time, pose, easing: seedEasing(kfs, time), leadIn: seedLeadIn(kfs, time) }]
      next.sort((a, b) => a.time - b.time)
      return { keyframes: next }
    }
    // else: at the start (t ≤ KF_EPS) with no keyframe there → fall through and edit the base pose.
  }
  const updates: PoseUpdates = {}
  for (const p of Object.keys(overrides) as AnimatableProperty[]) {
    const v = overrides[p]!
    if (p === 'opacity') updates.style = { ...obj.style, ...(updates.style ?? {}), opacity: v }
    else (updates as Record<string, number>)[p] = v
  }
  return updates
}

/**
 * Default lead-in for a keyframe created at `time`, clamped to the gap to the nearest EARLIER
 * waypoint (spec 21 R10). `existing` is the keyframe list before insertion.
 */
export function seedLeadIn(existing: { time: number }[], time: number): number {
  let prev = 0
  for (const k of existing) if (k.time < time - KF_EPS && k.time > prev) prev = k.time
  return Math.min(DEFAULT_LEAD_IN, Math.max(0, time - prev))
}

/**
 * Easing a newly-created keyframe should adopt: the last motion chosen for this object (the nearest
 * earlier keyframe, else the nearest later one), so new keyframes continue the object's feel instead
 * of snapping back to the default. Falls back to DEFAULT_EASING when there are no keyframes yet.
 */
export function seedEasing(existing: { time: number; easing: EasingKind }[], time: number): EasingKind {
  let prev: { time: number; easing: EasingKind } | null = null
  let next: { time: number; easing: EasingKind } | null = null
  for (const k of existing) {
    if (k.time <= time + KF_EPS) { if (!prev || k.time > prev.time) prev = k }
    else if (!next || k.time < next.time) next = k
  }
  return (prev ?? next)?.easing ?? DEFAULT_EASING
}

/** Insert a keyframe at clip-relative `t` capturing the current rendered pose (the "+ Keyframe" button). */
export function addKeyframeAt(obj: TimelineObject, t: number): Keyframe[] {
  const time = Math.max(0, t)
  const pose = poseAt(obj, time)
  const kfs = obj.keyframes ? [...obj.keyframes] : []
  const idx = kfs.findIndex((k) => Math.abs(k.time - time) < KF_EPS)
  if (idx >= 0) kfs[idx] = { ...kfs[idx], pose } // update in place → leave leadIn/easing untouched
  else kfs.push({ time, pose, easing: seedEasing(kfs, time), leadIn: seedLeadIn(kfs, time) })
  kfs.sort((a, b) => a.time - b.time)
  return kfs
}
