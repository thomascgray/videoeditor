import { useRef, useCallback, useState, useEffect } from 'react'
import type { TimelineObject, ProjectAction, AudioData, VideoData } from '../types'

type TimelineProps = {
  objects: TimelineObject[]
  globalTime: number
  totalDuration: number
  selectedObjectId: string | null
  onSelectObject: (id: string | null) => void
  onSeek: (time: number) => void
  dispatch: React.Dispatch<ProjectAction>
}

const LANE_HEIGHT = 32
const LANE_GAP = 2
const RULER_HEIGHT = 24
const GUTTER_WIDTH = 32
const MIN_PIXELS_PER_SECOND = 20
const MAX_PIXELS_PER_SECOND = 400
const DEFAULT_PIXELS_PER_SECOND = 80
const TIMELINE_PADDING_SECONDS = 5

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
  | { kind: 'resize-animate-in'; objectId: string; startMouseX: number; originalAnimateIn: number; originalDuration: number }
  | { kind: 'playhead'; startMouseX: number; startTime: number }

export default function Timeline({
  objects,
  globalTime,
  totalDuration,
  selectedObjectId,
  onSelectObject,
  onSeek,
  dispatch,
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
        // Clamp duration for audio/video to respect 0.25x–4x playback rate
        if (obj && (obj.type === 'audio' || obj.type === 'video')) {
          const origDur = (obj.data as AudioData | VideoData).originalDuration
          newDuration = Math.max(origDur / 4, Math.min(origDur * 4, newDuration))
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
        // Clamp duration for audio/video to respect 0.25x–4x playback rate
        if (obj && (obj.type === 'audio' || obj.type === 'video')) {
          const origDur = (obj.data as AudioData | VideoData).originalDuration
          newDuration = Math.max(origDur / 4, Math.min(origDur * 4, newDuration))
        }
        const clampedAnimateIn = obj ? Math.min(obj.animateIn, newDuration) : undefined
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { duration: newDuration, ...(clampedAnimateIn !== undefined && { animateIn: clampedAnimateIn }) },
        })
      } else if (dragState.kind === 'resize-animate-in') {
        const newAnimateIn = Math.round(Math.max(0.1, dragState.originalAnimateIn + dt) * 10) / 10
        // If animateIn exceeds duration, expand duration to fit
        const newDuration = Math.round(Math.max(dragState.originalDuration, newAnimateIn) * 10) / 10
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { animateIn: newAnimateIn, duration: newDuration },
        })
      }
    }

    const handleMouseUp = () => {
      if (dragState.kind === 'move') {
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
                    {/* Left resize handle */}
                    <div
                      className="absolute left-0 top-0 w-1.5 h-full cursor-col-resize z-10 hover:bg-white/30"
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        onSelectObject(obj.id)
                        setDragState({
                          kind: 'resize-left',
                          objectId: obj.id,
                          startMouseX: e.clientX,
                          originalStartTime: obj.startTime,
                          originalDuration: obj.duration,
                        })
                      }}
                    />

                    {/* Main bar body */}
                    <div
                      className="absolute inset-0 rounded-sm overflow-hidden cursor-grab active:cursor-grabbing"
                      style={{
                        backgroundColor: color,
                        opacity: isSelected ? 1 : 0.75,
                        outline: isSelected ? '2px solid white' : 'none',
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

                      {/* AnimateIn sub-bar: any object with a draw-on / type-on animation
                          (arrows, freehand, text, shapes — everything except media). */}
                      {obj.animateIn > 0 && obj.type !== 'photo' && obj.type !== 'audio' && obj.type !== 'video' ? (() => {
                        // Cap sub-bar so it never covers the parent's resize handles (6px reserved each side)
                        const pct = (obj.animateIn / obj.duration) * 100
                        const maxPx = width - 6
                        return (
                          <div
                            className="absolute top-0 left-0 h-full pointer-events-none"
                            style={{
                              width: maxPx > 0 ? `min(${pct}%, ${maxPx}px)` : `${pct}%`,
                            }}
                          >
                            <div
                              className="absolute inset-0 rounded-sm"
                              style={{
                                background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 3px, transparent 3px, transparent 6px)',
                              }}
                            />
                            {/* Drag handle for animateIn right edge */}
                            {(() => {
                              const isActive = dragState?.kind === 'resize-animate-in' && dragState.objectId === obj.id
                              return (
                                <div
                                  className="absolute right-0 top-0 w-2 h-full cursor-col-resize z-10 pointer-events-auto transition-colors"
                                  style={{
                                    background: isActive ? 'rgba(251,191,36,0.9)' : 'rgba(251,191,36,0.35)',
                                  }}
                                  onMouseEnter={(e) => { if (!dragState) (e.currentTarget.style.background = 'rgba(251,191,36,0.7)') }}
                                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget.style.background = 'rgba(251,191,36,0.35)') }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation()
                                    onSelectObject(obj.id)
                                    setDragState({
                                      kind: 'resize-animate-in',
                                      objectId: obj.id,
                                      startMouseX: e.clientX,
                                      originalAnimateIn: obj.animateIn,
                                      originalDuration: obj.duration,
                                    })
                                  }}
                                />
                              )
                            })()}
                          </div>
                        )
                      })() : null}
                    </div>

                    {/* Right resize handle */}
                    {(() => {
                      const isActive = dragState?.kind === 'resize-right' && dragState.objectId === obj.id
                      return (
                    <div
                      className="absolute right-0 top-0 w-2 h-full cursor-col-resize z-10 transition-colors"
                      style={{
                        background: isActive ? 'rgba(96,165,250,0.9)' : 'rgba(96,165,250,0.25)',
                      }}
                      onMouseEnter={(e) => { if (!dragState) (e.currentTarget.style.background = 'rgba(96,165,250,0.6)') }}
                      onMouseLeave={(e) => { if (!isActive) (e.currentTarget.style.background = 'rgba(96,165,250,0.25)') }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        onSelectObject(obj.id)
                        setDragState({
                          kind: 'resize-right',
                          objectId: obj.id,
                          startMouseX: e.clientX,
                          originalDuration: obj.duration,
                        })
                      }}
                    />
                      )
                    })()}
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
