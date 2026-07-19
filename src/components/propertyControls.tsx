import { useRef } from 'react'
import type {
  TimelineObject, EasingKind, Transition, TransitionKind, SlideDirection, Keyframe,
  CameraZoom, CameraKeyframe, TextEffect, TextEffectKind,
} from '../types'
import { keyframeColor, defaultTransitionEasing } from '../lib/keyframes'
import { clamp01 } from '../lib/easing'

/**
 * Shared property-editing UI (spec 17 P). Extracted from `PropertiesPanel` so the redesigned
 * inspector AND the floating context toolbar's popovers render the exact same controls — one
 * source of truth for sections, fields, transition editors, and the keyframe/type-on bars.
 */

export const EASINGS: EasingKind[] = [
  'linear',
  'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
  'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'easeOutBack', 'spring',
]
export const EASING_LABELS: Record<EasingKind, string> = {
  linear: 'Even pace throughout',
  easeInQuad: 'Starts slow (gentle)',
  easeOutQuad: 'Eases to a stop (gentle)',
  easeInOutQuad: 'Slow at both ends (gentle)',
  easeInCubic: 'Starts slow, speeds up',
  easeOutCubic: 'Fast, then eases to a stop',
  easeInOutCubic: 'Smooth — slow at both ends',
  easeOutBack: 'Overshoots, then settles',
  spring: 'Bouncy — springs into place',
}
export const SELECT_CLS = 'bg-surface-muted text-fg text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none cursor-pointer'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-muted text-xs shrink-0">{label}</label>
      {children}
    </div>
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 0.1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={Number(value.toFixed(2))}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value)
        if (!isNaN(v)) onChange(v)
      }}
      className="w-20 bg-surface-muted text-fg text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none text-right"
    />
  )
}

/** `TransitionFields` wrapped in a plain titled `Section` — used by the toolbar's Animate popover. */
export function TransitionSection({
  title, phase, value, objDuration, onChange,
}: {
  title: string
  phase: 'in' | 'out'
  value?: Transition
  objDuration: number
  onChange: (t?: Transition) => void
}) {
  return (
    <Section title={title}>
      <TransitionFields phase={phase} value={value} objDuration={objDuration} onChange={onChange} />
    </Section>
  )
}

/** The transition editor's fields (no section chrome) — so the inspector can wrap them in its
 *  accordion while the popover wraps them in a plain `Section`. */
