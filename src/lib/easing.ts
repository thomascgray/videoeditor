import { backOut, spring, calcGeneratorDuration } from 'motion'
import type { EasingKind } from '../types'

/**
 * Pure, engine-agnostic easing + interpolation core (spec 12).
 * Deterministic sample-at-t so preview and export animate identically.
 * Shared by the renderer (spec 12), the camera (spec 13), and audio fades (spec 15).
 *
 * We adopt Motion's (motion.dev) vetted math — the `backOut` curve and, crucially, its
 * duration-based `spring` generator — but NOT its playback/component layer (see spec 12).
 * The trivial polynomial eases are implemented directly so they exactly match their names.
 */

/** Linear interpolation between a and b. */
export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

/** Clamp to [0, 1]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// A single tuned, duration-based spring preset (spec 12 Q3: one preset for v1).
// Motion's spring generator is sampled into a normalized progress→progress curve: we take
// its full settle duration and map u∈[0,1] across it, so u=0→0 and u=1→1 (may overshoot mid-way).
const springEase: (u: number) => number = (() => {
  const gen = spring(0.5, 0.35) // visualDuration 0.5s, bounce 0.35
  const durMs = gen.calculatedDuration ?? calcGeneratorDuration(gen)
  return (u: number): number => {
    if (u <= 0) return 0
    if (u >= 1) return 1
    return gen.next(u * durMs).value
  }
})()

/**
 * Map an easing kind + normalized progress u∈[0,1] to an eased progress.
 * `easeOutBack` and `spring` intentionally overshoot (fine for position/scale;
 * callers clamp opacity via clamp01).
 */
export function ease(kind: EasingKind, u: number): number {
  switch (kind) {
    case 'instant':        return u >= 1 ? 1 : 0 // step / hard-cut: hold, then snap at arrival
    case 'linear':         return u
    case 'easeInCubic':    return u * u * u
    case 'easeOutCubic':   return 1 - (1 - u) ** 3
    case 'easeInOutCubic': return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2
    case 'easeOutBack':    return backOut(u)
    case 'spring':         return springEase(u)
    default:               return u
  }
}
