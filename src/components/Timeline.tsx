import { useRef, useCallback, useState, useEffect } from 'react'
import type { TimelineObject, ProjectAction, AudioData, VideoData, CameraZoom } from '../types'
import { keyframeColor } from '../lib/keyframes'
import { zoomEnvelope } from '../lib/camera'
import { sourceSpan, srcIn, srcOut } from '../lib/mediaTiming'

type TimelineProps = {
  objects: TimelineObject[]
  globalTime: number
  totalDuration: number
  selectedObjectId: string | null
  onSelectObject: (id: string | null) => void
  onSeek: (time: number) => void
  dispatch: React.Dispatch<ProjectAction>
  // Camera zooms (spec 13)
  zooms?: CameraZoom[]
  selectedZoomId: string | null
  onSelectZoom: (id: string | null) => void
}

const LANE_HEIGHT = 32
const LANE_GAP = 2
const RULER_HEIGHT = 24
const CAMERA_TRACK_HEIGHT = 32
const GUTTER_WIDTH = 32
const MIN_PIXELS_PER_SECOND = 20
const MAX_PIXELS_PER_SECOND = 400
const DEFAULT_PIXELS_PER_SECOND = 80
const TIMELINE_PADDING_SECONDS = 5
// Below this bar width, an audio/video clip is too narrow to safely split the edge handle
// into speed (top) + trim (bottom) halves, so it falls back to a single speed handle (R8).
const SPLIT_HANDLE_MIN_WIDTH = 28
const ZOOM_COLOR = '#f59e0b' // amber — matches the canvas framing rect + zoom panel

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

const TYPE_COLORS: Record<string, string> = {
  photo: '#3b82f6',     // blue
  arrow: '#ef4444',     // red
  text: '#22c55e',      // green
  rectangle: '#f59e0b', // amber
  circle: '#a855f7',    // purple
  audio: '#14b8a6',     // teal
  video: '#8b5cf6',     // violet
  freehand: '#ec4899',  // pink
}

type DragState =
  | null
  | { kind: 'move'; objectId: string; startMouseX: number; startMouseY: number; originalStartTime: number; originalLane: number; clampMinLane: number; clampMaxLane: number }
  | { kind: 'resize-left'; objectId: string; startMouseX: number; originalStartTime: number; originalDuration: number }
  | { kind: 'resize-right'; objectId: string; startMouseX: number; originalDuration: number }
  // Trim (spec 14 R8): rate-constant edge-drag on audio/video. Adjusts the source span + duration
  // (and startTime on the left edge, keeping the right timeline edge fixed) so playback speed is
  // preserved — the bottom half of the split edge handle.
  | { kind: 'trim-left'; objectId: string; startMouseX: number; originalStartTime: number; originalDuration: number; originalSourceIn: number; originalSourceOut: number; assetDuration: number }
  | { kind: 'trim-right'; objectId: string; startMouseX: number; originalDuration: number; originalSourceIn: number; originalSourceOut: number; assetDuration: number }
  | { kind: 'move-keyframe'; objectId: string; kfIndex: number; startMouseX: number; originalTime: number; minTime: number; maxTime: number }
  | { kind: 'playhead'; startMouseX: number; startTime: number }
  // Camera-zoom bars on the pinned Camera track (spec 13). Move shifts startTime; resizing
  // adjusts the zoom's `hold` (the flexible middle of the envelope), anchored at the opposite edge.
  | { kind: 'zoom-move'; zoomId: string; startMouseX: number; originalStartTime: number }
  | { kind: 'zoom-resize-right'; zoomId: string; startMouseX: number; originalHold: number }
  | { kind: 'zoom-resize-left'; zoomId: string; startMouseX: number; originalStartTime: number; originalHold: number }

