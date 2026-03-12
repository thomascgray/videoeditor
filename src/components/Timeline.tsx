import { useRef, useCallback, useState, useEffect } from 'react'
import type { TimelineObject, ProjectAction } from '../types'

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
const MIN_PIXELS_PER_SECOND = 20
const MAX_PIXELS_PER_SECOND = 400
const DEFAULT_PIXELS_PER_SECOND = 80
const TIMELINE_PADDING_SECONDS = 5

const TYPE_COLORS: Record<string, string> = {
  photo: '#3b82f6',     // blue
  arrow: '#ef4444',     // red
  text: '#22c55e',      // green
  rectangle: '#f59e0b', // amber
  circle: '#a855f7',    // purple
  freehand: '#ec4899',  // pink
}

type DragState =
  | null
  | { kind: 'move'; objectId: string; startMouseX: number; startMouseY: number; originalStartTime: number; originalLane: number }
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

  // Compute lanes: objects can have any integer lane (including negative)
  const minLane = objects.reduce((min, obj) => Math.min(min, obj.lane), 0)
  const maxLane = objects.reduce((max, obj) => Math.max(max, obj.lane), 0)
  // During a move drag, show an extra lane above for "new lane" drop zone
  const isDraggingMove = dragState?.kind === 'move'
  // Add drop zones above and below during drag
  const laneCount = Math.max(maxLane - minLane + 1, 1) + (isDraggingMove ? 2 : 0)

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

  // Mouse drag handling
  useEffect(() => {
    if (!dragState) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startMouseX
      const dt = dx / pixelsPerSecond

      if (dragState.kind === 'playhead') {
        onSeek(Math.max(0, dragState.startTime + dt))
      } else if (dragState.kind === 'move') {
        const newStart = Math.max(0, dragState.originalStartTime + dt)
        // Calculate target lane from vertical mouse movement (no clamp — negative lanes are fine)
        const dy = e.clientY - dragState.startMouseY
        const laneDelta = Math.round(-dy / (LANE_HEIGHT + LANE_GAP))
        const targetLane = dragState.originalLane + laneDelta
        dispatch({
          type: 'UPDATE_OBJECT_TRANSIENT',
          objectId: dragState.objectId,
          updates: { startTime: newStart, lane: targetLane },
        })
      } else if (dragState.kind === 'resize-left') {
        const newStart = Math.max(0, Math.min(
          dragState.originalStartTime + dragState.originalDuration - 0.1,
          dragState.originalStartTime + dt,
        ))
        const newDuration = dragState.originalStartTime + dragState.originalDuration - newStart
        const obj = objects.find((o) => o.id === dragState.objectId)
        const clampedAnimateIn = obj ? Math.min(obj.animateIn, newDuration) : undefined
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { startTime: newStart, duration: newDuration, ...(clampedAnimateIn !== undefined && { animateIn: clampedAnimateIn }) },
        })
      } else if (dragState.kind === 'resize-right') {
        const newDuration = Math.max(0.1, dragState.originalDuration + dt)
        const obj = objects.find((o) => o.id === dragState.objectId)
        const clampedAnimateIn = obj ? Math.min(obj.animateIn, newDuration) : undefined
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { duration: newDuration, ...(clampedAnimateIn !== undefined && { animateIn: clampedAnimateIn }) },
        })
      } else if (dragState.kind === 'resize-animate-in') {
        const newAnimateIn = Math.max(0.1, dragState.originalAnimateIn + dt)
        // If animateIn exceeds duration, expand duration to fit
        const newDuration = Math.max(dragState.originalDuration, newAnimateIn)
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
  }, [dragState, pixelsPerSecond, dispatch, onSeek])

  // Render ruler ticks
  const ticks: { time: number; label: string; major: boolean }[] = []
  const tickInterval = pixelsPerSecond >= 100 ? 1 : pixelsPerSecond >= 40 ? 2 : 5
  for (let t = 0; t <= viewDuration; t += tickInterval) {
    ticks.push({ time: t, label: `${t}s`, major: t % (tickInterval * 2) === 0 })
  }

  const trackHeight = laneCount * (LANE_HEIGHT + LANE_GAP) + LANE_GAP

  return (
    <div className="bg-gray-900 border-t border-gray-700 select-none" style={{ minHeight: 120 }}>
      <div
        ref={containerRef}
        className="overflow-x-auto overflow-y-hidden"
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
            {Array.from({ length: laneCount }, (_, i) => {
              const isTopDropZone = isDraggingMove && i === laneCount - 1
              const isBottomDropZone = isDraggingMove && i === 0
              const isDropZone = isTopDropZone || isBottomDropZone
              return (
                <div
                  key={i}
                  className="absolute w-full"
                  style={{
                    top: (laneCount - 1 - i) * (LANE_HEIGHT + LANE_GAP) + LANE_GAP,
                    height: LANE_HEIGHT,
                    background: isDropZone
                      ? 'rgba(59, 130, 246, 0.15)'
                      : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                    borderTop: isDropZone ? '1px dashed rgba(59, 130, 246, 0.5)' : 'none',
                    borderBottom: isDropZone ? '1px dashed rgba(59, 130, 246, 0.5)' : 'none',
                  }}
                />
              )
            })}

            {/* Object bars */}
            {objects.map((obj) => {
              const left = timeToX(obj.startTime)
              const width = Math.max(timeToX(obj.duration), 4)
              // Higher lane = higher in the panel (visually higher = foreground)
              // Map lane number to visual index: lane minLane = index 0 (bottom)
              const laneIndex = obj.lane - minLane + (isDraggingMove ? 1 : 0)
              const top = (laneCount - 1 - laneIndex) * (LANE_HEIGHT + LANE_GAP) + LANE_GAP
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
                      })
                    }}
                  >
                    <span className="text-[10px] text-white px-1 truncate leading-[32px] pointer-events-none">
                      {obj.name}
                    </span>

                    {/* AnimateIn sub-bar for drawable types */}
                    {obj.animateIn > 0 && (obj.type === 'arrow' || obj.type === 'freehand') ? (() => {
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

            {/* Playhead */}
            <div
              className="absolute top-0 w-0.5 bg-red-500 z-20 pointer-events-none"
              style={{
                left: timeToX(globalTime),
                height: trackHeight,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