export function TransitionFields({
  phase, value, objDuration, onChange,
}: {
  phase: 'in' | 'out'
  value?: Transition
  objDuration: number
  onChange: (t?: Transition) => void
}) {
  const kind = value?.kind ?? 'none'
  const patch = (p: Partial<Transition>) => {
    const next: Transition = {
      kind,
      duration: value?.duration ?? 0.5,
      direction: value?.direction ?? 'left',
      easing: value?.easing,
      ...p,
    }
    onChange(next.kind === 'none' ? undefined : next)
  }
  const dur = value?.duration ?? 0.5
  const maxDur = Math.max(0.1, objDuration)
  // The effective curve — falls back to the kind's sensible default when none is chosen.
  const effEasing = value?.easing ?? defaultTransitionEasing(kind === 'none' ? 'fade' : kind, phase)
  return (
    <>
      <Field label="Type">
        <select value={kind} onChange={(e) => patch({ kind: e.target.value as TransitionKind })} className={SELECT_CLS}>
          <option value="none">None</option>
          <option value="fade">Fade</option>
          <option value="slide">Slide</option>
          <option value="pop">Pop</option>
        </select>
      </Field>
      {kind !== 'none' && (
        <>
          {kind === 'slide' && (
            <Field label="From">
              <select
                value={value?.direction ?? 'left'}
                onChange={(e) => patch({ direction: e.target.value as SlideDirection })}
                className={SELECT_CLS}
              >
                <option value="left">← Left</option>
                <option value="right">→ Right</option>
                <option value="top">↑ Top</option>
                <option value="bottom">↓ Bottom</option>
              </select>
            </Field>
          )}
          <div>
            <label className="text-muted text-xs block mb-1">Motion</label>
            <select
              value={effEasing}
              onChange={(e) => patch({ easing: e.target.value as EasingKind })}
              className="w-full bg-surface-muted text-fg text-[11px] px-1 py-1 rounded border border-border focus:border-accent outline-none cursor-pointer"
            >
              {EASINGS.map((k) => <option key={k} value={k}>{EASING_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-muted text-xs">Duration</label>
              <span className="text-[10px] text-subtle tabular-nums">{dur.toFixed(1)}s of {objDuration.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={maxDur}
              step={0.1}
              value={Math.min(dur, maxDur)}
              onChange={(e) => patch({ duration: Number(e.target.value) })}
              className="w-full"
            />
            {/* Lifespan bar: how much of the object's whole life on the scrubber this transition
                occupies — filled from the start (enter) or the end (exit). */}
            <LifespanBar duration={objDuration} portion={dur} align={phase === 'in' ? 'left' : 'right'} />
          </div>
        </>
      )}
    </>
  )
}

// --- Text effects (spec 19) -----------------------------------------------------------------
export const TEXT_EFFECT_KINDS: TextEffectKind[] = [
  'glow', 'outline', 'shadow', 'gradient', 'pulse', 'rainbow', 'wave', 'shimmer',
]
export const TEXT_EFFECT_LABELS: Record<TextEffectKind, string> = {
  glow: 'Glow / Neon',
  outline: 'Outline',
  shadow: 'Drop shadow',
  gradient: 'Gradient fill',
  pulse: 'Pulse',
  rainbow: 'Rainbow',
  wave: 'Wave',
  shimmer: 'Shimmer',
}
// Sensible starting params per kind — picking a kind seeds these; each param stays editable.
export const DEFAULT_TEXT_EFFECT: Record<TextEffectKind, TextEffect> = {
  glow: { kind: 'glow', color: '#3b82f6', blur: 16 },
  outline: { kind: 'outline', color: '#000000', width: 3 },
  shadow: { kind: 'shadow', color: '#000000', dx: 4, dy: 4, blur: 6 },
  gradient: { kind: 'gradient', from: '#ff6ec4', to: '#7873f5', angle: 0 },
  pulse: { kind: 'pulse', speed: 1, amount: 1 },
  rainbow: { kind: 'rainbow', speed: 1 },
  wave: { kind: 'wave', speed: 1, amplitude: 12 },
  shimmer: { kind: 'shimmer', speed: 1, color: '#ffffff' },
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-6 rounded border border-border bg-surface-muted cursor-pointer"
      />
    </Field>
  )
}

function SliderRow({
  label, value, min, max, step, onChange, fmt,
}: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; fmt?: (v: number) => string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-muted text-xs">{label}</label>
        <span className="text-[10px] text-subtle tabular-nums">{fmt ? fmt(value) : value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

/**
 * Effect picker + per-kind params for a text object (spec 19). Modeled on `TransitionFields`:
 * a kind dropdown ("None" removes the effect) plus the params that apply to the chosen kind.
 * `value`/`onChange` carry the whole `TextEffect` (or undefined); the parent wires undo/persist.
 */
export function EffectFields({
  value, onChange,
}: {
  value?: TextEffect
  onChange: (e?: TextEffect) => void
}) {
  const kind = value?.kind ?? 'none'
  // Merge a partial into the current effect (same kind guaranteed by the UI branch).
  const patch = (p: Partial<Record<string, unknown>>) => {
    if (value) onChange({ ...value, ...p } as TextEffect)
  }
  return (
    <>
      <Field label="Effect">
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value
            onChange(k === 'none' ? undefined : DEFAULT_TEXT_EFFECT[k as TextEffectKind])
          }}
          className={SELECT_CLS}
        >
          <option value="none">None</option>
          {TEXT_EFFECT_KINDS.map((k) => <option key={k} value={k}>{TEXT_EFFECT_LABELS[k]}</option>)}
        </select>
      </Field>

      {value?.kind === 'glow' && (
        <>
          <ColorRow label="Colour" value={value.color} onChange={(color) => patch({ color })} />
          <SliderRow label="Blur" value={value.blur} min={2} max={40} step={1} onChange={(blur) => patch({ blur })} />
        </>
      )}
      {value?.kind === 'outline' && (
        <>
          <ColorRow label="Colour" value={value.color} onChange={(color) => patch({ color })} />
          <SliderRow label="Width" value={value.width} min={0.5} max={12} step={0.5} onChange={(width) => patch({ width })}
            fmt={(v) => v.toFixed(1)} />
        </>
      )}
      {value?.kind === 'shadow' && (
        <>
          <ColorRow label="Colour" value={value.color} onChange={(color) => patch({ color })} />
          <SliderRow label="Offset X" value={value.dx} min={-30} max={30} step={1} onChange={(dx) => patch({ dx })} />
          <SliderRow label="Offset Y" value={value.dy} min={-30} max={30} step={1} onChange={(dy) => patch({ dy })} />
          <SliderRow label="Blur" value={value.blur} min={0} max={30} step={1} onChange={(blur) => patch({ blur })} />
        </>
      )}
      {value?.kind === 'gradient' && (
        <>
          <ColorRow label="From" value={value.from} onChange={(from) => patch({ from })} />
          <ColorRow label="To" value={value.to} onChange={(to) => patch({ to })} />
          <SliderRow label="Angle" value={value.angle} min={0} max={360} step={5} onChange={(angle) => patch({ angle })}
            fmt={(v) => `${v}°`} />
        </>
      )}
      {value?.kind === 'pulse' && (
        <>
          <SliderRow label="Speed" value={value.speed} min={0.1} max={4} step={0.1} onChange={(speed) => patch({ speed })}
            fmt={(v) => v.toFixed(1)} />
          <SliderRow label="Amount" value={value.amount} min={0.1} max={2} step={0.1} onChange={(amount) => patch({ amount })}
            fmt={(v) => v.toFixed(1)} />
        </>
      )}
      {value?.kind === 'rainbow' && (
        <SliderRow label="Speed" value={value.speed} min={0.1} max={4} step={0.1} onChange={(speed) => patch({ speed })}
          fmt={(v) => v.toFixed(1)} />
      )}
      {value?.kind === 'wave' && (
        <>
          <SliderRow label="Speed" value={value.speed} min={0.1} max={4} step={0.1} onChange={(speed) => patch({ speed })}
            fmt={(v) => v.toFixed(1)} />
          <SliderRow label="Amplitude" value={value.amplitude} min={1} max={40} step={1} onChange={(amplitude) => patch({ amplitude })} />
        </>
      )}
      {value?.kind === 'shimmer' && (
        <>
          <ColorRow label="Highlight" value={value.color} onChange={(color) => patch({ color })} />
          <SliderRow label="Speed" value={value.speed} min={0.1} max={4} step={0.1} onChange={(speed) => patch({ speed })}
            fmt={(v) => v.toFixed(1)} />
        </>
      )}
    </>
  )
}

/**
 * Draggable "type-on" bar: the track is the object's full lifespan, the amber fill is how long the
 * object takes to type/draw on. Drag anywhere (fully left = instant / no reveal). Uses transient
 * dispatch while dragging so the whole gesture is a single undo entry.
 */
export function TypeOnBar({
  animateIn, duration, onChange, onCommit,
}: {
  animateIn: number
  duration: number
  onChange: (v: number) => void
  onCommit: () => void
}) {
  const dragging = useRef(false)
  const pct = duration > 0 ? clamp01(animateIn / duration) * 100 : 0

  const setFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = rect.width > 0 ? clamp01((e.clientX - rect.left) / rect.width) : 0
    onChange(Math.round(frac * duration * 10) / 10)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-muted text-xs">Reveal</label>
        <span className="text-[10px] text-subtle tabular-nums">
          {animateIn <= 0 ? 'instant' : `${animateIn.toFixed(1)}s of ${duration.toFixed(1)}s`}
        </span>
      </div>
      <div
        className="relative h-4 w-full rounded bg-border cursor-ew-resize select-none touch-none"
        title="Drag to set how long the object takes to reveal (type / draw on / grow in) — fully left = instant"
        onPointerDown={(e) => {
          e.preventDefault()
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromEvent(e)
        }}
        onPointerMove={(e) => { if (dragging.current) setFromEvent(e) }}
        onPointerUp={(e) => {
          if (!dragging.current) return
          dragging.current = false
          e.currentTarget.releasePointerCapture(e.pointerId)
          onCommit()
        }}
      >
        {/* Filled type-on portion, striped to match the timeline stripe */}
        <div className="absolute top-0 left-0 h-full rounded-l bg-amber-500/50 pointer-events-none" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-0 left-0 h-full pointer-events-none"
          style={{ width: `${pct}%`, background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 3px, transparent 3px, transparent 6px)' }}
        />
        {/* Grabber at the right edge of the fill */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-6 rounded-sm bg-amber-300 border border-amber-700 pointer-events-none"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** The object's full lifespan as a bar, with the transition's slice filled from one end. */
function LifespanBar({ duration, portion, align }: { duration: number; portion: number; align: 'left' | 'right' }) {
  const pct = duration > 0 ? Math.min(100, (portion / duration) * 100) : 0
  return (
    <div
      className="relative h-2 w-full rounded bg-border overflow-hidden mt-1"
      title="Transition length relative to the object's full lifespan"
    >
      <div
        className="absolute top-0 h-full bg-accent/70"
        style={{ width: `${pct}%`, left: align === 'left' ? 0 : undefined, right: align === 'right' ? 0 : undefined }}
      />
    </div>
  )
}

/** Mini timeline: this object's keyframes as colored diamonds + the live playhead position (req 6). */
export function KeyframeTrack({
  obj, kfs, clipTime, activeIdx, onSeek,
}: {
  obj: TimelineObject
  kfs: Keyframe[]
  clipTime: number
  activeIdx: number
  onSeek: (t: number) => void
}) {
  const dur = obj.duration > 0 ? obj.duration : 1
  const playPct = clamp01(clipTime / dur) * 100
  return (
    <div className="relative h-9 w-full mb-1 select-none">
      {/* baseline spanning the clip's lifespan */}
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border-strong" />
      {/* playhead */}
      <div className="absolute top-1 bottom-3 w-0.5 -translate-x-1/2 bg-playhead z-10" style={{ left: `${playPct}%` }} />
      {/* keyframe diamonds, positioned by time and colored to match their pip */}
      {kfs.map((k, i) => {
        const pct = clamp01(k.time / dur) * 100
        const color = keyframeColor(i)
        const active = i === activeIdx
        return (
          <button
            key={i}
            onClick={() => onSeek(obj.startTime + k.time)}
            title={`Keyframe ${i + 1} @ ${k.time.toFixed(2)}s — click to jump`}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer"
            style={{ left: `${pct}%` }}
          >
            <span
              className="block w-3 h-3 rotate-45 border"
              style={{
                background: color,
                borderColor: active ? '#fff' : 'rgba(0,0,0,0.5)',
                boxShadow: active ? '0 0 0 2px #fff' : 'none',
              }}
            />
            <span className="absolute left-1/2 -translate-x-1/2 top-3 text-[9px] tabular-nums text-muted">{i + 1}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Mini timeline for a zoom's pan/scale keyframes over its hold, + the live playhead. */
export function ZoomKeyframeTrack({
  zoom, kfs, holdTime, activeIdx, onSeek,
}: {
  zoom: CameraZoom
  kfs: CameraKeyframe[]
  holdTime: number
  activeIdx: number
  onSeek: (t: number) => void
}) {
  const hold = zoom.hold > 0 ? zoom.hold : 1
  const playPct = clamp01(holdTime / hold) * 100
  return (
    <div className="relative h-9 w-full mb-1 select-none">
      {/* baseline spanning the hold */}
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border-strong" />
      {/* playhead (within the hold) */}
      <div className="absolute top-1 bottom-3 w-0.5 -translate-x-1/2 bg-playhead z-10" style={{ left: `${playPct}%` }} />
      {/* keyframe diamonds, positioned by hold-relative time */}
      {kfs.map((k, i) => {
        const pct = clamp01(k.time / hold) * 100
        const color = keyframeColor(i)
        const active = i === activeIdx
        return (
          <button
            key={i}
            onClick={() => onSeek(zoom.startTime + zoom.transitionIn + k.time)}
            title={`Keyframe ${i + 1} @ ${k.time.toFixed(2)}s into the hold — click to jump`}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer"
            style={{ left: `${pct}%` }}
          >
            <span
              className="block w-3 h-3 rotate-45 border"
              style={{
                background: color,
                borderColor: active ? '#fff' : 'rgba(0,0,0,0.5)',
                boxShadow: active ? '0 0 0 2px #fff' : 'none',
              }}
            />
            <span className="absolute left-1/2 -translate-x-1/2 top-3 text-[9px] tabular-nums text-muted">{i + 1}</span>
          </button>
        )
      })}
    </div>
  )
}

/** One-line status: where the playhead sits relative to the object's keyframes (req 6). */
export function KeyframeStatus({ kfs, clipTime, activeIdx }: { kfs: Keyframe[]; clipTime: number; activeIdx: number }) {
  let text: string
  let color: string | null = null
  if (activeIdx >= 0) {
    text = `On keyframe ${activeIdx + 1}`
    color = keyframeColor(activeIdx)
  } else if (clipTime <= kfs[0].time) {
    text = 'Before keyframe 1'
  } else if (clipTime >= kfs[kfs.length - 1].time) {
    text = `Past keyframe ${kfs.length}`
  } else {
    let i = 0
    while (i < kfs.length - 1 && !(clipTime >= kfs[i].time && clipTime < kfs[i + 1].time)) i++
    text = `Between keyframe ${i + 1} and ${i + 2}`
  }
  return (
    <p className="text-[10px] mb-2 flex items-center gap-1">
      <span className="text-subtle">Playhead:</span>
      <span className="font-semibold" style={{ color: color ?? '#d1d5db' }}>{text}</span>
    </p>
  )
}