/** Feather-style eye / eye-off glyph for the hide toggle (spec 14 R11). */
function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default function Timeline({
  objects,
  globalTime,
  totalDuration,
  selectedObjectId,
  onSelectObject,
  onSeek,
  dispatch,
  zooms,
  selectedZoomId,
  onSelectZoom,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND)
  const [dragState, setDragState] = useState<DragState>(null)
  // Track explicitly added lane boundaries (absolute lane numbers, not offsets)
  // null = no extra lanes beyond object range
  const [addedTopLane, setAddedTopLane] = useState<number | null>(null)
  const [addedBottomLane, setAddedBottomLane] = useState<number | null>(null)

  // Compute lane range from objects
  const objMinLane = objects.length > 0
    ? objects.reduce((min, obj) => Math.min(min, obj.lane), Infinity)
    : 0
  const objMaxLane = objects.length > 0
    ? objects.reduce((max, obj) => Math.max(max, obj.lane), -Infinity)
    : 0
  // Combine object range with explicitly added lanes
  const minLane = addedBottomLane !== null ? Math.min(objMinLane, addedBottomLane) : objMinLane
  const maxLane = addedTopLane !== null ? Math.max(objMaxLane, addedTopLane) : objMaxLane
  const laneCount = Math.max(maxLane - minLane + 1, 1)

  // Build array of lane numbers from bottom to top
  const lanes: number[] = []
  for (let l = minLane; l <= maxLane; l++) lanes.push(l)

  const viewDuration = Math.max(totalDuration + TIMELINE_PADDING_SECONDS, 10)
  const timelineWidth = viewDuration * pixelsPerSecond

  const timeToX = useCallback((time: number) => time * pixelsPerSecond, [pixelsPerSecond])
  const xToTime = useCallback(
    (x: number) => Math.max(0, x / pixelsPerSecond),
    [pixelsPerSecond],
  )

  // Zoom with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setPixelsPerSecond((prev) => {
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        return Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, prev * factor))
      })
    }
  }, [])

  // Click on ruler or empty area to seek
  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const scrollLeft = containerRef.current?.scrollLeft ?? 0
      const x = e.clientX - rect.left + scrollLeft
      onSeek(xToTime(x))
    },
    [xToTime, onSeek],
  )

  // Lane management
  const handleAddLaneAbove = useCallback(() => {
    const currentMax = addedTopLane !== null ? Math.max(objMaxLane, addedTopLane) : objMaxLane
    setAddedTopLane(currentMax + 1)
  }, [objMaxLane, addedTopLane])

  const handleAddLaneBelow = useCallback(() => {
    const currentMin = addedBottomLane !== null ? Math.min(objMinLane, addedBottomLane) : objMinLane
    setAddedBottomLane(currentMin - 1)
  }, [objMinLane, addedBottomLane])

  const handleRemoveLane = useCallback((lane: number) => {
    const objectsOnLane = objects.filter((o) => o.lane === lane)
    if (objectsOnLane.length > 0) {
      dispatch({ type: 'REMOVE_LANE', lane })
    }
    // Shrink explicitly added lane boundaries
    if (addedTopLane !== null && lane >= objMaxLane) {
      const newTop = addedTopLane - 1
      setAddedTopLane(newTop > objMaxLane ? newTop : null)
    } else if (addedBottomLane !== null && lane <= objMinLane) {
      const newBottom = addedBottomLane + 1
      setAddedBottomLane(newBottom < objMinLane ? newBottom : null)
    }
  }, [objects, dispatch, objMaxLane, objMinLane, addedTopLane, addedBottomLane])

  // Mouse drag handling
  useEffect(() => {
    if (!dragState) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startMouseX
      const dt = dx / pixelsPerSecond

      if (dragState.kind === 'playhead') {
        onSeek(Math.max(0, dragState.startTime + dt))
      } else if (dragState.kind === 'move') {
        const newStart = Math.round(Math.max(0, dragState.originalStartTime + dt) * 10) / 10
        // Calculate target lane, clamped to existing lanes
        const dy = e.clientY - dragState.startMouseY
        const laneDelta = Math.round(-dy / (LANE_HEIGHT + LANE_GAP))
        const targetLane = Math.max(dragState.clampMinLane, Math.min(dragState.clampMaxLane, dragState.originalLane + laneDelta))
        dispatch({
          type: 'UPDATE_OBJECT_TRANSIENT',
          objectId: dragState.objectId,
          updates: { startTime: newStart, lane: targetLane },
        })
      } else if (dragState.kind === 'resize-left') {
        const rawStart = Math.max(0, Math.min(
          dragState.originalStartTime + dragState.originalDuration - 0.1,
          dragState.originalStartTime + dt,
        ))
        const newStart = Math.round(rawStart * 10) / 10
        let newDuration = Math.round((dragState.originalStartTime + dragState.originalDuration - newStart) * 10) / 10
        const obj = objects.find((o) => o.id === dragState.objectId)
        // Clamp duration for audio/video to respect 0.25x–4x playback rate. Speed-drag keeps the
        // source span fixed, so the clamp is [span/4, span*4] (== originalDuration for an untrimmed
        // clip, so this is behavior-identical to before for existing projects).
        if (obj && (obj.type === 'audio' || obj.type === 'video')) {
          const span = sourceSpan(obj.data as AudioData | VideoData)
          newDuration = Math.max(span / 4, Math.min(span * 4, newDuration))
        }
        const clampedAnimateIn = obj ? Math.min(obj.animateIn, newDuration) : undefined
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { startTime: newStart, duration: newDuration, ...(clampedAnimateIn !== undefined && { animateIn: clampedAnimateIn }) },
        })
      } else if (dragState.kind === 'resize-right') {
        let newDuration = Math.round(Math.max(0.1, dragState.originalDuration + dt) * 10) / 10
        const obj = objects.find((o) => o.id === dragState.objectId)
        // Clamp duration for audio/video to respect 0.25x–4x playback rate. Speed-drag keeps the
        // source span fixed, so the clamp is [span/4, span*4] (== originalDuration for an untrimmed
        // clip, so this is behavior-identical to before for existing projects).
        if (obj && (obj.type === 'audio' || obj.type === 'video')) {
          const span = sourceSpan(obj.data as AudioData | VideoData)
          newDuration = Math.max(span / 4, Math.min(span * 4, newDuration))
        }
        const clampedAnimateIn = obj ? Math.min(obj.animateIn, newDuration) : undefined
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { duration: newDuration, ...(clampedAnimateIn !== undefined && { animateIn: clampedAnimateIn }) },
        })
      } else if (dragState.kind === 'trim-left') {
        // Left-trim: rate constant, right timeline edge fixed. Shorten/lengthen from the left by
        // shifting startTime + duration and revealing a different sourceIn. Bounded sourceIn ≥ 0.
        const origSpan = dragState.originalSourceOut - dragState.originalSourceIn
        const rate = origSpan / dragState.originalDuration
        const rightEdge = dragState.originalStartTime + dragState.originalDuration
        // duration ≤ originalSourceOut/rate keeps sourceIn ≥ 0; duration ≤ rightEdge keeps startTime ≥ 0.
        const maxDur = Math.min(dragState.originalSourceOut / rate, rightEdge)
        const newDuration = Math.round(Math.max(0.1, Math.min(maxDur, dragState.originalDuration - dt)) * 100) / 100
        const newSourceIn = Math.max(0, dragState.originalSourceOut - rate * newDuration)
        const newStart = Math.round((rightEdge - newDuration) * 100) / 100
        const obj = objects.find((o) => o.id === dragState.objectId)
        if (obj) {
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: dragState.objectId,
            updates: {
              startTime: newStart,
              duration: newDuration,
              animateIn: Math.min(obj.animateIn, newDuration),
              data: { ...(obj.data as AudioData | VideoData), sourceIn: newSourceIn, sourceOut: dragState.originalSourceOut },
            },
          })
        }
      } else if (dragState.kind === 'trim-right') {
        // Right-trim: rate constant, startTime fixed. Reveal a different sourceOut. Bounded by the
        // asset length (sourceOut ≤ originalDuration of the asset).
        const origSpan = dragState.originalSourceOut - dragState.originalSourceIn
        const rate = origSpan / dragState.originalDuration
        const maxDur = (dragState.assetDuration - dragState.originalSourceIn) / rate
        const newDuration = Math.round(Math.max(0.1, Math.min(maxDur, dragState.originalDuration + dt)) * 100) / 100
        const newSourceOut = Math.min(dragState.assetDuration, dragState.originalSourceIn + rate * newDuration)
        const obj = objects.find((o) => o.id === dragState.objectId)
        if (obj) {
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: dragState.objectId,
            updates: {
              duration: newDuration,
              animateIn: Math.min(obj.animateIn, newDuration),
              data: { ...(obj.data as AudioData | VideoData), sourceIn: dragState.originalSourceIn, sourceOut: newSourceOut },
            },
          })
        }
      } else if (dragState.kind === 'move-keyframe') {
        // Retime a single keyframe; clamped between its neighbors so the order never flips.
        const raw = dragState.originalTime + dt
        const t = Math.round(Math.max(dragState.minTime, Math.min(dragState.maxTime, raw)) * 100) / 100
        const obj = objects.find((o) => o.id === dragState.objectId)
        if (obj?.keyframes) {
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: dragState.objectId,
            updates: { keyframes: obj.keyframes.map((k, j) => (j === dragState.kfIndex ? { ...k, time: t } : k)) },
          })
        }
      } else if (dragState.kind === 'zoom-move') {
        const newStart = Math.round(Math.max(0, dragState.originalStartTime + dt) * 10) / 10
        dispatch({ type: 'UPDATE_ZOOM_TRANSIENT', zoomId: dragState.zoomId, updates: { startTime: newStart } })
      } else if (dragState.kind === 'zoom-resize-right') {
        // Grow/shrink the hold; start + transitions stay put.
        const newHold = Math.round(Math.max(0, dragState.originalHold + dt) * 10) / 10
        dispatch({ type: 'UPDATE_ZOOM_TRANSIENT', zoomId: dragState.zoomId, updates: { hold: newHold } })
      } else if (dragState.kind === 'zoom-resize-left') {
        // Move the start while keeping the right edge fixed → hold shrinks by the same amount.
        // Clamp so hold never goes negative (start can't cross the fixed end).
        const clampedDt = Math.max(-dragState.originalStartTime, Math.min(dragState.originalHold, dt))
        const newStart = Math.round((dragState.originalStartTime + clampedDt) * 10) / 10
        const newHold = Math.round((dragState.originalHold - clampedDt) * 10) / 10
        dispatch({ type: 'UPDATE_ZOOM_TRANSIENT', zoomId: dragState.zoomId, updates: { startTime: newStart, hold: newHold } })
      }
    }

    const handleMouseUp = () => {
      if (
        dragState.kind === 'move' || dragState.kind === 'move-keyframe' ||
        dragState.kind === 'trim-left' || dragState.kind === 'trim-right' ||
        dragState.kind === 'zoom-move' || dragState.kind === 'zoom-resize-right' || dragState.kind === 'zoom-resize-left'
      ) {
        dispatch({ type: 'COMMIT_TRANSIENT' })
      }
      setDragState(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, pixelsPerSecond, dispatch, onSeek, minLane, maxLane, objects])

  // Render ruler ticks
  const ticks: { time: number; label: string; major: boolean }[] = []
  const tickInterval = pixelsPerSecond >= 100 ? 1 : pixelsPerSecond >= 40 ? 2 : 5
  for (let t = 0; t <= viewDuration; t += tickInterval) {
    ticks.push({ time: t, label: `${t}s`, major: t % (tickInterval * 2) === 0 })
  }

  const trackHeight = laneCount * (LANE_HEIGHT + LANE_GAP) + LANE_GAP

  // Helper: visual Y position for a lane number
  const laneToY = (lane: number) => {
    const laneIndex = lane - minLane
    return (laneCount - 1 - laneIndex) * (LANE_HEIGHT + LANE_GAP) + LANE_GAP
  }

  return (
    <div className="bg-gray-900 border-t border-gray-700 select-none" style={{ minHeight: 120 }}>
      <div className="flex">
        {/* Lane gutter (fixed, doesn't scroll) */}
        <div className="flex-shrink-0 flex flex-col" style={{ width: GUTTER_WIDTH }}>
          {/* Spacer for ruler */}
          <div className="bg-gray-800 border-b border-gray-700" style={{ height: RULER_HEIGHT }} />

          {/* Camera track label (pinned, spec 13) */}
          <div
            className="w-full flex items-center justify-center border-b border-gray-700 text-amber-500"
            style={{ height: CAMERA_TRACK_HEIGHT }}
            title="Camera zooms"
          >
            <span className="text-sm leading-none">⛶</span>
          </div>

          {/* Add lane above CTA (dedicated blank lane row) */}
          <button
            onClick={handleAddLaneAbove}
            className="w-full flex items-center justify-center text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
            style={{ height: LANE_HEIGHT }}
            title="Add lane above"
          >
            <span className="text-sm font-bold leading-none">+</span>
          </button>

          {/* Lane controls */}
          <div className="relative" style={{ height: trackHeight }}>
            {/* Per-lane remove buttons */}
            {lanes.map((lane) => {
              const y = laneToY(lane)
              const hasObjects = objects.some((o) => o.lane === lane)
              return (
                <button
                  key={lane}
                  onClick={() => handleRemoveLane(lane)}
                  disabled={laneCount <= 1}
                  className="absolute left-0 w-full flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-0 disabled:pointer-events-none transition-colors cursor-pointer"
                  style={{ top: y, height: LANE_HEIGHT }}
                  title={hasObjects ? 'Remove lane (objects move up)' : 'Remove empty lane'}
                >
                  <span className="text-sm leading-none">&times;</span>
                </button>
              )
            })}
          </div>

          {/* Add lane below CTA (dedicated blank lane row) */}
          <button
            onClick={handleAddLaneBelow}
            className="w-full flex items-center justify-center text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
            style={{ height: LANE_HEIGHT }}
            title="Add lane below"
          >
            <span className="text-sm font-bold leading-none">+</span>
          </button>
        </div>

        {/* Scrollable timeline area */}
        <div
          ref={containerRef}
          className="overflow-x-auto overflow-y-hidden flex-1"
          onWheel={handleWheel}
        >
          <div style={{ width: timelineWidth, position: 'relative' }}>
            {/* Ruler */}
            <div
              className="sticky top-0 bg-gray-800 border-b border-gray-700 cursor-pointer"
              style={{ height: RULER_HEIGHT }}
              onMouseDown={(e) => {
                handleRulerClick(e)
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) return
                const scrollLeft = containerRef.current?.scrollLeft ?? 0
                const x = e.clientX - rect.left + scrollLeft
                setDragState({ kind: 'playhead', startMouseX: e.clientX, startTime: xToTime(x) })
              }}
            >
              {ticks.map((tick) => (
                <div
                  key={tick.time}
                  className="absolute top-0"
                  style={{ left: timeToX(tick.time) }}
                >
                  <div
                    className={`w-px ${tick.major ? 'h-3 bg-gray-400' : 'h-2 bg-gray-600'}`}
                    style={{ marginTop: tick.major ? 0 : 4 }}
                  />
                  {tick.major && (
                    <span className="absolute text-[10px] text-gray-400 -translate-x-1/2" style={{ top: 12 }}>
                      {tick.label}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Camera track (pinned, spec 13): zoom envelope bars — not an object lane. */}
            <div
              className="relative border-b border-gray-800"
              style={{ height: CAMERA_TRACK_HEIGHT, background: 'rgba(245,158,11,0.04)' }}
              onMouseDown={(e) => {
                // Click empty camera track: deselect any zoom + seek
                if (e.target === e.currentTarget) {
                  onSelectZoom(null)
                  const rect = containerRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const scrollLeft = containerRef.current?.scrollLeft ?? 0
                  const x = e.clientX - rect.left + scrollLeft
                  onSeek(xToTime(x))
                }
              }}
            >
              {(zooms ?? []).map((zoom) => {
                const env = zoomEnvelope(zoom)
                const left = timeToX(zoom.startTime)
                const width = Math.max(timeToX(env), 8)
                const inW = timeToX(zoom.transitionIn)
                const outW = timeToX(zoom.transitionOut)
                const isSelected = zoom.id === selectedZoomId
                return (
                  <div
                    key={zoom.id}
                    className="absolute top-0 group"
                    style={{ left, top: 2, width, height: CAMERA_TRACK_HEIGHT - 4 }}
                  >
                    {/* Left resize handle (adjusts hold, right edge fixed) */}
                    <div
                      className="absolute left-0 top-0 w-1.5 h-full cursor-col-resize z-40 hover:bg-white/40"
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        onSelectZoom(zoom.id)
                        setDragState({ kind: 'zoom-resize-left', zoomId: zoom.id, startMouseX: e.clientX, originalStartTime: zoom.startTime, originalHold: zoom.hold })
                      }}
                    />

                    {/* Bar body (drag to retime) */}
                    <div
                      className="absolute inset-0 rounded-sm overflow-hidden cursor-grab active:cursor-grabbing"
                      style={{
                        backgroundColor: ZOOM_COLOR,
                        // Hidden zooms (spec 14 R11.3) render dimmed + dashed on the Camera track.
                        opacity: zoom.hidden ? 0.35 : isSelected ? 1 : 0.72,
                        outline: isSelected ? '2px solid white' : zoom.hidden ? '1px dashed rgba(255,255,255,0.7)' : 'none',
                        outlineOffset: -1,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        onSelectZoom(zoom.id)
                        setDragState({ kind: 'zoom-move', zoomId: zoom.id, startMouseX: e.clientX, originalStartTime: zoom.startTime })
                      }}
                    >
                      {/* transition-in ramp (left) */}
                      {zoom.transitionIn > 0 && (
                        <div
                          className="absolute top-0 left-0 h-full pointer-events-none"
                          style={{ width: Math.min(inW, width), background: 'linear-gradient(90deg, rgba(0,0,0,0.4), transparent)' }}
                        />
                      )}
                      {/* transition-out ramp (right) */}
                      {zoom.transitionOut > 0 && (
                        <div
                          className="absolute top-0 right-0 h-full pointer-events-none"
                          style={{ width: Math.min(outW, width), background: 'linear-gradient(270deg, rgba(0,0,0,0.4), transparent)' }}
                        />
                      )}
                      <span className="relative text-[10px] text-black/90 px-1.5 truncate leading-7 pointer-events-none font-semibold">
                        ⛶ {zoom.scale.toFixed(1)}×
                      </span>
                    </div>

                    {/* Right resize handle (adjusts hold, left edge fixed) */}
                    <div
                      className="absolute right-0 top-0 w-2 h-full cursor-col-resize z-40"
                      style={{ background: 'rgba(255,255,255,0.25)' }}
                      onMouseEnter={(e) => { if (!dragState) (e.currentTarget.style.background = 'rgba(255,255,255,0.5)') }}
                      onMouseLeave={(e) => { (e.currentTarget.style.background = 'rgba(255,255,255,0.25)') }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        onSelectZoom(zoom.id)
                        setDragState({ kind: 'zoom-resize-right', zoomId: zoom.id, startMouseX: e.clientX, originalHold: zoom.hold })
                      }}
                    />

                    {/* Hide toggle for the zoom (spec 14 R11.3) — revealed on hover; always shown when hidden. */}
                    <button
                      className={`absolute top-0.5 z-50 flex items-center justify-center rounded text-black hover:bg-white/40 ${zoom.hidden ? 'opacity-100 bg-white/40' : 'opacity-0 group-hover:opacity-100'}`}
                      style={{ right: 11, width: 16, height: 16 }}
                      title={zoom.hidden ? 'Show zoom (H)' : 'Hide zoom (H)'}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        dispatch({ type: 'UPDATE_ZOOM', zoomId: zoom.id, updates: { hidden: !zoom.hidden } })
                      }}
                    >
                      <EyeIcon off={!!zoom.hidden} />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Blank lane spacer for "add above" CTA alignment */}
            <div style={{ height: LANE_HEIGHT }} />

            {/* Lanes */}
            <div
              className="relative"
              style={{ height: trackHeight }}
              onMouseDown={(e) => {
                // Click empty area to deselect
                if (e.target === e.currentTarget) {
                  onSelectObject(null)
                  onSelectZoom(null)
                  // Also seek
                  const rect = containerRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const scrollLeft = containerRef.current?.scrollLeft ?? 0
                  const x = e.clientX - rect.left + scrollLeft
                  onSeek(xToTime(x))
                }
              }}
            >
              {/* Lane backgrounds */}
              {lanes.map((lane, i) => (
                <div
                  key={lane}
                  className="absolute w-full"
                  style={{
                    top: laneToY(lane),
                    height: LANE_HEIGHT,
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  }}
                />
              ))}

              {/* Object bars */}
              {objects.map((obj) => {
                const left = timeToX(obj.startTime)
                const width = Math.max(timeToX(obj.duration), 4)
                const top = laneToY(obj.lane)
                const color = TYPE_COLORS[obj.type] ?? '#666'
                const isSelected = obj.id === selectedObjectId
                // Media clips get split edge handles (speed on top, trim on bottom — spec 14 R8);
                // very narrow clips fall back to a single speed handle.
                const md = obj.type === 'audio' || obj.type === 'video' ? (obj.data as AudioData | VideoData) : null
                const splitHandles = md !== null && width >= SPLIT_HANDLE_MIN_WIDTH
                // Trim "ghosts": the played bar (= duration) is solid; the trimmed-off source is drawn
                // dimmed on each end so the bar keeps its ORIGINAL full length and the trimmed media
                // stays visible/recoverable — drag a ghost (or the trim handle) back out to restore.
                const rate = md && obj.duration > 0 ? sourceSpan(md) / obj.duration : 1
                const leftGhostPx = md ? timeToX(srcIn(md) / rate) : 0
                const rightGhostPx = md ? timeToX((md.originalDuration - srcOut(md)) / rate) : 0

                return (
                  <div
                    key={obj.id}
                    className="absolute flex items-center group"
                    style={{
                      left,
                      top,
                      width,
                      height: LANE_HEIGHT,
                    }}
                  >
                    {/* Trim ghosts (spec 14 R8 feedback): dimmed, draggable stubs of trimmed-off
                        source on each end so the bar keeps its original length and stays restorable.
                        Dragging a ghost runs the same rate-constant trim as the bottom edge handle. */}
                    {md && leftGhostPx > 1.5 && (
                      <div
                        className="absolute top-0 cursor-ew-resize rounded-l-sm opacity-25 hover:opacity-45 transition-opacity"
                        style={{
                          right: '100%',
                          width: leftGhostPx,
                          height: LANE_HEIGHT,
                          background: `repeating-linear-gradient(45deg, ${color} 0, ${color} 3px, transparent 3px, transparent 7px)`,
                          border: `1px dashed ${color}`,
                          borderRight: 'none',
                        }}
                        title="Trimmed source — drag to restore"
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          onSelectObject(obj.id)
                          setDragState({ kind: 'trim-left', objectId: obj.id, startMouseX: e.clientX, originalStartTime: obj.startTime, originalDuration: obj.duration, originalSourceIn: srcIn(md), originalSourceOut: srcOut(md), assetDuration: md.originalDuration })
                        }}
                      />
                    )}
                    {md && rightGhostPx > 1.5 && (
                      <div
                        className="absolute top-0 cursor-ew-resize rounded-r-sm opacity-25 hover:opacity-45 transition-opacity"
                        style={{
                          left: '100%',
                          width: rightGhostPx,
                          height: LANE_HEIGHT,
                          background: `repeating-linear-gradient(45deg, ${color} 0, ${color} 3px, transparent 3px, transparent 7px)`,
                          border: `1px dashed ${color}`,
                          borderLeft: 'none',
                        }}
                        title="Trimmed source — drag to restore"
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          onSelectObject(obj.id)
                          setDragState({ kind: 'trim-right', objectId: obj.id, startMouseX: e.clientX, originalDuration: obj.duration, originalSourceIn: srcIn(md), originalSourceOut: srcOut(md), assetDuration: md.originalDuration })
                        }}
                      />
                    )}

                    {/* Left edge handle. Media clips (R8) split into speed (top) + trim (bottom);
                        non-media / narrow clips keep the single speed handle. */}
                    {splitHandles && md ? (
                      <>
                        <div
                          className="absolute left-0 top-0 w-1.5 h-1/2 cursor-col-resize z-40 hover:bg-white/40"
                          title="Drag to change speed"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            onSelectObject(obj.id)
                            setDragState({ kind: 'resize-left', objectId: obj.id, startMouseX: e.clientX, originalStartTime: obj.startTime, originalDuration: obj.duration })
                          }}
                        />
                        <div
                          className="absolute left-0 bottom-0 w-1.5 h-1/2 cursor-ew-resize z-40 flex items-center justify-center bg-amber-400/0 group-hover:bg-amber-400/60"
                          title="Drag to trim in-point (keeps speed)"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            onSelectObject(obj.id)
                            setDragState({ kind: 'trim-left', objectId: obj.id, startMouseX: e.clientX, originalStartTime: obj.startTime, originalDuration: obj.duration, originalSourceIn: srcIn(md), originalSourceOut: srcOut(md), assetDuration: md.originalDuration })
                          }}
                        >
                          <span className="text-[9px] text-black font-bold leading-none pointer-events-none opacity-0 group-hover:opacity-100">[</span>
                        </div>
                      </>
                    ) : (
                      <div
                        className="absolute left-0 top-0 w-1.5 h-full cursor-col-resize z-40 hover:bg-white/30"
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          onSelectObject(obj.id)
                          setDragState({ kind: 'resize-left', objectId: obj.id, startMouseX: e.clientX, originalStartTime: obj.startTime, originalDuration: obj.duration })
                        }}
                      />
                    )}

                    {/* Main bar body */}
                    <div
                      className="absolute inset-0 rounded-sm overflow-hidden cursor-grab active:cursor-grabbing"
                      style={{
                        backgroundColor: color,
                        // Hidden clips (spec 14 R11) render dimmed + dashed so the state reads at a glance.
                        opacity: obj.hidden ? 0.4 : isSelected ? 1 : 0.75,
                        outline: isSelected ? '2px solid white' : obj.hidden ? '1px dashed rgba(255,255,255,0.6)' : 'none',
                        outlineOffset: -1,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        onSelectObject(obj.id)
                        setDragState({
                          kind: 'move',
                          objectId: obj.id,
                          startMouseX: e.clientX,
                          startMouseY: e.clientY,
                          originalStartTime: obj.startTime,
                          originalLane: obj.lane,
                          clampMinLane: minLane,
                          clampMaxLane: maxLane,
                        })
                      }}
                    >
                      {/* Enter/exit transition ramps (behind the label) */}
                      {obj.enter && obj.enter.kind !== 'none' && (
                        <div
                          className="absolute top-0 left-0 h-full pointer-events-none"
                          style={{ width: Math.min(timeToX(obj.enter.duration), width), background: 'linear-gradient(90deg, rgba(255,255,255,0.35), transparent)' }}
                        />
                      )}
                      {obj.exit && obj.exit.kind !== 'none' && (
                        <div
                          className="absolute top-0 right-0 h-full pointer-events-none"
                          style={{ width: Math.min(timeToX(obj.exit.duration), width), background: 'linear-gradient(270deg, rgba(255,255,255,0.35), transparent)' }}
                        />
                      )}
                      {/* Waveform background for audio clips */}
                      {obj.type === 'audio' && (obj.data as AudioData).waveform && (
                        <div className="absolute inset-0 flex items-end pointer-events-none opacity-30">
                          {(obj.data as AudioData).waveform!.map((peak, wi) => (
                            <div
                              key={wi}
                              className="flex-1 bg-white"
                              style={{ height: `${peak * 100}%`, minWidth: 0 }}
                            />
                          ))}
                        </div>
                      )}

                      <span className="relative text-[10px] text-white px-1 truncate leading-[32px] pointer-events-none">
                        <span className="font-bold">{obj.name}</span>
                        {' '}
                        <span className="opacity-70">[{formatTime(obj.startTime)} - {formatTime(obj.startTime + obj.duration)}]</span>
                      </span>

                      {/* AnimateIn sub-bar: display-only stripe showing the type-on / draw-on
                          region. Its length is edited from the Properties panel (Type-on bar),
                          not by dragging here. */}
                      {obj.animateIn > 0 && obj.type !== 'photo' && obj.type !== 'audio' && obj.type !== 'video' ? (() => {
                        // Cap sub-bar so it never covers the parent's resize handles (6px reserved each side)
                        const pct = (obj.animateIn / obj.duration) * 100
                        const maxPx = width - 6
                        return (
                          <div
                            className="absolute top-0 left-0 h-full pointer-events-none rounded-sm"
                            style={{
                              width: maxPx > 0 ? `min(${pct}%, ${maxPx}px)` : `${pct}%`,
                              background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 3px, transparent 3px, transparent 6px)',
                            }}
                          />
                        )
                      })() : null}
                    </div>

                    {/* Hide toggle (spec 14 R11) — revealed on hover; always shown when hidden.
                        Sits just left of the right resize handle. */}
                    <button
                      className={`absolute top-0.5 z-40 flex items-center justify-center rounded text-white hover:bg-black/50 ${obj.hidden ? 'opacity-100 bg-black/30' : 'opacity-0 group-hover:opacity-100'}`}
                      style={{ right: 11, width: 16, height: 16 }}
                      title={obj.hidden ? 'Show (H)' : 'Hide (H)'}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        dispatch({ type: 'UPDATE_OBJECT', objectId: obj.id, updates: { hidden: !obj.hidden } })
                      }}
                    >
                      <EyeIcon off={!!obj.hidden} />
                    </button>

                    {/* Keyframe markers (diamonds on top of the bar), colored to match the
                        panel pips. Drag one horizontally to retime that keyframe. */}
                    {(obj.keyframes ?? []).map((k, i) => {
                      const kfs = obj.keyframes!
                      // Clamp between neighbors (with a small gap) so dragging can't reorder them.
                      let minTime = i > 0 ? kfs[i - 1].time + 0.05 : 0
                      let maxTime = i < kfs.length - 1 ? kfs[i + 1].time - 0.05 : obj.duration
                      if (minTime > maxTime) { const m = (minTime + maxTime) / 2; minTime = m; maxTime = m }
                      const isActive = dragState?.kind === 'move-keyframe' && dragState.objectId === obj.id && dragState.kfIndex === i
                      return (
                        <div
                          key={i}
                          className="absolute top-1/2 w-3 h-3 border border-black/60 z-20 cursor-ew-resize pointer-events-auto"
                          style={{
                            left: timeToX(k.time),
                            background: keyframeColor(i),
                            transform: 'translate(-50%, -50%) rotate(45deg)',
                            boxShadow: isActive ? '0 0 0 2px #fff' : 'none',
                          }}
                          title={`Keyframe ${i + 1} @ ${k.time.toFixed(2)}s — drag to retime`}
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            onSelectObject(obj.id)
                            setDragState({
                              kind: 'move-keyframe',
                              objectId: obj.id,
                              kfIndex: i,
                              startMouseX: e.clientX,
                              originalTime: k.time,
                              minTime,
                              maxTime,
                            })
                          }}
                        />
                      )
                    })}

                    {/* Right edge handle. Media clips (R8) split into speed (top) + trim (bottom). */}
                    {splitHandles && md ? (
                      <>
                        {(() => {
                          const isActive = dragState?.kind === 'resize-right' && dragState.objectId === obj.id
                          return (
                            <div
                              className="absolute right-0 top-0 w-2 h-1/2 cursor-col-resize z-40 transition-colors"
                              style={{ background: isActive ? 'rgba(96,165,250,0.9)' : 'rgba(96,165,250,0.25)' }}
                              title="Drag to change speed"
                              onMouseEnter={(e) => { if (!dragState) (e.currentTarget.style.background = 'rgba(96,165,250,0.6)') }}
                              onMouseLeave={(e) => { if (!isActive) (e.currentTarget.style.background = 'rgba(96,165,250,0.25)') }}
                              onMouseDown={(e) => {
                                e.stopPropagation()
                                onSelectObject(obj.id)
                                setDragState({ kind: 'resize-right', objectId: obj.id, startMouseX: e.clientX, originalDuration: obj.duration })
                              }}
                            />
                          )
                        })()}
                        <div
                          className="absolute right-0 bottom-0 w-2 h-1/2 cursor-ew-resize z-40 flex items-center justify-center bg-amber-400/0 group-hover:bg-amber-400/60"
                          style={dragState?.kind === 'trim-right' && dragState.objectId === obj.id ? { background: 'rgba(251,191,36,0.9)' } : undefined}
                          title="Drag to trim out-point (keeps speed)"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            onSelectObject(obj.id)
                            setDragState({ kind: 'trim-right', objectId: obj.id, startMouseX: e.clientX, originalDuration: obj.duration, originalSourceIn: srcIn(md), originalSourceOut: srcOut(md), assetDuration: md.originalDuration })
                          }}
                        >
                          <span className="text-[9px] text-black font-bold leading-none pointer-events-none opacity-0 group-hover:opacity-100">]</span>
                        </div>
                      </>
                    ) : (
                      (() => {
                        const isActive = dragState?.kind === 'resize-right' && dragState.objectId === obj.id
                        return (
                          <div
                            className="absolute right-0 top-0 w-2 h-full cursor-col-resize z-40 transition-colors"
                            style={{ background: isActive ? 'rgba(96,165,250,0.9)' : 'rgba(96,165,250,0.25)' }}
                            onMouseEnter={(e) => { if (!dragState) (e.currentTarget.style.background = 'rgba(96,165,250,0.6)') }}
                            onMouseLeave={(e) => { if (!isActive) (e.currentTarget.style.background = 'rgba(96,165,250,0.25)') }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              onSelectObject(obj.id)
                              setDragState({ kind: 'resize-right', objectId: obj.id, startMouseX: e.clientX, originalDuration: obj.duration })
                            }}
                          />
                        )
                      })()
                    )}
                  </div>
                )
              })}

            </div>

            {/* Blank lane spacer for "add below" CTA alignment */}
            <div style={{ height: LANE_HEIGHT }} />

            {/* Playhead — spans full timeline height (ruler + spacers + lanes) */}
            <div
              className="absolute top-0 w-0.5 bg-red-500 z-20 pointer-events-none"
              style={{
                left: timeToX(globalTime),
                height: '100%',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
