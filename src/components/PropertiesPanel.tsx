import { useRef } from 'react'
import type {
  TimelineObject, ProjectAction, ArrowData, AudioData, VideoData, TextData,
  AnimatableProperty, EasingKind, Transition, TransitionKind, SlideDirection, Keyframe,
} from '../types'
import {
  KF_EPS, effVal as kfEffVal, editPose, addKeyframeAt,
  keyframeColor, defaultTransitionEasing,
} from '../lib/keyframes'
import { clamp01 } from '../lib/easing'

type PropertiesPanelProps = {
  object: TimelineObject | null
  dispatch: React.Dispatch<ProjectAction>
  globalTime: number
  onSeek: (t: number) => void
}

const EASINGS: EasingKind[] = [
  'linear',
  'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
  'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'easeOutBack', 'spring',
]
const EASING_LABELS: Record<EasingKind, string> = {
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
const SELECT_CLS = 'bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none cursor-pointer'

export default function PropertiesPanel({ object: obj, dispatch, globalTime, onSeek }: PropertiesPanelProps) {
  if (!obj) {
    return (
      <div className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto text-sm">
        <p className="text-gray-500 text-xs">No object selected</p>
      </div>
    )
  }

  const update = (updates: Partial<Omit<TimelineObject, 'id' | 'type'>>) => {
    dispatch({ type: 'UPDATE_OBJECT', objectId: obj.id, updates })
  }

  const updateStyle = (styleUpdates: Partial<TimelineObject['style']>) => {
    update({ style: { ...obj.style, ...styleUpdates } })
  }

  // --- Pose / keyframe helpers ---
  const clipTime = globalTime - obj.startTime
  const clampTime = (t: number) => Math.max(0, Math.min(t, obj.duration))

  // Value shown in the position/style inputs: interpolated pose at the playhead.
  const effVal = (p: AnimatableProperty) => kfEffVal(obj, p, clipTime)

  // Editing a property: per-property keyframe-aware (cements a keyframe iff that property is
  // already keyframed; otherwise edits the static base — so un-keyframed objects stay draggable).
  const dispatchPose = (prop: AnimatableProperty, value: number, transient: boolean) => {
    const overrides: Partial<Record<AnimatableProperty, number>> = { [prop]: value }
    dispatch({
      type: transient ? 'UPDATE_OBJECT_TRANSIENT' : 'UPDATE_OBJECT',
      objectId: obj.id,
      updates: editPose(obj, overrides, clampTime(clipTime)),
    })
  }
  const commitPose = () => dispatch({ type: 'COMMIT_TRANSIENT' })

  const kfs = obj.keyframes ?? []
  const activeIdx = kfs.findIndex((k) => Math.abs(k.time - clipTime) < KF_EPS)
  // When parked on a keyframe, this accent color threads through the whole panel (ring, banner,
  // pips) so it's unmistakable that edits land on that keyframe — matching the canvas selection box.
  const activeColor = activeIdx >= 0 ? keyframeColor(activeIdx) : null

  // Keyframes are created ONLY here — never from editing/dragging.
  const addKeyframe = () => update({ keyframes: addKeyframeAt(obj, clampTime(clipTime)) })

  const setKeyframeEasing = (idx: number, easing: EasingKind) =>
    update({ keyframes: kfs.map((k, j) => (j === idx ? { ...k, easing } : k)) })
  const deleteKeyframe = (idx: number) => {
    const next = kfs.filter((_, j) => j !== idx)
    update({ keyframes: next.length ? next : undefined })
  }

  const isVisual = obj.type !== 'audio'

  return (
    <div
      className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto text-sm"
      style={activeColor ? { boxShadow: `inset 0 0 0 3px ${activeColor}` } : undefined}
    >
      {/* Editing-a-keyframe banner: loud, colored, and matches the canvas selection box + pip */}
      {activeColor && (
        <div
          className="mb-4 -mt-1 flex items-center gap-2 px-2 py-1.5 rounded text-white text-xs font-semibold"
          style={{ background: activeColor }}
        >
          <span className="text-sm leading-none">◆</span>
          <span>Editing Keyframe {activeIdx + 1}</span>
          <span className="ml-auto font-normal opacity-80">changes land here</span>
        </div>
      )}
      {/* Name */}
      <div className="mb-4">
        <input
          type="text"
          value={obj.name}
          onChange={(e) => update({ name: e.target.value })}
          className="w-full bg-gray-800 text-white text-sm px-2 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none"
        />
        <span className="text-[10px] text-gray-500 mt-1 block capitalize">{obj.type}</span>
      </div>

      {/* Timing */}
      <Section title="Timing">
        <Field label="Start (s)">
          <NumberInput value={obj.startTime} min={0} step={0.1} onChange={(v) => update({ startTime: v })} />
        </Field>
        <Field label="Duration (s)">
          <NumberInput value={obj.duration} min={0.1} step={0.1} onChange={(v) => update({ duration: v })} />
        </Field>
        {obj.type !== 'audio' && obj.type !== 'video' && (
          <TypeOnBar
            animateIn={obj.animateIn}
            duration={obj.duration}
            onChange={(v) => dispatch({ type: 'UPDATE_OBJECT_TRANSIENT', objectId: obj.id, updates: { animateIn: v } })}
            onCommit={() => dispatch({ type: 'COMMIT_TRANSIENT' })}
          />
        )}
        <Field label="Lane">
          <NumberInput value={obj.lane} min={0} step={1} onChange={(v) => update({ lane: v })} />
        </Field>
        {(obj.type === 'audio' || obj.type === 'video') && (
          <Field label="Speed">
            <span className="text-xs text-gray-400 tabular-nums">
              {((obj.data as AudioData | VideoData).originalDuration / obj.duration).toFixed(2)}x
            </span>
          </Field>
        )}
      </Section>

      {/* Position (not for audio — audio has no visual) */}
      {isVisual && (
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <Field label="X">
            <NumberInput value={effVal('x')} step={0.01} onChange={(v) => dispatchPose('x', v, false)} />
          </Field>
          <Field label="Y">
            <NumberInput value={effVal('y')} step={0.01} onChange={(v) => dispatchPose('y', v, false)} />
          </Field>
          <Field label="W">
            <NumberInput value={effVal('width')} step={0.01} min={0.01} onChange={(v) => dispatchPose('width', v, false)} />
          </Field>
          <Field label="H">
            <NumberInput value={effVal('height')} step={0.01} min={0.01} onChange={(v) => dispatchPose('height', v, false)} />
          </Field>
        </div>
        <Field label="Rotation">
          <NumberInput
            value={Math.round(effVal('rotation') * 180 / Math.PI * 10) / 10}
            step={1}
            onChange={(v) => dispatchPose('rotation', v * Math.PI / 180, false)}
          />
        </Field>
      </Section>
      )}

      {/* Enter / exit animations (visual objects) */}
      {isVisual && (
        <>
          <TransitionSection title="On Appear" phase="in" value={obj.enter} objDuration={obj.duration} onChange={(t) => update({ enter: t })} />
          <TransitionSection title="On Exit" phase="out" value={obj.exit} objDuration={obj.duration} onChange={(t) => update({ exit: t })} />
        </>
      )}

      {/* Keyframes — whole-pose waypoints, created only via the button */}
      {isVisual && (
        <Section title="Keyframes">
          {/* Position indicator: playhead vs this object's keyframes (req 6) */}
          {kfs.length > 0 && (
            <>
              <KeyframeTrack obj={obj} kfs={kfs} clipTime={clipTime} activeIdx={activeIdx} onSeek={onSeek} />
              <KeyframeStatus kfs={kfs} clipTime={clipTime} activeIdx={activeIdx} />
            </>
          )}

          {/* Numbered pips (click to jump) — each keeps the keyframe's own accent color */}
          <div className="flex flex-wrap items-center gap-1">
            {kfs.map((k, i) => {
              const color = keyframeColor(i)
              const active = i === activeIdx
              return (
                <button
                  key={i}
                  onClick={() => onSeek(obj.startTime + k.time)}
                  title={`Keyframe ${i + 1} @ ${k.time.toFixed(2)}s — click to jump`}
                  className="px-2 py-0.5 text-[10px] tabular-nums rounded border cursor-pointer transition-colors"
                  style={active
                    ? { background: color, borderColor: '#fff', color: '#fff', fontWeight: 700, boxShadow: `0 0 0 1px ${color}` }
                    : { background: 'transparent', borderColor: color, color }}
                >◆ {i + 1}</button>
              )
            })}
            <button
              onClick={addKeyframe}
              title="Capture the object's current pose as a keyframe at the playhead"
              className="px-1.5 py-0.5 text-[10px] rounded border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 cursor-pointer transition-colors"
            >+ Keyframe</button>
          </div>

          {activeIdx >= 0 ? (
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Motion</label>
                <select
                  value={kfs[activeIdx].easing}
                  onChange={(e) => setKeyframeEasing(activeIdx, e.target.value as EasingKind)}
                  className="w-full bg-gray-800 text-white text-[11px] px-1 py-1 rounded border outline-none cursor-pointer"
                  style={{ borderColor: activeColor ?? '#374151' }}
                >
                  {EASINGS.map((k) => <option key={k} value={k}>{EASING_LABELS[k]}</option>)}
                </select>
                {/* Clarify: the easing shapes the segment ARRIVING at this keyframe (req 7) */}
                <p className="text-[10px] text-gray-500 mt-1">
                  Plays as the object animates{' '}
                  <span className="text-gray-300">
                    {activeIdx === 0 ? 'from its start → Keyframe 1' : `from Keyframe ${activeIdx} → Keyframe ${activeIdx + 1}`}
                  </span>.
                </p>
              </div>
              <button
                onClick={() => deleteKeyframe(activeIdx)}
                className="w-full px-2 py-1 text-[11px] text-red-300 bg-red-900/40 hover:bg-red-800/50 rounded cursor-pointer transition-colors"
              >Delete keyframe {activeIdx + 1}</button>
            </div>
          ) : (
            <p className="text-[10px] text-gray-500 mt-1">
              {kfs.length > 0
                ? 'Jump to a ◆ keyframe to edit it. Moving the object at any other time drops a keyframe there so it passes through that pose; at the very start it moves the home pose instead.'
                : 'Press + Keyframe to start animating from the current pose. Once animating, moving the object at other times adds keyframes automatically.'}
            </p>
          )}
        </Section>
      )}

      {/* Volume (audio/video) */}
      {(obj.type === 'audio' || obj.type === 'video') && (
        <Section title="Audio">
          <Field label="Volume">
            <div className="flex items-center gap-2 w-full">
              <input
                type="range"
                min={0} max={100} step={1}
                value={Math.round((obj.data as AudioData | VideoData).volume * 100)}
                onChange={(e) => {
                  const data = obj.data as AudioData | VideoData
                  update({ data: { ...data, volume: Number(e.target.value) / 100 } })
                }}
                className="w-full"
              />
              <span className="text-[10px] text-gray-500 tabular-nums w-8 text-right">
                {Math.round((obj.data as AudioData | VideoData).volume * 100)}%
              </span>
            </div>
          </Field>
        </Section>
      )}

      {/* Style (for non-photo, non-audio, non-video objects) */}
      {obj.type !== 'photo' && obj.type !== 'audio' && obj.type !== 'video' && (
        <Section title="Style">
          <Field label="Color">
            <input
              type="color"
              value={obj.style.color}
              onChange={(e) => updateStyle({ color: e.target.value })}
              className="w-8 h-6 bg-transparent border-none cursor-pointer"
            />
          </Field>
          <Field label="Opacity">
            <input
              type="range"
              min={0} max={100} step={1}
              value={Math.round(effVal('opacity') * 100)}
              onChange={(e) => dispatchPose('opacity', Number(e.target.value) / 100, true)}
              onPointerUp={commitPose}
              onKeyUp={commitPose}
              className="w-full"
            />
          </Field>
          <Field label="Line width">
            <NumberInput value={obj.style.lineWidth} min={1} max={20} step={1} onChange={(v) => updateStyle({ lineWidth: v })} />
          </Field>
          {(obj.type === 'text') && (
            <Field label="Font size">
              <NumberInput value={obj.style.fontSize ?? 32} min={8} max={200} step={1} onChange={(v) => updateStyle({ fontSize: v })} />
            </Field>
          )}
        </Section>
      )}

      {/* Text-specific */}
      {obj.type === 'text' && (
        <Section title="Text">
          <textarea
            value={(obj.data as TextData).content}
            onChange={(e) => update({ data: { ...(obj.data as TextData), content: e.target.value } })}
            rows={3}
            placeholder="Enter text…"
            className="w-full bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none resize-y"
          />
          <Field label="Font">
            <select
              value={obj.style.fontFamily ?? 'sans-serif'}
              onChange={(e) => updateStyle({ fontFamily: e.target.value })}
              className={SELECT_CLS}
            >
              <option value="sans-serif">Sans</option>
              <option value="serif">Serif</option>
              <option value="monospace">Mono</option>
            </select>
          </Field>
          <Field label="Bold">
            <input
              type="checkbox"
              checked={(obj.style.fontWeight ?? 'bold') === 'bold'}
              onChange={(e) => updateStyle({ fontWeight: e.target.checked ? 'bold' : 'normal' })}
              className="accent-indigo-500 cursor-pointer"
            />
          </Field>
          <Field label="Background">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={(obj.data as TextData).background != null}
                onChange={(e) => {
                  const data = obj.data as TextData
                  update({ data: { ...data, background: e.target.checked ? (data.background ?? '#000000') : undefined } })
                }}
                className="accent-indigo-500 cursor-pointer"
              />
              {(obj.data as TextData).background != null && (
                <input
                  type="color"
                  value={(obj.data as TextData).background ?? '#000000'}
                  onChange={(e) => update({ data: { ...(obj.data as TextData), background: e.target.value } })}
                  className="w-8 h-6 bg-transparent border-none cursor-pointer"
                />
              )}
            </div>
          </Field>
        </Section>
      )}

      {/* Arrow-specific */}
      {obj.type === 'arrow' && (
        <Section title="Arrow">
          <Field label="Moving head">
            <input
              type="checkbox"
              checked={(obj.data as ArrowData).progressiveHead ?? true}
              onChange={(e) => {
                const arrowData = obj.data as ArrowData
                update({ data: { ...arrowData, progressiveHead: e.target.checked } })
              }}
              className="accent-indigo-500 cursor-pointer"
            />
          </Field>
          <Field label="Curvature">
            <div className="flex items-center gap-2 w-full">
              <input
                type="range"
                min={-100} max={100} step={1}
                value={Math.round(((obj.data as ArrowData).curvature ?? 0) * 100)}
                onChange={(e) => {
                  const arrowData = obj.data as ArrowData
                  update({ data: { ...arrowData, curvature: Number(e.target.value) / 100 } })
                }}
                onDoubleClick={() => {
                  const arrowData = obj.data as ArrowData
                  update({ data: { ...arrowData, curvature: 0 } })
                }}
                className="w-full"
              />
              <span className="text-[10px] text-gray-500 tabular-nums w-8 text-right">
                {((obj.data as ArrowData).curvature ?? 0).toFixed(1)}
              </span>
            </div>
          </Field>
        </Section>
      )}

      {/* Photo/video opacity */}
      {(obj.type === 'photo' || obj.type === 'video') && (
        <Section title="Style">
          <Field label="Opacity">
            <input
              type="range"
              min={0} max={100} step={1}
              value={Math.round(effVal('opacity') * 100)}
              onChange={(e) => dispatchPose('opacity', Number(e.target.value) / 100, true)}
              onPointerUp={commitPose}
              onKeyUp={commitPose}
              className="w-full"
            />
          </Field>
        </Section>
      )}

      {/* Actions */}
      <div className="mt-4 space-y-2">
        <button
          onClick={() => dispatch({ type: 'DUPLICATE_OBJECT', objectId: obj.id })}
          className="w-full px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors cursor-pointer"
        >
          Duplicate
        </button>
        <button
          onClick={() => dispatch({ type: 'REMOVE_OBJECT', objectId: obj.id })}
          className="w-full px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300 rounded transition-colors cursor-pointer"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// --- Helper components ---

function TransitionSection({
  title, phase, value, objDuration, onChange,
}: {
  title: string
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
    <Section title={title}>
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
            <label className="text-gray-400 text-xs block mb-1">Motion</label>
            <select
              value={effEasing}
              onChange={(e) => patch({ easing: e.target.value as EasingKind })}
              className="w-full bg-gray-800 text-white text-[11px] px-1 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none cursor-pointer"
            >
              {EASINGS.map((k) => <option key={k} value={k}>{EASING_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-gray-400 text-xs">Duration</label>
              <span className="text-[10px] text-gray-500 tabular-nums">{dur.toFixed(1)}s of {objDuration.toFixed(1)}s</span>
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
    </Section>
  )
}

/**
 * Draggable "type-on" bar: the track is the object's full lifespan, the amber fill is how long the
 * object takes to type/draw on. Drag anywhere (fully left = instant / no reveal). Uses transient
 * dispatch while dragging so the whole gesture is a single undo entry.
 */
function TypeOnBar({
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
        <label className="text-gray-400 text-xs">Type-on</label>
        <span className="text-[10px] text-gray-500 tabular-nums">
          {animateIn <= 0 ? 'instant' : `${animateIn.toFixed(1)}s of ${duration.toFixed(1)}s`}
        </span>
      </div>
      <div
        className="relative h-4 w-full rounded bg-gray-700 cursor-ew-resize select-none touch-none"
        title="Drag to set how long the object takes to type / draw on — fully left = instant"
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
      className="relative h-2 w-full rounded bg-gray-700 overflow-hidden mt-1"
      title="Transition length relative to the object's full lifespan"
    >
      <div
        className="absolute top-0 h-full bg-indigo-500/70"
        style={{ width: `${pct}%`, left: align === 'left' ? 0 : undefined, right: align === 'right' ? 0 : undefined }}
      />
    </div>
  )
}

/** Mini timeline: this object's keyframes as colored diamonds + the live playhead position (req 6). */
function KeyframeTrack({
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
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-gray-600" />
      {/* playhead */}
      <div className="absolute top-1 bottom-3 w-0.5 -translate-x-1/2 bg-red-500 z-10" style={{ left: `${playPct}%` }} />
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
            <span className="absolute left-1/2 -translate-x-1/2 top-3 text-[9px] tabular-nums text-gray-400">{i + 1}</span>
          </button>
        )
      })}
    </div>
  )
}

/** One-line status: where the playhead sits relative to the object's keyframes (req 6). */
function KeyframeStatus({ kfs, clipTime, activeIdx }: { kfs: Keyframe[]; clipTime: number; activeIdx: number }) {
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
      <span className="text-gray-500">Playhead:</span>
      <span className="font-semibold" style={{ color: color ?? '#d1d5db' }}>{text}</span>
    </p>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-gray-400 text-xs shrink-0">{label}</label>
      {children}
    </div>
  )
}

function NumberInput({
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
      className="w-20 bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none text-right"
    />
  )
}
