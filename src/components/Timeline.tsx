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
  | { kind: 'move'; objectId: string; startMouseX: number; originalStartTime: number }
  | { kind: 'resize-left'; objectId: string; startMouseX: number; originalStartTime: number; originalDuration: number }
  | { kind: 'resize-right'; objectId: string; startMouseX: number; originalDuration: number }
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

  // Compute lanes: group objects by their lane property
  const maxLane = objects.reduce((max, obj) => Math.max(max, obj.lane), -1)
  const laneCount = Math.max(maxLane + 1, 1)

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
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { startTime: newStart },
        })
      } else if (dragState.kind === 'resize-left') {
        const newStart = Math.max(0, Math.min(
          dragState.originalStartTime + dragState.originalDuration - 0.1,
          dragState.originalStartTime + dt,
        ))
        const newDuration = dragState.originalStartTime + dragState.originalDuration - newStart
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { startTime: newStart, duration: newDuration },
        })
      } else if (dragState.kind === 'resize-right') {
        const newDuration = Math.max(0.1, dragState.originalDuration + dt)
        dispatch({
          type: 'UPDATE_OBJECT',
          objectId: dragState.objectId,
          updates: { duration: newDuration },
        })
      }
    }

    const handleMouseUp = () => {
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
            {Array.from({ length: laneCount }, (_, lane) => (
              <div
                key={lane}
                className="absolute w-full"
                style={{
                  top: (laneCount - 1 - lane) * (LANE_HEIGHT + LANE_GAP) + LANE_GAP,
                  height: LANE_HEIGHT,
                  background: lane % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                }}
              />
            ))}

            {/* Object bars */}
            {objects.map((obj) => {
              const left = timeToX(obj.startTime)
              const width = Math.max(timeToX(obj.duration), 4)
              // Higher lane = higher in the panel (visually higher = foreground)
              const top = (laneCount - 1 - obj.lane) * (LANE_HEIGHT + LANE_GAP) + LANE_GAP
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
                        originalStartTime: obj.startTime,
                      })
                    }}
                  >
                    <span className="text-[10px] text-white px-1 truncate leading-[32px] pointer-events-none">
                      {obj.name}
                    </span>
                  </div>

                  {/* Right resize handle */}
                  <div
                    className="absolute right-0 top-0 w-1.5 h-full cursor-col-resize z-10 hover:bg-white/30"
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
