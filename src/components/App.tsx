import { useState, useCallback, useEffect, useRef } from 'react'
import type { InteractionMode, TimelineObjectType, TimelineObject, ArrowData, FreehandData } from '../types'
import { createTimelineObject } from '../types'
import { useProject } from '../hooks/useProject'
import { usePlayback } from '../hooks/usePlayback'
import Canvas from './Canvas'
import AnnotationTools from './AnnotationTools'
import Timeline from './Timeline'
import PropertiesPanel from './PropertiesPanel'
import ImportModal from './ImportModal'
import ExportModal from './ExportModal'

export default function App() {
  const { project, dispatch, canUndo, canRedo, undo, redo } = useProject()
  const playback = usePlayback(project)

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('select')
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const selectedObject = project.objects.find((o) => o.id === selectedObjectId) ?? null

  // Draw mode only enabled when an arrow or freehand object is selected
  const drawEnabled = selectedObject != null && (selectedObject.type === 'arrow' || selectedObject.type === 'freehand')

  // Track the previous interaction mode for tightening on draw→select
  const prevModeRef = useRef<InteractionMode>(interactionMode)

  // Tighten bounding box when switching from draw → select
  const tightenBbox = useCallback((obj: typeof selectedObject) => {
    if (!obj) return
    if (obj.type !== 'arrow' && obj.type !== 'freehand') return

    // Collect all points (arrows use points, freehand uses strokes)
    const allPoints = obj.type === 'arrow'
      ? (obj.data as ArrowData).points
      : (obj.data as FreehandData).strokes.flat()
    if (allPoints.length < 2) return

    const PADDING = 0.05 // 5% padding in normalized object-local space

    // Find extents of points (in object-local 0–1)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of allPoints) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }

    // Add padding
    const rangeX = maxX - minX || 0.01
    const rangeY = maxY - minY || 0.01
    const padX = rangeX * PADDING
    const padY = rangeY * PADDING
    minX -= padX
    minY -= padY
    maxX += padX
    maxY += padY

    // Compute new bbox in canvas-normalized coords
    const newX = obj.x + minX * obj.width
    const newY = obj.y + minY * obj.height
    const newW = (maxX - minX) * obj.width
    const newH = (maxY - minY) * obj.height

    const renorm = (p: { x: number; y: number }) => ({
      x: (p.x - minX) / (maxX - minX),
      y: (p.y - minY) / (maxY - minY),
    })

    // Renormalize points to the new bbox
    const newData = obj.type === 'arrow'
      ? { ...obj.data, points: (obj.data as ArrowData).points.map(renorm) }
      : { strokes: (obj.data as FreehandData).strokes.map((s) => s.map(renorm)) }

    dispatch({
      type: 'UPDATE_OBJECT',
      objectId: obj.id,
      updates: {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
        data: newData,
      },
    })
  }, [dispatch])

  const handleSetMode = useCallback((mode: InteractionMode) => {
    // Tighten bbox when leaving draw mode
    if (prevModeRef.current === 'draw' && mode === 'select' && selectedObject) {
      tightenBbox(selectedObject)
    }
    prevModeRef.current = mode
    setInteractionMode(mode)
  }, [selectedObject, tightenBbox])

  // If draw mode is active but no longer valid, switch back to select
  useEffect(() => {
    if (interactionMode === 'draw' && !drawEnabled) {
      handleSetMode('select')
    }
  }, [interactionMode, drawEnabled, handleSetMode])

  // Central helper: assigns each object to a new lane above all existing objects, then dispatches
  const addObjects = useCallback((objects: TimelineObject[]) => {
    const maxLane = project.objects.reduce((max, o) => Math.max(max, o.lane), -1)
    const withLanes = objects.map((obj, i) => ({ ...obj, lane: maxLane + 1 + i }))
    dispatch({ type: 'ADD_OBJECTS', objects: withLanes })
    return withLanes
  }, [project.objects, dispatch])

  const handleCreateObject = useCallback((type: TimelineObjectType) => {
    const defaultData: Record<TimelineObjectType, () => ReturnType<typeof createTimelineObject>['data']> = {
      arrow: () => ({ points: [], headSize: 20, curved: false }),
      text: () => ({ content: 'Text' }),
      rectangle: () => ({} as Record<string, never>),
      circle: () => ({} as Record<string, never>),
      freehand: () => ({ strokes: [] }),
      photo: () => ({ src: '' }),
    }

    const obj = createTimelineObject(type, defaultData[type](), {
      startTime: playback.globalTime,
      duration: 5,
      x: type === 'text' ? 0.3 : 0,
      y: type === 'text' ? 0.4 : 0,
      width: type === 'text' ? 0.4 : 1,
      height: type === 'text' ? 0.2 : 1,
    })

    const [added] = addObjects([obj])
    setSelectedObjectId(added.id)

    // Auto-enter draw mode for arrow/freehand
    if (type === 'arrow' || type === 'freehand') {
      handleSetMode('draw')
    } else {
      handleSetMode('select')
    }
  }, [playback.globalTime, addObjects, handleSetMode])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === ' ') {
        e.preventDefault()
        playback.togglePlayback()
      } else if (e.key === 'v') {
        handleSetMode('select')
      } else if (e.key === 'd' && drawEnabled) {
        handleSetMode('draw')
      } else if (e.key === 'Escape') {
        handleSetMode('select')
        setSelectedObjectId(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObject) {
        dispatch({ type: 'REMOVE_OBJECT', objectId: selectedObject.id })
        setSelectedObjectId(null)
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playback, interactionMode, selectedObject, drawEnabled, dispatch, undo, redo, handleSetMode])

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Top Bar */}
      <header className="h-12 flex items-center justify-between px-4 bg-gray-900 border-b border-gray-700 shrink-0">
        <input
          type="text"
          value={project.name}
          onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
          className="bg-transparent text-white font-semibold text-sm border-b border-transparent hover:border-gray-600 focus:border-indigo-500 outline-none px-1 py-0.5"
        />
        <div className="flex items-center gap-2">
          <AnnotationTools
            interactionMode={interactionMode}
            onSetMode={handleSetMode}
            onCreateObject={handleCreateObject}
            onAddImage={() => setShowImport(true)}
            drawEnabled={drawEnabled}
          />
          <span className="w-px h-6 bg-gray-700" />
          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
            title="Redo (Ctrl+Y)"
          >
            Redo
          </button>
          <span className="w-px h-6 bg-gray-700" />
          <button
            onClick={playback.togglePlayback}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded transition-colors cursor-pointer"
          >
            {playback.isPlaying ? 'Pause' : 'Play'}
          </button>
          <span className="text-xs text-gray-400 tabular-nums min-w-16 text-right">
            {playback.globalTime.toFixed(1)}s / {playback.totalDuration.toFixed(1)}s
          </span>
          <button
            onClick={() => setShowExport(true)}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded font-medium transition-colors cursor-pointer"
          >
            Export
          </button>
        </div>
      </header>

      {/* Main Content: Viewport + Properties */}
      <div className="flex-1 flex min-h-0">
        <Canvas
          objects={project.objects}
          globalTime={playback.globalTime}
          width={project.width}
          height={project.height}
          selectedObjectId={selectedObjectId}
          interactionMode={interactionMode}
          onSelectObject={handleSelectObject}
          dispatch={dispatch}
        />

        <PropertiesPanel
          object={selectedObject}
          dispatch={dispatch}
        />
      </div>

      {/* Timeline */}
      <Timeline
        objects={project.objects}
        globalTime={playback.globalTime}
        totalDuration={playback.totalDuration}
        selectedObjectId={selectedObjectId}
        onSelectObject={handleSelectObject}
        onSeek={playback.seek}
        dispatch={dispatch}
      />

      {/* Modals */}
      {showImport && (
        <ImportModal
          onImport={addObjects}
          onClose={() => setShowImport(false)}
          insertAtTime={playback.globalTime}
        />
      )}
      {showExport && <ExportModal project={project} onClose={() => setShowExport(false)} />}
    </div>
  )
}
